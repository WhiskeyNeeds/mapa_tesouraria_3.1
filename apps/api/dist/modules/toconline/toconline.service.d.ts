import type { PrismaClient } from '@prisma/client';
import type { RedisClient } from '../../plugins/redis.js';
export declare class ToconlineService {
    private prisma;
    constructor(prisma: PrismaClient);
    getConfig(clientId: string): Promise<{
        clientId: string;
        createdAt: Date;
        id: string;
        updatedAt: Date;
        accessToken: string | null;
        refreshToken: string | null;
        oauthUrl: string;
        baseUrl: string;
        tocClientId: string;
        tocClientSecret: string;
        tokenExpiresAt: Date | null;
        status: import(".prisma/client").$Enums.ToconlineStatus;
        lastError: string | null;
    } | null>;
    getPublicConfig(clientId: string): Promise<{
        callbackUri: string;
    } | {
        callbackUri: string;
        clientId: string;
        createdAt: Date;
        id: string;
        updatedAt: Date;
        oauthUrl: string;
        baseUrl: string;
        tocClientId: string;
        tokenExpiresAt: Date | null;
        status: import(".prisma/client").$Enums.ToconlineStatus;
        lastError: string | null;
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
        updatedAt: Date;
        accessToken: string | null;
        refreshToken: string | null;
        oauthUrl: string;
        baseUrl: string;
        tocClientId: string;
        tocClientSecret: string;
        tokenExpiresAt: Date | null;
        status: import(".prisma/client").$Enums.ToconlineStatus;
        lastError: string | null;
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
        updatedAt: Date;
        accessToken: string | null;
        refreshToken: string | null;
        oauthUrl: string;
        baseUrl: string;
        tocClientId: string;
        tocClientSecret: string;
        tokenExpiresAt: Date | null;
        status: import(".prisma/client").$Enums.ToconlineStatus;
        lastError: string | null;
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
    private requireConfig;
    private requireActiveConfig;
    private getRedirectUri;
    private getOauthBase;
}
//# sourceMappingURL=toconline.service.d.ts.map