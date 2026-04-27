import type { PrismaClient } from '@prisma/client';
export declare class TreasuryDashboardService {
    private prisma;
    private recurrencesSvc;
    constructor(prisma: PrismaClient);
    private fetchAccountBalances;
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
            currentBalance: number;
            lowBalanceWarning: boolean;
            name: string;
            id: string;
            currency: string;
            bankName: string | null;
            ibanLast4: string | null;
            minBalance: import("@prisma/client/runtime/library").Decimal | null;
        }[];
        chartData: {
            income: number;
            expense: number;
            balance: number;
            date: string;
        }[];
        recentMovements: {
            id: string;
            date: string;
            amount: number;
            description: string;
            counterpartName: string | null;
            status: import(".prisma/client").$Enums.TreasuryMovementStatus;
            bankAccount: {
                name: string;
            } | null;
            category: {
                name: string;
                color: string | null;
            } | null;
        }[];
        topClients: {
            name: string;
            amount: number;
        }[];
        topSuppliers: {
            name: string;
            amount: number;
        }[];
        upcomingDues: {
            receivables: {
                entityName: string;
                reference: string;
                dueDate: string;
                pendingAmount: number;
            }[];
            payables: {
                entityName: string;
                reference: string;
                dueDate: string;
                pendingAmount: number;
            }[];
        };
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
    getCategoryBreakdown(clientId: string, days?: number): Promise<{
        revenue: {
            name: string;
            color: string;
            amount: number;
        }[];
        expense: {
            name: string;
            color: string;
            amount: number;
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