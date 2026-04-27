import type { PrismaClient } from '@prisma/client';
export declare class TreasuryRecurrencesService {
    private prisma;
    constructor(prisma: PrismaClient);
    list(clientId: string): Promise<{
        id: string;
        frequency: import(".prisma/client").$Enums.TreasuryRecurrenceFrequency;
        startDate: Date;
        endDate: Date | null;
        occurrences: number | null;
        nextRunAt: Date | null;
        lastRunAt: Date | null;
        isActive: boolean;
        type: string;
        entityName: string;
        reference: string;
        totalAmount: number;
        category: {
            name: string;
            color: string;
        } | null;
        instanceCount: number;
    }[]>;
    getById(clientId: string, id: string): Promise<{
        receivables: ({
            category: {
                name: string;
                color: string | null;
            };
        } & {
            origin: import(".prisma/client").$Enums.TreasuryDocOrigin;
            clientId: string;
            createdAt: Date;
            id: string;
            status: import(".prisma/client").$Enums.TreasuryDocStatus;
            updatedAt: Date;
            deletedAt: Date | null;
            currency: string;
            description: string | null;
            categoryId: string;
            tocSyncedAt: Date | null;
            createdById: string;
            dueDate: Date;
            totalAmount: import("@prisma/client/runtime/library").Decimal;
            pendingAmount: import("@prisma/client/runtime/library").Decimal;
            entityName: string;
            reference: string;
            recurrenceId: string | null;
            entityNif: string | null;
            tocCustomerId: string | null;
            documentDate: Date;
            receivedAmount: import("@prisma/client/runtime/library").Decimal;
            tocSalesDocId: string | null;
            tocSyncError: string | null;
            parentId: string | null;
        })[];
        payables: ({
            category: {
                name: string;
                color: string | null;
            };
        } & {
            origin: import(".prisma/client").$Enums.TreasuryDocOrigin;
            clientId: string;
            createdAt: Date;
            id: string;
            status: import(".prisma/client").$Enums.TreasuryDocStatus;
            updatedAt: Date;
            deletedAt: Date | null;
            currency: string;
            description: string | null;
            categoryId: string;
            tocSyncedAt: Date | null;
            createdById: string;
            dueDate: Date;
            totalAmount: import("@prisma/client/runtime/library").Decimal;
            pendingAmount: import("@prisma/client/runtime/library").Decimal;
            entityName: string;
            reference: string;
            recurrenceId: string | null;
            entityNif: string | null;
            documentDate: Date;
            tocSyncError: string | null;
            parentId: string | null;
            tocSupplierId: string | null;
            paidAmount: import("@prisma/client/runtime/library").Decimal;
            tocPurchasesDocId: string | null;
        })[];
    } & {
        clientId: string;
        createdAt: Date;
        id: string;
        updatedAt: Date;
        isActive: boolean;
        frequency: import(".prisma/client").$Enums.TreasuryRecurrenceFrequency;
        startDate: Date;
        endDate: Date | null;
        occurrences: number | null;
        customRrule: string | null;
        nextRunAt: Date | null;
        lastRunAt: Date | null;
    }>;
    deactivate(clientId: string, id: string): Promise<{
        clientId: string;
        createdAt: Date;
        id: string;
        updatedAt: Date;
        isActive: boolean;
        frequency: import(".prisma/client").$Enums.TreasuryRecurrenceFrequency;
        startDate: Date;
        endDate: Date | null;
        occurrences: number | null;
        customRrule: string | null;
        nextRunAt: Date | null;
        lastRunAt: Date | null;
    }>;
    processForClient(clientId: string, horizonDays?: number): Promise<{
        created: number;
    }>;
}
//# sourceMappingURL=recurrences.service.d.ts.map