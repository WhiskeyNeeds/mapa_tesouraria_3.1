import type { PrismaClient } from '@prisma/client'
import { resolveAccountBalance } from '../bank-accounts/balance.js'
import { TreasuryRecurrencesService } from '../recurrences/recurrences.service.js'
import { TreasuryReceivablesService } from '../receivables/receivables.service.js'
import { TreasuryBudgetsService } from '../budgets/budgets.service.js'
import { TreasuryBudgetRulesService } from '../budget-rules/budget-rules.service.js'

export class TreasuryDashboardService {
  private recurrencesSvc: TreasuryRecurrencesService
  private receivablesSvc: TreasuryReceivablesService

  constructor(private prisma: PrismaClient) {
    this.recurrencesSvc = new TreasuryRecurrencesService(prisma)
    // Reutiliza os KPIs de Contas a Receber para o "A Receber" do dashboard usar
    // exatamente os mesmos critérios do "Total Pendente" (single source of truth).
    this.receivablesSvc = new TreasuryReceivablesService(
      prisma,
      new TreasuryBudgetsService(prisma),
      new TreasuryBudgetRulesService(prisma),
    )
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

  /**
   * Devolve TODOS os docs TOC pendentes (sales=FT/FS/FR ou purchase=FC/DSP)
   * que estão em status 1/2/5. Inclui os que têm receivable/payable como
   * anotação local — esses já não duplicam dados de fatura no local (overlay).
   * Shape comum: entityName, reference, dueDate, pendingAmount.
   */
  private async fetchPendingTocDocs(clientId: string, direction: 'receivable' | 'payable') {
    const isReceivable = direction === 'receivable'
    const ELIGIBLE_TYPES = isReceivable
      ? new Set(['ft', 'fs', 'fr'])
      : new Set(['fc', 'dsp'])

    const docs = isReceivable
      ? await this.prisma.tocSalesDocument.findMany({
          where: { clientId, status: { in: [1, 2, 5] } },
          select: { tocId: true, dueDate: true, pendingTotal: true, grossTotal: true, raw: true },
        })
      : await this.prisma.tocPurchaseDocument.findMany({
          where: { clientId, status: { in: [1, 2, 5] } },
          select: { tocId: true, dueDate: true, pendingTotal: true, grossTotal: true, raw: true },
        })

    const result: Array<{ entityName: string; reference: string; dueDate: Date; pendingAmount: number }> = []
    for (const d of docs) {
      const raw = (d.raw ?? {}) as Record<string, unknown>
      const docType = String(raw.document_type ?? '').toLowerCase()
      if (!ELIGIBLE_TYPES.has(docType)) continue
      const pending = Number(d.pendingTotal ?? d.grossTotal ?? 0)
      if (pending <= 0) continue
      if (!d.dueDate) continue
      const entityName = String(raw[isReceivable ? 'customer_business_name' : 'supplier_business_name'] ?? '—')
      const reference = String(raw.document_no ?? '')
      result.push({ entityName, reference, dueDate: new Date(d.dueDate), pendingAmount: pending })
    }
    return result
  }

  async getOverview(clientId: string, days = 30) {
    await this.recurrencesSvc.processForClient(clientId, 30)

    const now = new Date()
    const from = new Date(Date.now() - days * 86400000)

    const [bankAccounts, balances, receivableKpis, payableKpis, movements, recentMovements, settings, tocReceivables, tocPayables, receivablesPageKpis] = await Promise.all([
      this.prisma.treasuryBankAccount.findMany({
        where: { clientId, isActive: true, deletedAt: null },
        select: { id: true, name: true, bankName: true, currency: true, ibanLast4: true, minBalance: true },
      }),
      this.fetchAccountBalances(clientId),
      // Após overlay TOC, evita-se dupla contagem excluindo aqui os receivables
      // com tocSalesDocId (esses passam a ser contados via tocSalesDocument
      // em fetchPendingTocDocs).
      this.prisma.treasuryReceivable.aggregate({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, tocSalesDocId: null },
        _sum: { pendingAmount: true },
        _count: true,
      }),
      this.prisma.treasuryPayable.aggregate({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, tocPurchasesDocId: null },
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
      this.fetchPendingTocDocs(clientId, 'receivable'),
      this.fetchPendingTocDocs(clientId, 'payable'),
      this.receivablesSvc.getKpis(clientId),
    ])

    const totalBalance = bankAccounts.reduce((sum, a) => sum + (balances.get(a.id) ?? 0), 0)
    const tocPayablesPending = tocPayables.reduce((s, d) => s + d.pendingAmount, 0)
    // "A Receber" usa os mesmos critérios do "Total Pendente" de Contas a Receber
    // (exclui recorrências futuras não vencidas; inclui docs TOC sem dueDate).
    const toReceive = receivablesPageKpis.totalPending
    const toPay = Number(payableKpis._sum.pendingAmount ?? 0) + tocPayablesPending
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

    // Overdue (locais sem tocLink + TOC: status 5 OU dueDate < now)
    const tocOverdueReceivables = tocReceivables.filter((d) => d.dueDate < now).length
    const tocOverduePayables = tocPayables.filter((d) => d.dueDate < now).length
    const [overdueReceivablesLocal, overduePayablesLocal] = await Promise.all([
      this.prisma.treasuryReceivable.count({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now }, tocSalesDocId: null },
      }),
      this.prisma.treasuryPayable.count({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now }, tocPurchasesDocId: null },
      }),
    ])
    const overdueReceivables = overdueReceivablesLocal + tocOverdueReceivables
    const overduePayables = overduePayablesLocal + tocOverduePayables

    const nextDays = new Date(Date.now() + 14 * 86400000)

    // Top entities (locais sem tocLink + TOC, agregados por entityName)
    // Upcoming dues nos próximos 14 dias (idem; tocLink já vem em tocReceivables/tocPayables)
    const [topReceivableEntitiesLocal, topPayableEntitiesLocal, upcomingReceivablesLocal, upcomingPayablesLocal] = await Promise.all([
      this.prisma.treasuryReceivable.groupBy({
        by: ['entityName'],
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, tocSalesDocId: null },
        _sum: { pendingAmount: true },
      }),
      this.prisma.treasuryPayable.groupBy({
        by: ['entityName'],
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, tocPurchasesDocId: null },
        _sum: { pendingAmount: true },
      }),
      this.prisma.treasuryReceivable.findMany({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lte: nextDays }, tocSalesDocId: null },
        select: { entityName: true, reference: true, dueDate: true, pendingAmount: true },
      }),
      this.prisma.treasuryPayable.findMany({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lte: nextDays }, tocPurchasesDocId: null },
        select: { entityName: true, reference: true, dueDate: true, pendingAmount: true },
      }),
    ])

    const aggregateByEntity = (
      local: Array<{ entityName: string | null; _sum: { pendingAmount: unknown } }>,
      toc: Array<{ entityName: string; pendingAmount: number }>,
    ) => {
      const map = new Map<string, number>()
      for (const e of local) {
        const key = e.entityName ?? '—'
        map.set(key, (map.get(key) ?? 0) + Number(e._sum.pendingAmount ?? 0))
      }
      for (const d of toc) {
        map.set(d.entityName, (map.get(d.entityName) ?? 0) + d.pendingAmount)
      }
      return [...map.entries()]
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5)
    }
    const topClients = aggregateByEntity(topReceivableEntitiesLocal, tocReceivables)
    const topSuppliers = aggregateByEntity(topPayableEntitiesLocal, tocPayables)

    const mergeUpcoming = (
      local: Array<{ entityName: string | null; reference: string | null; dueDate: Date | null; pendingAmount: unknown }>,
      toc: Array<{ entityName: string; reference: string; dueDate: Date; pendingAmount: number }>,
    ) => {
      const all: Array<{ entityName: string; reference: string; dueDate: Date; pendingAmount: number }> = []
      for (const r of local) {
        if (!r.dueDate) continue
        all.push({
          entityName: r.entityName ?? '—',
          reference: r.reference ?? '',
          dueDate: r.dueDate,
          pendingAmount: Number(r.pendingAmount ?? 0),
        })
      }
      for (const d of toc) if (d.dueDate <= nextDays) all.push(d)
      return all
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
        .slice(0, 5)
        .map((d) => ({ entityName: d.entityName, reference: d.reference, dueDate: d.dueDate.toISOString().slice(0, 10), pendingAmount: d.pendingAmount }))
    }

    return {
      kpis: {
        totalBalance, cashAvailable, toReceive, toPay,
        countReceivablesOpen: receivableKpis._count + tocReceivables.length,
        countPayablesOpen: payableKpis._count + tocPayables.length,
        overdueReceivables, overduePayables,
      },
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
      topClients,
      topSuppliers,
      upcomingDues: {
        receivables: mergeUpcoming(upcomingReceivablesLocal, tocReceivables),
        payables: mergeUpcoming(upcomingPayablesLocal, tocPayables),
      },
    }
  }

  async getAccountMonthlyBalances(clientId: string, year: number) {
    const accounts = await this.prisma.treasuryBankAccount.findMany({
      where: { clientId, isActive: true, deletedAt: null },
      select: { id: true, name: true, openingBalance: true },
      orderBy: { name: 'asc' },
    })

    const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999)

    const allMovements = await this.prisma.treasuryBankMovement.findMany({
      where: { bankAccountId: { in: accounts.map((a) => a.id) }, deletedAt: null, date: { lte: endOfYear } },
      select: { id: true, bankAccountId: true, date: true, amount: true, balanceAfter: true, source: true },
      orderBy: { date: 'asc' },
    })

    const byAccount = new Map<string, typeof allMovements>()
    for (const m of allMovements) {
      if (!byAccount.has(m.bankAccountId)) byAccount.set(m.bankAccountId, [])
      byAccount.get(m.bankAccountId)!.push(m)
    }

    const result = accounts.map((acc) => {
      const movements = byAccount.get(acc.id) ?? []
      const monthlyBalances = Array.from({ length: 12 }, (_, i) => {
        const month = i + 1
        const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999)
        const snapshots = movements
          .filter((m) => m.date <= endOfMonth)
          .map((m) => ({ id: m.id, date: m.date, amount: Number(m.amount), balanceAfter: m.balanceAfter !== null ? Number(m.balanceAfter) : null, source: m.source }))
        return resolveAccountBalance(Number(acc.openingBalance), snapshots)
      })
      return { id: acc.id, name: acc.name, monthlyBalances }
    })

    const now = new Date()
    const forecastTotals: (number | null)[] = new Array(12).fill(null)

    if (endOfYear > now) {
      const horizonDays = Math.ceil((endOfYear.getTime() - now.getTime()) / 86400000) + 30
      await this.recurrencesSvc.processForClient(clientId, Math.min(horizonDays, 365))

      const futureStart = year === now.getFullYear()
        ? new Date(now.getFullYear(), now.getMonth() + 1, 1)
        : new Date(year, 0, 1)

      const [pendingRec, pendingPay] = await Promise.all([
        this.prisma.treasuryReceivable.findMany({
          where: { clientId, deletedAt: null, NOT: { parentId: { not: null }, recurrenceId: null }, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { gte: futureStart, lte: endOfYear } },
          select: { dueDate: true, pendingAmount: true },
        }),
        this.prisma.treasuryPayable.findMany({
          where: { clientId, deletedAt: null, NOT: { parentId: { not: null }, recurrenceId: null }, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { gte: futureStart, lte: endOfYear } },
          select: { dueDate: true, pendingAmount: true },
        }),
      ])

      const monthlyDelta = new Array(12).fill(0)
      for (const r of pendingRec) {
        if (r.dueDate && r.dueDate.getFullYear() === year) monthlyDelta[r.dueDate.getMonth()] += Number(r.pendingAmount ?? 0)
      }
      for (const p of pendingPay) {
        if (p.dueDate && p.dueDate.getFullYear() === year) monthlyDelta[p.dueDate.getMonth()] -= Number(p.pendingAmount ?? 0)
      }

      const lastRealMonthIdx = year === now.getFullYear() ? now.getMonth() : 11
      let running = result.reduce((s, a) => s + a.monthlyBalances[lastRealMonthIdx], 0)

      for (let i = 0; i < 12; i++) {
        const isFuture = year > now.getFullYear() || (year === now.getFullYear() && i > now.getMonth())
        if (isFuture) {
          running += monthlyDelta[i]
          forecastTotals[i] = running
        }
      }
    }

    return { year, accounts: result, forecastTotals }
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
    const now = new Date()

    // Generate recurring entries up to end of the requested year when in future
    if (end > now) {
      const horizonDays = Math.ceil((end.getTime() - now.getTime()) / 86400000) + 30
      await this.recurrencesSvc.processForClient(clientId, Math.min(horizonDays, 365))
    }

    // Lê faturas TOC pendentes diretamente das tabelas espelho locais
    // (sincronizadas em background pelo TocScheduler a cada 5 min).
    // Antes fazia 2 pedidos HTTP ao TOC no caminho crítico — agora é só BD.
    const startStr = start.toISOString().slice(0, 10)
    const endStr = end.toISOString().slice(0, 10)
    const ACTIVE_TOC_STATUS = [1, 2, 5]  // 1=emitido, 2=parcial, 5=vencido

    const [movements, categories, bankAccounts, tocSalesPending, tocPurchPending] = await Promise.all([
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
      this.prisma.tocSalesDocument.findMany({
        where: { clientId, status: { in: ACTIVE_TOC_STATUS }, dueDate: { gte: startStr, lte: endStr } },
        select: { tocId: true, dueDate: true, pendingTotal: true, grossTotal: true, raw: true },
      }),
      this.prisma.tocPurchaseDocument.findMany({
        where: { clientId, status: { in: ACTIVE_TOC_STATUS }, dueDate: { gte: startStr, lte: endStr } },
        select: { tocId: true, dueDate: true, pendingTotal: true, grossTotal: true, raw: true },
      }),
    ])

    const balances = await this.fetchAccountBalances(clientId)
    const currentBalance = bankAccounts.reduce((s, a) => s + (balances.get(a.id) ?? 0), 0)

    // Saldo no início do ano = saldo atual − TODOS os movimentos desde o início
    // desse ano até hoje. Para anos passados isto reconstrói o saldo histórico
    // real (subtraindo tudo o que aconteceu desde então); subtrair apenas os
    // movimentos do próprio ano dava o saldo de hoje em anos sem movimentos.
    // (Para anos futuros o intervalo fica vazio → saldo atual; o encadeamento
    // contínuo entre anos é feito no frontend.)
    const movementsSinceYearStart = await this.prisma.treasuryBankMovement.findMany({
      where: { clientId, deletedAt: null, date: { gte: start, lte: now } },
      select: { amount: true },
    })
    const balanceAtYearStart = currentBalance - movementsSinceYearStart.reduce((s, m) => s + Number(m.amount), 0)

    // Decomposição por status semântico:
    //   settled    = movimentos bancários realizados                  → "Atual" no chart
    //   open       = receivable/payable OPEN/PARTIAL sem recorrência  → "Em aberto" / Esperada
    //   programmed = receivable/payable OPEN/PARTIAL com recurrenceId → "Programada" / Forecast
    const monthlySettledIncome    = new Array(12).fill(0)
    const monthlySettledExpense   = new Array(12).fill(0)
    const monthlyOpenIncome       = new Array(12).fill(0)
    const monthlyOpenExpense      = new Array(12).fill(0)
    const monthlyProgrammedIncome = new Array(12).fill(0)
    const monthlyProgrammedExpense = new Array(12).fill(0)

    // Pendentes (em aberto + programadas) desdobrados por categoria, para a
    // tabela bater certo com os totais/saldo em todos os meses.
    const catPendingMonthly = new Map<string, number[]>()
    const uncatPendingIncome = new Array(12).fill(0)
    const uncatPendingExpense = new Array(12).fill(0)
    const addCatPending = (categoryId: string | null, idx: number, amt: number, income: boolean) => {
      if (!categoryId) { (income ? uncatPendingIncome : uncatPendingExpense)[idx] += amt; return }
      if (!catPendingMonthly.has(categoryId)) catPendingMonthly.set(categoryId, new Array(12).fill(0))
      catPendingMonthly.get(categoryId)![idx] += amt
    }

    for (const m of movements) {
      const idx = m.date.getMonth()
      const amt = Number(m.amount)
      if (amt > 0) monthlySettledIncome[idx] += amt
      else monthlySettledExpense[idx] += Math.abs(amt)
    }

    // Pending docs OPEN/PARTIAL — injectados em qualquer mês (passado, atual ou
    // futuro). Exclui split parcelas (parentId set, recurrenceId null) para
    // evitar double-count com o pai. Subdivide entre "open" e "programmed"
    // consoante existir recurrenceId.
    const [pendingRec, pendingPay, splitRec, splitPay] = await Promise.all([
      this.prisma.treasuryReceivable.findMany({
        where: { clientId, deletedAt: null, NOT: { parentId: { not: null }, recurrenceId: null }, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { gte: start, lte: end } },
        select: { dueDate: true, pendingAmount: true, recurrenceId: true, tocSalesDocId: true, categoryId: true, children: { where: { recurrenceId: null, deletedAt: null }, select: { id: true } } },
      }),
      this.prisma.treasuryPayable.findMany({
        where: { clientId, deletedAt: null, NOT: { parentId: { not: null }, recurrenceId: null }, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { gte: start, lte: end } },
        select: { dueDate: true, pendingAmount: true, recurrenceId: true, tocPurchasesDocId: true, categoryId: true, children: { where: { recurrenceId: null, deletedAt: null }, select: { id: true } } },
      }),
      // Parcelas de splits: a data que conta é a promisedPaymentDate de CADA parcela
      // (o dueDate da parcela é herdado da mãe). São contadas aqui pela sua data real
      // e a mãe é excluída do cálculo (children.length > 0), para o valor ficar
      // distribuído pelos meses reais de pagamento em vez de cair todo num só.
      this.prisma.treasuryReceivable.findMany({
        where: { clientId, deletedAt: null, parentId: { not: null }, recurrenceId: null, status: { in: ['OPEN', 'PARTIAL'] }, promisedPaymentDate: { gte: start, lte: end } },
        select: { promisedPaymentDate: true, pendingAmount: true, categoryId: true },
      }),
      this.prisma.treasuryPayable.findMany({
        where: { clientId, deletedAt: null, parentId: { not: null }, recurrenceId: null, status: { in: ['OPEN', 'PARTIAL'] }, promisedPaymentDate: { gte: start, lte: end } },
        select: { promisedPaymentDate: true, pendingAmount: true, categoryId: true },
      }),
    ])

    // tocIds que já existem como treasuryReceivable/Payable — evita
    // double-count quando o doc TOC também foi importado para local.
    const importedSalesTocIds = new Set(pendingRec.map(r => r.tocSalesDocId).filter((s): s is string => !!s))
    const importedPurchTocIds = new Set(pendingPay.map(p => p.tocPurchasesDocId).filter((s): s is string => !!s))

    for (const r of pendingRec) {
      if (r.children.length > 0) continue // mãe dividida: contam as parcelas (abaixo)
      if (!r.dueDate || r.dueDate.getFullYear() !== year) continue
      const idx = r.dueDate.getMonth()
      const amt = Number(r.pendingAmount ?? 0)
      if (r.recurrenceId) monthlyProgrammedIncome[idx] += amt
      else monthlyOpenIncome[idx] += amt
      addCatPending(r.categoryId, idx, amt, true)
    }
    for (const p of pendingPay) {
      if (p.children.length > 0) continue // mãe dividida: contam as parcelas (abaixo)
      if (!p.dueDate || p.dueDate.getFullYear() !== year) continue
      const idx = p.dueDate.getMonth()
      const amt = Number(p.pendingAmount ?? 0)
      if (p.recurrenceId) monthlyProgrammedExpense[idx] += amt
      else monthlyOpenExpense[idx] += amt
      addCatPending(p.categoryId, idx, amt, false)
    }
    // Parcelas de splits — cada uma na sua data real (promisedPaymentDate). Sem
    // recorrência → entram sempre como "open". Não têm tocSalesDocId (Abordagem A),
    // logo não precisam do dedup TOC; a mãe mantém-se na pendingRec só para o dedup.
    for (const c of splitRec) {
      if (!c.promisedPaymentDate || c.promisedPaymentDate.getFullYear() !== year) continue
      const idx = c.promisedPaymentDate.getMonth()
      const amt = Number(c.pendingAmount ?? 0)
      monthlyOpenIncome[idx] += amt
      addCatPending(c.categoryId, idx, amt, true)
    }
    for (const c of splitPay) {
      if (!c.promisedPaymentDate || c.promisedPaymentDate.getFullYear() !== year) continue
      const idx = c.promisedPaymentDate.getMonth()
      const amt = Number(c.pendingAmount ?? 0)
      monthlyOpenExpense[idx] += amt
      addCatPending(c.categoryId, idx, amt, false)
    }

    // Faturas TOC sincronizadas que ainda não foram importadas como
    // receivable/payable — contam como "open" (não têm recorrência). Filtra
    // pelos tipos elegíveis (raw.document_type) tal como o auto-import fazia.
    const SALES_INVOICE_TYPES = new Set(['ft', 'fs', 'fr'])
    const PURCH_INVOICE_TYPES = new Set(['fc', 'dsp'])
    for (const d of tocSalesPending) {
      if (importedSalesTocIds.has(String(d.tocId))) continue
      const docType = String((d.raw as { document_type?: unknown } | null)?.document_type ?? '').toLowerCase()
      if (!SALES_INVOICE_TYPES.has(docType)) continue
      if (!d.dueDate) continue
      const due = new Date(d.dueDate)
      if (due.getFullYear() !== year) continue
      const amt = Number(d.pendingTotal ?? d.grossTotal ?? 0)
      if (amt <= 0) continue
      monthlyOpenIncome[due.getMonth()] += amt
      addCatPending(null, due.getMonth(), amt, true)
    }
    for (const d of tocPurchPending) {
      if (importedPurchTocIds.has(String(d.tocId))) continue
      const docType = String((d.raw as { document_type?: unknown } | null)?.document_type ?? '').toLowerCase()
      if (!PURCH_INVOICE_TYPES.has(docType)) continue
      if (!d.dueDate) continue
      const due = new Date(d.dueDate)
      if (due.getFullYear() !== year) continue
      const amt = Number(d.pendingTotal ?? d.grossTotal ?? 0)
      if (amt <= 0) continue
      monthlyOpenExpense[due.getMonth()] += amt
      addCatPending(null, due.getMonth(), amt, false)
    }

    // Totais agregados para tabela e saldo. Em TODOS os meses somam-se as 3
    // séries (settled + open + programmed): o saldo é uma projeção contínua de
    // forecast — pendentes vencidos em meses passados também contam, porque
    // influenciam o saldo projetado dali em diante. (Para a visão puramente
    // contabilística "só banco", o ajuste é mudar as datas de pagamento.)
    // Sem dupla contagem: a parte já paga de uma fatura é movimento (settled) e
    // só a parte por liquidar (pendingAmount) entra em open/programmed.
    const monthlyIncome = new Array(12).fill(0)
    const monthlyExpense = new Array(12).fill(0)
    for (let i = 0; i < 12; i++) {
      monthlyIncome[i]  = monthlySettledIncome[i]  + monthlyOpenIncome[i]  + monthlyProgrammedIncome[i]
      monthlyExpense[i] = monthlySettledExpense[i] + monthlyOpenExpense[i] + monthlyProgrammedExpense[i]
    }

    // Forward-prop a partir de balanceAtYearStart: saldo no fim de cada mês =
    // saldo inicial + entradas - saídas (já com settled + open + programmed).
    const endingBalances = new Array(12).fill(0)
    const startingBalances = new Array(12).fill(0)
    startingBalances[0] = balanceAtYearStart
    for (let i = 0; i < 12; i++) {
      endingBalances[i] = startingBalances[i] + monthlyIncome[i] - monthlyExpense[i]
      if (i < 11) startingBalances[i + 1] = endingBalances[i]
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

    // Funde os pendentes (em aberto + programadas) nas categorias e no "Sem
    // categoria" — assim a soma das linhas de categoria = total da secção =
    // reflete no saldo, em todos os meses.
    for (const [catId, arr] of catPendingMonthly) {
      if (!catDirectMonthly.has(catId)) catDirectMonthly.set(catId, new Array(12).fill(0))
      const target = catDirectMonthly.get(catId)!
      for (let i = 0; i < 12; i++) target[i] += arr[i]
    }
    for (let i = 0; i < 12; i++) {
      uncatIncome[i] += uncatPendingIncome[i]
      uncatExpense[i] += uncatPendingExpense[i]
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
      // Subdivisão por status semântico para o chart Cash Flow:
      //   settled    → barras sólidas (Atual)
      //   open       → barras com opacidade (Esperada / Em aberto)
      //   programmed → barras com opacidade + tracejado (Programada / Forecast)
      incomeSettled: monthlySettledIncome,
      incomeOpen: monthlyOpenIncome,
      incomeProgrammed: monthlyProgrammedIncome,
      expenseSettled: monthlySettledExpense,
      expenseOpen: monthlyOpenExpense,
      expenseProgrammed: monthlyProgrammedExpense,
      uncategorizedIncome: uncatIncome,
      uncategorizedExpense: uncatExpense,
      categories: roots.filter(hasData).map(serializeNode),
    }
  }

  async getCashPositioning(clientId: string, count = 12, startDate?: string) {
    await this.recurrencesSvc.processForClient(clientId, count * 7 + 14)

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

    const [bankAccounts, pastMovements, firstMovement, pendingReceivables, pendingPayables, categories] = await Promise.all([
      this.prisma.treasuryBankAccount.findMany({
        where: { clientId, isActive: true, deletedAt: null },
        select: { id: true, name: true },
      }),
      // Use endOfToday so movements recorded today are included in the current week's actuals
      this.prisma.treasuryBankMovement.findMany({
        where: { clientId, deletedAt: null, date: { gte: rangeStart, lte: endOfToday } },
        select: { date: true, amount: true, categoryId: true, bankAccountId: true },
      }),
      this.prisma.treasuryBankMovement.findFirst({
        where: { clientId, deletedAt: null },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
      // Only fetch pending docs due AFTER today — docs due today belong to actuals, not forecast
      this.prisma.treasuryReceivable.findMany({
        where: { clientId, deletedAt: null, NOT: { parentId: { not: null }, recurrenceId: null }, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { gt: endOfToday, lte: rangeEnd } },
        select: { dueDate: true, pendingAmount: true, categoryId: true },
      }),
      this.prisma.treasuryPayable.findMany({
        where: { clientId, deletedAt: null, NOT: { parentId: { not: null }, recurrenceId: null }, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { gt: endOfToday, lte: rangeEnd } },
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

    // Per-account running balances: start from each account's balance minus in-range movements
    const accRunning = new Map<string, number>()
    for (const acc of bankAccounts) {
      const accInRange = movementsInRange.filter((m) => (m as { bankAccountId?: string }).bankAccountId === acc.id)
      accRunning.set(acc.id, (balances.get(acc.id) ?? 0) - accInRange.reduce((s, m) => s + Number(m.amount), 0))
    }

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
          if (!r.dueDate || r.dueDate < wk.start || r.dueDate > wk.end) continue
          const amt = Number(r.pendingAmount ?? 0)
          income += amt
          if (r.categoryId) catIncome.set(r.categoryId, (catIncome.get(r.categoryId) ?? 0) + amt)
        }
        for (const p of pendingPayables) {
          if (!p.dueDate || p.dueDate < wk.start || p.dueDate > wk.end) continue
          const amt = Number(p.pendingAmount ?? 0)
          expense += amt
          if (p.categoryId) catExpense.set(p.categoryId, (p.categoryId ? (catExpense.get(p.categoryId) ?? 0) + amt : amt))
        }
      }

      const openingBalance = running
      running += income - expense
      const closingBalance = running

      // Per-account balances for this week (past only)
      const accountBalances: Array<{ id: string; name: string; balance: number }> = []
      // hasData = week is at or after the earliest imported movement (even if this specific week has no movements)
      const hasData = !wk.isFuture && firstMovement !== null && wk.end >= firstMovement.date
      if (!wk.isFuture) {
        const weekMovements = pastMovements.filter((m) => m.date >= wk.start && m.date <= wk.end)
        for (const acc of bankAccounts) {
          const weekChange = weekMovements
            .filter((m) => (m as { bankAccountId?: string }).bankAccountId === acc.id)
            .reduce((s, m) => s + Number(m.amount), 0)
          const newBal = (accRunning.get(acc.id) ?? 0) + weekChange
          accRunning.set(acc.id, newBal)
          accountBalances.push({ id: acc.id, name: acc.name, balance: newBal })
        }
      }

      return {
        label: wk.label,
        start: wk.start.toISOString().slice(0, 10),
        end: wk.end.toISOString().slice(0, 10),
        isCurrent: wk.isCurrent,
        isFuture: wk.isFuture,
        hasData,
        openingBalance,
        closingBalance,
        income,
        expense,
        catIncome: Object.fromEntries(catIncome),
        catExpense: Object.fromEntries(catExpense),
        accountBalances,
      }
    })

    return {
      currentBalance,
      accounts: bankAccounts.map((a) => ({ id: a.id, name: a.name })),
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
        where: { clientId, deletedAt: null, NOT: { parentId: { not: null }, recurrenceId: null }, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { gte: now, lte: new Date(Date.now() + days * 86400000) } },
        select: { dueDate: true, pendingAmount: true },
      }),
      this.prisma.treasuryPayable.findMany({
        where: { clientId, deletedAt: null, NOT: { parentId: { not: null }, recurrenceId: null }, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { gte: now, lte: new Date(Date.now() + days * 86400000) } },
        select: { dueDate: true, pendingAmount: true },
      }),
    ])

    let balance = startingBalance
    const dailyForecast: Array<{ date: string; balance: number; income: number; expense: number }> = []

    for (let d = 0; d < days; d++) {
      const date = new Date(Date.now() + d * 86400000)
      const dateStr = date.toISOString().slice(0, 10)
      const income = pendingReceivables
        .filter((r) => r.dueDate?.toISOString().slice(0, 10) === dateStr)
        .reduce((s, r) => s + Number(r.pendingAmount ?? 0), 0)
      const expense = pendingPayables
        .filter((p) => p.dueDate?.toISOString().slice(0, 10) === dateStr)
        .reduce((s, p) => s + Number(p.pendingAmount ?? 0), 0)

      balance = balance + income - expense
      dailyForecast.push({ date: dateStr, balance, income, expense })
    }

    return { startingBalance, days, forecast: dailyForecast }
  }
}
