import type { PrismaClient } from '@prisma/client'
import { encrypt, decrypt } from '../../../plugins/encrypt.js'
import { httpError } from '../../../lib/errors.js'

export class TreasuryBankAccountsService {
  constructor(private prisma: PrismaClient) {}

  async list(clientId: string) {
    const accounts = await this.prisma.treasuryBankAccount.findMany({
      where: { clientId, deletedAt: null, isActive: true },
      orderBy: { name: 'asc' },
    })
    return accounts.map(({ ibanEnc: _enc, ...acc }) => acc)
  }

  async getById(clientId: string, id: string) {
    const acc = await this.prisma.treasuryBankAccount.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!acc) throw httpError(404, 'Bank account not found')
    const { ibanEnc: _enc, ...rest } = acc
    return rest
  }

  async create(clientId: string, data: {
    name: string
    bankName?: string
    currency?: string
    iban?: string
    openingBalance?: number
    minBalance?: number
    tocBankAccountId?: string
  }) {
    const { iban, openingBalance = 0, ...rest } = data

    // Name duplicate check
    const sameName = await this.prisma.treasuryBankAccount.findFirst({
      where: { clientId, deletedAt: null, name: { equals: data.name, mode: 'insensitive' } },
    })
    if (sameName) throw httpError(409, `Já existe uma conta com o nome "${data.name}"`)

    // IBAN duplicate check (decrypt existing accounts in memory — clients have few accounts)
    if (iban) {
      const normalizedIban = iban.replace(/\s/g, '').toUpperCase()
      const existing = await this.prisma.treasuryBankAccount.findMany({
        where: { clientId, deletedAt: null, ibanEnc: { not: null } },
        select: { id: true, name: true, ibanEnc: true },
      })
      for (const acc of existing) {
        if (acc.ibanEnc && decrypt(acc.ibanEnc).replace(/\s/g, '').toUpperCase() === normalizedIban) {
          throw httpError(409, `O IBAN já está associado à conta "${acc.name}"`)
        }
      }
    }

    const ibanEnc = iban ? encrypt(iban) : undefined
    const ibanLast4 = iban ? iban.replace(/\s/g, '').slice(-4) : undefined

    const acc = await this.prisma.treasuryBankAccount.create({
      data: {
        clientId,
        ...rest,
        ibanEnc,
        ibanLast4,
        openingBalance,
        currentBalance: openingBalance,
      },
    })
    const { ibanEnc: _enc, ...result } = acc
    return result
  }

  async update(clientId: string, id: string, data: Partial<{
    name: string
    bankName: string
    minBalance: number
    isActive: boolean
  }>) {
    await this.getById(clientId, id)
    const acc = await this.prisma.treasuryBankAccount.update({ where: { id }, data })
    const { ibanEnc: _enc, ...result } = acc
    return result
  }

  async delete(clientId: string, id: string) {
    await this.getById(clientId, id)
    return this.prisma.treasuryBankAccount.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } })
  }

  async recalcBalance(bankAccountId: string) {
    const account = await this.prisma.treasuryBankAccount.findUnique({ where: { id: bankAccountId } })
    if (!account) return

    const agg = await this.prisma.treasuryBankMovement.aggregate({
      where: { bankAccountId, deletedAt: null },
      _sum: { amount: true },
    })

    const movementsSum = Number(agg._sum.amount ?? 0)
    await this.prisma.treasuryBankAccount.update({
      where: { id: bankAccountId },
      data: { currentBalance: Number(account.openingBalance) + movementsSum },
    })
  }

  decryptIban(ibanEnc: string): string {
    return decrypt(ibanEnc)
  }
}
