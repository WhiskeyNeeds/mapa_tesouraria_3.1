import { randomUUID } from 'crypto'
import type { PrismaClient } from '@prisma/client'
import { encrypt, decrypt } from '../../plugins/encrypt.js'
import { httpError } from '../../lib/errors.js'
import type { RedisClient } from '../../plugins/redis.js'

const TOC_STATE_PREFIX = 'toconline:state:'

export class ToconlineService {
  constructor(private prisma: PrismaClient) { }

  // ── Config ────────────────────────────────────────────────────────────────

  async getConfig(clientId: string) {
    return this.prisma.toconlineConfig.findUnique({ where: { clientId } })
  }

  async getPublicConfig(clientId: string) {
    const cfg = await this.getConfig(clientId)
    if (!cfg) return { callbackUri: this.getRedirectUri() }
    const { tocClientSecret: _s, accessToken: _a, refreshToken: _r, ...pub } = cfg
    return { ...pub, callbackUri: this.getRedirectUri() }
  }

  async saveCredentials(clientId: string, data: {
    oauthUrl: string
    baseUrl: string
    tocClientId: string
    tocClientSecret?: string
  }) {
    const existing = await this.getConfig(clientId)
    if (!existing && !data.tocClientSecret) throw httpError(400, 'tocClientSecret is required on first setup')
    const secretEnc = data.tocClientSecret ? encrypt(data.tocClientSecret.trim()) : (existing?.tocClientSecret ?? '')
    const { tocClientSecret: _, ...rest } = data
    // Strip trailing slashes so paths never double up
    rest.oauthUrl = rest.oauthUrl.trim().replace(/\/+$/, '')
    rest.baseUrl = rest.baseUrl.trim().replace(/\/+$/, '')
    return this.prisma.toconlineConfig.upsert({
      where: { clientId },
      update: { ...rest, tocClientSecret: secretEnc, status: 'UNCONFIGURED', accessToken: null, refreshToken: null },
      create: { clientId, ...rest, tocClientSecret: secretEnc },
    })
  }

