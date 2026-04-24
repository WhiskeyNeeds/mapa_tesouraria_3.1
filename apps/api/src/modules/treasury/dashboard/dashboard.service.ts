import type { PrismaClient } from '@prisma/client'
import { resolveAccountBalance } from '../bank-accounts/balance.js'

export class TreasuryDashboardService {
  constructor(private prisma: PrismaClient) {}

  private async fetchAccountBalances(clientId: string): Promise<Map<string, number>> {
    const accounts = await this.prisma.treasuryBankAccount.findMany({
      where: { clientId, isActive: true, deletedAt: null },
      select: { id: true, openingBalance: true },
    })
    const allMovements = await this.prisma.treasuryBankMovement.findMany({
      where: { bankAccountId: { in: accounts.map((a) => a.id) }, deletedAt: null },
      select: { id: true, bankAccountId: true, date: true, amount: true, balanceAfter: true, source: true },
    })
    const byAccount = new Map<string, typeof allMovements>()
    for (const m of allMovements) {
      if (!byAccount.has(m.bankAccountId)) byAccount.set(m.bankAccountId, [])
      byAccount.get(m.bankAccountId)!.push(m)
    }
    const result = new Map<string, number>()
    for (const acc of accounts) {
      const snapshots = (byAccount.get(acc.id) ?? []).map((m) => ({
        id: m.id,
        date: m.date,
        amount: Number(m.amount),
        balanceAfter: m.balanceAfter !== null ? Number(m.balanceAfter) : null,
        source: m.source,
      }))
      result.set(acc.id, resolveAccountBalance(Number(acc.openingBalance), snapshots))
    }
    return result
  }

