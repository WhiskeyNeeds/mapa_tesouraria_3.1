import type { PrismaClient } from '@prisma/client';
import type { JwtPayload } from '../../plugins/auth.js';
export declare class ClientsService {
    private prisma;
    constructor(prisma: PrismaClient);
    getAll(caller: JwtPayload): Promise<{
        createdAt: Date;
        name: string;
        id: string;
        isActive: boolean;
        nif: string;
        countryCode: string;
    }[]>;
    getById(clientId: string, caller: JwtPayload): Promise<{
        createdAt: Date;
        name: string;
        id: string;
        isActive: boolean;
        updatedAt: Date;
        deletedAt: Date | null;
        nif: string;
        companyType: import(".prisma/client").$Enums.BalancoTipoEmpresa;
        countryCode: string;
        nomeOficial: string | null;
        morada: string | null;
        codigoPostal: string | null;
    }>;
    create(data: {
        name: string;
        nif: string;
        morada?: string;
        codigoPostal?: string;
    }, caller: JwtPayload): Promise<{
        createdAt: Date;
        name: string;
        id: string;
        isActive: boolean;
        updatedAt: Date;
        deletedAt: Date | null;
        nif: string;
        companyType: import(".prisma/client").$Enums.BalancoTipoEmpresa;
        countryCode: string;
        nomeOficial: string | null;
        morada: string | null;
        codigoPostal: string | null;
    }>;
    update(clientId: string, data: Partial<{
        name: string;
        morada: string;
        codigoPostal: string;
        isActive: boolean;
    }>): Promise<{
        createdAt: Date;
        name: string;
        id: string;
        isActive: boolean;
        updatedAt: Date;
        deletedAt: Date | null;
        nif: string;
        companyType: import(".prisma/client").$Enums.BalancoTipoEmpresa;
        countryCode: string;
        nomeOficial: string | null;
        morada: string | null;
        codigoPostal: string | null;
    }>;
    delete(clientId: string): Promise<{
        createdAt: Date;
        name: string;
        id: string;
        isActive: boolean;
        updatedAt: Date;
        deletedAt: Date | null;
        nif: string;
        companyType: import(".prisma/client").$Enums.BalancoTipoEmpresa;
        countryCode: string;
        nomeOficial: string | null;
        morada: string | null;
        codigoPostal: string | null;
    }>;
    getUsers(clientId: string): Promise<({
        user: {
            name: string;
            email: string;
            id: string;
            isActive: boolean;
            userRoles: ({
                role: {
                    level: number;
                    createdAt: Date;
                    name: string;
                    id: string;
                };
            } & {
                userId: string;
                createdAt: Date;
                roleId: string;
            })[];
        };
    } & {
        clientId: string;
        userId: string;
        createdAt: Date;
    })[]>;
    assignUser(clientId: string, userId: string): Promise<{
        clientId: string;
        userId: string;
        createdAt: Date;
    }>;
    removeUser(clientId: string, userId: string): Promise<{
        clientId: string;
        userId: string;
        createdAt: Date;
    }>;
    assertClientAccess(caller: JwtPayload, clientId: string): Promise<void>;
}
//# sourceMappingURL=clients.service.d.ts.map