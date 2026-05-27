import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate, formatDateRelative, statusLabel, statusVariant } from '@/lib/utils'
import KpiCard from '@/components/ui/KpiCard'
import Badge from '@/components/ui/Badge'
import { Wallet, ArrowDownToLine, ArrowUpFromLine, AlertTriangle, TrendingUp, TrendingDown, Activity, Clock, CalendarDays, Gauge, ReceiptText, ChevronDown, ChevronRight } from 'lucide-react'
import {
  Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Bar, ComposedChart, Line, PieChart, Pie, Cell, ReferenceLine,
} from 'recharts'
import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'

interface UpcomingDue { entityName: string; reference: string; dueDate: string; pendingAmount: number }
interface CatItem { name: string; color: string; amount: number }
interface RecentMovement {
  id: string; date: string; amount: string | number; description: string; counterpartName?: string | null; status: string; source: string
  bankAccount: { id: string; name: string; bankName: string } | null
  category: { id: string; name: string; color: string } | null
}
interface DashboardData {
  kpis: {
    totalBalance: number; cashAvailable: number; toReceive: number; toPay: number
    countReceivablesOpen: number; countPayablesOpen: number; overdueReceivables: number; overduePayables: number
  }
  bankAccounts: Array<{ id: string; name: string; bankName: string; currentBalance: number; ibanLast4: string; lowBalanceWarning?: boolean; minBalance?: number | null; currency?: string }>
  chartData: Array<{ date: string; income: number; expense: number; balance: number }>
  topClients: Array<{ name: string; amount: number }>
  topSuppliers: Array<{ name: string; amount: number }>
  upcomingDues?: { receivables: UpcomingDue[]; payables: UpcomingDue[] }
}

const MONTH_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const ACCOUNT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#6366f1']

interface AccountMonthlyData {
  year: number
  accounts: Array<{ id: string; name: string; monthlyBalances: number[] }>
  forecastTotals?: (number | null)[]
}

interface CashflowStatCategory {
  id: string; name: string; type: 'REVENUE' | 'EXPENSE'; color: string | null; monthly: number[]
  children?: CashflowStatCategory[]
}
interface CashflowStatementData {
  year: number
  months: Array<{ month: number; label: string }>
  startingBalances: number[]; endingBalances: number[]
  incomeTotal: number[]; expenseTotal: number[]
  uncategorizedIncome: number[]; uncategorizedExpense: number[]
  categories: CashflowStatCategory[]
}
interface CashPositioningWeek {
  label: string; start: string; end: string
  isCurrent: boolean; isFuture: boolean; hasData: boolean
  openingBalance: number; closingBalance: number
  income: number; expense: number
  catIncome: Record<string, number>; catExpense: Record<string, number>
  accountBalances: Array<{ id: string; name: string; balance: number }>
}
interface CashPositioningData {
  currentBalance: number
  accounts: Array<{ id: string; name: string }>
  categories: Array<{ id: string; name: string; type: string; color: string }>
  weeks: CashPositioningWeek[]
}