  async getOverview(clientId: string, days = 30) {
    const now = new Date()
    const from = new Date(Date.now() - days * 86400000)

    const [bankAccounts, balances, receivableKpis, payableKpis, movements, recentMovements] = await Promise.all([
      this.prisma.treasuryBankAccount.findMany({
        where: { clientId, isActive: true, deletedAt: null },
        select: { id: true, name: true, bankName: true, currency: true, ibanLast4: true },
      }),
      this.fetchAccountBalances(clientId),
      this.prisma.treasuryReceivable.aggregate({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] } },
        _sum: { pendingAmount: true },
        _count: true,
      }),
      this.prisma.treasuryPayable.aggregate({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] } },
        _sum: { pendingAmount: true },
        _count: true,
      }),
      this.prisma.treasuryBankMovement.findMany({
        where: { clientId, deletedAt: null, date: { gte: from } },
        select: { date: true, amount: true },
        orderBy: { date: 'asc' },
      }),
      this.prisma.treasuryBankMovement.findMany({
        where: { clientId, deletedAt: null },
        include: { category: { select: { name: true, color: true } }, bankAccount: { select: { name: true } } },
        orderBy: { date: 'desc' },
        take: 10,
      }),
    ])

    const totalBalance = bankAccounts.reduce((sum, a) => sum + (balances.get(a.id) ?? 0), 0)
    const toReceive = Number(receivableKpis._sum.pendingAmount ?? 0)
    const toPay = Number(payableKpis._sum.pendingAmount ?? 0)
    const cashAvailable = totalBalance - toPay

    // Build daily chart data
    const dailyMap = new Map<string, { income: number; expense: number; balance: number }>()
    let runningBalance = totalBalance
    for (const m of [...movements].reverse()) {
      const key = m.date.toISOString().slice(0, 10)
      if (!dailyMap.has(key)) dailyMap.set(key, { income: 0, expense: 0, balance: runningBalance })
      const day = dailyMap.get(key)!
      if (Number(m.amount) > 0) day.income += Number(m.amount)
      else day.expense += Math.abs(Number(m.amount))
      day.balance = runningBalance
      runningBalance -= Number(m.amount)
    }

    // Overdue
    const overdueReceivables = await this.prisma.treasuryReceivable.count({
      where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now } },
    })
    const overduePayables = await this.prisma.treasuryPayable.count({
      where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now } },
    })

    // Top entities
    const topReceivableEntities = await this.prisma.treasuryReceivable.groupBy({
      by: ['entityName'],
      where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] } },
      _sum: { pendingAmount: true },
      orderBy: { _sum: { pendingAmount: 'desc' } },
      take: 5,
    })
    const topPayableEntities = await this.prisma.treasuryPayable.groupBy({
      by: ['entityName'],
      where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] } },
      _sum: { pendingAmount: true },
      orderBy: { _sum: { pendingAmount: 'desc' } },
      take: 5,
    })

    return {
      kpis: { totalBalance, cashAvailable, toReceive, toPay, countReceivablesOpen: receivableKpis._count, countPayablesOpen: payableKpis._count, overdueReceivables, overduePayables },
      bankAccounts: bankAccounts.map((a) => ({ ...a, currentBalance: balances.get(a.id) ?? 0 })),
      chartData: Array.from(dailyMap.entries()).map(([date, data]) => ({ date, ...data })),
      recentMovements,
      topClients: topReceivableEntities.map((e) => ({ name: e.entityName, amount: Number(e._sum.pendingAmount ?? 0) })),
      topSuppliers: topPayableEntities.map((e) => ({ name: e.entityName, amount: Number(e._sum.pendingAmount ?? 0) })),
    }
  }

  async getCashFlowMonthly(clientId: string, year: number) {
    const start = new Date(year, 0, 1)
    const end = new Date(year, 11, 31, 23, 59, 59)

    const [incomeByMonth, expenseByMonth] = await Promise.all([
      this.prisma.treasuryBankMovement.findMany({
        where: { clientId, deletedAt: null, date: { gte: start, lte: end }, amount: { gt: 0 } },
        select: { date: true, amount: true, categoryId: true, category: { select: { name: true } } },
      }),
      this.prisma.treasuryBankMovement.findMany({
        where: { clientId, deletedAt: null, date: { gte: start, lte: end }, amount: { lt: 0 } },
        select: { date: true, amount: true, categoryId: true, category: { select: { name: true } } },
      }),
    ])

    const months = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1
      const income = incomeByMonth.filter((m) => m.date.getMonth() + 1 === month).reduce((s, m) => s + Number(m.amount), 0)
      const expense = expenseByMonth.filter((m) => m.date.getMonth() + 1 === month).reduce((s, m) => s + Math.abs(Number(m.amount)), 0)
      return { month, income, expense, net: income - expense }
    })

    return { year, months }
  }

  async getForecast(clientId: string, days = 90) {
    const now = new Date()
    const [balances, bankAccounts] = await Promise.all([
      this.fetchAccountBalances(clientId),
      this.prisma.treasuryBankAccount.findMany({
        where: { clientId, isActive: true, deletedAt: null },
        select: { id: true },
      }),
    ])
    const startingBalance = bankAccounts.reduce((sum, a) => sum + (balances.get(a.id) ?? 0), 0)

    const [pendingReceivables, pendingPayables] = await Promise.all([
      this.prisma.treasuryReceivable.findMany({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { gte: now, lte: new Date(Date.now() + days * 86400000) } },
        select: { dueDate: true, pendingAmount: true },
      }),
      this.prisma.treasuryPayable.findMany({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { gte: now, lte: new Date(Date.now() + days * 86400000) } },
        select: { dueDate: true, pendingAmount: true },
      }),
    ])

    let balance = startingBalance
    const dailyForecast: Array<{ date: string; balance: number; income: number; expense: number }> = []

    for (let d = 0; d < days; d++) {
      const date = new Date(Date.now() + d * 86400000)
      const dateStr = date.toISOString().slice(0, 10)
      const income = pendingReceivables
        .filter((r) => r.dueDate.toISOString().slice(0, 10) === dateStr)
        .reduce((s, r) => s + Number(r.pendingAmount), 0)
      const expense = pendingPayables
        .filter((p) => p.dueDate.toISOString().slice(0, 10) === dateStr)
        .reduce((s, p) => s + Number(p.pendingAmount), 0)

      balance = balance + income - expense
      dailyForecast.push({ date: dateStr, balance, income, expense })
    }

    return { startingBalance, days, forecast: dailyForecast }
  }
}
