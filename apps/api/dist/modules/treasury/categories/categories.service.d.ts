import type { PrismaClient, TreasuryCategoryType } from '@prisma/client';
export declare class TreasuryCategoriesService {
    private prisma;
    constructor(prisma: PrismaClient);
    list(clientId: string, type?: TreasuryCategoryType, includeArchived?: boolean): Promise<{
        usageCount: number;
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
    }[]>;
    getById(clientId: string, id: string): Promise<{
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
    }>;
    create(clientId: string, data: {
        name: string;
        type: TreasuryCategoryType;
        launchToc?: boolean;
        tocExpenseCategoryId?: string;
        tocTaxDescriptorId?: string;
        color?: string;
        icon?: string;
    }): Promise<{
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
    }>;
    update(clientId: string, id: string, data: Partial<{
        name: string;
        launchToc: boolean;
        tocExpenseCategoryId: string;
        color: string;
        icon: string;
        isArchived: boolean;
    }>): Promise<{
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
    }>;
    delete(clientId: string, id: string): Promise<{
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
    }>;
}
//# sourceMappingURL=categories.service.d.ts.map