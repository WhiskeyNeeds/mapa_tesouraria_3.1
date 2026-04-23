import { randomUUID } from 'crypto';
import { encrypt, decrypt } from '../../plugins/encrypt.js';
import { httpError } from '../../lib/errors.js';
const TOC_STATE_PREFIX = 'toconline:state:';
export class ToconlineService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    // ── Config ────────────────────────────────────────────────────────────────
    async getConfig(clientId) {
        return this.prisma.toconlineConfig.findUnique({ where: { clientId } });
    }
    async getPublicConfig(clientId) {
        const cfg = await this.getConfig(clientId);
        if (!cfg)
            return { callbackUri: this.getRedirectUri() };
        const { tocClientSecret: _s, accessToken: _a, refreshToken: _r, ...pub } = cfg;
        return { ...pub, callbackUri: this.getRedirectUri() };
    }
    async saveCredentials(clientId, data) {
        const existing = await this.getConfig(clientId);
        if (!existing && !data.tocClientSecret)
            throw httpError(400, 'tocClientSecret is required on first setup');
        const secretEnc = data.tocClientSecret ? encrypt(data.tocClientSecret.trim()) : (existing?.tocClientSecret ?? '');
        const { tocClientSecret: _, ...rest } = data;
        // Strip trailing slashes so paths never double up
        rest.oauthUrl = rest.oauthUrl.trim().replace(/\/+$/, '');
        rest.baseUrl = rest.baseUrl.trim().replace(/\/+$/, '');
        return this.prisma.toconlineConfig.upsert({
            where: { clientId },
            update: { ...rest, tocClientSecret: secretEnc, status: 'UNCONFIGURED', accessToken: null, refreshToken: null },
            create: { clientId, ...rest, tocClientSecret: secretEnc },
        });
    }
    async getAuthUrl(clientId, redis) {
        const cfg = await this.requireConfig(clientId);
        const state = randomUUID();
        const redirectUri = this.getRedirectUri();
        await redis.setex(`${TOC_STATE_PREFIX}${state}`, 600, clientId);
        await this.prisma.toconlineConfig.update({ where: { clientId }, data: { status: 'PENDING_AUTH' } });
        const oauthBase = this.getOauthBase(cfg.oauthUrl);
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: cfg.tocClientId,
            redirect_uri: redirectUri,
            state,
        });
        return `${oauthBase}/oauth/authorize?${params}`;
    }
    async handleCallback(code, state, redis) {
        const clientId = await redis.get(`${TOC_STATE_PREFIX}${state}`);
        if (!clientId)
            throw httpError(400, 'Invalid or expired OAuth state');
        await redis.del(`${TOC_STATE_PREFIX}${state}`);
        const cfg = await this.requireConfig(clientId);
        const redirectUri = this.getRedirectUri();
        const secret = decrypt(cfg.tocClientSecret);
        const oauthBase = this.getOauthBase(cfg.oauthUrl);
        const res = await fetch(`${oauthBase}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
                client_id: cfg.tocClientId,
                client_secret: secret,
            }),
        });
        if (!res.ok)
            throw httpError(502, 'TOConline token exchange failed');
        const data = await res.json();
        await this.prisma.toconlineConfig.update({
            where: { clientId },
            data: {
                accessToken: encrypt(data.access_token),
                refreshToken: data.refresh_token ? encrypt(data.refresh_token) : null,
                tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
                status: 'ACTIVE',
                lastError: null,
            },
        });
    }
    async setTokensManually(clientId, data) {
        await this.requireConfig(clientId);
        const accessToken = data.accessToken.trim();
        const refreshToken = data.refreshToken?.trim() || null;
        if (!accessToken)
            throw httpError(400, 'accessToken não pode ser vazio');
        return this.prisma.toconlineConfig.update({
            where: { clientId },
            data: {
                accessToken: encrypt(accessToken),
                refreshToken: refreshToken ? encrypt(refreshToken) : null,
                tokenExpiresAt: data.expiresIn ? new Date(Date.now() + data.expiresIn * 1000) : null,
                status: 'ACTIVE',
                lastError: null,
            },
        });
    }
    async revokeConfig(clientId) {
        await this.prisma.toconlineConfig.update({
            where: { clientId },
            data: { accessToken: null, refreshToken: null, tokenExpiresAt: null, status: 'UNCONFIGURED' },
        });
    }
    // ── HTTP helper ────────────────────────────────────────────────────────────
    async apiGet(clientId, path, params) {
        const cfg = await this.requireActiveConfig(clientId);
        const token = decrypt(cfg.accessToken);
        const url = new URL(`${cfg.baseUrl}${path}`);
        if (params)
            Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
        let res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 401) {
            let body401 = '';
            try {
                body401 = JSON.stringify(await res.clone().json());
            }
            catch {
                body401 = await res.text().catch(() => '');
            }
            console.error(`[TOConline] 401 on GET ${path} for ${clientId}: ${body401}`);
            await this.tryRefreshToken(clientId, cfg);
            const cfg2 = await this.requireActiveConfig(clientId);
            const token2 = decrypt(cfg2.accessToken);
            res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token2}` } });
        }
        if (!res.ok)
            throw httpError(res.status, `TOConline GET ${path} failed: ${res.statusText}`);
        return res.json();
    }
    async apiPost(clientId, path, body) {
        const cfg = await this.requireActiveConfig(clientId);
        const token = decrypt(cfg.accessToken);
        let res = await fetch(`${cfg.baseUrl}${path}`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (res.status === 401) {
            await this.tryRefreshToken(clientId, cfg);
            const cfg2 = await this.requireActiveConfig(clientId);
            const token2 = decrypt(cfg2.accessToken);
            res = await fetch(`${cfg.baseUrl}${path}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token2}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
        }
        if (!res.ok)
            throw httpError(res.status, `TOConline POST ${path} failed: ${res.statusText}`);
        return res.json();
    }
    async tryRefreshToken(clientId, cfg) {
        if (!cfg.refreshToken) {
            const msg = 'Sem refresh token — o access token expirou e não é possível renovar automaticamente. Insira um novo token manualmente.';
            console.error(`[TOConline] no refresh_token for ${clientId}`);
            await this.prisma.toconlineConfig.update({ where: { clientId }, data: { status: 'ERROR', lastError: msg } });
            throw httpError(401, msg);
        }
        const secret = decrypt(cfg.tocClientSecret);
        const rt = decrypt(cfg.refreshToken);
        const oauthBase = this.getOauthBase(cfg.oauthUrl);
        const res = await fetch(`${oauthBase}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: rt,
                client_id: cfg.tocClientId,
                client_secret: secret,
            }),
        });
        if (!res.ok) {
            let detail = `HTTP ${res.status} ${res.statusText}`;
            try {
                const body = await res.json();
                detail = body.error_description
                    ?? body.message
                    ?? body.error
                    ?? JSON.stringify(body);
            }
            catch { /* body não é JSON */ }
            console.error(`[TOConline] refresh_token failed for ${clientId}: ${detail}`);
            await this.prisma.toconlineConfig.update({ where: { clientId }, data: { status: 'ERROR', lastError: `Refresh falhou: ${detail}` } });
            throw httpError(401, `TOConline refresh falhou: ${detail}`);
        }
        const data = await res.json();
        await this.prisma.toconlineConfig.update({
            where: { clientId },
            data: {
                accessToken: encrypt(data.access_token),
                refreshToken: data.refresh_token ? encrypt(data.refresh_token) : cfg.refreshToken,
                tokenExpiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
                status: 'ACTIVE',
                lastError: null,
            },
        });
    }
    // ── TOConline endpoints ────────────────────────────────────────────────────
    async getPurchaseDocuments(clientId, filters) {
        return this.apiGet(clientId, '/api/v1/commercial_purchases_documents', filters);
    }
    async getSalesDocuments(clientId, filters) {
        return this.apiGet(clientId, '/api/v1/commercial_sales_documents', filters);
    }
    async createSalesDocument(clientId, payload) {
        return this.apiPost(clientId, '/api/v1/commercial_sales_documents', payload);
    }
    async createSalesReceipt(clientId, payload) {
        return this.apiPost(clientId, '/api/v1/commercial_sales_receipts', payload);
    }
    async createPurchaseDocument(clientId, payload) {
        return this.apiPost(clientId, '/api/v1/commercial_purchases_documents', payload);
    }
    async createPurchasePayment(clientId, payload) {
        return this.apiPost(clientId, '/api/v1/commercial_purchases_payments', payload);
    }
    async getCustomers(clientId) {
        return this.apiGet(clientId, '/api/customers');
    }
    async createCustomer(clientId, payload) {
        return this.apiPost(clientId, '/api/customers', payload);
    }
    async getSuppliers(clientId) {
        return this.apiGet(clientId, '/api/suppliers');
    }
    async createSupplier(clientId, payload) {
        return this.apiPost(clientId, '/api/suppliers', payload);
    }
    async getBankAccounts(clientId) {
        return this.apiGet(clientId, '/api/bank_accounts');
    }
    async getExpenseCategories(clientId) {
        return this.apiGet(clientId, '/api/expense_categories');
    }
    async getTaxDescriptors(clientId) {
        return this.apiGet(clientId, '/api/tax_descriptors');
    }
    // ── Helpers ────────────────────────────────────────────────────────────────
    async requireConfig(clientId) {
        const cfg = await this.getConfig(clientId);
        if (!cfg)
            throw httpError(404, 'TOConline not configured for this company');
        return cfg;
    }
    async requireActiveConfig(clientId) {
        const cfg = await this.requireConfig(clientId);
        if (cfg.status !== 'ACTIVE' || !cfg.accessToken) {
            throw httpError(401, 'TOConline not authenticated. Please complete OAuth flow.');
        }
        return cfg;
    }
    getRedirectUri() {
        return `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/toconline/callback`;
    }
    getOauthBase(oauthUrl) {
        // Accept both formats from UI: https://host or https://host/oauth
        const normalized = oauthUrl.trim().replace(/\/+$/, '');
        return normalized.replace(/\/oauth$/i, '');
    }
}
//# sourceMappingURL=toconline.service.js.map