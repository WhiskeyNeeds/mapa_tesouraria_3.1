import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate, formatDateRelative, statusLabel, statusVariant } from '@/lib/utils'
import KpiCard from '@/components/ui/KpiCard'
import Badge from '@/components/ui/Badge'
import { Wallet, ArrowDownToLine, ArrowUpFromLine, AlertTriangle, TrendingUp, TrendingDown, Activity, Clock, CalendarDays, Gauge, ReceiptText } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend, ComposedChart, Line, PieChart, Pie, Cell, ReferenceLine,
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

export default function DashboardPage() {
  const { selectedClientId } = useAuth()
  const [days, setDays] = useState(30)
  const currentYear = new Date().getFullYear()
  const [cashFlowYear, setCashFlowYear] = useState(currentYear)
  const [forecastDays, setForecastDays] = useState(90)

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard', selectedClientId, days],
    queryFn: () => api.get(`/treasury/${selectedClientId}/dashboard/overview?days=${days}`),
    enabled: !!selectedClientId,
  })

  const { data: monthlyData } = useQuery<{ year: number; months: Array<{ month: number; income: number; expense: number; net: number }> }>({
    queryKey: ['dashboard-monthly', selectedClientId, cashFlowYear],
    queryFn: () => api.get(`/treasury/${selectedClientId}/dashboard/cash-flow?year=${cashFlowYear}`),
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

  const yearStats = useMemo(() => {
    if (!monthlyData) return null
    const months = monthlyData.months.filter((m) => m.income > 0 || m.expense > 0)
    const totalNet = monthlyData.months.reduce((s, m) => s + m.net, 0)
    const bestMonth = months.reduce((best, m) => m.net > best.net ? m : best, months[0] ?? { month: 0, net: 0, income: 0, expense: 0 })
    const worstMonth = months.reduce((worst, m) => m.net < worst.net ? m : worst, months[0] ?? { month: 0, net: 0, income: 0, expense: 0 })
    return { totalNet, bestMonth, worstMonth }
  }, [monthlyData])

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
        <Link to="/bancos">
          <KpiCard title="Saldo Total" value={formatCurrency(kpis.totalBalance)} icon={<Wallet className="w-6 h-6 text-blue-500" />} className="hover:border-blue-300 transition-colors cursor-pointer" />
        </Link>
        <KpiCard
          title="Caixa Disponível"
          value={formatCurrency(kpis.cashAvailable)}
          subtitle="Saldo − A Pagar"
          icon={<Activity className="w-6 h-6 text-indigo-500" />}
        />
        <Link to="/contas-a-receber">
          <KpiCard
            title="A Receber"
            value={formatCurrency(kpis.toReceive)}
            subtitle={`${kpis.countReceivablesOpen} doc.${kpis.overdueReceivables > 0 ? ` · ${kpis.overdueReceivables} vencidos` : ''}`}
            icon={<ArrowDownToLine className="w-6 h-6 text-green-500" />}
            className={`hover:border-green-300 transition-colors cursor-pointer ${kpis.overdueReceivables > 0 ? 'border-amber-200' : ''}`}
          />
        </Link>
        <Link to="/contas-a-pagar">
          <KpiCard
            title="A Pagar"
            value={formatCurrency(kpis.toPay)}
            subtitle={`${kpis.countPayablesOpen} doc.${kpis.overduePayables > 0 ? ` · ${kpis.overduePayables} vencidos` : ''}`}
            icon={<ArrowUpFromLine className="w-6 h-6 text-red-500" />}
            className={`hover:border-red-300 transition-colors cursor-pointer ${kpis.overduePayables > 0 ? 'border-amber-200' : ''}`}
          />
        </Link>
        <KpiCard
          title="Posição Líquida"
          value={formatCurrency(netPosition)}
          valueColor="auto"
          rawValue={netPosition}
          subtitle="Saldo + CR − CP"
          icon={netPosition >= 0 ? <TrendingUp className="w-6 h-6 text-green-500" /> : <TrendingDown className="w-6 h-6 text-red-500" />}
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

      {/* Row: Balance chart + accounts + stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Balance evolution */}
        <div className="card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-gray-700 mb-1">Evolução do Saldo</h2>
          <p className="text-xs text-gray-400 mb-4">Últimos {days} dias</p>
          {data.chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={data.chartData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="incGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.08} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={(v: string) => formatDate(v, 'dd/MM')} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} width={38} />
                <Tooltip content={<ChartTooltip />} formatter={(v: number) => formatCurrency(v)} labelFormatter={(l: string) => formatDate(l)} />
                <Area type="monotone" dataKey="balance" stroke="#3b82f6" fill="url(#balGrad)" strokeWidth={2} dot={false} name="Saldo" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-gray-400 text-sm">Sem movimentos no período</div>
          )}

          {/* Mini income/expense bars below */}
          {data.chartData.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-500">Entradas vs Saídas</span>
                {stats && (
                  <div className="flex gap-4 text-xs">
                    <span className="text-green-700 font-medium">↓ {formatCurrency(stats.totalIncome)}</span>
                    <span className="text-red-700 font-medium">↑ {formatCurrency(stats.totalExpense)}</span>
                    <span className={`font-semibold ${stats.netCashFlow >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      Líq: {stats.netCashFlow >= 0 ? '+' : ''}{formatCurrency(stats.netCashFlow)}
                    </span>
                  </div>
                )}
              </div>
              <ResponsiveContainer width="100%" height={80}>
                <BarChart data={data.chartData} margin={{ left: 0, right: 8, top: 0, bottom: 0 }} barCategoryGap="20%">
                  <XAxis hide dataKey="date" />
                  <YAxis hide />
                  <Tooltip content={<ChartTooltip />} formatter={(v: number) => formatCurrency(v)} labelFormatter={(l: string) => formatDate(l)} />
                  <Bar dataKey="income" fill="#10b981" name="Entradas" radius={[2, 2, 0, 0]} maxBarSize={12} />
                  <Bar dataKey="expense" fill="#ef4444" name="Saídas" radius={[2, 2, 0, 0]} maxBarSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Bank accounts + derived stats */}
        <div className="space-y-4">
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
      </div>

      {/* Monthly cash flow — ComposedChart with net line */}
      {monthlyData && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Fluxo de Caixa Mensal</h2>
              {yearStats && (
                <div className="flex gap-4 text-xs text-gray-500 mt-0.5">
                  <span>Líquido do ano: <span className={`font-semibold ${yearStats.totalNet >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatCurrency(yearStats.totalNet)}</span></span>
                  {yearStats.bestMonth.month > 0 && <span>Melhor: <span className="font-medium text-gray-700">{MONTH_LABELS[yearStats.bestMonth.month - 1]}</span></span>}
                  {yearStats.worstMonth.month > 0 && yearStats.worstMonth.net < 0 && <span>Pior: <span className="font-medium text-gray-700">{MONTH_LABELS[yearStats.worstMonth.month - 1]}</span></span>}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setCashFlowYear((y) => y - 1)} className="p-1 text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100 transition-colors text-sm leading-none">‹</button>
              <span className="text-sm font-medium text-gray-700 w-12 text-center">{cashFlowYear}</span>
              <button onClick={() => setCashFlowYear((y) => y + 1)} disabled={cashFlowYear >= currentYear} className="p-1 text-gray-400 hover:text-gray-700 rounded hover:bg-gray-100 transition-colors text-sm leading-none disabled:opacity-30">›</button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={monthlyData.months.map((m) => ({ ...m, label: MONTH_LABELS[m.month - 1] }))} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} width={38} />
              <Tooltip content={<ChartTooltip />} formatter={(v: number) => formatCurrency(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="square" iconSize={8} />
              <ReferenceLine y={0} stroke="#e5e7eb" strokeWidth={1} />
              <Bar dataKey="income" fill="#10b981" name="Entradas" radius={[3, 3, 0, 0]} maxBarSize={28} />
              <Bar dataKey="expense" fill="#ef4444" name="Saídas" radius={[3, 3, 0, 0]} maxBarSize={28} />
              <Line type="monotone" dataKey="net" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6', r: 3 }} name="Líquido" connectNulls={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

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
              <Legend wrapperStyle={{ fontSize: 11 }} iconType="square" iconSize={8} />
              <ReferenceLine y={0} stroke="#fca5a5" strokeWidth={1.5} strokeDasharray="4 4" label={{ value: '0', position: 'right', fontSize: 9, fill: '#fca5a5' }} />
              <Bar dataKey="income" fill="#10b981" fillOpacity={0.6} name="Entradas" maxBarSize={6} />
              <Bar dataKey="expense" fill="#ef4444" fillOpacity={0.6} name="Saídas" maxBarSize={6} />
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
