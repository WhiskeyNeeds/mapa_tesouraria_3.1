import { randomUUID } from 'crypto'
import type { PrismaClient } from '@prisma/client'
import { encrypt, decrypt } from '../../plugins/encrypt.js'
import { httpError } from '../../lib/errors.js'
import type { RedisClient } from '../../plugins/redis.js'

const TOC_STATE_PREFIX = 'toconline:state:'

export class ToconlineService {
  private refreshLocks = new Map<string, Promise<void>>()

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
    rest.tocClientId = rest.tocClientId.trim()
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
      scope: 'commercial',
      state,
    })
    return `${cfg.oauthUrl}/auth?${params}`
  }

  async handleCallback(code: string, state: string, redis: RedisClient): Promise<void> {
    const clientId = await redis.get(`${TOC_STATE_PREFIX}${state}`)
    if (!clientId) throw httpError(400, 'Invalid or expired OAuth state')
    await redis.del(`${TOC_STATE_PREFIX}${state}`)

    const cfg = await this.requireConfig(clientId)
    const secret = decrypt(cfg.tocClientSecret)
    const credentials = Buffer.from(`${cfg.tocClientId}:${secret}`).toString('base64')

    const res = await fetch(`${cfg.oauthUrl}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        scope: 'commercial',
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

  private async apiDelete(clientId: string, path: string): Promise<void> {
    const cfg = await this.requireActiveConfig(clientId)
    const token = decrypt(cfg.accessToken!)
    let res = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })
    if (res.status === 401) {
      await this.tryRefreshToken(clientId, cfg)
      const cfg2 = await this.requireActiveConfig(clientId)
      const token2 = decrypt(cfg2.accessToken!)
      res = await fetch(`${cfg.baseUrl}${path}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token2}`, Accept: 'application/json' },
      })
    }
    if (!res.ok && res.status !== 204) {
      let detail = res.statusText
      try { detail = JSON.stringify(await res.clone().json()) } catch { detail = await res.text().catch(() => res.statusText) }
      console.error(`[TOConline] DELETE ${path} failed for ${clientId} (${res.status}): ${detail}`)
      throw httpError(res.status, `TOConline DELETE ${path} failed: ${detail}`)
    }
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

  private async tryRefreshToken(
    clientId: string,
    cfg: Awaited<ReturnType<typeof this.requireConfig>>,
    force = false,
  ) {
    // Serialise refreshes per clientId: parallel callers wait for the in-flight one,
    // then re-read fresh config — TOConline invalidates the previous refresh_token on each use.
    const inFlight = this.refreshLocks.get(clientId)
    if (inFlight) {
      await inFlight
      return
    }

    const job = (async () => {
      const fresh = await this.requireConfig(clientId)
      if (!force && fresh.tokenExpiresAt && fresh.tokenExpiresAt.getTime() - Date.now() > 60_000 && fresh.status === 'ACTIVE') {
        // Another caller already refreshed while we were queued.
        return
      }
      await this.doRefresh(clientId, fresh)
    })().finally(() => this.refreshLocks.delete(clientId))

    this.refreshLocks.set(clientId, job)
    await job
  }

  private async doRefresh(clientId: string, cfg: Awaited<ReturnType<typeof this.requireConfig>>) {
    if (!cfg.refreshToken) {
      const msg = 'Sem refresh token — o access token expirou e não é possível renovar automaticamente. Insira um novo token manualmente.'
      console.error(`[TOConline] no refresh_token for ${clientId}`)
      await this.prisma.toconlineConfig.update({ where: { clientId }, data: { status: 'ERROR', lastError: msg } })
      throw httpError(401, msg)
    }

    const secret = decrypt(cfg.tocClientSecret)
    const rt = decrypt(cfg.refreshToken)
    const credentials = Buffer.from(`${cfg.tocClientId}:${secret}`).toString('base64')

    const res = await fetch(`${cfg.oauthUrl}/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: rt,
        scope: 'commercial',
      }),
    })

    if (!res.ok) {
      let detail = `HTTP ${res.status} ${res.statusText}`
      let rawBody = ''
      try { rawBody = await res.clone().text() } catch { /* ignore */ }
      try {
        const body = JSON.parse(rawBody) as Record<string, unknown>
        detail = body.error_description as string
          ?? body.message as string
          ?? body.error as string
          ?? JSON.stringify(body)
      } catch { /* body não é JSON */ }
      console.error(`[TOConline] refresh_token failed for ${clientId} (HTTP ${res.status}): ${detail}`)
      console.error(`[TOConline] refresh raw response body: ${rawBody}`)
      console.error(`[TOConline] refresh request: oauthUrl=${cfg.oauthUrl}, tocClientId=${cfg.tocClientId}, rt_preview=${rt.slice(0, 4)}...${rt.slice(-4)} (len=${rt.length})`)
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

  async getSalesDocumentReceipts(clientId: string, docId: string) {
    const raw = await this.apiGet<unknown>(clientId, `/api/v1/commercial_sales_documents/${docId}`)
    const obj = raw as Record<string, unknown>

    let receiptIds: number[] = []
    if (obj.data && typeof obj.data === 'object') {
      const data = obj.data as Record<string, unknown>
      const attrs = (data.attributes ?? data) as Record<string, unknown>
      if (Array.isArray(attrs.receipts_ids)) receiptIds = attrs.receipts_ids as number[]
    } else if (Array.isArray(obj.receipts_ids)) {
      receiptIds = obj.receipts_ids as number[]
    }

    if (receiptIds.length === 0) return []

    const results = await Promise.allSettled(
      receiptIds.map((id) => this.apiGet<unknown>(clientId, `/api/v1/commercial_sales_receipts/${id}`))
    )
    return results
      .filter((r): r is PromiseFulfilledResult<unknown> => r.status === 'fulfilled')
      .map((r) => r.value as Record<string, unknown>)
  }

  async getPurchaseDocumentPayments(clientId: string, docId: string) {
    const raw = await this.apiGet<unknown>(clientId, `/api/v1/commercial_purchases_documents/${docId}`)
    const obj = raw as Record<string, unknown>

    let paymentIds: number[] = []
    if (obj.data && typeof obj.data === 'object') {
      const data = obj.data as Record<string, unknown>
      const attrs = (data.attributes ?? data) as Record<string, unknown>
      if (Array.isArray(attrs.payments_ids)) paymentIds = attrs.payments_ids as number[]
    } else if (Array.isArray(obj.payments_ids)) {
      paymentIds = obj.payments_ids as number[]
    }

    if (paymentIds.length === 0) return []

    const results = await Promise.allSettled(
      paymentIds.map((id) => this.apiGet<unknown>(clientId, `/api/v1/commercial_purchases_payments/${id}`))
    )
    return results
      .filter((r): r is PromiseFulfilledResult<unknown> => r.status === 'fulfilled')
      .map((r) => r.value as Record<string, unknown>)
  }

  async getSalesReceiptLines(clientId: string, receiptId: string) {
    const raw = await this.apiGet<unknown>(clientId, `/api/v1/commercial_sales_receipts/${receiptId}`)
    const obj = raw as Record<string, unknown>

    let attrs: Record<string, unknown>
    if (obj.data && typeof obj.data === 'object') {
      const data = obj.data as Record<string, unknown>
      attrs = (data.attributes ?? data) as Record<string, unknown>
    } else {
      attrs = obj
    }

    const lines = Array.isArray(attrs.lines) ? attrs.lines as Array<Record<string, unknown>> : []
    if (lines.length === 0) return []

    const enriched = await Promise.allSettled(
      lines.map(async (line) => {
        const receivableId = line.receivable_id
        if (!receivableId) return line
        try {
          const docRaw = await this.apiGet<unknown>(clientId, `/api/v1/commercial_sales_documents/${receivableId}`)
          const docObj = docRaw as Record<string, unknown>
          let docAttrs: Record<string, unknown>
          if (docObj.data && typeof docObj.data === 'object') {
            const d = docObj.data as Record<string, unknown>
            docAttrs = (d.attributes ?? d) as Record<string, unknown>
          } else {
            docAttrs = docObj
          }
          return {
            ...line,
            document_no: docAttrs.document_no,
            _doc_date: docAttrs.date,
            _doc_due_date: docAttrs.due_date,
            _doc_gross_total: docAttrs.gross_total,
            _doc_pending_total: docAttrs.pending_total,
            _doc_retention: docAttrs.retention,
          }
        } catch {
          return line
        }
      })
    )
    return enriched
      .filter((r): r is PromiseFulfilledResult<Record<string, unknown>> => r.status === 'fulfilled')
      .map((r) => r.value)
  }

  async getPurchasePaymentLines(clientId: string, paymentId: string) {
    const raw = await this.apiGet<unknown>(clientId, `/api/v1/commercial_purchases_payments/${paymentId}`)
    const obj = raw as Record<string, unknown>

    let attrs: Record<string, unknown>
    if (obj.data && typeof obj.data === 'object') {
      const data = obj.data as Record<string, unknown>
      attrs = (data.attributes ?? data) as Record<string, unknown>
    } else {
      attrs = obj
    }

    const lines = Array.isArray(attrs.lines) ? attrs.lines as Array<Record<string, unknown>> : []
    if (lines.length === 0) return []

    const enriched = await Promise.allSettled(
      lines.map(async (line) => {
        const payableId = line.payable_id
        if (!payableId) return line
        try {
          const docRaw = await this.apiGet<unknown>(clientId, `/api/v1/commercial_purchases_documents/${payableId}`)
          const docObj = docRaw as Record<string, unknown>
          let docAttrs: Record<string, unknown>
          if (docObj.data && typeof docObj.data === 'object') {
            const d = docObj.data as Record<string, unknown>
            docAttrs = (d.attributes ?? d) as Record<string, unknown>
          } else {
            docAttrs = docObj
          }
          return {
            ...line,
            document_no: docAttrs.document_no,
            _doc_date: docAttrs.date,
            _doc_due_date: docAttrs.due_date,
            _doc_gross_total: docAttrs.gross_total,
            _doc_pending_total: docAttrs.pending_total,
            _doc_external_reference: docAttrs.external_reference,
          }
        } catch {
          return line
        }
      })
    )
    return enriched
      .filter((r): r is PromiseFulfilledResult<Record<string, unknown>> => r.status === 'fulfilled')
      .map((r) => r.value)
  }

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

  async getTaxExemptionReasonId(clientId: string, code: string): Promise<number | undefined> {
    try {
      const raw = await this.apiGet<unknown>(clientId, `/api/tax_exemption_reasons?filter[code]=${encodeURIComponent(code)}`)
      const items = this.unwrapArray(raw)
      if (!items.length) return undefined
      const id = Number(items[0].id)
      return isNaN(id) ? undefined : id
    } catch {
      return undefined
    }
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
    const body = {
      data: {
        type: 'addresses',
        id: addressId,
        attributes: attrs,
      },
    }
    // The TOConline API expects PATCH /api/addresses with the id in the body (not in the URL path)
    return this.apiPatch(clientId, '/api/addresses', body)
  }

  async getSuppliers(clientId: string) {
    return this.apiGetFlat(clientId, '/api/suppliers')
  }

  async getSupplierWithAddress(clientId: string, supplierId: string) {
    type JsonApiRef = { id: string }
    type AddressRes = {
      data: {
        id: string
        attributes: Record<string, unknown>
        relationships?: { country?: { data?: JsonApiRef | null } }
      }
    }
    type SupplierRes = {
      data: {
        id: string
        attributes: Record<string, unknown>
        relationships?: {
          main_address?: { data?: JsonApiRef | null }
          addresses?:    { data?: JsonApiRef[] | null }
        }
      }
    }

    const res = await this.apiGet<SupplierRes>(clientId, `/api/suppliers/${supplierId}`)
    const supplier: Record<string, unknown> = { id: res.data.id, ...res.data.attributes }

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
      supplier._addresses = addresses
      supplier._address   = addresses.find(a => a._isMain) ?? addresses[0] ?? null
    }

    return supplier
  }

  async createSupplier(clientId: string, attrs: Record<string, unknown>, addressAttrs?: Record<string, unknown>) {
    type Rels = { main_address?: { data?: { id: string } | null }; addresses?: { data?: { id: string }[] | null } }
    type Res  = { data: { id: string; relationships?: Rels } }

    const created = await this.apiPost<Res>(clientId, '/api/suppliers', {
      data: { type: 'suppliers', attributes: attrs },
    })

    if (addressAttrs && Object.keys(addressAttrs).length > 0) {
      let addressId = created.data.relationships?.main_address?.data?.id
        ?? created.data.relationships?.addresses?.data?.[0]?.id

      if (!addressId) {
        try {
          const got = await this.apiGet<Res>(clientId, `/api/suppliers/${created.data.id}`)
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

  // ── Update / Delete ────────────────────────────────────────────────────────────

  async updateCustomer(clientId: string, id: string, attrs: Record<string, unknown>) {
    // PATCH /api/customers/{id} — ID in URL and in body (JSON:API standard)
    return this.apiPatch(clientId, `/api/customers/${id}`, {
      data: { type: 'customers', id, attributes: attrs },
    })
  }

  async deleteCustomer(clientId: string, id: string): Promise<void> {
    await this.apiDelete(clientId, `/api/customers/${id}`)
  }

  async updateSupplier(clientId: string, id: string, attrs: Record<string, unknown>) {
    // PATCH /api/suppliers/{id} — ID in URL and in body (JSON:API standard)
    return this.apiPatch(clientId, `/api/suppliers/${id}`, {
      data: { type: 'suppliers', id, attributes: attrs },
    })
  }

  async deleteSupplier(clientId: string, id: string): Promise<void> {
    await this.apiDelete(clientId, `/api/suppliers/${id}`)
  }

  async updateItem(clientId: string, id: string, attrs: Record<string, unknown>) {
    // PATCH /api/products — ID only in body, NOT in URL (same pattern as addresses)
    return this.apiPatch(clientId, '/api/products', {
      data: { type: 'products', id, attributes: attrs },
    })
  }

  async deleteItem(clientId: string, id: string): Promise<void> {
    await this.apiDelete(clientId, `/api/products/${id}`)
  }

  async updateService(clientId: string, id: string, attrs: Record<string, unknown>) {
    // PATCH /api/services — ID only in body, NOT in URL (same pattern as addresses)
    return this.apiPatch(clientId, '/api/services', {
      data: { type: 'services', id, attributes: attrs },
    })
  }

  async deleteService(clientId: string, id: string): Promise<void> {
    await this.apiDelete(clientId, `/api/services/${id}`)
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

  // Aggressive refresh at server startup: forces a refresh on every config that
  // still has a refresh_token, regardless of status or expiry. Self-heals ERROR
  // configs whose refresh_token is still valid, and guarantees a clean baseline
  // before the dashboard fires its parallel API calls.
  async refreshAllOnStartup(): Promise<void> {
    const configs = await this.prisma.toconlineConfig.findMany({
      where: { refreshToken: { not: null } },
    })
    console.info(`[TOConline] startup refresh: ${configs.length} config(s) to process`)
    for (const cfg of configs) {
      try {
        await this.tryRefreshToken(cfg.clientId, cfg, true)
        console.info(`[TOConline] startup refresh OK for ${cfg.clientId}`)
      } catch {
        // error already persisted to DB inside doRefresh
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
