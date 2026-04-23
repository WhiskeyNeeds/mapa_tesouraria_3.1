import { randomUUID } from 'crypto'
import type { PrismaClient } from '@prisma/client'
import { encrypt, decrypt } from '../../plugins/encrypt.js'
import { httpError } from '../../lib/errors.js'
import type { RedisClient } from '../../plugins/redis.js'

const TOC_STATE_PREFIX = 'toconline:state:'

export class ToconlineService {
  constructor(private prisma: PrismaClient) {}

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
    const secretEnc = data.tocClientSecret ? encrypt(data.tocClientSecret) : (existing?.tocClientSecret ?? '')
    const { tocClientSecret: _, ...rest } = data
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
    return this.prisma.toconlineConfig.update({
      where: { clientId },
      data: {
        accessToken: encrypt(data.accessToken),
        refreshToken: data.refreshToken ? encrypt(data.refreshToken) : null,
        tokenExpiresAt: data.expiresIn ? new Date(Date.now() + data.expiresIn * 1000) : null,
        status: 'ACTIVE',
        lastError: null,
      },
    })
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
      await this.tryRefreshToken(clientId, cfg)
      const cfg2 = await this.requireActiveConfig(clientId)
      const token2 = decrypt(cfg2.accessToken!)
      res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token2}` } })
    }

    if (!res.ok) throw httpError(res.status, `TOConline GET ${path} failed: ${res.statusText}`)
    return res.json() as Promise<T>
  }

  private async apiPost<T>(clientId: string, path: string, body: unknown): Promise<T> {
    const cfg = await this.requireActiveConfig(clientId)
    const token = decrypt(cfg.accessToken!)

    let res = await fetch(`${cfg.baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (res.status === 401) {
      await this.tryRefreshToken(clientId, cfg)
      const cfg2 = await this.requireActiveConfig(clientId)
      const token2 = decrypt(cfg2.accessToken!)
      res = await fetch(`${cfg.baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    if (!res.ok) throw httpError(res.status, `TOConline POST ${path} failed: ${res.statusText}`)
    return res.json() as Promise<T>
  }

  private async tryRefreshToken(clientId: string, cfg: Awaited<ReturnType<typeof this.requireConfig>>) {
    if (!cfg.refreshToken) {
      await this.prisma.toconlineConfig.update({ where: { clientId }, data: { status: 'ERROR', lastError: 'No refresh token' } })
      throw httpError(401, 'TOConline session expired. Please re-authenticate.')
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
      await this.prisma.toconlineConfig.update({ where: { clientId }, data: { status: 'ERROR', lastError: 'Refresh failed' } })
      throw httpError(401, 'TOConline session expired. Please re-authenticate.')
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
    return this.apiGet<unknown[]>(clientId, '/api/v1/commercial_purchases_documents', filters)
  }

  async getSalesDocuments(clientId: string, filters?: Record<string, string>) {
    return this.apiGet<unknown[]>(clientId, '/api/v1/commercial_sales_documents', filters)
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

  async getCustomers(clientId: string) {
    return this.apiGet<unknown[]>(clientId, '/api/customers')
  }

  async createCustomer(clientId: string, payload: unknown) {
    return this.apiPost(clientId, '/api/customers', payload)
  }

  async getSuppliers(clientId: string) {
    return this.apiGet<unknown[]>(clientId, '/api/suppliers')
  }

  async createSupplier(clientId: string, payload: unknown) {
    return this.apiPost(clientId, '/api/suppliers', payload)
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
    return cfg
  }

  private getRedirectUri(): string {
    return `${process.env.API_URL ?? 'http://localhost:3001'}/api/v1/toconline/callback`
  }
}
