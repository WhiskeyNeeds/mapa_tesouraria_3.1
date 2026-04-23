import type { PrismaClient, TreasuryCategoryType } from '@prisma/client';
export declare class TreasuryClassificationRulesService {
    private prisma;
    constructor(prisma: PrismaClient);
    list(clientId: string): Promise<({
        category: {
            name: string;
            id: string;
            color: string | null;
        };
    } & {
        clientId: string;
        createdAt: Date;
        priority: number;
        id: string;
        isActive: boolean;
        updatedAt: Date;
        categoryId: string;
        direction: import(".prisma/client").$Enums.TreasuryCategoryType | null;
        matchField: string;
        matchOp: string;
        matchValue: string;
        amountMin: import("@prisma/client/runtime/library").Decimal | null;
        amountMax: import("@prisma/client/runtime/library").Decimal | null;
        hits: number;
        lastHitAt: Date | null;
    })[]>;
    create(clientId: string, data: {
        matchField: string;
        matchOp: string;
        matchValue: string;
        amountMin?: number;
        amountMax?: number;
        direction?: TreasuryCategoryType;
        categoryId: string;
        priority?: number;
    }): Promise<{
        clientId: string;
        createdAt: Date;
        priority: number;
        id: string;
        isActive: boolean;
        updatedAt: Date;
        categoryId: string;
        direction: import(".prisma/client").$Enums.TreasuryCategoryType | null;
        matchField: string;
        matchOp: string;
        matchValue: string;
        amountMin: import("@prisma/client/runtime/library").Decimal | null;
        amountMax: import("@prisma/client/runtime/library").Decimal | null;
        hits: number;
        lastHitAt: Date | null;
    }>;
    update(clientId: string, id: string, data: Partial<Parameters<TreasuryClassificationRulesService['create']>[1] & {
        isActive: boolean;
    }>): Promise<{
        clientId: string;
        createdAt: Date;
        priority: number;
        id: string;
        isActive: boolean;
        updatedAt: Date;
        categoryId: string;
        direction: import(".prisma/client").$Enums.TreasuryCategoryType | null;
        matchField: string;
        matchOp: string;
        matchValue: string;
        amountMin: import("@prisma/client/runtime/library").Decimal | null;
        amountMax: import("@prisma/client/runtime/library").Decimal | null;
        hits: number;
        lastHitAt: Date | null;
    }>;
    delete(clientId: string, id: string): Promise<{
        clientId: string;
        createdAt: Date;
        priority: number;
        id: string;
        isActive: boolean;
        updatedAt: Date;
        categoryId: string;
        direction: import(".prisma/client").$Enums.TreasuryCategoryType | null;
        matchField: string;
        matchOp: string;
        matchValue: string;
        amountMin: import("@prisma/client/runtime/library").Decimal | null;
        amountMax: import("@prisma/client/runtime/library").Decimal | null;
        hits: number;
        lastHitAt: Date | null;
    }>;
}
//# sourceMappingURL=classification-rules.service.d.ts.map