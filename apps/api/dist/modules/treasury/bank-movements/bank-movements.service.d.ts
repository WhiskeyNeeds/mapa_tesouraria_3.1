import type { PrismaClient, TreasuryMovementSource, TreasuryMovementStatus, Prisma } from '@prisma/client';
export interface CsvMovement {
    date: string;
    amount: number;
    description: string;
    bookingDate?: string;
    balanceAfter?: number;
    counterpartName?: string;
    counterpartIban?: string;
    externalRef?: string;
}
export declare class TreasuryBankMovementsService {
    private prisma;
    private bankSvc;
    constructor(prisma: PrismaClient);
    private recalcManualBalances;
    private buildDedupeHash;
    private normalize;
    private toDateKey;
    private toAmountKey;
    private toBalanceKey;
    private buildLogicalKey;
    list(clientId: string, filters: {
        bankAccountId?: string;
        status?: TreasuryMovementStatus;
        dateFrom?: string;
        dateTo?: string;
        search?: string;
        direction?: 'income' | 'expense';
        sortBy?: 'date' | 'amount' | 'description' | 'balanceAfter';
        sortDir?: 'asc' | 'desc';
        page?: number;
        limit?: number;
    }): Promise<{
        total: number;
        page: number;
        limit: number;
        items: ({
            bankAccount: {
                name: string;
                id: string;
                bankName: string | null;
            };
            category: {
                type: import(".prisma/client").$Enums.TreasuryCategoryType;
                name: string;
                id: string;
                color: string | null;
            } | null;
        } & {
            date: Date;
            clientId: string;
            createdAt: Date;
            id: string;
            updatedAt: Date;
            deletedAt: Date | null;
            status: import(".prisma/client").$Enums.TreasuryMovementStatus;
            bankAccountId: string;
            bookingDate: Date | null;
            amount: Prisma.Decimal;
            currency: string;
            balanceAfter: Prisma.Decimal | null;
            description: string;
            normalizedDesc: string | null;
            counterpartName: string | null;
            counterpartIban: string | null;
            categoryId: string | null;
            source: import(".prisma/client").$Enums.TreasuryMovementSource;
            importId: string | null;
            dedupeHash: string;
            reconciledAmount: Prisma.Decimal;
            externalRef: string | null;
        })[];
    }>;
    importMovements(clientId: string, bankAccountId: string, movements: CsvMovement[], source: TreasuryMovementSource, userId: string, importId?: string): Promise<{
        imported: number;
        duplicated: number;
        failed: number;
    }>;
    createManual(clientId: string, data: {
        bankAccountId: string;
        date: string;
        amount: number;
        description: string;
    }): Promise<{
        date: Date;
        clientId: string;
        createdAt: Date;
        id: string;
        updatedAt: Date;
        deletedAt: Date | null;
        status: import(".prisma/client").$Enums.TreasuryMovementStatus;
        bankAccountId: string;
        bookingDate: Date | null;
        amount: Prisma.Decimal;
        currency: string;
        balanceAfter: Prisma.Decimal | null;
        description: string;
        normalizedDesc: string | null;
        counterpartName: string | null;
        counterpartIban: string | null;
        categoryId: string | null;
        source: import(".prisma/client").$Enums.TreasuryMovementSource;
        importId: string | null;
        dedupeHash: string;
        reconciledAmount: Prisma.Decimal;
        externalRef: string | null;
    }>;
    deduplicateMovements(clientId: string, bankAccountId?: string): Promise<{
        removed: number;
    }>;
    classify(clientId: string, id: string, categoryId: string): Promise<{
        date: Date;
        clientId: string;
        createdAt: Date;
        id: string;
        updatedAt: Date;
        deletedAt: Date | null;
        status: import(".prisma/client").$Enums.TreasuryMovementStatus;
        bankAccountId: string;
        bookingDate: Date | null;
        amount: Prisma.Decimal;
        currency: string;
        balanceAfter: Prisma.Decimal | null;
        description: string;
        normalizedDesc: string | null;
        counterpartName: string | null;
        counterpartIban: string | null;
        categoryId: string | null;
        source: import(".prisma/client").$Enums.TreasuryMovementSource;
        importId: string | null;
        dedupeHash: string;
        reconciledAmount: Prisma.Decimal;
        externalRef: string | null;
    }>;
    delete(clientId: string, id: string): Promise<void>;
    getSummary(clientId: string, bankAccountId?: string): Promise<{
        totalIncome: number;
        totalExpense: number;
        countIncome: number;
        countExpense: number;
        byStatus: {
            [k: string]: number;
        };
    }>;
}
//# sourceMappingURL=bank-movements.service.d.ts.map