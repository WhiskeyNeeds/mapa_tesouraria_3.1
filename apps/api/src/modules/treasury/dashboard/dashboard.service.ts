import type { PrismaClient } from '@prisma/client'
import { resolveAccountBalance } from '../bank-accounts/balance.js'
import { TreasuryRecurrencesService } from '../recurrences/recurrences.service.js'

export class TreasuryDashboardService {
  private recurrencesSvc: TreasuryRecurrencesService

  constructor(private prisma: PrismaClient) {
    this.recurrencesSvc = new TreasuryRecurrencesService(prisma)
  }

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

    const [bankAccounts, balances, receivableKpis, payableKpis, movements, recentMovements, settings] = await Promise.all([
      this.prisma.treasuryBankAccount.findMany({
        where: { clientId, isActive: true, deletedAt: null },
        select: { id: true, name: true, bankName: true, currency: true, ibanLast4: true, minBalance: true },
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
      this.prisma.treasurySettings.findUnique({ where: { clientId } }),
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

    const nextDays = new Date(Date.now() + 14 * 86400000)

    // Top entities and upcoming dues
    const [topReceivableEntities, topPayableEntities, upcomingReceivables, upcomingPayables] = await Promise.all([
      this.prisma.treasuryReceivable.groupBy({
        by: ['entityName'],
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] } },
        _sum: { pendingAmount: true },
        orderBy: { _sum: { pendingAmount: 'desc' } },
        take: 5,
      }),
      this.prisma.treasuryPayable.groupBy({
        by: ['entityName'],
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] } },
        _sum: { pendingAmount: true },
        orderBy: { _sum: { pendingAmount: 'desc' } },
        take: 5,
      }),
      this.prisma.treasuryReceivable.findMany({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lte: nextDays } },
        select: { entityName: true, reference: true, dueDate: true, pendingAmount: true },
        orderBy: { dueDate: 'asc' },
        take: 5,
      }),
      this.prisma.treasuryPayable.findMany({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lte: nextDays } },
        select: { entityName: true, reference: true, dueDate: true, pendingAmount: true },
        orderBy: { dueDate: 'asc' },
        take: 5,
      }),
    ])

    return {
      kpis: { totalBalance, cashAvailable, toReceive, toPay, countReceivablesOpen: receivableKpis._count, countPayablesOpen: payableKpis._count, overdueReceivables, overduePayables },
      bankAccounts: bankAccounts.map((a) => {
        const currentBalance = balances.get(a.id) ?? 0
        const lowBalanceEnabled = settings?.lowBalanceEnabled ?? true
        const lowBalanceWarning = lowBalanceEnabled && a.minBalance != null && currentBalance < Number(a.minBalance)
        return { ...a, currentBalance, lowBalanceWarning }
      }),
      chartData: Array.from(dailyMap.entries()).map(([date, data]) => ({ date, ...data })),
      recentMovements: recentMovements.map((m) => ({
        id: m.id,
        date: m.date.toISOString(),
        amount: Number(m.amount),
        description: m.description,
        counterpartName: m.counterpartName ?? null,
        status: m.status,
        bankAccount: m.bankAccount ? { name: m.bankAccount.name } : null,
        category: m.category ? { name: m.category.name, color: m.category.color } : null,
      })),
      topClients: topReceivableEntities.map((e) => ({ name: e.entityName, amount: Number(e._sum.pendingAmount ?? 0) })),
      topSuppliers: topPayableEntities.map((e) => ({ name: e.entityName, amount: Number(e._sum.pendingAmount ?? 0) })),
      upcomingDues: {
        receivables: upcomingReceivables.map((r) => ({ entityName: r.entityName, reference: r.reference, dueDate: r.dueDate.toISOString().slice(0, 10), pendingAmount: Number(r.pendingAmount) })),
        payables: upcomingPayables.map((p) => ({ entityName: p.entityName, reference: p.reference, dueDate: p.dueDate.toISOString().slice(0, 10), pendingAmount: Number(p.pendingAmount) })),
      },
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

  async getCategoryBreakdown(clientId: string, days = 30) {
    const from = new Date(Date.now() - days * 86400000)
    const movements = await this.prisma.treasuryBankMovement.findMany({
      where: { clientId, deletedAt: null, date: { gte: from }, categoryId: { not: null } },
      include: { category: { select: { name: true, color: true } } },
    })
    const revenueMap = new Map<string, { name: string; color: string; amount: number }>()
    const expenseMap = new Map<string, { name: string; color: string; amount: number }>()
    for (const m of movements) {
      if (!m.category || !m.categoryId) continue
      const amount = Number(m.amount)
      if (amount > 0) {
        const entry = revenueMap.get(m.categoryId) ?? { name: m.category.name, color: m.category.color ?? '#6b7280', amount: 0 }
        entry.amount += amount
        revenueMap.set(m.categoryId, entry)
      } else if (amount < 0) {
        const entry = expenseMap.get(m.categoryId) ?? { name: m.category.name, color: m.category.color ?? '#6b7280', amount: 0 }
        entry.amount += Math.abs(amount)
        expenseMap.set(m.categoryId, entry)
      }
    }
    const sortDesc = (a: { amount: number }, b: { amount: number }) => b.amount - a.amount
    return {
      revenue: Array.from(revenueMap.values()).sort(sortDesc).slice(0, 8),
      expense: Array.from(expenseMap.values()).sort(sortDesc).slice(0, 8),
    }
  }

  async getCashflowStatement(clientId: string, year: number) {
    const start = new Date(year, 0, 1)
    const end = new Date(year, 11, 31, 23, 59, 59)

    const [movements, categories, bankAccounts] = await Promise.all([
      this.prisma.treasuryBankMovement.findMany({
        where: { clientId, deletedAt: null, date: { gte: start, lte: end } },
        select: { date: true, amount: true, categoryId: true },
      }),
      this.prisma.treasuryCategory.findMany({
        where: { clientId, deletedAt: null, isArchived: false },
        select: { id: true, name: true, type: true, color: true, parentId: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.treasuryBankAccount.findMany({
        where: { clientId, isActive: true, deletedAt: null },
        select: { id: true },
      }),
    ])

    const balances = await this.fetchAccountBalances(clientId)
    const currentBalance = bankAccounts.reduce((s, a) => s + (balances.get(a.id) ?? 0), 0)

    const movementsAfterYear = await this.prisma.treasuryBankMovement.findMany({
      where: { clientId, deletedAt: null, date: { gt: end } },
      select: { amount: true },
    })
    const balanceAtYearEnd = currentBalance - movementsAfterYear.reduce((s, m) => s + Number(m.amount), 0)

    const monthlyIncome = new Array(12).fill(0)
    const monthlyExpense = new Array(12).fill(0)
    for (const m of movements) {
      const idx = m.date.getMonth()
      const amt = Number(m.amount)
      if (amt > 0) monthlyIncome[idx] += amt
      else monthlyExpense[idx] += Math.abs(amt)
    }

    const endingBalances = new Array(12).fill(0)
    const startingBalances = new Array(12).fill(0)
    endingBalances[11] = balanceAtYearEnd
    for (let i = 11; i >= 0; i--) {
      startingBalances[i] = endingBalances[i] - monthlyIncome[i] + monthlyExpense[i]
      if (i > 0) endingBalances[i - 1] = startingBalances[i]
    }

    // Per-category direct monthly amounts (movements assigned directly to this category)
    const catDirectMonthly = new Map<string, number[]>()
    const uncatIncome = new Array(12).fill(0)
    const uncatExpense = new Array(12).fill(0)

    for (const m of movements) {
      const idx = m.date.getMonth()
      const amt = Number(m.amount)
      if (!m.categoryId) {
        if (amt > 0) uncatIncome[idx] += amt
        else uncatExpense[idx] += Math.abs(amt)
        continue
      }
      if (!catDirectMonthly.has(m.categoryId)) catDirectMonthly.set(m.categoryId, new Array(12).fill(0))
      catDirectMonthly.get(m.categoryId)![idx] += Math.abs(amt)
    }

    // Build hierarchy tree
    type CatNode = {
      id: string; name: string; type: string; color: string | null; parentId: string | null
      ownMonthly: number[]; monthly: number[]
      children: CatNode[]
    }

    const nodeMap = new Map<string, CatNode>()
    for (const c of categories) {
      nodeMap.set(c.id, {
        id: c.id, name: c.name, type: c.type, color: c.color, parentId: c.parentId,
        ownMonthly: catDirectMonthly.get(c.id) ?? new Array(12).fill(0),
        monthly: new Array(12).fill(0),
        children: [],
      })
    }

    const roots: CatNode[] = []
    for (const c of categories) {
      const node = nodeMap.get(c.id)!
      if (c.parentId && nodeMap.has(c.parentId)) {
        nodeMap.get(c.parentId)!.children.push(node)
      } else {
        roots.push(node)
      }
    }

    // Aggregate monthly amounts bottom-up (children sum into parents)
    function aggregate(node: CatNode): number[] {
      const total = [...node.ownMonthly]
      for (const child of node.children) {
        const childTotal = aggregate(child)
        for (let i = 0; i < 12; i++) total[i] += childTotal[i]
      }
      node.monthly = total
      return total
    }
    for (const root of roots) aggregate(root)

    // Filter out nodes with no data (all zeros across all months)
    function hasData(node: CatNode): boolean {
      return node.monthly.some((v) => v > 0) || node.children.some(hasData)
    }

    function serializeNode(node: CatNode): object {
      return {
        id: node.id,
        name: node.name,
        type: node.type,
        color: node.color,
        monthly: node.monthly,
        children: node.children.filter(hasData).map(serializeNode),
      }
    }

    const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

    return {
      year,
      months: MONTH_LABELS.map((label, i) => ({ month: i + 1, label })),
      startingBalances,
      endingBalances,
      incomeTotal: monthlyIncome,
      expenseTotal: monthlyExpense,
      uncategorizedIncome: uncatIncome,
      uncategorizedExpense: uncatExpense,
      categories: roots.filter(hasData).map(serializeNode),
    }
  }

  async getCashPositioning(clientId: string, count = 12, startDate?: string) {
    const now = new Date()
    now.setHours(0, 0, 0, 0)

    // End of today — used to include all actual movements from today
    const endOfToday = new Date(now)
    endOfToday.setHours(23, 59, 59, 999)

    // Monday of the current week
    const dow = now.getDay()
    const daysToMon = dow === 0 ? 6 : dow - 1
    const currentMon = new Date(now)
    currentMon.setDate(now.getDate() - daysToMon)

    // Start of the visible window — caller-supplied or default to 3 weeks before current Monday
    let windowStart: Date
    if (startDate) {
      windowStart = new Date(startDate)
      windowStart.setHours(0, 0, 0, 0)
    } else {
      windowStart = new Date(currentMon)
      windowStart.setDate(currentMon.getDate() - 3 * 7)
    }

    // Build exactly `count` week windows starting from windowStart
    const weekList: Array<{ start: Date; end: Date; isFuture: boolean; isCurrent: boolean; label: string }> = []
    for (let i = 0; i < count; i++) {
      const start = new Date(windowStart)
      start.setDate(windowStart.getDate() + i * 7)
      const end = new Date(start)
      end.setDate(start.getDate() + 6)
      end.setHours(23, 59, 59, 999)

      const isCurrent = start.getTime() === currentMon.getTime()
      const isFuture = start > currentMon

      // ISO week number
      const tmp = new Date(start)
      tmp.setDate(tmp.getDate() + 3 - ((tmp.getDay() + 6) % 7))
      const week1 = new Date(tmp.getFullYear(), 0, 4)
      const wn = 1 + Math.round(((tmp.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
      const dayStr = start.toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit' })

      weekList.push({ start, end, isFuture, isCurrent, label: `S${wn} - ${dayStr}` })
    }

    const rangeStart = weekList[0].start
    const rangeEnd = weekList[weekList.length - 1].end

    const [bankAccounts, pastMovements, pendingReceivables, pendingPayables, categories] = await Promise.all([
      this.prisma.treasuryBankAccount.findMany({
        where: { clientId, isActive: true, deletedAt: null },
        select: { id: true },
      }),
      // Use endOfToday so movements recorded today are included in the current week's actuals
      this.prisma.treasuryBankMovement.findMany({
        where: { clientId, deletedAt: null, date: { gte: rangeStart, lte: endOfToday } },
        select: { date: true, amount: true, categoryId: true },
      }),
      // Only fetch pending docs due AFTER today — docs due today belong to actuals, not forecast
      this.prisma.treasuryReceivable.findMany({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { gt: endOfToday, lte: rangeEnd } },
        select: { dueDate: true, pendingAmount: true, categoryId: true },
      }),
      this.prisma.treasuryPayable.findMany({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { gt: endOfToday, lte: rangeEnd } },
        select: { dueDate: true, pendingAmount: true, categoryId: true },
      }),
      this.prisma.treasuryCategory.findMany({
        where: { clientId, deletedAt: null, isArchived: false },
        select: { id: true, name: true, type: true, color: true },
        orderBy: { name: 'asc' },
      }),
    ])

    const balances = await this.fetchAccountBalances(clientId)
    const currentBalance = bankAccounts.reduce((s, a) => s + (balances.get(a.id) ?? 0), 0)

    // Balance at start of range (subtract all past movements within range from current balance)
    const movementsBeforeRange = pastMovements.filter((m) => m.date < rangeStart)
    const movementsInRange = pastMovements.filter((m) => m.date >= rangeStart)
    const balanceAtRangeStart = currentBalance - movementsInRange.reduce((s, m) => s + Number(m.amount), 0)

    let running = balanceAtRangeStart
    const weeks = weekList.map((wk) => {
      let income = 0
      let expense = 0
      const catIncome = new Map<string, number>()
      const catExpense = new Map<string, number>()

      if (!wk.isFuture) {
        // Actual movements
        for (const m of pastMovements) {
          if (m.date < wk.start || m.date > wk.end) continue
          const amt = Number(m.amount)
          if (amt > 0) {
            income += amt
            if (m.categoryId) catIncome.set(m.categoryId, (catIncome.get(m.categoryId) ?? 0) + amt)
          } else {
            expense += Math.abs(amt)
            if (m.categoryId) catExpense.set(m.categoryId, (catExpense.get(m.categoryId) ?? 0) + Math.abs(amt))
          }
        }
      } else {
        // Forecast from pending docs
        for (const r of pendingReceivables) {
          if (r.dueDate < wk.start || r.dueDate > wk.end) continue
          const amt = Number(r.pendingAmount)
          income += amt
          if (r.categoryId) catIncome.set(r.categoryId, (catIncome.get(r.categoryId) ?? 0) + amt)
        }
        for (const p of pendingPayables) {
          if (p.dueDate < wk.start || p.dueDate > wk.end) continue
          const amt = Number(p.pendingAmount)
          expense += amt
          if (p.categoryId) catExpense.set(p.categoryId, (p.categoryId ? (catExpense.get(p.categoryId) ?? 0) + amt : amt))
        }
      }

      const openingBalance = running
      running += income - expense
      const closingBalance = running

      return {
        label: wk.label,
        start: wk.start.toISOString().slice(0, 10),
        end: wk.end.toISOString().slice(0, 10),
        isCurrent: wk.isCurrent,
        isFuture: wk.isFuture,
        openingBalance,
        closingBalance,
        income,
        expense,
        catIncome: Object.fromEntries(catIncome),
        catExpense: Object.fromEntries(catExpense),
      }
    })

    return {
      currentBalance,
      categories: categories.map((c) => ({ id: c.id, name: c.name, type: c.type, color: c.color })),
      weeks,
    }
  }

  async getForecast(clientId: string, days = 90) {
    // Ensure recurring entries are generated up to the forecast horizon before computing
    await this.recurrencesSvc.processForClient(clientId, days + 30)

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
