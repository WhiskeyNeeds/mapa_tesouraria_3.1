import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useStickyHScrollbar } from '@/lib/useStickyHScrollbar'
import KpiCard from '@/components/ui/KpiCard'
import { AlertTriangle } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar, Legend } from 'recharts'

interface ForecastData {
  startingBalance: number
  days: number
  forecast: Array<{ date: string; balance: number; income: number; expense: number }>
}

export default function ForecastPage() {
  const { selectedClientId } = useAuth()
  const [days, setDays] = useState(90)
  const hScroll = useStickyHScrollbar<HTMLDivElement>()

  const { data } = useQuery<ForecastData>({
    queryKey: ['forecast', selectedClientId, days],
    queryFn: () => api.get(`/treasury/${selectedClientId}/dashboard/forecast?days=${days}`),
    enabled: !!selectedClientId,
  })

  const minBalance = data ? Math.min(...data.forecast.map((d) => d.balance)) : 0
  const firstNegativeDate = data?.forecast.find((d) => d.balance < 0)?.date
  const totalProjectedIncome = data?.forecast.reduce((s, d) => s + d.income, 0) ?? 0
  const totalProjectedExpense = data?.forecast.reduce((s, d) => s + d.expense, 0) ?? 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">Previsão de Tesouraria</h1>
        <div className="flex gap-2">
          {[30, 60, 90, 180].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`px-3 py-1.5 text-sm rounded-lg font-medium ${days === d ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}>
              {d} dias
            </button>
          ))}
        </div>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <KpiCard title="Saldo atual" value={formatCurrency(data.startingBalance)} valueColor="auto" rawValue={data.startingBalance} />
            <KpiCard title="Saldo final previsto" value={formatCurrency(data.forecast[data.forecast.length - 1]?.balance ?? 0)} valueColor="auto" rawValue={data.forecast[data.forecast.length - 1]?.balance ?? 0} />
            <KpiCard title="Saldo mínimo previsto" value={formatCurrency(minBalance)} valueColor="auto" rawValue={minBalance} subtitle={firstNegativeDate ? `Negativo a partir de ${formatDate(firstNegativeDate)}` : undefined} className={minBalance < 0 ? 'border-red-200' : ''} />
            <KpiCard title="A Receber (prev.)" value={formatCurrency(totalProjectedIncome)} subtitle={`${days} dias`} />
            <KpiCard title="A Pagar (prev.)" value={formatCurrency(totalProjectedExpense)} subtitle={`${days} dias`} />
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Saldo projetado ({days} dias)</h2>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={data.forecast}>
                <defs>
                  <linearGradient id="fg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => formatDate(v, 'dd/MM')} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k€`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} labelFormatter={(l: string) => formatDate(l)} />
                <ReferenceLine y={0} stroke="#ef4444" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="balance" stroke="#3b82f6" fill="url(#fg)" strokeWidth={2} dot={false} name="Saldo previsto" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="card p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-4">Entradas e Saídas previstas ({days} dias)</h2>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.forecast.filter((d) => d.income > 0 || d.expense > 0)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => formatDate(v, 'dd/MM')} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k€`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} labelFormatter={(l: string) => formatDate(l)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="income" fill="#10b981" name="Entradas" radius={[2, 2, 0, 0]} />
                <Bar dataKey="expense" fill="#ef4444" name="Saídas" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {minBalance < 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3 text-sm text-red-800">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-500" />
              <span>A previsão indica saldo negativo{firstNegativeDate ? ` a partir de ${formatDate(firstNegativeDate)}` : ''} nos próximos {days} dias. Reveja os pagamentos agendados.</span>
            </div>
          )}

          <div className="card">
            <div className="px-5 py-4 border-b border-gray-100"><h2 className="font-semibold text-gray-900 text-sm">Detalhe diário</h2></div>
            <div ref={hScroll} className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px] lg:min-w-0">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                    <th className="text-left px-5 py-3">Data</th>
                    <th className="text-right px-5 py-3">Entradas</th>
                    <th className="text-right px-5 py-3">Saídas</th>
                    <th className="text-right px-5 py-3">Saldo Previsto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(() => {
                    const today = new Date().toISOString().slice(0, 10)
                    return data.forecast.filter((d) => d.income > 0 || d.expense > 0).map((d) => {
                      const isToday = d.date === today
                      const isNegative = d.balance < 0
                      return (
                        <tr key={d.date} className={isNegative ? 'bg-red-50' : isToday ? 'bg-blue-50' : 'hover:bg-gray-50'}>
                          <td className={`px-5 py-2 ${isToday ? 'font-semibold text-blue-700' : 'text-gray-500'}`}>
                            {formatDate(d.date)}{isToday ? ' · hoje' : ''}
                          </td>
                          <td className="px-5 py-2 text-right text-green-700">{d.income > 0 ? `+${formatCurrency(d.income)}` : '—'}</td>
                          <td className="px-5 py-2 text-right text-red-700">{d.expense > 0 ? `−${formatCurrency(d.expense)}` : '—'}</td>
                          <td className={`px-5 py-2 text-right font-semibold ${isNegative ? 'text-red-600' : 'text-gray-900'}`}>{formatCurrency(d.balance)}</td>
                        </tr>
                      )
                    })
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
