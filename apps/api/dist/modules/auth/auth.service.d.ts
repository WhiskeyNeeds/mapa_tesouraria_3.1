import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
export interface TokenPair {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}
export declare class AuthService {
    private prisma;
    private fastify;
    constructor(prisma: PrismaClient, fastify: FastifyInstance);
    private buildPayload;
    private issueTokens;
    private parseExpiry;
    login(dto: {
        email: string;
        password: string;
    }): Promise<TokenPair>;
    register(dto: {
        name: string;
        email: string;
        password: string;
        phone?: string;
    }): Promise<TokenPair>;
    refresh(token: string): Promise<TokenPair>;
    logout(userId: string): Promise<void>;
    setPassword(token: string, password: string): Promise<TokenPair>;
    forgotPassword(email: string): Promise<void>;
    changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>;
}
//# sourceMappingURL=auth.service.d.ts.map