// Custom tooltip component for recharts
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      {label && <div className="font-medium text-gray-700 mb-1">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-gray-600">{p.name}:</span>
          <span className="font-semibold text-gray-900">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// Donut chart with central total
function DonutWithLegend({ data, total, label }: { data: CatItem[]; total: number; label: string }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  if (data.length === 0) return <div className="text-center text-gray-400 text-sm py-8">Sem dados no período</div>
  return (
    <div className="flex items-start gap-4">
      <div className="flex-shrink-0 relative" style={{ width: 140, height: 140 }}>
        <ResponsiveContainer width={140} height={140}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={44}
              outerRadius={62}
              paddingAngle={2}
              dataKey="amount"
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
              {data.map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.color}
                  opacity={activeIndex === null || activeIndex === index ? 1 : 0.4}
                  stroke="none"
                />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} formatter={(v: number) => formatCurrency(v)} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-xs font-semibold text-gray-900" style={{ fontSize: 11 }}>{formatCurrency(total)}</div>
          <div className="text-gray-400" style={{ fontSize: 9 }}>{label}</div>
        </div>
      </div>
      <div className="flex-1 min-w-0 space-y-1.5 pt-1">
        {data.slice(0, 6).map((c, i) => (
          <div key={i} className={`transition-opacity ${activeIndex !== null && activeIndex !== i ? 'opacity-40' : ''}`}>
            <div className="flex items-center justify-between text-xs mb-0.5">
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                <span className="text-gray-700 truncate">{c.name}</span>
              </div>
              <span className="font-medium text-gray-700 ml-2 whitespace-nowrap">{((c.amount / total) * 100).toFixed(0)}%</span>
            </div>
            <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${(c.amount / data[0].amount) * 100}%`, backgroundColor: c.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

interface ForecastDay { date: string; balance: number; income: number; expense: number }

// Indentation levels for cashflow category rows
const INDENT_PX = [40, 56, 72] // px-10, px-14, px-18

interface ColDef {
  key: string; label: string; colYear: number; monthIndices: number[]
  isFuture: boolean; isCurrent: boolean
}

function CashflowStatementTable() {
  const { selectedClientId } = useAuth()
  const [inflowOpen, setInflowOpen] = useState(true)
  const [outflowOpen, setOutflowOpen] = useState(true)
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set())
  const [selectedColKey, setSelectedColKey] = useState<string | null>(null)
  const [hoveredColKey, setHoveredColKey] = useState<string | null>(null)
  const [viewType, setViewType] = useState<'cashflow' | 'balances'>('cashflow')
  const [periodType, setPeriodType] = useState<'weekly' | 'monthly'>('monthly')

  const [year, setYear] = useState(() => new Date().getFullYear())
  const [monthOffset, setMonthOffset] = useState(0)
  const [weekWindowDate, setWeekWindowDate] = useState<string>(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    const dow = d.getDay()
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1) - 21)
    return d.toISOString().slice(0, 10)
  })

  const currentYear = new Date().getFullYear()
  const currentMonth = new Date().getMonth()
  const activeColKey = hoveredColKey ?? selectedColKey

  const { data: yearData } = useQuery<CashflowStatementData>({
    queryKey: ['dashboard-cashflow-statement', selectedClientId, year],
    queryFn: () => api.get(`/treasury/${selectedClientId}/dashboard/cashflow-statement?year=${year}`),
    enabled: !!selectedClientId,
  })

  const needsNextYear = monthOffset > 0
  const { data: nextYearData } = useQuery<CashflowStatementData>({
    queryKey: ['dashboard-cashflow-statement', selectedClientId, year + 1],
    queryFn: () => api.get(`/treasury/${selectedClientId}/dashboard/cashflow-statement?year=${year + 1}`),
    enabled: !!selectedClientId && needsNextYear,
  })

  const { data: cpData } = useQuery<CashPositioningData>({
    queryKey: ['dashboard-cash-positioning', selectedClientId, weekWindowDate],
    queryFn: () => api.get(`/treasury/${selectedClientId}/dashboard/cash-positioning?count=12&startDate=${weekWindowDate}`),
    enabled: !!selectedClientId,
  })

  const { data: balYearData } = useQuery<AccountMonthlyData>({
    queryKey: ['dashboard-account-balances', selectedClientId, year],
    queryFn: () => api.get(`/treasury/${selectedClientId}/dashboard/account-monthly-balances?year=${year}`),
    enabled: !!selectedClientId,
  })

  const { data: balNextYearData } = useQuery<AccountMonthlyData>({
    queryKey: ['dashboard-account-balances', selectedClientId, year + 1],
    queryFn: () => api.get(`/treasury/${selectedClientId}/dashboard/account-monthly-balances?year=${year + 1}`),
    enabled: !!selectedClientId && needsNextYear,
  })

  const getYearData = (y: number) => y === year ? yearData : y === year + 1 ? nextYearData : undefined
  const getBalYearData = (y: number) => y === year ? balYearData : y === year + 1 ? balNextYearData : undefined

  const cols: ColDef[] = useMemo(() => {
    return Array.from({ length: 12 }, (_, k) => {
      const absMonth = monthOffset + k
      const colYear = year + Math.floor(absMonth / 12)
      const monthIdx = absMonth % 12
      const isFuture = colYear > currentYear || (colYear === currentYear && monthIdx > currentMonth)
      const isCurrent = colYear === currentYear && monthIdx === currentMonth
      const label = MONTH_LABELS[monthIdx]
      const displayLabel = colYear !== year ? `${label} '${String(colYear).slice(2)}` : label
      return { key: `${colYear}-${monthIdx}`, label: displayLabel, colYear, monthIndices: [monthIdx], isFuture, isCurrent }
    })
  }, [year, monthOffset, currentYear, currentMonth])

  const accountColorMap = useMemo(() => {
    const ids = new Set<string>()
    for (const a of balYearData?.accounts ?? []) ids.add(a.id)
    for (const a of balNextYearData?.accounts ?? []) ids.add(a.id)
    for (const a of cpData?.accounts ?? []) ids.add(a.id)
    const sorted = [...ids].sort()
    return new Map(sorted.map((id, i) => [id, ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]]))
  }, [balYearData, balNextYearData, cpData])

  const findCatInTree = (cats: CashflowStatCategory[], id: string): CashflowStatCategory | undefined => {
    for (const c of cats) {
      if (c.id === id) return c
      const found = findCatInTree(c.children ?? [], id)
      if (found) return found
    }
  }

  const colIncome = (col: ColDef) => { const d = getYearData(col.colYear); return d ? col.monthIndices.reduce((s, i) => s + (d.incomeTotal[i] ?? 0), 0) : 0 }
  const colExpense = (col: ColDef) => { const d = getYearData(col.colYear); return d ? col.monthIndices.reduce((s, i) => s + (d.expenseTotal[i] ?? 0), 0) : 0 }
  const colStartBal = (col: ColDef) => { const d = getYearData(col.colYear); return d ? (d.startingBalances[col.monthIndices[0]] ?? 0) : 0 }
  const colEndBal = (col: ColDef) => { const d = getYearData(col.colYear); return d ? (d.endingBalances[col.monthIndices[col.monthIndices.length - 1]] ?? 0) : 0 }
  const colCatAmt = (col: ColDef, cat: CashflowStatCategory) => {
    const d = getYearData(col.colYear)
    if (!d) return 0
    const yearCat = findCatInTree(d.categories, cat.id)
    return yearCat ? col.monthIndices.reduce((s, i) => s + (yearCat.monthly[i] ?? 0), 0) : 0
  }
  const colUncatInc = (col: ColDef) => { const d = getYearData(col.colYear); return d ? col.monthIndices.reduce((s, i) => s + (d.uncategorizedIncome[i] ?? 0), 0) : 0 }
  const colUncatExp = (col: ColDef) => { const d = getYearData(col.colYear); return d ? col.monthIndices.reduce((s, i) => s + (d.uncategorizedExpense[i] ?? 0), 0) : 0 }

  const incomeCats = (yearData?.categories ?? []).filter((c) => c.type === 'REVENUE')
  const expenseCats = (yearData?.categories ?? []).filter((c) => c.type === 'EXPENSE')
  const totalIncome = cols.reduce((s, col) => s + colIncome(col), 0)
  const totalExpense = cols.reduce((s, col) => s + colExpense(col), 0)
  const netVariation = totalIncome - totalExpense

  const navigateMonths = (dir: -1 | 1) => {
    setSelectedColKey(null)
    const newOffset = monthOffset + dir * 3
    if (newOffset < 0) { setYear((y) => y - 1); setMonthOffset(9) }
    else if (newOffset >= 12) { setYear((y) => y + 1); setMonthOffset(0) }
    else setMonthOffset(newOffset)
  }

  const visibleWeeks = cpData?.weeks ?? []
  const navigateWeeks = (dir: -1 | 1) => {
    setSelectedColKey(null)
    setWeekWindowDate((prev) => {
      const d = new Date(prev)
      d.setDate(d.getDate() + dir * 21)
      return d.toISOString().slice(0, 10)
    })
  }

  const endYear = year + Math.floor((monthOffset + 11) / 12)
  const endMonthIdx = (monthOffset + 11) % 12
  const windowLabel = monthOffset === 0 ? `${year}` : `${MONTH_LABELS[monthOffset]} ${year} – ${MONTH_LABELS[endMonthIdx]} ${endYear}`

  const weeklyRangeLabel = (() => {
    if (!visibleWeeks.length) return 'Semanas'
    const MONTHS_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
    const fmt = (s: string) => { const d = new Date(s); return `${MONTHS_PT[d.getUTCMonth()]} ${d.getUTCFullYear()}` }
    const s = fmt(visibleWeeks[0].start)
    const e = fmt(visibleWeeks[visibleWeeks.length - 1].end)
    return s === e ? s : `${s} – ${e}`
  })()

  const netFmt = (v: number) => v === 0 ? '—' : (v > 0 ? '+' : '') + formatCurrency(v)
  const colMinW = 'min-w-[110px]'

  const hoverProps = (key: string) => ({
    onMouseEnter: () => setHoveredColKey(key),
    onMouseLeave: () => setHoveredColKey(null),
    onClick: (e: React.MouseEvent) => { e.stopPropagation(); setSelectedColKey((p) => p === key ? null : key) },
  })

  const chartData = cols.map((col) => ({
    label: col.label,
    income: colIncome(col),
    expense: colExpense(col),
    balance: col.isFuture ? null : colEndBal(col),
  }))

  const weeklyChartData = visibleWeeks.map((wk) => ({
    label: wk.label,
    income: wk.income,
    expense: wk.expense,
    balance: wk.isFuture ? null : wk.closingBalance,
  }))

  const toggleGroup = (id: string) => setClosedGroups((prev) => {
    const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next
  })

  const chartLegend = (
    <div className="flex flex-col gap-2 py-3">
      <div className="text-xs font-medium text-gray-500 mb-0.5">Gráfico</div>
      <div className="flex items-center gap-1.5 text-xs text-gray-500"><div className="w-3 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: '#10b981' }} />Entradas</div>
      <div className="flex items-center gap-1.5 text-xs text-gray-500"><div className="w-3 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: '#ef4444' }} />Saídas</div>
      <div className="flex items-center gap-1.5 text-xs text-gray-500"><div className="w-4 flex-shrink-0 border-b-2 border-blue-500 rounded" style={{ marginTop: 1 }} />Saldo</div>
    </div>
  )

  function renderChart(cData: typeof chartData, nCols: number, isFutureCol: (k: number) => boolean) {
    return (
      <tr>
        <td className="sticky left-0 bg-white z-10 px-5 align-middle border-b border-gray-100" style={{ minWidth: 220 }}>{chartLegend}</td>
        <td colSpan={nCols} className="p-0 border-b border-gray-100">
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart
              data={cData}
              margin={{ left: 0, right: 0, top: 8, bottom: 0 }}
              barCategoryGap="22%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="label" hide />
              <YAxis hide />
              <Tooltip content={<ChartTooltip />} formatter={(v: number) => formatCurrency(v)} />
              <Bar dataKey="income" name="Entradas" fill="#10b981" maxBarSize={32} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                {cData.map((_, k) => <Cell key={k} fill="#10b981" fillOpacity={isFutureCol(k) ? 0.22 : 1} />)}
              </Bar>
              <Bar dataKey="expense" name="Saídas" fill="#ef4444" maxBarSize={32} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                {cData.map((_, k) => <Cell key={k} fill="#ef4444" fillOpacity={isFutureCol(k) ? 0.22 : 1} />)}
              </Bar>
              <Line type="monotone" dataKey="balance" name="Saldo Final" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6', r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </td>
        <td className="border-b border-gray-100 bg-white" />
      </tr>
    )
  }

  const hasCatActivity = (cat: CashflowStatCategory): boolean => {
    const total = cols.reduce((s, col) => s + colCatAmt(col, cat), 0)
    if (total > 0) return true
    return (cat.children ?? []).some(hasCatActivity)
  }

  function renderCatRows(cats: CashflowStatCategory[], depth = 0): React.ReactNode {
    const indentPx = INDENT_PX[Math.min(depth, INDENT_PX.length - 1)]
    return cats.map((cat) => {
      if (!hasCatActivity(cat)) return null
      const hasChildren = (cat.children?.length ?? 0) > 0
      const isOpen = !closedGroups.has(cat.id)
      const catTotal = cols.reduce((s, col) => s + colCatAmt(col, cat), 0)
      return (
        <React.Fragment key={cat.id}>
          <tr className={`hover:bg-gray-50/50 ${hasChildren ? 'cursor-pointer select-none' : ''}`} onClick={hasChildren ? () => toggleGroup(cat.id) : undefined}>
            <td className="py-1.5 sticky left-0 bg-white z-10 pr-4" style={{ paddingLeft: indentPx }}>
              <div className="flex items-center gap-1.5">
                {hasChildren
                  ? (isOpen ? <ChevronDown className="w-3 h-3 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0" />)
                  : <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color ?? '#9ca3af' }} />}
                <span className={`text-xs truncate max-w-[160px] ${hasChildren ? 'font-medium text-gray-700' : 'text-gray-600'}`}>{cat.name}</span>
              </div>
            </td>
            {cols.map((col) => {
              const v = colCatAmt(col, cat)
              return (
                <td key={col.key} className={`px-3 py-1.5 text-right tabular-nums text-xs whitespace-nowrap cursor-pointer select-none ${activeColKey === col.label ? 'bg-blue-50' : ''} ${v > 0 && !col.isFuture ? (hasChildren ? 'font-medium text-gray-700' : 'text-gray-700') : 'text-gray-300'}`} {...hoverProps(col.label)}>
                  {v > 0 && !col.isFuture ? formatCurrency(v) : '—'}
                </td>
              )
            })}
            <td className={`px-3 py-1.5 text-right text-xs whitespace-nowrap ${hasChildren ? 'font-medium text-gray-700' : 'text-gray-600'}`}>{catTotal > 0 ? formatCurrency(catTotal) : '—'}</td>
          </tr>
          {hasChildren && isOpen && renderCatRows(cat.children!, depth + 1)}
        </React.Fragment>
      )
    })
  }

  const renderBalancesWeeklyView = () => {
    if (!cpData) return <div className="px-5 py-8 text-center text-sm text-gray-400">A carregar dados semanais…</div>
    const weeks = visibleWeeks
    if (!weeks.length) return <div className="px-5 py-8 text-center text-sm text-gray-400">Sem dados semanais</div>
    const wkAccounts = cpData.accounts ?? []

    // ── Stacked chart calculations (same logic as monthly view)
    let maxNetPos = 1, maxGrossNeg = 0
    for (const wk of weeks) {
      if (wk.isFuture) {
        if (wk.closingBalance > maxNetPos) maxNetPos = wk.closingBalance
        continue
      }
      if (!wk.hasData) continue
      const accs = wk.accountBalances ?? []
      const gp = accs.reduce((s, a) => s + Math.max(0, a.balance), 0)
      const gn = accs.reduce((s, a) => s + Math.max(0, -a.balance), 0)
      if (gp > maxNetPos) maxNetPos = gp
      if (gn > maxGrossNeg) maxGrossNeg = gn
    }
    const sHasNeg = maxGrossNeg > 0
    const TD_H = 180, CHART_TOP = 16, CHART_BOTTOM = 6
    const CHART_INNER = TD_H - CHART_TOP - CHART_BOTTOM
    const SEP_H = sHasNeg ? 2 : 0
    const niceUp = (max: number, divs = 4) => { const r = max / divs || 1; const m = Math.pow(10, Math.floor(Math.log10(r))); return Math.max(1, Math.ceil(r / m) * m) }
    const sNicePos = niceUp(maxNetPos), sChartMaxPos = Math.ceil(maxNetPos / sNicePos) * sNicePos
    const sNiceNeg = sHasNeg ? niceUp(maxGrossNeg, 2) : 1, sChartMaxNeg = sHasNeg ? Math.ceil(maxGrossNeg / sNiceNeg) * sNiceNeg : 0
    const sNegAreaH = sHasNeg ? Math.max(Math.round(0.15 * (CHART_INNER - SEP_H)), Math.round((sChartMaxNeg / (sChartMaxPos + sChartMaxNeg)) * (CHART_INNER - SEP_H))) : 0
    const sPosAreaH = CHART_INNER - SEP_H - sNegAreaH
    const sTicks: number[] = []
    for (let i = 0; i * sNicePos <= sChartMaxPos + 0.001; i++) sTicks.push(i * sNicePos)
    if (sHasNeg) for (let v = -sNiceNeg; v >= -sChartMaxNeg; v -= sNiceNeg) sTicks.push(v)
    const sTickY = (v: number) => v >= 0
      ? CHART_TOP + sPosAreaH - Math.round((v / sChartMaxPos) * sPosAreaH)
      : CHART_TOP + sPosAreaH + SEP_H + Math.round((Math.abs(v) / sChartMaxNeg) * sNegAreaH)
    const sFmtTick = (v: number) => { const a = Math.abs(v), p = v < 0 ? '-' : ''; return a >= 1e6 ? `${p}${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${p}${(a / 1e3).toFixed(0)}k` : `${p}${Math.round(a)}` }

    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 sticky left-0 bg-gray-50 z-10 min-w-[220px]">Conta</th>
              {weeks.map((wk) => (
                <th key={wk.label} className={`px-3 py-2 text-center text-xs font-medium whitespace-nowrap cursor-pointer select-none ${colMinW} ${activeColKey === wk.label ? 'bg-blue-50 text-blue-700' : wk.isCurrent ? 'text-gray-700' : wk.isFuture ? 'text-gray-400' : 'text-gray-500'}`} {...hoverProps(wk.label)}>
                  {wk.label}
                </th>
              ))}
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap bg-gray-50">—</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {/* Chart row — stacked bars + smooth netTotal line */}
            {(() => {
              const colW = 100 / weeks.length
              const grossPosPts = weeks.map((wk, wkIdx) => {
                if (wk.isFuture || !wk.hasData) return null
                const accs = wk.accountBalances ?? []
                const net = accs.reduce((s, a) => s + a.balance, 0)
                return net !== 0 ? { wkIdx, gp: net } : null
              }).filter((p): p is { wkIdx: number; gp: number } => p !== null)
              return (
                <tr>
                  <td className="sticky left-0 bg-white z-10 px-3 border-b border-gray-100 relative" style={{ height: TD_H }}>
                    {sTicks.map((v) => (
                      <span key={v} className="absolute text-gray-400 tabular-nums select-none pointer-events-none" style={{ top: sTickY(v) - 6, right: 10, fontSize: 9, lineHeight: '12px' }}>
                        {sFmtTick(v)}
                      </span>
                    ))}
                  </td>
                  <td colSpan={weeks.length} className="border-b border-gray-100 p-0" style={{ height: TD_H }}>
                    <div style={{ position: 'relative', height: TD_H }}>
                      {sTicks.map((v) => (
                        <div key={v} className="absolute left-0 right-0 pointer-events-none" style={{ top: sTickY(v), height: v === 0 ? 2 : 1, backgroundColor: v === 0 ? '#d1d5db' : '#f3f4f6' }} />
                      ))}
                      {weeks.map((wk, wkIdx) => {
                        const accs = wk.accountBalances ?? []
                        const netTotal = wk.hasData ? accs.reduce((s, a) => s + a.balance, 0) : 0
                        const grossPos = wk.hasData ? accs.reduce((s, a) => s + Math.max(0, a.balance), 0) : 0
                        const grossNeg = wk.hasData ? accs.reduce((s, a) => s + Math.max(0, -a.balance), 0) : 0
                        const forecastBarH = wk.isFuture && wk.closingBalance > 0 ? Math.round((wk.closingBalance / sChartMaxPos) * sPosAreaH) : 0
                        const barH = grossPos > 0 ? Math.round((grossPos / sChartMaxPos) * sPosAreaH) : 0
                        const negBarH = grossNeg > 0 && sChartMaxNeg > 0 ? Math.round((grossNeg / sChartMaxNeg) * sNegAreaH) : 0
                        return (
                          <div key={wk.label} className={`absolute cursor-pointer select-none group ${activeColKey === wk.label ? 'bg-blue-50' : ''}`}
                            style={{ top: 0, left: `${wkIdx * colW}%`, width: `${colW}%`, height: TD_H }}
                            {...hoverProps(wk.label)}>
                            <div style={{ position: 'absolute', top: CHART_TOP, left: '50%', transform: 'translateX(-13px)', width: 26 }}>
                              <div style={{ height: sPosAreaH, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                                {wk.isFuture && forecastBarH > 0 && (
                                  <div style={{ height: forecastBarH, backgroundColor: '#3b82f6', opacity: 0.22, borderRadius: '2px 2px 0 0' }} />
                                )}
                                {barH > 0 && (
                                  <div style={{ height: barH, display: 'flex', flexDirection: 'column-reverse', overflow: 'hidden', borderRadius: '2px 2px 0 0' }}>
                                    {accs.map((acc) => {
                                      const val = Math.max(0, acc.balance)
                                      if (val === 0 || grossPos === 0) return null
                                      return <div key={acc.id} style={{ height: `${(val / grossPos) * barH}px`, backgroundColor: accountColorMap.get(acc.id) ?? '#3b82f6', minHeight: 1, opacity: wk.isCurrent ? 0.55 : 1 }} />
                                    })}
                                  </div>
                                )}
                              </div>
                              {sHasNeg && <div style={{ height: SEP_H, backgroundColor: '#9ca3af' }} />}
                              {sHasNeg && (
                                <div style={{ height: sNegAreaH, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
                                  {negBarH > 0 && (
                                    <div style={{ height: negBarH, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: '0 0 2px 2px' }}>
                                      {accs.map((acc) => {
                                        const val = Math.max(0, -acc.balance)
                                        if (val === 0 || grossNeg === 0) return null
                                        return <div key={acc.id} style={{ height: `${(val / grossNeg) * negBarH}px`, backgroundColor: accountColorMap.get(acc.id) ?? '#3b82f6', opacity: 0.4, minHeight: 1 }} />
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            {wk.hasData && netTotal !== 0 && (
                              <div className="absolute left-1/2 -translate-x-1/2 rounded-full pointer-events-none" style={{ top: sTickY(netTotal) - 3, width: 6, height: 6, backgroundColor: '#3b82f6', zIndex: 10 }} />
                            )}
                            {wk.isFuture && wk.closingBalance > 0 && (
                              <div className="absolute left-1/2 -translate-x-1/2 rounded-full pointer-events-none" style={{ top: sTickY(wk.closingBalance) - 3, width: 6, height: 6, backgroundColor: '#3b82f6', opacity: 0.4, zIndex: 10 }} />
                            )}
                            {wk.hasData && (grossPos > 0 || netTotal !== 0) && (
                              <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-30 text-xs transition-opacity">
                                <div className="font-medium text-gray-700 mb-1">{wk.label}</div>
                                {accs.map((acc) => (
                                  <div key={acc.id} className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: accountColorMap.get(acc.id) ?? '#3b82f6' }} />
                                    <span className="text-gray-600">{acc.name}:</span>
                                    <span className={`font-semibold ${acc.balance < 0 ? 'text-red-600' : 'text-gray-900'}`}>{formatCurrency(acc.balance)}</span>
                                  </div>
                                ))}
                                <div className="border-t border-gray-100 mt-1 pt-1 flex items-center gap-2">
                                  <div className="w-3 h-0.5 rounded flex-shrink-0" style={{ backgroundColor: '#3b82f6' }} />
                                  <span className="text-gray-600">Total:</span>
                                  <span className={`font-semibold ${netTotal < 0 ? 'text-red-600' : 'text-gray-900'}`}>{formatCurrency(netTotal)}</span>
                                </div>
                              </div>
                            )}
                            {wk.isFuture && (
                              <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-30 text-xs transition-opacity">
                                <div className="font-medium text-gray-500 italic mb-1">{wk.label} (previsão)</div>
                                <div className="flex items-center gap-2">
                                  <div className="w-3 h-0.5 rounded flex-shrink-0" style={{ backgroundColor: '#3b82f6' }} />
                                  <span className="text-gray-600">Saldo previsto:</span>
                                  <span className={`font-semibold ${wk.closingBalance < 0 ? 'text-red-600' : 'text-blue-600'}`}>{formatCurrency(wk.closingBalance)}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                      {/* Continuous grossPos SVG line — smooth Catmull-Rom spline */}
                      {grossPosPts.length >= 2 && (() => {
                        const pts = grossPosPts.map(pt => [pt.wkIdx + 0.5, sTickY(pt.gp)] as [number, number])
                        let d = `M ${pts[0][0]} ${pts[0][1]}`
                        for (let i = 0; i < pts.length - 1; i++) {
                          const p0 = pts[Math.max(0, i - 1)]
                          const p1 = pts[i]
                          const p2 = pts[i + 1]
                          const p3 = pts[Math.min(pts.length - 1, i + 2)]
                          const cp1x = p1[0] + (p2[0] - p0[0]) / 6
                          const cp1y = p1[1] + (p2[1] - p0[1]) / 6
                          const cp2x = p2[0] - (p3[0] - p1[0]) / 6
                          const cp2y = p2[1] - (p3[1] - p1[1]) / 6
                          d += ` C ${cp1x.toFixed(3)} ${cp1y.toFixed(3)}, ${cp2x.toFixed(3)} ${cp2y.toFixed(3)}, ${p2[0]} ${p2[1]}`
                        }
                        return (
                          <svg viewBox={`0 0 ${weeks.length} ${TD_H}`} preserveAspectRatio="none"
                            width="100%" height={TD_H}
                            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'visible' }}>
                            <path d={d} fill="none" stroke="#3b82f6" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                          </svg>
                        )
                      })()}
                    </div>
                  </td>
                  <td className="border-b border-gray-100 bg-white" />
                </tr>
              )
            })()}

            {/* Account rows */}
            {wkAccounts.map((acc) => (
              <tr key={acc.id} className="hover:bg-gray-50/50">
                <td className="px-5 py-2 text-xs font-medium text-gray-700 sticky left-0 bg-white z-10">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: accountColorMap.get(acc.id) ?? '#3b82f6' }} />
                    {acc.name}
                  </div>
                </td>
                {weeks.map((wk) => {
                  const accBal = wk.isFuture ? null : (wk.accountBalances ?? []).find((a) => a.id === acc.id)
                  return (
                    <td key={wk.label} className={`px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap cursor-pointer select-none ${activeColKey === wk.label ? 'bg-blue-50' : ''} ${wk.isFuture ? 'text-gray-300' : accBal && accBal.balance < 0 ? 'text-red-600 font-semibold' : wk.isCurrent ? 'text-gray-500' : 'text-gray-700'}`} {...hoverProps(wk.label)}>
                      {accBal === undefined || accBal === null ? '—' : formatCurrency(accBal.balance)}
                    </td>
                  )
                })}
                <td className="px-3 py-2 text-right text-xs text-gray-300">—</td>
              </tr>
            ))}

            {/* Saldo final */}
            <tr className="bg-white border-t-2 border-gray-300">
              <td className="px-5 py-2.5 text-xs font-bold text-gray-900 sticky left-0 bg-white z-10">Saldo final</td>
              {weeks.map((wk) => (
                <td key={wk.label} className={`px-3 py-2.5 text-right tabular-nums text-xs font-bold whitespace-nowrap cursor-pointer select-none ${activeColKey === wk.label ? 'bg-blue-50' : ''} ${wk.isFuture ? (wk.closingBalance < 0 ? 'text-red-400 italic' : 'text-blue-400 italic') : wk.closingBalance < 0 ? 'text-red-700' : 'text-gray-900'}`} {...hoverProps(wk.label)}>
                  {formatCurrency(wk.closingBalance)}
                </td>
              ))}
              <td className="px-3 py-2.5 text-right text-xs text-gray-300">—</td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  const renderBalancesView = () => {
    const accounts = balYearData?.accounts ?? []
    if (accounts.length === 0) return <div className="px-5 py-8 text-center text-sm text-gray-400">Sem contas bancárias</div>

    const getBalance = (accId: string, col: ColDef): number => {
      const d = getBalYearData(col.colYear)
      if (!d) return 0
      const acc = d.accounts.find((a) => a.id === accId)
      return acc ? acc.monthlyBalances[col.monthIndices[0]] : 0
    }



    // ── Stacked chart calculations
    let maxNetPos = 1, maxGrossNeg = 0
    for (const col of cols) {
      const d = getBalYearData(col.colYear)
      if (!d) continue
      if (col.isFuture) {
        const ft = d.forecastTotals?.[col.monthIndices[0]] ?? null
        if (ft !== null && ft > maxNetPos) maxNetPos = ft
        continue
      }
      const gp = d.accounts.reduce((s, a) => s + Math.max(0, a.monthlyBalances[col.monthIndices[0]]), 0)
      const gn = d.accounts.reduce((s, a) => s + Math.max(0, -a.monthlyBalances[col.monthIndices[0]]), 0)
      if (gp > maxNetPos) maxNetPos = gp
      if (gn > maxGrossNeg) maxGrossNeg = gn
    }
    const sHasNeg = maxGrossNeg > 0
    const TD_H = 180, CHART_TOP = 16, CHART_BOTTOM = 6
    const CHART_INNER = TD_H - CHART_TOP - CHART_BOTTOM
    const SEP_H = sHasNeg ? 2 : 0
    const niceUp = (max: number, divs = 4) => { const r = max / divs || 1; const m = Math.pow(10, Math.floor(Math.log10(r))); return Math.max(1, Math.ceil(r / m) * m) }
    const sNicePos = niceUp(maxNetPos), sChartMaxPos = Math.ceil(maxNetPos / sNicePos) * sNicePos
    const sNiceNeg = sHasNeg ? niceUp(maxGrossNeg, 2) : 1, sChartMaxNeg = sHasNeg ? Math.ceil(maxGrossNeg / sNiceNeg) * sNiceNeg : 0
    const sNegAreaH = sHasNeg ? Math.max(Math.round(0.15 * (CHART_INNER - SEP_H)), Math.round((sChartMaxNeg / (sChartMaxPos + sChartMaxNeg)) * (CHART_INNER - SEP_H))) : 0
    const sPosAreaH = CHART_INNER - SEP_H - sNegAreaH
    const sTicks: number[] = []
    for (let i = 0; i * sNicePos <= sChartMaxPos + 0.001; i++) sTicks.push(i * sNicePos)
    if (sHasNeg) for (let v = -sNiceNeg; v >= -sChartMaxNeg; v -= sNiceNeg) sTicks.push(v)
    const sTickY = (v: number) => v >= 0
      ? CHART_TOP + sPosAreaH - Math.round((v / sChartMaxPos) * sPosAreaH)
      : CHART_TOP + sPosAreaH + SEP_H + Math.round((Math.abs(v) / sChartMaxNeg) * sNegAreaH)
    const sFmtTick = (v: number) => { const a = Math.abs(v), p = v < 0 ? '-' : ''; return a >= 1e6 ? `${p}${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${p}${(a / 1e3).toFixed(0)}k` : `${p}${Math.round(a)}` }

    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 sticky left-0 bg-gray-50 z-10 min-w-[220px]">Conta</th>
              {cols.map((col) => (
                <th key={col.key} className={`px-3 py-2 text-center text-xs font-medium whitespace-nowrap cursor-pointer select-none ${colMinW} ${activeColKey === col.label ? 'bg-blue-50 text-blue-700' : col.isCurrent ? 'text-gray-700' : col.isFuture ? 'text-gray-400' : 'text-gray-500'}`} {...hoverProps(col.label)}>
                  {col.label}
                </th>
              ))}
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap bg-gray-50">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {/* Chart row — Empilhado */}
            {(() => {
              const colW = 100 / cols.length
              const grossPosPts = cols.map((col, colIdx) => {
                if (col.isFuture) return null
                const accs = getBalYearData(col.colYear)?.accounts ?? []
                const net = accs.reduce((s, a) => s + a.monthlyBalances[col.monthIndices[0]], 0)
                return net !== 0 ? { colIdx, gp: net } : null
              }).filter((p): p is { colIdx: number; gp: number } => p !== null)
              return (
                <tr>
                  <td className="sticky left-0 bg-white z-10 px-3 border-b border-gray-100 relative" style={{ height: TD_H }}>
                    {sTicks.map((v) => (
                      <span key={v} className="absolute text-gray-400 tabular-nums select-none pointer-events-none" style={{ top: sTickY(v) - 6, right: 10, fontSize: 9, lineHeight: '12px' }}>
                        {sFmtTick(v)}
                      </span>
                    ))}
                  </td>
                  <td colSpan={cols.length} className="border-b border-gray-100 p-0" style={{ height: TD_H }}>
                    <div style={{ position: 'relative', height: TD_H }}>
                      {/* Horizontal grid lines */}
                      {sTicks.map((v) => (
                        <div key={v} className="absolute left-0 right-0 pointer-events-none" style={{ top: sTickY(v), height: v === 0 ? 2 : 1, backgroundColor: v === 0 ? '#d1d5db' : '#f3f4f6' }} />
                      ))}
                      {/* Per-column bars + hover */}
                      {cols.map((col, colIdx) => {
                        const d = getBalYearData(col.colYear)
                        const accs = d?.accounts ?? []
                        const forecastTotal = col.isFuture ? (d?.forecastTotals?.[col.monthIndices[0]] ?? null) : null
                        const netTotal = !col.isFuture ? accs.reduce((s, a) => s + a.monthlyBalances[col.monthIndices[0]], 0) : 0
                        const grossPos = !col.isFuture ? accs.reduce((s, a) => s + Math.max(0, a.monthlyBalances[col.monthIndices[0]]), 0) : 0
                        const grossNeg = !col.isFuture ? accs.reduce((s, a) => s + Math.max(0, -a.monthlyBalances[col.monthIndices[0]]), 0) : 0
                        const forecastBarH = forecastTotal !== null && forecastTotal > 0 ? Math.round((forecastTotal / sChartMaxPos) * sPosAreaH) : 0
                        const barH = grossPos > 0 ? Math.round((grossPos / sChartMaxPos) * sPosAreaH) : 0
                        const negBarH = grossNeg > 0 && sChartMaxNeg > 0 ? Math.round((grossNeg / sChartMaxNeg) * sNegAreaH) : 0
                        return (
                          <div key={col.key} className={`absolute cursor-pointer select-none group ${activeColKey === col.label ? 'bg-blue-50' : ''}`}
                            style={{ top: 0, left: `${colIdx * colW}%`, width: `${colW}%`, height: TD_H }}
                            {...hoverProps(col.label)}>
                            <div style={{ position: 'absolute', top: CHART_TOP, left: '50%', transform: 'translateX(-13px)', width: 26 }}>
                              <div style={{ height: sPosAreaH, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                                {col.isFuture && forecastBarH > 0 && (
                                  <div style={{ height: forecastBarH, backgroundColor: '#3b82f6', opacity: 0.22, borderRadius: '2px 2px 0 0' }} />
                                )}
                                {barH > 0 && (
                                  <div style={{ height: barH, display: 'flex', flexDirection: 'column-reverse', overflow: 'hidden', borderRadius: '2px 2px 0 0' }}>
                                    {accs.map((acc) => {
                                      const val = Math.max(0, acc.monthlyBalances[col.monthIndices[0]])
                                      if (val === 0 || grossPos === 0) return null
                                      return <div key={acc.id} style={{ height: `${(val / grossPos) * barH}px`, backgroundColor: accountColorMap.get(acc.id) ?? '#3b82f6', minHeight: 1, opacity: col.isCurrent ? 0.55 : 1 }} />
                                    })}
                                  </div>
                                )}
                              </div>
                              {sHasNeg && <div style={{ height: SEP_H, backgroundColor: '#9ca3af' }} />}
                              {sHasNeg && (
                                <div style={{ height: sNegAreaH, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start' }}>
                                  {negBarH > 0 && (
                                    <div style={{ height: negBarH, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: '0 0 2px 2px' }}>
                                      {accs.map((acc) => {
                                        const val = Math.max(0, -acc.monthlyBalances[col.monthIndices[0]])
                                        if (val === 0 || grossNeg === 0) return null
                                        return <div key={acc.id} style={{ height: `${(val / grossNeg) * negBarH}px`, backgroundColor: accountColorMap.get(acc.id) ?? '#3b82f6', opacity: 0.4, minHeight: 1 }} />
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            {!col.isFuture && netTotal !== 0 && (
                              <div className="absolute left-1/2 -translate-x-1/2 rounded-full pointer-events-none" style={{ top: sTickY(netTotal) - 3, width: 6, height: 6, backgroundColor: '#3b82f6', zIndex: 10 }} />
                            )}
                            {col.isFuture && forecastTotal !== null && forecastTotal > 0 && (
                              <div className="absolute left-1/2 -translate-x-1/2 rounded-full pointer-events-none" style={{ top: sTickY(forecastTotal) - 3, width: 6, height: 6, backgroundColor: '#3b82f6', opacity: 0.4, zIndex: 10 }} />
                            )}
                            {!col.isFuture && (grossPos > 0 || netTotal !== 0) && (
                              <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-30 text-xs transition-opacity">
                                <div className="font-medium text-gray-700 mb-1">{col.label}</div>
                                {accs.map((acc) => {
                                  const bal = acc.monthlyBalances[col.monthIndices[0]]
                                  return (
                                    <div key={acc.id} className="flex items-center gap-2">
                                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: accountColorMap.get(acc.id) ?? '#3b82f6' }} />
                                      <span className="text-gray-600">{acc.name}:</span>
                                      <span className={`font-semibold ${bal < 0 ? 'text-red-600' : 'text-gray-900'}`}>{formatCurrency(bal)}</span>
                                    </div>
                                  )
                                })}
                                <div className="border-t border-gray-100 mt-1 pt-1 flex items-center gap-2">
                                  <div className="w-3 h-0.5 rounded flex-shrink-0" style={{ backgroundColor: '#3b82f6' }} />
                                  <span className="text-gray-600">Total:</span>
                                  <span className={`font-semibold ${netTotal < 0 ? 'text-red-600' : 'text-gray-900'}`}>{formatCurrency(netTotal)}</span>
                                </div>
                              </div>
                            )}
                            {col.isFuture && forecastTotal !== null && (
                              <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-30 text-xs transition-opacity">
                                <div className="font-medium text-gray-500 italic mb-1">{col.label} (previsão)</div>
                                <div className="flex items-center gap-2">
                                  <div className="w-3 h-0.5 rounded flex-shrink-0" style={{ backgroundColor: '#3b82f6' }} />
                                  <span className="text-gray-600">Saldo previsto:</span>
                                  <span className={`font-semibold ${forecastTotal < 0 ? 'text-red-600' : 'text-blue-600'}`}>{formatCurrency(forecastTotal)}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                      {/* Continuous grossPos SVG line — smooth Catmull-Rom spline */}
                      {grossPosPts.length >= 2 && (() => {
                        const pts = grossPosPts.map(pt => [pt.colIdx + 0.5, sTickY(pt.gp)] as [number, number])
                        let d = `M ${pts[0][0]} ${pts[0][1]}`
                        for (let i = 0; i < pts.length - 1; i++) {
                          const p0 = pts[Math.max(0, i - 1)]
                          const p1 = pts[i]
                          const p2 = pts[i + 1]
                          const p3 = pts[Math.min(pts.length - 1, i + 2)]
                          const cp1x = p1[0] + (p2[0] - p0[0]) / 6
                          const cp1y = p1[1] + (p2[1] - p0[1]) / 6
                          const cp2x = p2[0] - (p3[0] - p1[0]) / 6
                          const cp2y = p2[1] - (p3[1] - p1[1]) / 6
                          d += ` C ${cp1x.toFixed(3)} ${cp1y.toFixed(3)}, ${cp2x.toFixed(3)} ${cp2y.toFixed(3)}, ${p2[0]} ${p2[1]}`
                        }
                        return (
                          <svg viewBox={`0 0 ${cols.length} ${TD_H}`} preserveAspectRatio="none"
                            width="100%" height={TD_H}
                            style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', overflow: 'visible' }}>
                            <path d={d} fill="none" stroke="#3b82f6" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                          </svg>
                        )
                      })()}
                    </div>
                  </td>
                  <td className="border-b border-gray-100 bg-white" />
                </tr>
              )
            })()}

            {/* Account rows */}
            {accounts.map((acc) => (
              <tr key={acc.id} className="hover:bg-gray-50/50">
                <td className="px-5 py-2 text-xs font-medium text-gray-700 sticky left-0 bg-white z-10">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: accountColorMap.get(acc.id) ?? '#3b82f6' }} />
                    {acc.name}
                  </div>
                </td>
                {cols.map((col) => {
                  const bal = col.isFuture ? null : getBalance(acc.id, col)
                  return (
                    <td key={col.key} className={`px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap cursor-pointer select-none ${activeColKey === col.label ? 'bg-blue-50' : ''} ${col.isFuture ? 'text-gray-300' : bal !== null && bal < 0 ? 'text-red-600 font-semibold' : col.isCurrent ? 'text-gray-500' : 'text-gray-700'}`} {...hoverProps(col.label)}>
                      {bal === null ? '—' : formatCurrency(bal)}
                    </td>
                  )
                })}
                <td className="px-3 py-2 text-right text-xs text-gray-300">—</td>
              </tr>
            ))}

            {/* Saldo final */}
            <tr className="bg-white border-t-2 border-gray-300">
              <td className="px-5 py-2.5 text-xs font-bold text-gray-900 sticky left-0 bg-white z-10">Saldo final</td>
              {cols.map((col) => {
                const d = getBalYearData(col.colYear)
                const total = col.isFuture ? null : d ? d.accounts.reduce((s, a) => s + a.monthlyBalances[col.monthIndices[0]], 0) : null
                const forecast = col.isFuture ? (d?.forecastTotals?.[col.monthIndices[0]] ?? null) : null
                const displayVal = total ?? forecast
                return (
                  <td key={col.key} className={`px-3 py-2.5 text-right tabular-nums text-xs font-bold whitespace-nowrap cursor-pointer select-none ${activeColKey === col.label ? 'bg-blue-50' : ''} ${col.isFuture ? (forecast !== null ? (forecast < 0 ? 'text-red-400 italic' : 'text-blue-400 italic') : 'text-gray-300') : total !== null && total < 0 ? 'text-red-700' : 'text-gray-900'}`} {...hoverProps(col.label)}>
                    {displayVal === null ? '—' : formatCurrency(displayVal)}
                  </td>
                )
              })}
              <td className="px-3 py-2.5 text-right text-xs text-gray-300">—</td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  const renderPeriodView = () => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 sticky left-0 bg-gray-50 z-10 min-w-[220px]">Categoria</th>
            {cols.map((col) => (
              <th key={col.key} className={`px-3 py-2 text-center text-xs font-medium whitespace-nowrap cursor-pointer select-none ${colMinW} ${activeColKey === col.label ? 'bg-blue-50 text-blue-700' : col.isCurrent ? 'text-gray-700' : col.isFuture ? 'text-gray-400' : 'text-gray-500'}`} {...hoverProps(col.label)}>
                {col.label}
              </th>
            ))}
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap bg-gray-50">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {renderChart(chartData, cols.length, (k) => cols[k].isFuture)}

          <tr className="bg-white hover:bg-gray-50/50">
            <td className="px-5 py-2 text-xs font-semibold text-gray-700 sticky left-0 bg-white z-10">Saldo inicial</td>
            {cols.map((col) => {
              const v = colStartBal(col)
              return <td key={col.key} className={`px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap font-semibold cursor-pointer select-none ${activeColKey === col.label ? 'bg-blue-50' : ''} ${col.isFuture ? 'text-gray-300' : 'text-gray-700'}`} {...hoverProps(col.label)}>{col.isFuture ? '—' : formatCurrency(v)}</td>
            })}
            <td className="px-3 py-2 text-right text-xs text-gray-300">—</td>
          </tr>

          <tr className="bg-emerald-50 hover:bg-emerald-100 cursor-pointer select-none" onClick={() => setInflowOpen((o) => !o)}>
            <td className="px-5 py-2 sticky left-0 bg-emerald-50 z-10">
              <div className="flex items-center gap-1.5">
                {inflowOpen ? <ChevronDown className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />}
                <span className="text-xs font-semibold text-emerald-800">Entradas</span>
              </div>
            </td>
            {cols.map((col) => {
              const v = colIncome(col)
              return <td key={col.key} className={`px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap font-semibold cursor-pointer select-none ${activeColKey === col.label ? 'bg-emerald-100' : ''} ${col.isFuture ? 'text-gray-300' : v > 0 ? 'text-emerald-700' : 'text-gray-300'}`} {...hoverProps(col.label)}>{v > 0 && !col.isFuture ? formatCurrency(v) : '—'}</td>
            })}
            <td className="px-3 py-2 text-right text-xs font-semibold text-emerald-700 whitespace-nowrap">{totalIncome > 0 ? formatCurrency(totalIncome) : '—'}</td>
          </tr>
          {inflowOpen && renderCatRows(incomeCats)}
          {inflowOpen && cols.some((col) => colUncatInc(col) > 0) && (
            <tr className="bg-white hover:bg-gray-50/50">
              <td className="pl-10 pr-5 py-1.5 text-xs text-gray-400 italic sticky left-0 bg-white z-10">Sem categoria</td>
              {cols.map((col) => { const v = colUncatInc(col); return <td key={col.key} className={`px-3 py-1.5 text-right tabular-nums text-xs whitespace-nowrap cursor-pointer select-none ${activeColKey === col.label ? 'bg-blue-50' : ''} ${v > 0 && !col.isFuture ? 'text-gray-400' : 'text-gray-300'}`} {...hoverProps(col.label)}>{v > 0 && !col.isFuture ? formatCurrency(v) : '—'}</td> })}
              <td className="px-3 py-1.5 text-right text-xs text-gray-400 whitespace-nowrap">{(() => { const t = cols.reduce((s, col) => s + colUncatInc(col), 0); return t > 0 ? formatCurrency(t) : '—' })()}</td>
            </tr>
          )}

          <tr className="bg-red-50 hover:bg-red-100 cursor-pointer select-none" onClick={() => setOutflowOpen((o) => !o)}>
            <td className="px-5 py-2 sticky left-0 bg-red-50 z-10">
              <div className="flex items-center gap-1.5">
                {outflowOpen ? <ChevronDown className="w-3.5 h-3.5 text-red-600 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />}
                <span className="text-xs font-semibold text-red-800">Saídas</span>
              </div>
            </td>
            {cols.map((col) => {
              const v = colExpense(col)
              return <td key={col.key} className={`px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap font-semibold cursor-pointer select-none ${activeColKey === col.label ? 'bg-red-100' : ''} ${col.isFuture ? 'text-gray-300' : v > 0 ? 'text-red-700' : 'text-gray-300'}`} {...hoverProps(col.label)}>{v > 0 && !col.isFuture ? formatCurrency(v) : '—'}</td>
            })}
            <td className="px-3 py-2 text-right text-xs font-semibold text-red-700 whitespace-nowrap">{totalExpense > 0 ? formatCurrency(totalExpense) : '—'}</td>
          </tr>
          {outflowOpen && renderCatRows(expenseCats)}
          {outflowOpen && cols.some((col) => colUncatExp(col) > 0) && (
            <tr className="bg-white hover:bg-gray-50/50">
              <td className="pl-10 pr-5 py-1.5 text-xs text-gray-400 italic sticky left-0 bg-white z-10">Sem categoria</td>
              {cols.map((col) => { const v = colUncatExp(col); return <td key={col.key} className={`px-3 py-1.5 text-right tabular-nums text-xs whitespace-nowrap cursor-pointer select-none ${activeColKey === col.label ? 'bg-blue-50' : ''} ${v > 0 && !col.isFuture ? 'text-gray-400' : 'text-gray-300'}`} {...hoverProps(col.label)}>{v > 0 && !col.isFuture ? formatCurrency(v) : '—'}</td> })}
              <td className="px-3 py-1.5 text-right text-xs text-gray-400 whitespace-nowrap">{(() => { const t = cols.reduce((s, col) => s + colUncatExp(col), 0); return t > 0 ? formatCurrency(t) : '—' })()}</td>
            </tr>
          )}

          <tr className="bg-gray-50 border-t border-gray-200">
            <td className="px-5 py-2 text-xs font-semibold text-gray-700 sticky left-0 bg-gray-50 z-10">Variação líquida</td>
            {cols.map((col) => {
              const net = colIncome(col) - colExpense(col)
              return <td key={col.key} className={`px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap font-semibold cursor-pointer select-none ${activeColKey === col.label ? 'bg-blue-50' : ''} ${col.isFuture || net === 0 ? 'text-gray-300' : net > 0 ? 'text-emerald-700' : 'text-red-700'}`} {...hoverProps(col.label)}>{net !== 0 && !col.isFuture ? netFmt(net) : '—'}</td>
            })}
            <td className={`px-3 py-2 text-right text-xs font-semibold whitespace-nowrap ${netVariation === 0 ? 'text-gray-300' : netVariation > 0 ? 'text-emerald-700' : 'text-red-700'}`}>{netVariation !== 0 ? netFmt(netVariation) : '—'}</td>
          </tr>

          <tr className="bg-white border-t-2 border-gray-300">
            <td className="px-5 py-2.5 text-xs font-bold text-gray-900 sticky left-0 bg-white z-10">Saldo final</td>
            {cols.map((col) => {
              const v = colEndBal(col)
              return <td key={col.key} className={`px-3 py-2.5 text-right tabular-nums text-xs whitespace-nowrap font-bold cursor-pointer select-none ${activeColKey === col.label ? 'bg-blue-50 text-blue-900' : col.isFuture ? 'text-gray-300' : v < 0 ? 'text-red-700' : 'text-gray-900'}`} {...hoverProps(col.label)}>{col.isFuture ? '—' : formatCurrency(v)}</td>
            })}
            <td className="px-3 py-2.5 text-right text-xs text-gray-300">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  )

  const renderWeeklyView = () => {
    if (!cpData) return <div className="px-5 py-8 text-center text-xs text-gray-400">Dados semanais não disponíveis</div>
    const wkIncomeCats = cpData.categories.filter((c) => c.type === 'REVENUE')
    const wkExpenseCats = cpData.categories.filter((c) => c.type === 'EXPENSE')
    const wkTotalIncome = visibleWeeks.reduce((s, w) => s + w.income, 0)
    const wkTotalExpense = visibleWeeks.reduce((s, w) => s + w.expense, 0)
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-5 py-2 text-left text-xs font-medium text-gray-500 sticky left-0 bg-gray-50 z-10 min-w-[220px]">Categoria</th>
              {visibleWeeks.map((wk) => (
                <th key={wk.label} className={`px-3 py-2 text-center text-xs font-medium whitespace-nowrap cursor-pointer select-none min-w-[110px] ${activeColKey === wk.label ? 'bg-blue-50 text-blue-700' : wk.isCurrent ? 'text-blue-600' : wk.isFuture ? 'text-gray-400' : 'text-gray-500'}`} {...hoverProps(wk.label)}>
                  <div>{wk.label}</div>
                  <div className="text-gray-400 mt-0.5" style={{ fontSize: 9 }}>{wk.isCurrent ? 'atual' : wk.isFuture ? 'previsão' : 'realizado'}</div>
                </th>
              ))}
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap bg-gray-50">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {renderChart(weeklyChartData, visibleWeeks.length, (k) => visibleWeeks[k].isFuture)}

            <tr className="bg-white hover:bg-gray-50/50">
              <td className="px-5 py-2.5 text-xs font-semibold text-gray-700 sticky left-0 bg-white z-10">Saldo inicial</td>
              {visibleWeeks.map((wk) => (
                <td key={wk.label} className={`px-3 py-2.5 text-right tabular-nums text-xs whitespace-nowrap font-medium cursor-pointer select-none ${activeColKey === wk.label ? 'bg-blue-50' : ''} ${wk.openingBalance < 0 ? 'text-red-700' : wk.isCurrent ? 'text-blue-900' : wk.isFuture ? 'text-gray-500' : 'text-gray-800'}`} {...hoverProps(wk.label)}>
                  {formatCurrency(wk.openingBalance)}
                </td>
              ))}
              <td className="px-3 py-2.5 text-right text-xs text-gray-300">—</td>
            </tr>

            <tr className="bg-emerald-50 hover:bg-emerald-100 cursor-pointer select-none" onClick={() => setInflowOpen((o) => !o)}>
              <td className="px-5 py-2 sticky left-0 bg-emerald-50 z-10">
                <div className="flex items-center gap-1.5">
                  {inflowOpen ? <ChevronDown className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />}
                  <span className="text-xs font-semibold text-emerald-800">Entradas</span>
                </div>
              </td>
              {visibleWeeks.map((wk) => (
                <td key={wk.label} className={`px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap font-semibold cursor-pointer select-none ${activeColKey === wk.label ? 'bg-emerald-100' : ''} ${wk.income > 0 ? wk.isFuture ? 'text-emerald-400' : 'text-emerald-700' : 'text-gray-300'}`} {...hoverProps(wk.label)}>
                  {wk.income > 0 ? formatCurrency(wk.income) : '—'}
                </td>
              ))}
              <td className="px-3 py-2 text-right text-xs font-semibold text-emerald-700 whitespace-nowrap">{wkTotalIncome > 0 ? formatCurrency(wkTotalIncome) : '—'}</td>
            </tr>
            {inflowOpen && wkIncomeCats.map((cat) => {
              const catTotal = visibleWeeks.reduce((s, wk) => s + (wk.catIncome[cat.id] ?? 0), 0)
              if (catTotal === 0) return null
              return (
                <tr key={cat.id} className="bg-white hover:bg-gray-50/50">
                  <td className="py-1.5 sticky left-0 bg-white z-10 pr-4" style={{ paddingLeft: INDENT_PX[0] }}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color ?? '#9ca3af' }} />
                      <span className="text-xs truncate max-w-[160px] text-gray-600">{cat.name}</span>
                    </div>
                  </td>
                  {visibleWeeks.map((wk) => {
                    const v = wk.catIncome[cat.id] ?? 0
                    return <td key={wk.label} className={`px-3 py-1.5 text-right tabular-nums text-xs whitespace-nowrap cursor-pointer select-none ${activeColKey === wk.label ? 'bg-blue-50' : ''} ${v > 0 ? 'text-gray-700' : 'text-gray-300'}`} {...hoverProps(wk.label)}>{v > 0 ? formatCurrency(v) : '—'}</td>
                  })}
                  <td className="px-3 py-1.5 text-right text-xs text-gray-600 whitespace-nowrap">{catTotal > 0 ? formatCurrency(catTotal) : '—'}</td>
                </tr>
              )
            })}
            {inflowOpen && (() => {
              const wkUncatInc = (wk: CashPositioningWeek) => Math.max(0, wk.income - wkIncomeCats.reduce((s, c) => s + (wk.catIncome[c.id] ?? 0), 0))
              const totalUncat = visibleWeeks.reduce((s, wk) => s + wkUncatInc(wk), 0)
              if (totalUncat <= 0) return null
              return (
                <tr className="bg-white hover:bg-gray-50/50">
                  <td className="pl-10 pr-5 py-1.5 text-xs text-gray-400 italic sticky left-0 bg-white z-10">Sem categoria</td>
                  {visibleWeeks.map((wk) => { const v = wkUncatInc(wk); return <td key={wk.label} className={`px-3 py-1.5 text-right tabular-nums text-xs whitespace-nowrap cursor-pointer select-none ${activeColKey === wk.label ? 'bg-blue-50' : ''} ${v > 0 ? 'text-gray-400' : 'text-gray-300'}`} {...hoverProps(wk.label)}>{v > 0 ? formatCurrency(v) : '—'}</td> })}
                  <td className="px-3 py-1.5 text-right text-xs text-gray-400 whitespace-nowrap">{formatCurrency(totalUncat)}</td>
                </tr>
              )
            })()}

            <tr className="bg-red-50 hover:bg-red-100 cursor-pointer select-none" onClick={() => setOutflowOpen((o) => !o)}>
              <td className="px-5 py-2 sticky left-0 bg-red-50 z-10">
                <div className="flex items-center gap-1.5">
                  {outflowOpen ? <ChevronDown className="w-3.5 h-3.5 text-red-600 flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />}
                  <span className="text-xs font-semibold text-red-800">Saídas</span>
                </div>
              </td>
              {visibleWeeks.map((wk) => (
                <td key={wk.label} className={`px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap font-semibold cursor-pointer select-none ${activeColKey === wk.label ? 'bg-red-100' : ''} ${wk.expense > 0 ? wk.isFuture ? 'text-red-400' : 'text-red-700' : 'text-gray-300'}`} {...hoverProps(wk.label)}>
                  {wk.expense > 0 ? formatCurrency(wk.expense) : '—'}
                </td>
              ))}
              <td className="px-3 py-2 text-right text-xs font-semibold text-red-700 whitespace-nowrap">{wkTotalExpense > 0 ? formatCurrency(wkTotalExpense) : '—'}</td>
            </tr>
            {outflowOpen && wkExpenseCats.map((cat) => {
              const catTotal = visibleWeeks.reduce((s, wk) => s + (wk.catExpense[cat.id] ?? 0), 0)
              if (catTotal === 0) return null
              return (
                <tr key={cat.id} className="bg-white hover:bg-gray-50/50">
                  <td className="py-1.5 sticky left-0 bg-white z-10 pr-4" style={{ paddingLeft: INDENT_PX[0] }}>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color ?? '#9ca3af' }} />
                      <span className="text-xs truncate max-w-[160px] text-gray-600">{cat.name}</span>
                    </div>
                  </td>
                  {visibleWeeks.map((wk) => {
                    const v = wk.catExpense[cat.id] ?? 0
                    return <td key={wk.label} className={`px-3 py-1.5 text-right tabular-nums text-xs whitespace-nowrap cursor-pointer select-none ${activeColKey === wk.label ? 'bg-blue-50' : ''} ${v > 0 ? 'text-gray-700' : 'text-gray-300'}`} {...hoverProps(wk.label)}>{v > 0 ? formatCurrency(v) : '—'}</td>
                  })}
                  <td className="px-3 py-1.5 text-right text-xs text-gray-600 whitespace-nowrap">{catTotal > 0 ? formatCurrency(catTotal) : '—'}</td>
                </tr>
              )
            })}
            {outflowOpen && (() => {
              const wkUncatExp = (wk: CashPositioningWeek) => Math.max(0, wk.expense - wkExpenseCats.reduce((s, c) => s + (wk.catExpense[c.id] ?? 0), 0))
              const totalUncat = visibleWeeks.reduce((s, wk) => s + wkUncatExp(wk), 0)
              if (totalUncat <= 0) return null
              return (
                <tr className="bg-white hover:bg-gray-50/50">
                  <td className="pl-10 pr-5 py-1.5 text-xs text-gray-400 italic sticky left-0 bg-white z-10">Sem categoria</td>
                  {visibleWeeks.map((wk) => { const v = wkUncatExp(wk); return <td key={wk.label} className={`px-3 py-1.5 text-right tabular-nums text-xs whitespace-nowrap cursor-pointer select-none ${activeColKey === wk.label ? 'bg-blue-50' : ''} ${v > 0 ? 'text-gray-400' : 'text-gray-300'}`} {...hoverProps(wk.label)}>{v > 0 ? formatCurrency(v) : '—'}</td> })}
                  <td className="px-3 py-1.5 text-right text-xs text-gray-400 whitespace-nowrap">{formatCurrency(totalUncat)}</td>
                </tr>
              )
            })()}

            <tr className="bg-gray-50 border-t border-gray-100">
              <td className="px-5 py-2 text-xs font-semibold text-gray-600 sticky left-0 bg-gray-50 z-10">Variação líquida</td>
              {visibleWeeks.map((wk) => {
                const net = wk.income - wk.expense
                return (
                  <td key={wk.label} className={`px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap font-semibold cursor-pointer select-none ${activeColKey === wk.label ? 'bg-blue-50' : ''} ${net === 0 ? 'text-gray-300' : net > 0 ? wk.isFuture ? 'text-emerald-400' : 'text-emerald-700' : wk.isFuture ? 'text-red-400' : 'text-red-700'}`} {...hoverProps(wk.label)}>
                    {net !== 0 ? netFmt(net) : '—'}
                  </td>
                )
              })}
              <td className="px-3 py-2 text-right text-xs text-gray-300">—</td>
            </tr>

            <tr className="bg-white border-t-2 border-gray-300">
              <td className="px-5 py-2.5 text-xs font-bold text-gray-900 sticky left-0 bg-white z-10">Saldo final</td>
              {visibleWeeks.map((wk) => (
                <td key={wk.label} className={`px-3 py-2.5 text-right tabular-nums text-xs whitespace-nowrap font-bold cursor-pointer select-none ${activeColKey === wk.label ? 'bg-blue-50 text-blue-900' : wk.closingBalance < 0 ? 'text-red-700' : wk.isFuture ? 'text-gray-500' : 'text-gray-900'}`} {...hoverProps(wk.label)}>
                  {formatCurrency(wk.closingBalance)}
                </td>
              ))}
              <td className="px-3 py-2.5 text-right text-xs text-gray-300">—</td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-sm font-semibold text-gray-700">Demonstração</h2>
          <p className="text-xs text-gray-400 mt-0.5">Entradas e saídas e Saldo por Contas</p>
        </div>
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
              {(['cashflow', 'balances'] as const).map((v) => (
                <button key={v} onClick={() => { setViewType(v); setSelectedColKey(null); setHoveredColKey(null) }}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${viewType === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {v === 'cashflow' ? 'Cash Flow' : 'Saldo por Contas'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
              {(['weekly', 'monthly'] as const).map((t) => (
                <button key={t} onClick={() => { setPeriodType(t); setSelectedColKey(null); setHoveredColKey(null) }}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${periodType === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                  {t === 'weekly' ? 'Semanal' : 'Mensal'}
                </button>
              ))}
            </div>
          </div>
          {periodType === 'weekly' ? (
            <div className="flex items-center gap-1">
              <button onClick={() => navigateWeeks(-1)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors leading-none">‹</button>
              <span className="text-sm font-semibold text-gray-700 min-w-[160px] text-center">{weeklyRangeLabel}</span>
              <button onClick={() => navigateWeeks(1)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors leading-none">›</button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <button onClick={() => navigateMonths(-1)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors leading-none">‹</button>
              <span className="text-sm font-semibold text-gray-700 min-w-[160px] text-center">{windowLabel}</span>
              <button onClick={() => navigateMonths(1)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors leading-none">›</button>
            </div>
          )}
        </div>
      </div>
      {viewType === 'balances'
        ? (periodType === 'weekly' ? renderBalancesWeeklyView() : renderBalancesView())
        : (periodType === 'weekly' ? renderWeeklyView() : renderPeriodView())}
    </div>
  )
}

export default function DashboardPage() {
  const { selectedClientId } = useAuth()
  const [days, setDays] = useState(30)
  const [forecastDays, setForecastDays] = useState(90)

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard', selectedClientId, days],
    queryFn: () => api.get(`/treasury/${selectedClientId}/dashboard/overview?days=${days}`),
    enabled: !!selectedClientId,
  })

  const { data: catBreakdown } = useQuery<{ revenue: CatItem[]; expense: CatItem[] }>({
    queryKey: ['dashboard-categories', selectedClientId, days],
    queryFn: () => api.get(`/treasury/${selectedClientId}/dashboard/category-breakdown?days=${days}`),
    enabled: !!selectedClientId,
  })

  const { data: recentMovementsData } = useQuery<{ items: RecentMovement[] }>({
    queryKey: ['movements-recent', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/movements?limit=10&sortDir=desc`),
    enabled: !!selectedClientId,
  })

  const { data: forecastData } = useQuery<{ startingBalance: number; days: number; forecast: ForecastDay[] }>({
    queryKey: ['dashboard-forecast', selectedClientId, forecastDays],
    queryFn: () => api.get(`/treasury/${selectedClientId}/dashboard/forecast?days=${forecastDays}`),
    enabled: !!selectedClientId,
  })


  // Derived stats from chart data
  const stats = useMemo(() => {
    if (!data) return null
    const chart = data.chartData
    const totalIncome = chart.reduce((s, d) => s + d.income, 0)
    const totalExpense = chart.reduce((s, d) => s + d.expense, 0)
    const netCashFlow = totalIncome - totalExpense
    const avgDailyExpense = chart.length > 0 ? totalExpense / days : 0
    const avgDailyIncome = chart.length > 0 ? totalIncome / days : 0
    const cashRunway = avgDailyExpense > 0 ? Math.floor(data.kpis.cashAvailable / avgDailyExpense) : null
    const coverageRatio = data.kpis.toPay > 0 ? data.kpis.toReceive / data.kpis.toPay : null
    // Financial ratios
    const dso = avgDailyIncome > 0 ? Math.round(data.kpis.toReceive / avgDailyIncome) : null
    const dpo = avgDailyExpense > 0 ? Math.round(data.kpis.toPay / avgDailyExpense) : null
    const liquidezImediata = data.kpis.toPay > 0 ? data.kpis.totalBalance / data.kpis.toPay : null
    const workingCapital = data.kpis.totalBalance + data.kpis.toReceive - data.kpis.toPay
    return { totalIncome, totalExpense, netCashFlow, avgDailyExpense, avgDailyIncome, cashRunway, coverageRatio, dso, dpo, liquidezImediata, workingCapital }
  }, [data, days])

  const forecastStats = useMemo(() => {
    if (!forecastData || forecastData.forecast.length === 0) return null
    const { forecast, startingBalance } = forecastData
    const totalIncome = forecast.reduce((s, d) => s + d.income, 0)
    const totalExpense = forecast.reduce((s, d) => s + d.expense, 0)
    const minEntry = forecast.reduce((min, d) => d.balance < min.balance ? d : min, forecast[0])
    const firstNegativeIdx = forecast.findIndex((d) => d.balance < 0)
    return {
      totalIncome,
      totalExpense,
      minBalance: minEntry.balance,
      minDate: minEntry.date,
      daysUntilNegative: firstNegativeIdx >= 0 ? firstNegativeIdx + 1 : null,
      negativeDate: firstNegativeIdx >= 0 ? forecast[firstNegativeIdx].date : null,
      projectedFinal: forecast[forecast.length - 1]?.balance ?? startingBalance,
    }
  }, [forecastData])

  if (isLoading) return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-48 bg-gray-200 rounded" />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => <div key={i} className="card p-5 h-24" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-5 lg:col-span-2 h-64" />
        <div className="card p-5 h-64" />
      </div>
    </div>
  )
  if (!data) return null

  const { kpis } = data
  const netPosition = kpis.totalBalance + kpis.toReceive - kpis.toPay

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex gap-2">
          {[30, 60, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${days === d ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Link to="/bancos" className="block h-full">
          <KpiCard title="Saldo Total" value={formatCurrency(kpis.totalBalance)} icon={<Wallet className="w-6 h-6 text-blue-500" />} className="h-full hover:border-blue-300 transition-colors cursor-pointer" />
        </Link>
        <KpiCard
          title="Caixa Disponível"
          value={formatCurrency(kpis.cashAvailable)}
          subtitle="Saldo − A Pagar"
          icon={<Activity className="w-6 h-6 text-indigo-500" />}
          className="h-full"
        />
        <Link to="/contas-a-receber" className="block h-full">
          <KpiCard
            title="A Receber"
            value={formatCurrency(kpis.toReceive)}
            subtitle={`${kpis.countReceivablesOpen} doc.${kpis.overdueReceivables > 0 ? ` · ${kpis.overdueReceivables} vencidos` : ''}`}
            icon={<ArrowDownToLine className="w-6 h-6 text-green-500" />}
            className={`h-full hover:border-green-300 transition-colors cursor-pointer ${kpis.overdueReceivables > 0 ? 'border-amber-200' : ''}`}
          />
        </Link>
        <Link to="/contas-a-pagar" className="block h-full">
          <KpiCard
            title="A Pagar"
            value={formatCurrency(kpis.toPay)}
            subtitle={`${kpis.countPayablesOpen} doc.${kpis.overduePayables > 0 ? ` · ${kpis.overduePayables} vencidos` : ''}`}
            icon={<ArrowUpFromLine className="w-6 h-6 text-red-500" />}
            className={`h-full hover:border-red-300 transition-colors cursor-pointer ${kpis.overduePayables > 0 ? 'border-amber-200' : ''}`}
          />
        </Link>
        <KpiCard
          title="Posição Líquida"
          value={formatCurrency(netPosition)}
          valueColor="auto"
          rawValue={netPosition}
          subtitle="Saldo + CR − CP"
          icon={netPosition >= 0 ? <TrendingUp className="w-6 h-6 text-green-500" /> : <TrendingDown className="w-6 h-6 text-red-500" />}
          className="h-full"
        />
      </div>

      {/* Alerts */}
      {(kpis.overdueReceivables > 0 || kpis.overduePayables > 0 || data.bankAccounts.some((a) => a.lowBalanceWarning)) && (
        <div className="space-y-2">
          {(kpis.overdueReceivables > 0 || kpis.overduePayables > 0) && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <div className="text-sm text-amber-800 flex gap-4 flex-wrap">
                {kpis.overdueReceivables > 0 && (
                  <Link to="/contas-a-receber" className="hover:underline">
                    {kpis.overdueReceivables} conta(s) a receber vencida(s) →
                  </Link>
                )}
                {kpis.overduePayables > 0 && (
                  <Link to="/contas-a-pagar" className="hover:underline">
                    {kpis.overduePayables} conta(s) a pagar vencida(s) →
                  </Link>
                )}
              </div>
            </div>
          )}
          {data.bankAccounts.filter((a) => a.lowBalanceWarning).map((a) => (
            <div key={a.id} className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <div className="text-sm text-red-800">
                Saldo baixo em <strong>{a.name}</strong>: {formatCurrency(a.currentBalance)} <span className="text-red-600">(mín. {formatCurrency(a.minBalance ?? 0)})</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cashflow Statement Table */}
      <CashflowStatementTable />

      {/* Bank accounts + derived stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Accounts */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">Contas Bancárias</h2>
            <Link to="/bancos" className="text-xs text-primary-600 hover:text-primary-700 font-medium">Ver →</Link>
          </div>
          <div className="space-y-2.5">
            {data.bankAccounts.map((acc) => (
              <div key={acc.id} className={`flex items-center justify-between rounded-lg px-2.5 py-2 -mx-0.5 ${acc.lowBalanceWarning ? 'bg-red-50 border border-red-100' : 'hover:bg-gray-50'}`}>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-gray-900 flex items-center gap-1">
                    {acc.name}
                    {acc.lowBalanceWarning && <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />}
                  </div>
                  <div className="text-xs text-gray-400">{acc.bankName} ···· {acc.ibanLast4}</div>
                </div>
                <div className={`text-sm font-semibold whitespace-nowrap ${acc.lowBalanceWarning ? 'text-red-600' : acc.currentBalance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {formatCurrency(acc.currentBalance)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Indicadores financeiros */}
        {stats && (
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <Gauge className="w-4 h-4 text-gray-400" />
              <h2 className="text-sm font-semibold text-gray-700">Indicadores Financeiros</h2>
            </div>
            <div className="space-y-2.5">
              {/* Net cash flow highlight */}
              <div className={`rounded-lg px-3 py-2 flex items-center justify-between ${stats.netCashFlow >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
                <span className="text-xs text-gray-600 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" />Fluxo líquido ({days}d)</span>
                <span className={`text-sm font-bold ${stats.netCashFlow >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {stats.netCashFlow >= 0 ? '+' : ''}{formatCurrency(stats.netCashFlow)}
                </span>
              </div>
              <div className="pt-1 space-y-2.5">
                {stats.liquidezImediata !== null && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5" />Liquidez imediata</span>
                    <span className={`text-xs font-semibold ${stats.liquidezImediata >= 1 ? 'text-green-700' : stats.liquidezImediata >= 0.5 ? 'text-amber-600' : 'text-red-700'}`}>
                      {stats.liquidezImediata.toFixed(2)}×
                    </span>
                  </div>
                )}
                {stats.coverageRatio !== null && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 flex items-center gap-1.5"><ArrowDownToLine className="w-3.5 h-3.5" />Rácio CR/CP</span>
                    <span className={`text-xs font-semibold ${stats.coverageRatio >= 1 ? 'text-green-700' : 'text-amber-600'}`}>
                      {stats.coverageRatio.toFixed(2)}×
                    </span>
                  </div>
                )}
                {stats.cashRunway !== null && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />Autonomia de caixa</span>
                    <span className={`text-xs font-semibold ${stats.cashRunway > 90 ? 'text-green-700' : stats.cashRunway > 30 ? 'text-amber-600' : 'text-red-700'}`}>
                      {stats.cashRunway > 365 ? '+1 ano' : `${stats.cashRunway} dias`}
                    </span>
                  </div>
                )}
                {stats.dso !== null && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 flex items-center gap-1.5"><CalendarDays className="w-3.5 h-3.5" />DSO est.</span>
                    <span className={`text-xs font-semibold ${stats.dso <= 30 ? 'text-green-700' : stats.dso <= 60 ? 'text-amber-600' : 'text-red-700'}`}>
                      {stats.dso} dias
                    </span>
                  </div>
                )}
                {stats.dpo !== null && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500 flex items-center gap-1.5"><ReceiptText className="w-3.5 h-3.5" />DPO est.</span>
                    <span className="text-xs font-semibold text-gray-700">{stats.dpo} dias</span>
                  </div>
                )}
              </div>
              <div className="pt-2 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" />Capital de trabalho</span>
                  <span className={`text-xs font-semibold ${stats.workingCapital >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {formatCurrency(stats.workingCapital)}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-gray-500 flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" />Média diária entrada</span>
                  <span className="text-xs font-medium text-green-700">{formatCurrency(stats.avgDailyIncome)}</span>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-gray-500 flex items-center gap-1.5"><TrendingDown className="w-3.5 h-3.5" />Média diária saída</span>
                  <span className="text-xs font-medium text-red-700">{formatCurrency(stats.avgDailyExpense)}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Cashflow Statement Table */}
      {/* Painel de Controlo */}
      <div className="card p-5">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-gray-700">Painel de Controlo</h2>
          <p className="text-xs text-gray-400 mt-0.5">Indicadores de saúde financeira</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

          {/* Saldo & Liquidez */}
          <div className="rounded-xl border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Wallet className="w-4 h-4 text-blue-500 flex-shrink-0" />
              <span className="text-xs font-semibold text-gray-700">Saldo & Liquidez</span>
            </div>
            <div className="text-2xl font-bold text-gray-900 tabular-nums">{formatCurrency(kpis.totalBalance)}</div>
            <div className="text-xs text-gray-400 mt-0.5 mb-3">saldo total em bancos</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Disponível</span>
                <span className={`font-semibold tabular-nums ${kpis.cashAvailable >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCurrency(kpis.cashAvailable)}</span>
              </div>
              {stats?.liquidezImediata != null && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Liquidez imediata</span>
                  <span className={`font-semibold ${stats.liquidezImediata >= 1 ? 'text-emerald-700' : stats.liquidezImediata >= 0.5 ? 'text-amber-600' : 'text-red-600'}`}>{stats.liquidezImediata.toFixed(2)}×</span>
                </div>
              )}
              {stats?.cashRunway != null && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Autonomia de caixa</span>
                  <span className={`font-semibold ${stats.cashRunway > 90 ? 'text-emerald-700' : stats.cashRunway > 30 ? 'text-amber-600' : 'text-red-600'}`}>
                    {stats.cashRunway > 365 ? '+1 ano' : `${stats.cashRunway} dias`}
                  </span>
                </div>
              )}
              {stats?.workingCapital != null && (
                <div className="flex items-center justify-between text-xs border-t border-gray-100 pt-2 mt-2">
                  <span className="text-gray-500">Capital de trabalho</span>
                  <span className={`font-semibold tabular-nums ${stats.workingCapital >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCurrency(stats.workingCapital)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Risco */}
          {(() => {
            const isHigh = (forecastStats?.daysUntilNegative != null) ||
              (stats?.cashRunway != null && stats.cashRunway < 30) ||
              (stats?.liquidezImediata != null && stats.liquidezImediata < 0.5)
            const isMed = !isHigh && (
              kpis.overduePayables > 0 ||
              data.bankAccounts.some((a) => a.lowBalanceWarning) ||
              (stats?.cashRunway != null && stats.cashRunway < 90) ||
              (stats?.liquidezImediata != null && stats.liquidezImediata < 1)
            )
            const riskLabel = isHigh ? 'Alto' : isMed ? 'Médio' : 'Baixo'
            const riskColor = isHigh ? 'text-red-600' : isMed ? 'text-amber-600' : 'text-emerald-600'
            const riskBg = isHigh ? 'bg-red-50' : isMed ? 'bg-amber-50' : 'bg-emerald-50'
            const dotColor = isHigh ? 'bg-red-500' : isMed ? 'bg-amber-400' : 'bg-emerald-400'
            const factors: string[] = []
            if (kpis.overdueReceivables > 0) factors.push(`${kpis.overdueReceivables} recebimento${kpis.overdueReceivables > 1 ? 's' : ''} vencido${kpis.overdueReceivables > 1 ? 's' : ''}`)
            if (kpis.overduePayables > 0) factors.push(`${kpis.overduePayables} pagamento${kpis.overduePayables > 1 ? 's' : ''} vencido${kpis.overduePayables > 1 ? 's' : ''}`)
            if (data.bankAccounts.some((a) => a.lowBalanceWarning)) factors.push('Saldo baixo em conta')
            if (forecastStats?.daysUntilNegative != null) factors.push(`Saldo negativo em ${forecastStats.daysUntilNegative}d`)
            if (stats?.cashRunway != null && stats.cashRunway < 30) factors.push(`Autonomia crítica (${stats.cashRunway}d)`)
            return (
              <div className="rounded-xl border border-gray-100 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <span className="text-xs font-semibold text-gray-700">Risco de Liquidez</span>
                </div>
                <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 mb-3 ${riskBg}`}>
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
                  <span className={`text-sm font-bold ${riskColor}`}>{riskLabel}</span>
                </div>
                <div className="space-y-1.5">
                  {factors.length === 0 ? (
                    <div className="text-xs text-gray-400">Sem alertas ativos</div>
                  ) : factors.map((f, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-gray-600">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-0.5 ${dotColor}`} />
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Operações a Vencer */}
          <div className="rounded-xl border border-gray-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <CalendarDays className="w-4 h-4 text-indigo-500 flex-shrink-0" />
              <span className="text-xs font-semibold text-gray-700">Operações a Vencer</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{kpis.countReceivablesOpen + kpis.countPayablesOpen}</div>
            <div className="text-xs text-gray-400 mt-0.5 mb-3">documentos em aberto</div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 flex items-center gap-1"><ArrowDownToLine className="w-3 h-3" />A receber ({kpis.countReceivablesOpen})</span>
                <span className="font-semibold tabular-nums text-emerald-700">{formatCurrency(kpis.toReceive)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 flex items-center gap-1"><ArrowUpFromLine className="w-3 h-3" />A pagar ({kpis.countPayablesOpen})</span>
                <span className="font-semibold tabular-nums text-red-600">{formatCurrency(kpis.toPay)}</span>
              </div>
              <div className="flex items-center justify-between text-xs border-t border-gray-100 pt-2 mt-2">
                <span className="text-gray-500">Saldo líquido</span>
                <span className={`font-semibold tabular-nums ${kpis.toReceive - kpis.toPay >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{formatCurrency(kpis.toReceive - kpis.toPay)}</span>
              </div>
            </div>
          </div>

          {/* Cobranças a Fazer */}
          <div className={`rounded-xl border p-4 ${kpis.overdueReceivables > 0 ? 'border-amber-200 bg-amber-50/40' : 'border-gray-100'}`}>
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-orange-500 flex-shrink-0" />
              <span className="text-xs font-semibold text-gray-700">Cobranças a Fazer</span>
            </div>
            <div className={`text-2xl font-bold ${kpis.overdueReceivables > 0 ? 'text-amber-700' : 'text-gray-900'}`}>{kpis.overdueReceivables}</div>
            <div className="text-xs text-gray-500 mt-0.5 mb-3">
              {kpis.overdueReceivables === 0 ? 'Nenhum vencimento em atraso' : `recebimento${kpis.overdueReceivables > 1 ? 's' : ''} vencido${kpis.overdueReceivables > 1 ? 's' : ''}`}
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Total a receber</span>
                <span className="font-semibold tabular-nums text-gray-700">{formatCurrency(kpis.toReceive)}</span>
              </div>
              {kpis.overduePayables > 0 && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-red-500">Pagamentos vencidos</span>
                  <span className="font-semibold text-red-600">{kpis.overduePayables}</span>
                </div>
              )}
              <div className="pt-2 border-t border-gray-100 mt-1">
                <Link to="/contas-a-receber" className="text-xs text-primary-600 hover:underline">Ver cobranças →</Link>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Forecast section */}
      {forecastData && forecastData.forecast.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Previsão de Tesouraria</h2>
              <p className="text-xs text-gray-400 mt-0.5">Baseado em contas a receber e a pagar em aberto</p>
            </div>
            <div className="flex gap-1">
              {[30, 60, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setForecastDays(d)}
                  className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${forecastDays === d ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>

          {/* Stats header */}
          {forecastStats && (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mt-4 mb-4">
              <div className="bg-gray-50 rounded-lg px-3 py-2.5">
                <div className="text-xs text-gray-500">Saldo Atual</div>
                <div className="text-sm font-bold text-gray-900 mt-0.5">{formatCurrency(forecastData.startingBalance)}</div>
              </div>
              <div className={`rounded-lg px-3 py-2.5 ${forecastStats.minBalance < 0 ? 'bg-red-50' : forecastStats.minBalance < forecastData.startingBalance * 0.2 ? 'bg-amber-50' : 'bg-gray-50'}`}>
                <div className="text-xs text-gray-500">Mín. Projetado</div>
                <div className={`text-sm font-bold mt-0.5 ${forecastStats.minBalance < 0 ? 'text-red-600' : forecastStats.minBalance < forecastData.startingBalance * 0.2 ? 'text-amber-600' : 'text-gray-900'}`}>
                  {formatCurrency(forecastStats.minBalance)}
                </div>
                <div className="text-xs text-gray-400">{formatDate(forecastStats.minDate)}</div>
              </div>
              <div className={`rounded-lg px-3 py-2.5 ${forecastStats.projectedFinal >= forecastData.startingBalance ? 'bg-green-50' : 'bg-red-50'}`}>
                <div className="text-xs text-gray-500">Saldo Final ({forecastDays}d)</div>
                <div className={`text-sm font-bold mt-0.5 ${forecastStats.projectedFinal >= forecastData.startingBalance ? 'text-green-700' : 'text-red-700'}`}>
                  {forecastStats.projectedFinal >= forecastData.startingBalance ? '+' : ''}{formatCurrency(forecastStats.projectedFinal - forecastData.startingBalance)}
                </div>
                <div className="text-xs text-gray-400">{formatCurrency(forecastStats.projectedFinal)}</div>
              </div>
              <div className="bg-green-50 rounded-lg px-3 py-2.5">
                <div className="text-xs text-gray-500">Entradas Esperadas</div>
                <div className="text-sm font-bold text-green-700 mt-0.5">{formatCurrency(forecastStats.totalIncome)}</div>
              </div>
              <div className="bg-red-50 rounded-lg px-3 py-2.5">
                <div className="text-xs text-gray-500">Saídas Esperadas</div>
                <div className="text-sm font-bold text-red-700 mt-0.5">{formatCurrency(forecastStats.totalExpense)}</div>
              </div>
            </div>
          )}

          {/* Negative balance alert */}
          {forecastStats?.daysUntilNegative !== null && forecastStats?.negativeDate && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span className="text-sm text-red-700">
                Saldo projetado <strong>abaixo de zero</strong> em {forecastStats.daysUntilNegative} dias ({formatDate(forecastStats.negativeDate)})
              </span>
            </div>
          )}

          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart
              data={forecastData.forecast.map((d) => ({ ...d, label: formatDate(d.date, 'dd/MM') }))}
              margin={{ left: 0, right: 8, top: 4, bottom: 0 }}
            >
              <defs>
                <linearGradient id="forecastBalGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={false}
                interval={Math.max(1, Math.floor(forecastData.forecast.length / 10))}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`}
                width={38}
              />
              <Tooltip content={<ChartTooltip />} formatter={(v: number) => formatCurrency(v)} labelFormatter={(l) => l} />
              <ReferenceLine y={0} stroke="#fca5a5" strokeWidth={1.5} strokeDasharray="4 4" label={{ value: '0', position: 'right', fontSize: 9, fill: '#fca5a5' }} />
              <Area type="monotone" dataKey="balance" stroke="#3b82f6" fill="url(#forecastBalGrad)" strokeWidth={2} dot={false} name="Saldo Projetado" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Category breakdown — donuts */}
      {catBreakdown && (catBreakdown.revenue.length > 0 || catBreakdown.expense.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700">Receita por Categoria</h2>
              <span className="text-xs text-gray-400">{days} dias</span>
            </div>
            <DonutWithLegend
              data={catBreakdown.revenue}
              total={catBreakdown.revenue.reduce((s, c) => s + c.amount, 0)}
              label="total"
            />
          </div>
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700">Despesa por Categoria</h2>
              <span className="text-xs text-gray-400">{days} dias</span>
            </div>
            <DonutWithLegend
              data={catBreakdown.expense}
              total={catBreakdown.expense.reduce((s, c) => s + c.amount, 0)}
              label="total"
            />
          </div>
        </div>
      )}

      {/* Top clients / suppliers */}
      {(data.topClients.length > 0 || data.topSuppliers.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {data.topClients.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-700">Top Clientes a Receber</h2>
                <Link to="/contas-a-receber" className="text-xs text-primary-600 hover:text-primary-700 font-medium">Ver →</Link>
              </div>
              <div className="space-y-3">
                {data.topClients.slice(0, 5).map((c, i) => {
                  const max = data.topClients[0]?.amount ?? 1
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs text-gray-400 w-4 text-right flex-shrink-0">{i + 1}</span>
                          <span className="text-sm text-gray-800 truncate">{c.name}</span>
                        </div>
                        <span className="text-sm font-semibold text-green-700 whitespace-nowrap ml-2">{formatCurrency(c.amount)}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden ml-6">
                        <div className="h-full bg-green-400 rounded-full transition-all" style={{ width: `${(c.amount / max) * 100}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {data.topSuppliers.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-700">Top Fornecedores a Pagar</h2>
                <Link to="/contas-a-pagar" className="text-xs text-primary-600 hover:text-primary-700 font-medium">Ver →</Link>
              </div>
              <div className="space-y-3">
                {data.topSuppliers.slice(0, 5).map((s, i) => {
                  const max = data.topSuppliers[0]?.amount ?? 1
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs text-gray-400 w-4 text-right flex-shrink-0">{i + 1}</span>
                          <span className="text-sm text-gray-800 truncate">{s.name}</span>
                        </div>
                        <span className="text-sm font-semibold text-red-700 whitespace-nowrap ml-2">{formatCurrency(s.amount)}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden ml-6">
                        <div className="h-full bg-red-400 rounded-full transition-all" style={{ width: `${(s.amount / max) * 100}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Upcoming dues — timeline + list */}
      {data.upcomingDues && (data.upcomingDues.receivables.length > 0 || data.upcomingDues.payables.length > 0) && (() => {
        // Build 14-day timeline buckets
        const today = new Date(); today.setHours(0, 0, 0, 0)
        const timeline = Array.from({ length: 14 }, (_, i) => {
          const d = new Date(today.getTime() + i * 86400000)
          const dateStr = d.toISOString().slice(0, 10)
          const income = (data.upcomingDues?.receivables ?? []).filter((r) => r.dueDate === dateStr).reduce((s, r) => s + r.pendingAmount, 0)
          const expense = (data.upcomingDues?.payables ?? []).filter((p) => p.dueDate === dateStr).reduce((s, p) => s + p.pendingAmount, 0)
          return { dateStr, label: formatDate(dateStr, 'dd/MM'), income, expense, dayOfWeek: d.toLocaleDateString('pt-PT', { weekday: 'short' }) }
        })
        const maxVal = Math.max(...timeline.map((d) => Math.max(d.income, d.expense)), 1)
        return (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-700">Próximos 14 dias</h2>
              <div className="flex items-center gap-3 text-xs">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" />A receber</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />A pagar</span>
              </div>
            </div>

            {/* Mini timeline chart */}
            <div className="flex items-end gap-1 h-16 mb-1">
              {timeline.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5 group relative">
                  <div className="w-full flex flex-col justify-end gap-0.5" style={{ height: 56 }}>
                    {d.income > 0 && (
                      <div
                        className="w-full rounded-sm bg-green-400 transition-opacity group-hover:opacity-80"
                        style={{ height: `${Math.max(4, (d.income / maxVal) * 52)}px` }}
                      />
                    )}
                    {d.expense > 0 && (
                      <div
                        className="w-full rounded-sm bg-red-400 transition-opacity group-hover:opacity-80"
                        style={{ height: `${Math.max(4, (d.expense / maxVal) * 52)}px` }}
                      />
                    )}
                    {d.income === 0 && d.expense === 0 && <div className="w-full rounded-sm bg-gray-100" style={{ height: 2, marginTop: 'auto' }} />}
                  </div>
                  {/* Tooltip on hover */}
                  {(d.income > 0 || d.expense > 0) && (
                    <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs rounded px-2 py-1 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10 shadow-lg">
                      <div className="font-medium">{d.label}</div>
                      {d.income > 0 && <div className="text-green-300">+{formatCurrency(d.income)}</div>}
                      {d.expense > 0 && <div className="text-red-300">-{formatCurrency(d.expense)}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-1 mb-5">
              {timeline.map((d, i) => (
                <div key={i} className={`flex-1 text-center text-xs leading-tight ${i === 0 ? 'text-primary-600 font-semibold' : 'text-gray-400'}`} style={{ fontSize: 9 }}>
                  {d.label}
                </div>
              ))}
            </div>

            {/* Lists side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {data.upcomingDues.receivables.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-600">A Receber</span>
                    <Link to="/contas-a-receber" className="text-xs text-primary-600 hover:text-primary-700 font-medium">Ver todos →</Link>
                  </div>
                  <div className="space-y-1.5">
                    {data.upcomingDues.receivables.map((r, i) => {
                      const overdue = new Date(r.dueDate) < new Date()
                      const daysUntil = Math.ceil((new Date(r.dueDate).getTime() - Date.now()) / 86400000)
                      return (
                        <div key={i} className={`flex items-center justify-between rounded-lg px-3 py-2 ${overdue ? 'bg-red-50' : 'bg-gray-50'}`}>
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-gray-900 truncate">{r.entityName}</div>
                            <div className={`text-xs flex items-center gap-1 ${overdue ? 'text-red-500' : 'text-gray-400'}`}>
                              {r.reference} · {formatDate(r.dueDate)}
                              {overdue ? <span className="font-medium"> · vencido</span> : daysUntil <= 3 ? <span className="text-amber-500"> · {daysUntil}d</span> : null}
                            </div>
                          </div>
                          <span className="text-xs font-bold text-green-700 whitespace-nowrap ml-3">{formatCurrency(r.pendingAmount)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              {data.upcomingDues.payables.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-gray-600">A Pagar</span>
                    <Link to="/contas-a-pagar" className="text-xs text-primary-600 hover:text-primary-700 font-medium">Ver todos →</Link>
                  </div>
                  <div className="space-y-1.5">
                    {data.upcomingDues.payables.map((p, i) => {
                      const overdue = new Date(p.dueDate) < new Date()
                      const daysUntil = Math.ceil((new Date(p.dueDate).getTime() - Date.now()) / 86400000)
                      return (
                        <div key={i} className={`flex items-center justify-between rounded-lg px-3 py-2 ${overdue ? 'bg-red-50' : 'bg-gray-50'}`}>
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-gray-900 truncate">{p.entityName}</div>
                            <div className={`text-xs flex items-center gap-1 ${overdue ? 'text-red-500' : 'text-gray-400'}`}>
                              {p.reference} · {formatDate(p.dueDate)}
                              {overdue ? <span className="font-medium"> · vencido</span> : daysUntil <= 3 ? <span className="text-amber-500"> · {daysUntil}d</span> : null}
                            </div>
                          </div>
                          <span className="text-xs font-bold text-red-700 whitespace-nowrap ml-3">{formatCurrency(p.pendingAmount)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* Recent movements — fixed mapping with bankAccount + status */}
      <div className="card">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Movimentos Recentes</h2>
          <Link to="/bancos" className="text-xs text-primary-600 hover:text-primary-700 font-medium">Ver todos →</Link>
        </div>
        <div className="divide-y divide-gray-50">
          {(recentMovementsData?.items ?? []).length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-gray-400">Sem movimentos</div>
          )}
          {(recentMovementsData?.items ?? []).map((m) => {
            const amt = Number(m.amount)
            const label = m.counterpartName || m.description || '—'
            const sublabel = m.counterpartName && m.description !== m.counterpartName ? m.description : null
            return (
              <div key={m.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                <div
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5"
                  style={{ backgroundColor: m.category?.color ?? '#e5e7eb' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-900 truncate">{label}</div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-xs text-gray-400">{formatDateRelative(m.date)}</span>
                    {m.bankAccount?.name && <span className="text-xs text-gray-400">· {m.bankAccount.name}</span>}
                    {m.category?.name && <span className="text-xs text-gray-400">· {m.category.name}</span>}
                    {sublabel && <span className="text-xs text-gray-400 truncate">· {sublabel}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {m.status !== 'UNCLASSIFIED' && (
                    <Badge variant={statusVariant(m.status)}>{statusLabel(m.status)}</Badge>
                  )}
                  <span className={`text-sm font-semibold tabular-nums w-24 text-right ${amt >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {amt >= 0 ? '+' : ''}{formatCurrency(amt)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

    </div>
  )
}