  async getAuthUrl(clientId: string, redis: RedisClient): Promise<string> {
    const cfg = await this.requireConfig(clientId)
    const state = randomUUID()
    const redirectUri = this.getRedirectUri()
    await redis.setex(`${TOC_STATE_PREFIX}${state}`, 600, clientId)
    await this.prisma.toconlineConfig.update({ where: { clientId }, data: { status: 'PENDING_AUTH' } })

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: cfg.tocClientId,
      redirect_uri: redirectUri,
      state,
    })
    return `${cfg.oauthUrl}/oauth/authorize?${params}`
  }

  async handleCallback(code: string, state: string, redis: RedisClient): Promise<void> {
    const clientId = await redis.get(`${TOC_STATE_PREFIX}${state}`)
    if (!clientId) throw httpError(400, 'Invalid or expired OAuth state')
    await redis.del(`${TOC_STATE_PREFIX}${state}`)

    const cfg = await this.requireConfig(clientId)
    const redirectUri = this.getRedirectUri()
    const secret = decrypt(cfg.tocClientSecret)

    const res = await fetch(`${cfg.oauthUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: cfg.tocClientId,
        client_secret: secret,
      }),
    })
    if (!res.ok) throw httpError(502, 'TOConline token exchange failed')
    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number }

    await this.prisma.toconlineConfig.update({
      where: { clientId },
      data: {
        accessToken: encrypt(data.access_token),
        refreshToken: data.refresh_token ? encrypt(data.refresh_token) : null,
        tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
        status: 'ACTIVE',
        lastError: null,
      },
    })
  }

  async setTokensManually(clientId: string, data: {
    accessToken: string
    refreshToken?: string
    expiresIn?: number
  }) {
    await this.requireConfig(clientId)
    const accessToken = data.accessToken.trim()
    const refreshToken = data.refreshToken?.trim() || null
    if (!accessToken) throw httpError(400, 'accessToken não pode ser vazio')
    return this.prisma.toconlineConfig.update({
      where: { clientId },
      data: {
        accessToken: encrypt(accessToken),
        refreshToken: refreshToken ? encrypt(refreshToken) : null,
        tokenExpiresAt: data.expiresIn ? new Date(Date.now() + data.expiresIn * 1000) : null,
        status: 'ACTIVE',
        lastError: null,
      },
    })
  }

  async getCredentialsForTesting(clientId: string) {
    const cfg = await this.requireActiveConfig(clientId)
    return {
      baseUrl:     cfg.baseUrl,
      accessToken: decrypt(cfg.accessToken!),
    }
  }

  async revokeConfig(clientId: string): Promise<void> {
    await this.prisma.toconlineConfig.update({
      where: { clientId },
      data: { accessToken: null, refreshToken: null, tokenExpiresAt: null, status: 'UNCONFIGURED' },
    })
  }

  // ── HTTP helper ────────────────────────────────────────────────────────────

  private async apiGet<T>(clientId: string, path: string, params?: Record<string, string>): Promise<T> {
    const cfg = await this.requireActiveConfig(clientId)
    const token = decrypt(cfg.accessToken!)
    const url = new URL(`${cfg.baseUrl}${path}`)
    if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))

    let res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } })

    if (res.status === 401) {
      let body401 = ''
      try { body401 = JSON.stringify(await res.clone().json()) } catch { body401 = await res.text().catch(() => '') }
      console.error(`[TOConline] 401 on GET ${path} for ${clientId}: ${body401}`)
      await this.tryRefreshToken(clientId, cfg)
      const cfg2 = await this.requireActiveConfig(clientId)
      const token2 = decrypt(cfg2.accessToken!)
      res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token2}` } })
    }

    if (!res.ok) throw httpError(res.status, `TOConline GET ${path} failed: ${res.statusText}`)
    return res.json() as Promise<T>
  }

  // Fetches a TOConline master-data endpoint and normalises the JSON:API envelope
  // ({ data: [{ id, attributes }] }) into a flat array of plain objects.
  private async apiGetFlat(clientId: string, path: string): Promise<Record<string, unknown>[]> {
    const res = await this.apiGet<unknown>(clientId, path)

    if (Array.isArray(res)) return res as Record<string, unknown>[]

    if (res != null && typeof res === 'object') {
      const obj = res as Record<string, unknown>
      if (Array.isArray(obj.data)) {
        type JsonApiItem = { id?: unknown; attributes?: Record<string, unknown> }
        return (obj.data as JsonApiItem[]).map((item) => ({ id: item.id, ...(item.attributes ?? {}) }))
      }
      for (const k of ['items', 'results', 'records', 'list']) {
        if (Array.isArray(obj[k])) return obj[k] as Record<string, unknown>[]
      }
    }

    return []
  }

  private async apiPatch<T>(clientId: string, path: string, body: unknown): Promise<T> {
    const cfg = await this.requireActiveConfig(clientId)
    const token = decrypt(cfg.accessToken!)
    console.info(`[TOConline] PATCH ${path} payload: ${JSON.stringify(body)}`)

    let res = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/vnd.api+json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.status === 401) {
      await this.tryRefreshToken(clientId, cfg)
      const cfg2 = await this.requireActiveConfig(clientId)
      const token2 = decrypt(cfg2.accessToken!)
      res = await fetch(`${cfg.baseUrl}${path}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/vnd.api+json', Accept: 'application/json' },
        body: JSON.stringify(body),
      })
    }

    if (!res.ok) {
      let detail = res.statusText
      try { detail = JSON.stringify(await res.clone().json()) } catch { detail = await res.text().catch(() => res.statusText) }
      console.error(`[TOConline] PATCH ${path} failed for ${clientId} (${res.status}): ${detail}`)
      throw httpError(res.status, `TOConline PATCH ${path} failed: ${detail}`)
    }
    return res.json() as Promise<T>
  }

  private async apiPost<T>(clientId: string, path: string, body: unknown): Promise<T> {
    const cfg = await this.requireActiveConfig(clientId)
    const token = decrypt(cfg.accessToken!)
    console.info(`[TOConline] POST ${path} payload: ${JSON.stringify(body)}`)

    let res = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/vnd.api+json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.status === 401) {
      await this.tryRefreshToken(clientId, cfg)
      const cfg2 = await this.requireActiveConfig(clientId)
      const token2 = decrypt(cfg2.accessToken!)
      res = await fetch(`${cfg.baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/vnd.api+json', Accept: 'application/json' },
        body: JSON.stringify(body),
      })
    }

    if (!res.ok) {
      let detail = res.statusText
      try { detail = JSON.stringify(await res.clone().json()) } catch { detail = await res.text().catch(() => res.statusText) }
      console.error(`[TOConline] POST ${path} failed for ${clientId} (${res.status}): ${detail}`)
      throw httpError(res.status, `TOConline POST ${path} failed: ${detail}`)
    }
    return res.json() as Promise<T>
  }

  private async tryRefreshToken(clientId: string, cfg: Awaited<ReturnType<typeof this.requireConfig>>) {
    if (!cfg.refreshToken) {
      const msg = 'Sem refresh token — o access token expirou e não é possível renovar automaticamente. Insira um novo token manualmente.'
      console.error(`[TOConline] no refresh_token for ${clientId}`)
      await this.prisma.toconlineConfig.update({ where: { clientId }, data: { status: 'ERROR', lastError: msg } })
      throw httpError(401, msg)
    }

    const secret = decrypt(cfg.tocClientSecret)
    const rt = decrypt(cfg.refreshToken)

    const res = await fetch(`${cfg.oauthUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: rt,
        client_id: cfg.tocClientId,
        client_secret: secret,
      }),
    })

    if (!res.ok) {
      let detail = `HTTP ${res.status} ${res.statusText}`
      try {
        const body = await res.json() as Record<string, unknown>
        detail = body.error_description as string
          ?? body.message as string
          ?? body.error as string
          ?? JSON.stringify(body)
      } catch { /* body não é JSON */ }
      console.error(`[TOConline] refresh_token failed for ${clientId}: ${detail}`)
      await this.prisma.toconlineConfig.update({ where: { clientId }, data: { status: 'ERROR', lastError: `Refresh falhou: ${detail}` } })
      throw httpError(401, `TOConline refresh falhou: ${detail}`)
    }

    const data = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number }
    await this.prisma.toconlineConfig.update({
      where: { clientId },
      data: {
        accessToken: encrypt(data.access_token),
        refreshToken: data.refresh_token ? encrypt(data.refresh_token) : cfg.refreshToken,
        tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
        status: 'ACTIVE',
        lastError: null,
      },
    })
  }

  // ── TOConline endpoints ────────────────────────────────────────────────────

  async getPurchaseDocuments(clientId: string, filters?: Record<string, string>) {
    const raw = await this.apiGet<unknown>(clientId, '/api/v1/commercial_purchases_documents', filters)
    return this.unwrapArray(raw)
  }

  async getSalesDocuments(clientId: string, filters?: Record<string, string>) {
    const raw = await this.apiGet<unknown>(clientId, '/api/v1/commercial_sales_documents', filters)
    return this.unwrapArray(raw)
  }

  // Unwraps common API response envelopes ({ data: [...] }, { items: [...] }, etc.)
  // without touching individual item structure (unlike apiGetFlat which flattens JSON:API attributes).
  private unwrapArray(raw: unknown): Record<string, unknown>[] {
    if (Array.isArray(raw)) return raw as Record<string, unknown>[]
    if (raw != null && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>
      for (const k of ['data', 'items', 'results', 'records', 'list']) {
        if (Array.isArray(obj[k])) return obj[k] as Record<string, unknown>[]
      }
    }
    return []
  }

  async createSalesDocument(clientId: string, payload: unknown) {
    return this.apiPost(clientId, '/api/v1/commercial_sales_documents', payload)
  }

  async createSalesReceipt(clientId: string, payload: unknown) {
    return this.apiPost(clientId, '/api/v1/commercial_sales_receipts', payload)
  }

  async createPurchaseDocument(clientId: string, payload: unknown) {
    return this.apiPost(clientId, '/api/v1/commercial_purchases_documents', payload)
  }

  async createPurchasePayment(clientId: string, payload: unknown) {
    return this.apiPost(clientId, '/api/v1/commercial_purchases_payments', payload)
  }

  async getCountries(clientId: string) {
    return this.apiGetFlat(clientId, '/api/countries')
  }

  async getCustomers(clientId: string) {
    return this.apiGetFlat(clientId, '/api/customers')
  }

  async getCustomerWithAddress(clientId: string, customerId: string) {
    type JsonApiRef = { id: string }
    type AddressRes = {
      data: {
        id: string
        attributes: Record<string, unknown>
        relationships?: { country?: { data?: JsonApiRef | null } }
      }
    }
    type CustomerRes = {
      data: {
        id: string
        attributes: Record<string, unknown>
        relationships?: {
          main_address?: { data?: JsonApiRef | null }
          addresses?:    { data?: JsonApiRef[] | null }
        }
      }
    }

    const res = await this.apiGet<CustomerRes>(clientId, `/api/customers/${customerId}`)
    const customer: Record<string, unknown> = { id: res.data.id, ...res.data.attributes }

    const mainAddressId = res.data.relationships?.main_address?.data?.id
    const allAddressRefs = res.data.relationships?.addresses?.data ?? []
    const allAddressIds = Array.isArray(allAddressRefs) ? allAddressRefs.map(a => a.id) : []

    if (allAddressIds.length > 0) {
      const addresses = await Promise.all(
        allAddressIds.map(async (id) => {
          try {
            const addrRes = await this.apiGet<AddressRes>(clientId, `/api/addresses/${id}`)
            return {
              id,
              ...addrRes.data.attributes,
              _countryId: addrRes.data.relationships?.country?.data?.id ?? null,
              _isMain: id === mainAddressId,
            }
          } catch {
            return { id, _isMain: id === mainAddressId }
          }
        })
      )
      customer._addresses = addresses
      customer._address   = addresses.find(a => a._isMain) ?? addresses[0] ?? null
    }

    return customer
  }

  async createCustomer(clientId: string, attrs: Record<string, unknown>, addressAttrs?: Record<string, unknown>) {
    type Rels = { main_address?: { data?: { id: string } | null }; addresses?: { data?: { id: string }[] | null } }
    type Res  = { data: { id: string; relationships?: Rels } }

    const created = await this.apiPost<Res>(clientId, '/api/customers', {
      data: { type: 'customers', attributes: attrs },
    })

    if (addressAttrs && Object.keys(addressAttrs).length > 0) {
      // Try the POST response first; if null fall back to a GET
      let addressId = created.data.relationships?.main_address?.data?.id
        ?? created.data.relationships?.addresses?.data?.[0]?.id

      if (!addressId) {
        try {
          const got = await this.apiGet<Res>(clientId, `/api/customers/${created.data.id}`)
          addressId = got.data.relationships?.main_address?.data?.id
            ?? got.data.relationships?.addresses?.data?.[0]?.id
        } catch { /* non-fatal */ }
      }

      if (addressId) {
        await this.patchAddress(clientId, addressId, addressAttrs)
      }
    }

    return created
  }

  async createAddress(clientId: string, attrs: Record<string, unknown>) {
    return this.apiPost(clientId, '/api/addresses', { data: { type: 'addresses', attributes: attrs } })
  }

  async patchAddress(clientId: string, addressId: string, attrs: Record<string, unknown>) {
    return this.apiPatch(clientId, `/api/addresses/${addressId}`, {
      data: { type: 'addresses', id: addressId, attributes: attrs },
    })
  }

  async getSuppliers(clientId: string) {
    return this.apiGetFlat(clientId, '/api/suppliers')
  }

  async createSupplier(clientId: string, attrsOrEnvelope: Record<string, unknown>) {
    // Accept either a JSON:API envelope ({ data: { type, attributes } })
    // or a plain attributes object. If the caller already sent a data
    // envelope, forward it as-is to avoid double-wrapping.
    if (attrsOrEnvelope && typeof attrsOrEnvelope === 'object' && 'data' in attrsOrEnvelope) {
      return this.apiPost(clientId, '/api/suppliers', attrsOrEnvelope)
    }
    return this.apiPost(clientId, '/api/suppliers', { data: { type: 'suppliers', attributes: attrsOrEnvelope } })
  }

  async getBankAccounts(clientId: string) {
    return this.apiGet<unknown[]>(clientId, '/api/bank_accounts')
  }

  async getExpenseCategories(clientId: string) {
    return this.apiGet<unknown[]>(clientId, '/api/expense_categories')
  }

  async getTaxDescriptors(clientId: string) {
    return this.apiGet<unknown[]>(clientId, '/api/tax_descriptors')
  }

  async getItems(clientId: string) {
    return this.apiGetFlat(clientId, '/api/products')
  }

  async createItem(clientId: string, attrs: Record<string, unknown>) {
    return this.apiPost(clientId, '/api/products', { data: { type: 'products', attributes: { ...attrs, type: 'Product' } } })
  }

  async getServices(clientId: string) {
    return this.apiGetFlat(clientId, '/api/services')
  }

  async createService(clientId: string, attrs: Record<string, unknown>) {
    return this.apiPost(clientId, '/api/services', { data: { type: 'services', attributes: { ...attrs, type: 'Service' } } })
  }

  // ── Analítica (local persistence) ────────────────────────────────────────────

  async getAnalytics(clientId: string, itemType?: string) {
    return this.prisma.productAnalytic.findMany({
      where: { clientId, ...(itemType ? { itemType } : {}) },
      orderBy: { updatedAt: 'desc' },
    })
  }

  async getItemAnalytic(clientId: string, itemId: string, itemType: string) {
    return this.prisma.productAnalytic.findUnique({
      where: { clientId_itemId_itemType: { clientId, itemId, itemType } },
    })
  }

  async saveItemAnalytic(clientId: string, itemId: string, itemType: string, entries: unknown[]) {
    return this.prisma.productAnalytic.upsert({
      where: { clientId_itemId_itemType: { clientId, itemId, itemType } },
      update: { entries: entries as object[] },
      create: { clientId, itemId, itemType, entries: entries as object[] },
    })
  }

  async deleteItemAnalytic(clientId: string, itemId: string, itemType: string) {
    await this.prisma.productAnalytic.deleteMany({
      where: { clientId, itemId, itemType },
    })
  }

  // ── Background token refresh ───────────────────────────────────────────────

  async refreshAllExpiring(thresholdMs = 10 * 60 * 1000): Promise<void> {
    const cutoff = new Date(Date.now() + thresholdMs)
    const expiring = await this.prisma.toconlineConfig.findMany({
      where: {
        status: 'ACTIVE',
        tokenExpiresAt: { lte: cutoff },
        refreshToken: { not: null },
      },
    })
    for (const cfg of expiring) {
      try {
        await this.tryRefreshToken(cfg.clientId, cfg)
        console.info(`[TOConline] background token refreshed for ${cfg.clientId}`)
      } catch {
        // error already persisted to DB as ERROR status inside tryRefreshToken
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async requireConfig(clientId: string) {
    const cfg = await this.getConfig(clientId)
    if (!cfg) throw httpError(404, 'TOConline not configured for this company')
    return cfg
  }

  private async requireActiveConfig(clientId: string) {
    const cfg = await this.requireConfig(clientId)
    if (cfg.status !== 'ACTIVE' || !cfg.accessToken) {
      throw httpError(401, 'TOConline not authenticated. Please complete OAuth flow.')
    }
    // Proactively refresh if token expires within the next 60 seconds
    if (cfg.tokenExpiresAt && cfg.tokenExpiresAt.getTime() - Date.now() < 60_000) {
      await this.tryRefreshToken(clientId, cfg)
      return this.requireConfig(clientId)
    }
    return cfg
  }

  private getRedirectUri(): string {
    return `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/toconline/callback`
  }
}
