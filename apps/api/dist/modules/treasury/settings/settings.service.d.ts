import type { PrismaClient } from '@prisma/client';
export declare class TreasurySettingsService {
    private prisma;
    constructor(prisma: PrismaClient);
    get(clientId: string): Promise<{
        clientId: string;
        createdAt: Date;
        id: string;
        updatedAt: Date;
        reconciliationDryRun: boolean;
        autoMatchEnabled: boolean;
        autoMatchThreshold: import("@prisma/client/runtime/library").Decimal;
        lowBalanceEnabled: boolean;
        lowBalanceChannels: string[];
        importFileRetentionDays: number;
        syncIntervalMinutes: number;
        lastFullSyncAt: Date | null;
    }>;
    update(clientId: string, data: Partial<{
        reconciliationDryRun: boolean;
        autoMatchEnabled: boolean;
        autoMatchThreshold: number;
        lowBalanceEnabled: boolean;
        lowBalanceChannels: string[];
        importFileRetentionDays: number;
        syncIntervalMinutes: number;
    }>): Promise<{
        clientId: string;
        createdAt: Date;
        id: string;
        updatedAt: Date;
        reconciliationDryRun: boolean;
        autoMatchEnabled: boolean;
        autoMatchThreshold: import("@prisma/client/runtime/library").Decimal;
        lowBalanceEnabled: boolean;
        lowBalanceChannels: string[];
        importFileRetentionDays: number;
        syncIntervalMinutes: number;
        lastFullSyncAt: Date | null;
    }>;
}
//# sourceMappingURL=settings.service.d.ts.map