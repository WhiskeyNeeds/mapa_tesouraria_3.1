import type { PrismaClient } from '@prisma/client';
export interface ReconciliationItem {
    movementIds: string[];
    allocations: Array<{
        type: 'receivable' | 'payable';
        id: string;
        amount: number;
    }>;
    isDryRun?: boolean;
}
export declare class TreasuryReconciliationsService {
    private prisma;
    private tocSvc;
    constructor(prisma: PrismaClient);
    list(clientId: string, filters: {
        page?: number;
        limit?: number;
        status?: string;
    }): Promise<{
        total: number;
        page: number;
        limit: number;
        items: ({
            receivables: ({
                receivable: {
                    id: string;
                    entityName: string;
                    reference: string;
                    pendingAmount: import("@prisma/client/runtime/library").Decimal;
                };
            } & {
                id: string;
                reconciliationId: string;
                receivableId: string;
                amountAllocated: import("@prisma/client/runtime/library").Decimal;
                tocReceiptId: string | null;
                tocCreatedAt: Date | null;
                tocError: string | null;
            })[];
            payables: ({
                payable: {
                    id: string;
                    entityName: string;
                    reference: string;
                    pendingAmount: import("@prisma/client/runtime/library").Decimal;
                };
            } & {
                id: string;
                reconciliationId: string;
                amountAllocated: import("@prisma/client/runtime/library").Decimal;
                tocCreatedAt: Date | null;
                tocError: string | null;
                payableId: string;
                tocPaymentId: string | null;
            })[];
            movements: ({
                movement: {
                    date: Date;
                    id: string;
                    amount: import("@prisma/client/runtime/library").Decimal;
                    description: string;
                };
            } & {
                id: string;
                amount: import("@prisma/client/runtime/library").Decimal;
                reconciliationId: string;
                movementId: string;
            })[];
            createdBy: {
                name: string;
                id: string;
            };
        } & {
            clientId: string;
            createdAt: Date;
            id: string;
            updatedAt: Date;
            status: import(".prisma/client").$Enums.TreasuryReconciliationStatus;
            direction: import(".prisma/client").$Enums.TreasuryCategoryType;
            createdById: string;
            isDryRun: boolean;
            totalMovements: import("@prisma/client/runtime/library").Decimal;
            totalAllocated: import("@prisma/client/runtime/library").Decimal;
            tocReceiptsCreated: number;
            tocPaymentsCreated: number;
            tocFirstError: string | null;
            reversedAt: Date | null;
            reversedById: string | null;
            reversedReason: string | null;
        })[];
    }>;
    getById(clientId: string, id: string): Promise<{
        receivables: ({
            receivable: {
                category: {
                    type: import(".prisma/client").$Enums.TreasuryCategoryType;
                    clientId: string;
                    createdAt: Date;
                    name: string;
                    id: string;
                    updatedAt: Date;
                    deletedAt: Date | null;
                    launchToc: boolean;
                    tocExpenseCategoryId: string | null;
                    tocTaxDescriptorId: string | null;
                    color: string | null;
                    icon: string | null;
                    isArchived: boolean;
                };
            } & {
                origin: import(".prisma/client").$Enums.TreasuryDocOrigin;
                clientId: string;
                createdAt: Date;
                id: string;
                updatedAt: Date;
                deletedAt: Date | null;
                status: import(".prisma/client").$Enums.TreasuryDocStatus;
                currency: string;
                description: string | null;
                categoryId: string;
                tocSyncedAt: Date | null;
                createdById: string;
                entityName: string;
                dueDate: Date;
                recurrenceId: string | null;
                entityNif: string | null;
                tocCustomerId: string | null;
                reference: string;
                documentDate: Date;
                totalAmount: import("@prisma/client/runtime/library").Decimal;
                receivedAmount: import("@prisma/client/runtime/library").Decimal;
                pendingAmount: import("@prisma/client/runtime/library").Decimal;
                tocSalesDocId: string | null;
                tocSyncError: string | null;
                parentId: string | null;
            };
        } & {
            id: string;
            reconciliationId: string;
            receivableId: string;
            amountAllocated: import("@prisma/client/runtime/library").Decimal;
            tocReceiptId: string | null;
            tocCreatedAt: Date | null;
            tocError: string | null;
        })[];
        payables: ({
            payable: {
                category: {
                    type: import(".prisma/client").$Enums.TreasuryCategoryType;
                    clientId: string;
                    createdAt: Date;
                    name: string;
                    id: string;
                    updatedAt: Date;
                    deletedAt: Date | null;
                    launchToc: boolean;
                    tocExpenseCategoryId: string | null;
                    tocTaxDescriptorId: string | null;
                    color: string | null;
                    icon: string | null;
                    isArchived: boolean;
                };
            } & {
                origin: import(".prisma/client").$Enums.TreasuryDocOrigin;
                clientId: string;
                createdAt: Date;
                id: string;
                updatedAt: Date;
                deletedAt: Date | null;
                status: import(".prisma/client").$Enums.TreasuryDocStatus;
                currency: string;
                description: string | null;
                categoryId: string;
                tocSyncedAt: Date | null;
                createdById: string;
                entityName: string;
                dueDate: Date;
                recurrenceId: string | null;
                entityNif: string | null;
                reference: string;
                documentDate: Date;
                totalAmount: import("@prisma/client/runtime/library").Decimal;
                pendingAmount: import("@prisma/client/runtime/library").Decimal;
                tocSyncError: string | null;
                parentId: string | null;
                tocSupplierId: string | null;
                paidAmount: import("@prisma/client/runtime/library").Decimal;
                tocPurchasesDocId: string | null;
            };
        } & {
            id: string;
            reconciliationId: string;
            amountAllocated: import("@prisma/client/runtime/library").Decimal;
            tocCreatedAt: Date | null;
            tocError: string | null;
            payableId: string;
            tocPaymentId: string | null;
        })[];
        movements: ({
            movement: {
                date: Date;
                clientId: string;
                createdAt: Date;
                id: string;
                updatedAt: Date;
                deletedAt: Date | null;
                status: import(".prisma/client").$Enums.TreasuryMovementStatus;
                bankAccountId: string;
                bookingDate: Date | null;
                amount: import("@prisma/client/runtime/library").Decimal;
                currency: string;
                balanceAfter: import("@prisma/client/runtime/library").Decimal | null;
                description: string;
                normalizedDesc: string | null;
                counterpartName: string | null;
                counterpartIban: string | null;
                categoryId: string | null;
                source: import(".prisma/client").$Enums.TreasuryMovementSource;
                importId: string | null;
                dedupeHash: string;
                reconciledAmount: import("@prisma/client/runtime/library").Decimal;
                externalRef: string | null;
            };
        } & {
            id: string;
            amount: import("@prisma/client/runtime/library").Decimal;
            reconciliationId: string;
            movementId: string;
        })[];
        createdBy: {
            name: string;
            id: string;
        };
        reversedBy: {
            name: string;
            id: string;
        } | null;
    } & {
        clientId: string;
        createdAt: Date;
        id: string;
        updatedAt: Date;
        status: import(".prisma/client").$Enums.TreasuryReconciliationStatus;
        direction: import(".prisma/client").$Enums.TreasuryCategoryType;
        createdById: string;
        isDryRun: boolean;
        totalMovements: import("@prisma/client/runtime/library").Decimal;
        totalAllocated: import("@prisma/client/runtime/library").Decimal;
        tocReceiptsCreated: number;
        tocPaymentsCreated: number;
        tocFirstError: string | null;
        reversedAt: Date | null;
        reversedById: string | null;
        reversedReason: string | null;
    }>;
    preview(clientId: string, data: ReconciliationItem): Promise<{
        direction: import(".prisma/client").$Enums.TreasuryCategoryType;
        totalMovements: number;
        totalAllocated: number;
        tocActions: {
            type: "receivable" | "payable";
            reference: string;
            amount: number;
        }[];
        isDryRun: boolean;
    }>;
    confirm(clientId: string, userId: string, data: ReconciliationItem): Promise<{
        clientId: string;
        createdAt: Date;
        id: string;
        updatedAt: Date;
        status: import(".prisma/client").$Enums.TreasuryReconciliationStatus;
        direction: import(".prisma/client").$Enums.TreasuryCategoryType;
        createdById: string;
        isDryRun: boolean;
        totalMovements: import("@prisma/client/runtime/library").Decimal;
        totalAllocated: import("@prisma/client/runtime/library").Decimal;
        tocReceiptsCreated: number;
        tocPaymentsCreated: number;
        tocFirstError: string | null;
        reversedAt: Date | null;
        reversedById: string | null;
        reversedReason: string | null;
    } | null>;
    reverse(clientId: string, reconciliationId: string, userId: string, reason?: string): Promise<void>;
}
//# sourceMappingURL=reconciliations.service.d.ts.map