import type { PrismaClient } from '@prisma/client'
import { encrypt, decrypt } from '../../../plugins/encrypt.js'
import { httpError } from '../../../lib/errors.js'
import { sanitizeIban, assertValidIban } from './iban.js'

export class TreasuryBankAccountsService {
  constructor(private prisma: PrismaClient) { }

  private async resolveFinalBalance(bankAccountId: string, openingBalance: number): Promise<number> {
    // Step 1: derive balance from the imported chain only (exclude MANUAL — they never have bank-verified balances)
    const lastDate = await this.prisma.treasuryBankMovement.findFirst({
      where: { bankAccountId, deletedAt: null, source: { not: 'MANUAL' }, balanceAfter: { not: null } },
      orderBy: { date: 'desc' },
      select: { date: true },
    })

    let chainBalance: number
    if (!lastDate) {
      chainBalance = openingBalance
    } else {
      const lastDayMovs = await this.prisma.treasuryBankMovement.findMany({
        where: { bankAccountId, deletedAt: null, source: { not: 'MANUAL' }, date: lastDate.date!, balanceAfter: { not: null } },
        select: { amount: true, balanceAfter: true },
      })
      if (lastDayMovs.length === 1) {
        chainBalance = Number(lastDayMovs[0].balanceAfter)
      } else {
        const startingBalances = new Set(
          lastDayMovs.map((m) => Math.round((Number(m.balanceAfter) - Number(m.amount)) * 100))
        )
        const tail = lastDayMovs.find((m) => !startingBalances.has(Math.round(Number(m.balanceAfter) * 100)))
        chainBalance = tail ? Number(tail.balanceAfter) : Number(lastDayMovs[0].balanceAfter)
      }
    }

    // Step 2: add all MANUAL movements on top — bank chain is unaware of them regardless of date
    const manualAgg = await this.prisma.treasuryBankMovement.aggregate({
      where: { bankAccountId, deletedAt: null, source: 'MANUAL' },
      _sum: { amount: true },
    })
    return chainBalance + Number(manualAgg._sum.amount ?? 0)
  }

  async list(clientId: string) {
    const [accounts, settings] = await Promise.all([
      this.prisma.treasuryBankAccount.findMany({
        where: { clientId, deletedAt: null, isActive: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.treasurySettings.findUnique({ where: { clientId } }),
    ])

    const balances = await Promise.all(
      accounts.map((a) => this.resolveFinalBalance(a.id, Number(a.openingBalance)))
    )

    const lowBalanceEnabled = settings?.lowBalanceEnabled ?? true

    return accounts.map(({ ibanEnc: _enc, ...acc }, i) => ({
      ...acc,
      currentBalance: balances[i],
      lowBalanceWarning: lowBalanceEnabled && acc.minBalance != null && balances[i] < Number(acc.minBalance),
    }))
  }

  async getById(clientId: string, id: string) {
    const acc = await this.prisma.treasuryBankAccount.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!acc) throw httpError(404, 'Bank account not found')
    const { ibanEnc: _enc, ...rest } = acc
    const currentBalance = await this.resolveFinalBalance(id, Number(acc.openingBalance))
    return { ...rest, currentBalance }
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
    const normalizedIban = iban ? sanitizeIban(iban) : undefined

    if (normalizedIban) {
      assertValidIban(normalizedIban)
    }

    // Name duplicate check
    const sameName = await this.prisma.treasuryBankAccount.findFirst({
      where: { clientId, deletedAt: null, name: { equals: data.name, mode: 'insensitive' } },
    })
    if (sameName) throw httpError(409, `Já existe uma conta com o nome "${data.name}"`)

    // IBAN duplicate check (decrypt existing accounts in memory — clients have few accounts)
    if (normalizedIban) {
      const existing = await this.prisma.treasuryBankAccount.findMany({
        where: { clientId, deletedAt: null, ibanEnc: { not: null } },
        select: { id: true, name: true, ibanEnc: true },
      })
      for (const acc of existing) {
        if (acc.ibanEnc && sanitizeIban(decrypt(acc.ibanEnc)) === normalizedIban) {
          throw httpError(409, `O IBAN já está associado à conta "${acc.name}"`)
        }
      }
    }

    const ibanEnc = normalizedIban ? encrypt(normalizedIban) : undefined
    const ibanLast4 = normalizedIban ? normalizedIban.slice(-4) : undefined

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
    minBalance: number | null
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

  private async recalcManualBalances(bankAccountId: string) {
    const account = await this.prisma.treasuryBankAccount.findUnique({
      where: { id: bankAccountId },
      select: { openingBalance: true },
    })

    const movs = await this.prisma.treasuryBankMovement.findMany({
      where: { bankAccountId, deletedAt: null },
      select: { id: true, amount: true, balanceAfter: true, source: true, date: true },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    })

    // Group by calendar day (Map preserves insertion order → days processed chronologically)
    const byDay = new Map<string, typeof movs>()
    for (const mov of movs) {
      const day = mov.date.toISOString().slice(0, 10)
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day)!.push(mov)
    }

    // Track bank chain end separately from accumulated manual offset
    // so that resetting to the bank anchor doesn't discard previous manual adjustments
    let bankRunning = Number(account?.openingBalance ?? 0)
    let manualCumulative = 0
    const updates: { id: string; balanceAfter: number }[] = []

    for (const dayMovs of byDay.values()) {
      // Find the bank-verified end-of-day balance via tail detection
      // (CSVs are newest-first so createdAt order ≠ chain order — tail detection is required)
      const imported = dayMovs.filter((m) => m.source !== 'MANUAL' && m.balanceAfter !== null)
      if (imported.length === 1) {
        bankRunning = Number(imported[0].balanceAfter)
      } else if (imported.length > 1) {
        const startingBalances = new Set(
          imported.map((m) => Math.round((Number(m.balanceAfter) - Number(m.amount)) * 100))
        )
        const tail = imported.find((m) => !startingBalances.has(Math.round(Number(m.balanceAfter) * 100)))
        bankRunning = tail ? Number(tail.balanceAfter) : Number(imported[imported.length - 1].balanceAfter)
      }

      // Stack manual movements: bankRunning stays at bank anchor, manualCumulative accumulates across days
      for (const mov of dayMovs.filter((m) => m.source === 'MANUAL')) {
        manualCumulative += Number(mov.amount)
        updates.push({ id: mov.id, balanceAfter: bankRunning + manualCumulative })
      }
    }

    if (updates.length > 0) {
      await Promise.all(
        updates.map(({ id, balanceAfter }) =>
          this.prisma.treasuryBankMovement.update({ where: { id }, data: { balanceAfter } })
        )
      )
    }
  }

  async recalcBalance(bankAccountId: string) {
    const account = await this.prisma.treasuryBankAccount.findUnique({ where: { id: bankAccountId } })
    if (!account) return
    await this.recalcManualBalances(bankAccountId)
    // currentBalance is always derived dynamically in list()/getById() — no need to persist it
  }

  decryptIban(ibanEnc: string): string {
    return decrypt(ibanEnc)
  }
}
