export class TreasurySettingsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async get(clientId) {
        return this.prisma.treasurySettings.upsert({
            where: { clientId },
            update: {},
            create: { clientId, lowBalanceChannels: ['inapp'] },
        });
    }
    async update(clientId, data) {
        return this.prisma.treasurySettings.upsert({
            where: { clientId },
            update: data,
            create: { clientId, ...data, lowBalanceChannels: data.lowBalanceChannels ?? ['inapp'] },
        });
    }
}
//# sourceMappingURL=settings.service.js.map