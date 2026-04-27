import type { PrismaClient } from '@prisma/client';
import type { RedisClient } from '../../plugins/redis.js';
export declare class ToconlineService {
    private prisma;
    constructor(prisma: PrismaClient);
    getConfig(clientId: string): Promise<{
        clientId: string;
        createdAt: Date;
        id: string;
        oauthUrl: string;
        baseUrl: string;
        tocClientId: string;
        tocClientSecret: string;
        accessToken: string | null;
        refreshToken: string | null;
        tokenExpiresAt: Date | null;
        status: import(".prisma/client").$Enums.ToconlineStatus;
        lastError: string | null;
        updatedAt: Date;
    } | null>;
    getPublicConfig(clientId: string): Promise<{
        callbackUri: string;
    } | {
        callbackUri: string;
        clientId: string;
        createdAt: Date;
        id: string;
        oauthUrl: string;
        baseUrl: string;
        tocClientId: string;
        tokenExpiresAt: Date | null;
        status: import(".prisma/client").$Enums.ToconlineStatus;
        lastError: string | null;
        updatedAt: Date;
    }>;
    saveCredentials(clientId: string, data: {
        oauthUrl: string;
        baseUrl: string;
        tocClientId: string;
        tocClientSecret?: string;
    }): Promise<{
        clientId: string;
        createdAt: Date;
        id: string;
        oauthUrl: string;
        baseUrl: string;
        tocClientId: string;
        tocClientSecret: string;
        accessToken: string | null;
        refreshToken: string | null;
        tokenExpiresAt: Date | null;
        status: import(".prisma/client").$Enums.ToconlineStatus;
        lastError: string | null;
        updatedAt: Date;
    }>;
    getAuthUrl(clientId: string, redis: RedisClient): Promise<string>;
    handleCallback(code: string, state: string, redis: RedisClient): Promise<void>;
    setTokensManually(clientId: string, data: {
        accessToken: string;
        refreshToken?: string;
        expiresIn?: number;
    }): Promise<{
        clientId: string;
        createdAt: Date;
        id: string;
        oauthUrl: string;
        baseUrl: string;
        tocClientId: string;
        tocClientSecret: string;
        accessToken: string | null;
        refreshToken: string | null;
        tokenExpiresAt: Date | null;
        status: import(".prisma/client").$Enums.ToconlineStatus;
        lastError: string | null;
        updatedAt: Date;
    }>;
    revokeConfig(clientId: string): Promise<void>;
    private apiGet;
    private apiPost;
    private tryRefreshToken;
    getPurchaseDocuments(clientId: string, filters?: Record<string, string>): Promise<unknown[]>;
    getSalesDocuments(clientId: string, filters?: Record<string, string>): Promise<unknown[]>;
    createSalesDocument(clientId: string, payload: unknown): Promise<unknown>;
    createSalesReceipt(clientId: string, payload: unknown): Promise<unknown>;
    createPurchaseDocument(clientId: string, payload: unknown): Promise<unknown>;
    createPurchasePayment(clientId: string, payload: unknown): Promise<unknown>;
    getCustomers(clientId: string): Promise<unknown[]>;
    createCustomer(clientId: string, payload: unknown): Promise<unknown>;
    getSuppliers(clientId: string): Promise<unknown[]>;
    createSupplier(clientId: string, payload: unknown): Promise<unknown>;
    getBankAccounts(clientId: string): Promise<unknown[]>;
    getExpenseCategories(clientId: string): Promise<unknown[]>;
    getTaxDescriptors(clientId: string): Promise<unknown[]>;
    refreshAllExpiring(thresholdMs?: number): Promise<void>;
    private requireConfig;
    private requireActiveConfig;
    private getRedirectUri;
}
//# sourceMappingURL=toconline.service.d.ts.map