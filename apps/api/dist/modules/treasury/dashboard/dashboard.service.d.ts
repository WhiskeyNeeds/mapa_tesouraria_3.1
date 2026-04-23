import type { PrismaClient } from '@prisma/client';
export declare class TreasuryDashboardService {
    private prisma;
    constructor(prisma: PrismaClient);
    getOverview(clientId: string, days?: number): Promise<{
        kpis: {
            totalBalance: number;
            cashAvailable: number;
            toReceive: number;
            toPay: number;
            countReceivablesOpen: number;
            countPayablesOpen: number;
            overdueReceivables: number;
            overduePayables: number;
        };
        bankAccounts: {
            name: string;
            id: string;
            updatedAt: Date;
            currency: string;
            bankName: string | null;
            ibanLast4: string | null;
            currentBalance: import("@prisma/client/runtime/library").Decimal;
        }[];
        chartData: {
            income: number;
            expense: number;
            balance: number;
            date: string;
        }[];
        recentMovements: ({
            bankAccount: {
                name: string;
            };
            category: {
                name: string;
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
        })[];
        topClients: {
            name: string;
            amount: number;
        }[];
        topSuppliers: {
            name: string;
            amount: number;
        }[];
    }>;
    getCashFlowMonthly(clientId: string, year: number): Promise<{
        year: number;
        months: {
            month: number;
            income: number;
            expense: number;
            net: number;
        }[];
    }>;
    getForecast(clientId: string, days?: number): Promise<{
        startingBalance: number;
        days: number;
        forecast: {
            date: string;
            balance: number;
            income: number;
            expense: number;
        }[];
    }>;
}
//# sourceMappingURL=dashboard.service.d.ts.map