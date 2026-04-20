import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'

interface ForecastData {
  startingBalance: number
  days: number
  forecast: Array<{ date: string; balance: number; income: number; expense: number }>
}

export default function ForecastPage() {
  const { selectedClientId } = useAuth()
  const [days, setDays] = useState(90)

  const { data } = useQuery<ForecastData>({
    queryKey: ['forecast', selectedClientId, days],
    queryFn: () => api.get(`/treasury/${selectedClientId}/dashboard/forecast?days=${days}`),
    enabled: !!selectedClientId,
  })

  const minBalance = data ? Math.min(...data.forecast.map((d) => d.balance)) : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Previsão de Tesouraria</h1>
        <div className="flex gap-2">
          {[30, 60, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`px-3 py-1.5 text-sm rounded-lg font-medium ${days === d ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-50'}`}>
              {d} dias
            </button>
          ))}
        </div>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-3 gap-4">
            <div className="card p-5">
              <p className="text-sm text-gray-500">Saldo atual</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(data.startingBalance)}</p>
            </div>
            <div className="card p-5">
              <p className="text-sm text-gray-500">Saldo mínimo previsto</p>
              <p className={`text-2xl font-bold mt-1 ${minBalance < 0 ? 'text-red-600' : 'text-gray-900'}`}>{formatCurrency(minBalance)}</p>
            </div>
            <div className="card p-5">
              <p className="text-sm text-gray-500">Saldo final previsto</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{formatCurrency(data.forecast[data.forecast.length - 1]?.balance ?? 0)}</p>
            </div>
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

          {minBalance < 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-800">
              ⚠️ A previsão indica saldo negativo em algum ponto nos próximos {days} dias. Reveja os pagamentos agendados.
            </div>
          )}

          <div className="card">
            <div className="px-5 py-4 border-b border-gray-100"><h2 className="font-semibold text-gray-900 text-sm">Detalhe diário</h2></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                    <th className="text-left px-5 py-3">Data</th>
                    <th className="text-right px-5 py-3">Entradas</th>
                    <th className="text-right px-5 py-3">Saídas</th>
                    <th className="text-right px-5 py-3">Saldo Previsto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.forecast.filter((d) => d.income > 0 || d.expense > 0).map((d) => (
                    <tr key={d.date} className="hover:bg-gray-50">
                      <td className="px-5 py-2 text-gray-500">{formatDate(d.date)}</td>
                      <td className="px-5 py-2 text-right text-green-700">{d.income > 0 ? `+${formatCurrency(d.income)}` : '—'}</td>
                      <td className="px-5 py-2 text-right text-red-700">{d.expense > 0 ? `−${formatCurrency(d.expense)}` : '—'}</td>
                      <td className={`px-5 py-2 text-right font-semibold ${d.balance < 0 ? 'text-red-600' : 'text-gray-900'}`}>{formatCurrency(d.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
