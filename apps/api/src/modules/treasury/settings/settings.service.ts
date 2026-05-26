import type { PrismaClient } from '@prisma/client'

export class TreasurySettingsService {
  constructor(private prisma: PrismaClient) {}

  async get(clientId: string) {
    return this.prisma.treasurySettings.upsert({
      where: { clientId },
      update: {},
      create: { clientId, lowBalanceChannels: ['inapp'] },
    })
  }

  async update(clientId: string, data: Partial<{
    reconciliationDryRun: boolean
    autoMatchEnabled: boolean
    autoMatchThreshold: number
    lowBalanceEnabled: boolean
    lowBalanceChannels: string[]
    importFileRetentionDays: number
    syncIntervalMinutes: number
    followupEnableEmail: boolean
    followupEnableCallTask: boolean
    followupEnableLogCall: boolean
    followupEnableNote: boolean
    followupEnablePdfUpload: boolean
  }>) {
    return this.prisma.treasurySettings.upsert({
      where: { clientId },
      update: data,
      create: { clientId, ...data, lowBalanceChannels: data.lowBalanceChannels ?? ['inapp'] },
    })
  }
}
