import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import KpiCard from '@/components/ui/KpiCard'
import { Wallet, ArrowDownToLine, ArrowUpFromLine, AlertTriangle, TrendingUp } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts'
import { useState } from 'react'

interface DashboardData {
  kpis: {
    totalBalance: number; cashAvailable: number; toReceive: number; toPay: number
    countReceivablesOpen: number; countPayablesOpen: number; overdueReceivables: number; overduePayables: number
  }
  bankAccounts: Array<{ id: string; name: string; bankName: string; currentBalance: number; ibanLast4: string }>
  chartData: Array<{ date: string; income: number; expense: number; balance: number }>
  recentMovements: Array<{ id: string; date: string; amount: number; description: string; category?: { name: string; color: string } }>
  topClients: Array<{ name: string; amount: number }>
  topSuppliers: Array<{ name: string; amount: number }>
}

export default function DashboardPage() {
  const { selectedClientId } = useAuth()
  const [days, setDays] = useState(30)

  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ['dashboard', selectedClientId, days],
    queryFn: () => api.get(`/treasury/${selectedClientId}/dashboard/overview?days=${days}`),
    enabled: !!selectedClientId,
  })

  if (isLoading) return <div className="flex h-64 items-center justify-center text-gray-400">A carregar...</div>
  if (!data) return null

  const { kpis } = data

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex gap-2">
          {[30, 60, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${days === d ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}>
              {d} dias
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Saldo Total" value={formatCurrency(kpis.totalBalance)} icon={<Wallet className="w-6 h-6" />} />
        <KpiCard title="Caixa Disponível" value={formatCurrency(kpis.cashAvailable)} subtitle="Saldo − A Pagar" icon={<TrendingUp className="w-6 h-6" />} />
        <KpiCard title="A Receber" value={formatCurrency(kpis.toReceive)} subtitle={`${kpis.countReceivablesOpen} documentos${kpis.overdueReceivables > 0 ? ` · ${kpis.overdueReceivables} vencidos` : ''}`} icon={<ArrowDownToLine className="w-6 h-6 text-green-500" />} />
        <KpiCard title="A Pagar" value={formatCurrency(kpis.toPay)} subtitle={`${kpis.countPayablesOpen} documentos${kpis.overduePayables > 0 ? ` · ${kpis.overduePayables} vencidos` : ''}`} icon={<ArrowUpFromLine className="w-6 h-6 text-red-500" />} />
      </div>

      {/* Alerts */}
      {(kpis.overdueReceivables > 0 || kpis.overduePayables > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            {kpis.overdueReceivables > 0 && <span>{kpis.overdueReceivables} conta(s) a receber vencida(s). </span>}
            {kpis.overduePayables > 0 && <span>{kpis.overduePayables} conta(s) a pagar vencida(s).</span>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Balance chart */}
        <div className="card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Evolução do Saldo</h2>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data.chartData}>
              <defs>
                <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => formatDate(v, 'dd/MM')} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} labelFormatter={(l: string) => formatDate(l)} />
              <Area type="monotone" dataKey="balance" stroke="#3b82f6" fill="url(#balGrad)" strokeWidth={2} dot={false} name="Saldo" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Bank accounts */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Contas Bancárias</h2>
          <div className="space-y-3">
            {data.bankAccounts.map((acc) => (
              <div key={acc.id} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-900">{acc.name}</div>
                  <div className="text-xs text-gray-400">{acc.bankName} •••• {acc.ibanLast4}</div>
                </div>
                <div className={`text-sm font-semibold ${acc.currentBalance >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                  {formatCurrency(acc.currentBalance)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Income vs expense chart */}
        <div className="card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Entradas vs Saídas</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => formatDate(v, 'dd/MM')} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Bar dataKey="income" fill="#10b981" name="Entradas" radius={[2, 2, 0, 0]} />
              <Bar dataKey="expense" fill="#ef4444" name="Saídas" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top clients/suppliers */}
        <div className="card p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Top Clientes (a receber)</h2>
            {data.topClients.slice(0, 3).map((c, i) => (
              <div key={i} className="flex items-center justify-between py-1">
                <span className="text-sm text-gray-700 truncate mr-2">{c.name}</span>
                <span className="text-sm font-medium text-green-700 whitespace-nowrap">{formatCurrency(c.amount)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-gray-100 pt-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Top Fornecedores (a pagar)</h2>
            {data.topSuppliers.slice(0, 3).map((s, i) => (
              <div key={i} className="flex items-center justify-between py-1">
                <span className="text-sm text-gray-700 truncate mr-2">{s.name}</span>
                <span className="text-sm font-medium text-red-700 whitespace-nowrap">{formatCurrency(s.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent movements */}
      <div className="card">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Movimentos Recentes</h2>
        </div>
        <div className="divide-y divide-gray-50">
          {data.recentMovements.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-3">
                {m.category && (
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: m.category.color }} />
                )}
                <div>
                  <div className="text-sm text-gray-900">{m.description}</div>
                  <div className="text-xs text-gray-400">{formatDate(m.date)}{m.category ? ` · ${m.category.name}` : ''}</div>
                </div>
              </div>
              <span className={`text-sm font-semibold ${Number(m.amount) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                {Number(m.amount) >= 0 ? '+' : ''}{formatCurrency(Number(m.amount))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
