import type { PrismaClient } from '@prisma/client'
import { encrypt, decrypt } from '../../../plugins/encrypt.js'
import { httpError } from '../../../lib/errors.js'

export class TreasuryBankAccountsService {
  constructor(private prisma: PrismaClient) {}

  // Resolves the final balance from the movement chain.
  // When multiple movements share the last date, finds the tail of the chain:
  // the balanceAfter that is not the starting point of any other movement on that day.
  private async resolveFinalBalance(bankAccountId: string, openingBalance: number): Promise<number> {
    const lastDate = await this.prisma.treasuryBankMovement.findFirst({
      where: { bankAccountId, deletedAt: null, balanceAfter: { not: null } },
      orderBy: { date: 'desc' },
      select: { date: true },
    })
    if (!lastDate) return openingBalance

    const lastDayMovs = await this.prisma.treasuryBankMovement.findMany({
      where: { bankAccountId, deletedAt: null, date: lastDate.date!, balanceAfter: { not: null } },
      select: { amount: true, balanceAfter: true },
    })
    if (lastDayMovs.length === 1) return Number(lastDayMovs[0].balanceAfter)

    // Starting balance for each movement = balanceAfter - amount
    const startingBalances = new Set(
      lastDayMovs.map((m) => Math.round((Number(m.balanceAfter) - Number(m.amount)) * 100))
    )
    // The tail is the movement whose balanceAfter is not a starting point of any other
    const tail = lastDayMovs.find((m) => !startingBalances.has(Math.round(Number(m.balanceAfter) * 100)))
    return tail ? Number(tail.balanceAfter) : Number(lastDayMovs[0].balanceAfter)
  }

  async list(clientId: string) {
    const accounts = await this.prisma.treasuryBankAccount.findMany({
      where: { clientId, deletedAt: null, isActive: true },
      orderBy: { name: 'asc' },
    })

    const balances = await Promise.all(
      accounts.map((a) => this.resolveFinalBalance(a.id, Number(a.openingBalance)))
    )

    return accounts.map(({ ibanEnc: _enc, ...acc }, i) => ({
      ...acc,
      currentBalance: balances[i],
    }))
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

    if (data.name) {
      const sameName = await this.prisma.treasuryBankAccount.findFirst({
        where: { clientId, deletedAt: null, name: { equals: data.name, mode: 'insensitive' }, NOT: { id } },
      })
      if (sameName) throw httpError(409, `Já existe uma conta com o nome "${data.name}"`)
    }

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
    const currentBalance = await this.resolveFinalBalance(bankAccountId, Number(account.openingBalance))
    await this.prisma.treasuryBankAccount.update({ where: { id: bankAccountId }, data: { currentBalance } })
  }

  decryptIban(ibanEnc: string): string {
    return decrypt(ibanEnc)
  }
}
