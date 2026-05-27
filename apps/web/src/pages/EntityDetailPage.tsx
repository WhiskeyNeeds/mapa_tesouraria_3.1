// apps/web/src/pages/EntityDetailPage.tsx
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate, statusLabel, statusVariant } from '@/lib/utils'
import Badge from '@/components/ui/Badge'

interface Props {
  entityType: 'supplier' | 'customer'
}

interface EntityConfig {
  id: string
  defaultCategoryId: string | null
  category: { id: string; name: string; color: string } | null
}

interface LocalDoc {
  id: string
  reference: string
  entityName: string
  documentDate: string | null
  dueDate: string
  totalAmount: number
  pendingAmount: number
  status: string
  category?: { id: string; name: string; color: string } | null
}

interface Category {
  id: string
  name: string
  type: string
  color?: string | null
}

export default function EntityDetailPage({ entityType }: Props) {
  const { tocId } = useParams<{ tocId: string }>()
  const navigate = useNavigate()
  const { selectedClientId: clientId } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState<'current' | 'history'>('current')

  const isSupplier = entityType === 'supplier'
  const typeParam = isSupplier ? 'supplier' : 'customer'

  const entityQuery = useQuery<Record<string, unknown>>({
    queryKey: isSupplier
      ? ['toc-supplier-detail', clientId, tocId]
      : ['toc-customer-detail', clientId, tocId],
    queryFn: () =>
      api.get(
        isSupplier
          ? `/toconline/${clientId}/suppliers/${tocId}`
          : `/toconline/${clientId}/customers/${tocId}`,
      ),
    enabled: !!clientId && !!tocId,
    retry: 1,
  })

  const docsQuery = useQuery<{ items: LocalDoc[]; total: number }>({
    queryKey: isSupplier
      ? ['payables', clientId, 'entity-detail', tocId]
      : ['receivables', clientId, 'entity-detail', tocId],
    queryFn: () =>
      api.get(
        isSupplier
          ? `/treasury/${clientId}/payables?tocSupplierId=${tocId}&limit=500`
          : `/treasury/${clientId}/receivables?tocCustomerId=${tocId}&limit=500`,
      ),
    enabled: !!clientId && !!tocId,
  })

  const configQuery = useQuery<EntityConfig | null>({
    queryKey: ['entity-config', clientId, typeParam, tocId],
    queryFn: () =>
      api.get<EntityConfig | null>(
        `/treasury/${clientId}/entity-configs/${typeParam}/${tocId}`,
      ),
    enabled: !!clientId && !!tocId,
  })

  const categoriesQuery = useQuery<Category[]>({
    queryKey: isSupplier
      ? ['categories-expense', clientId]
      : ['categories-revenue', clientId],
    queryFn: () =>
      api.get(
        `/treasury/${clientId}/categories?type=${isSupplier ? 'EXPENSE' : 'REVENUE'}`,
      ),
    enabled: !!clientId,
  })

  const updateConfig = useMutation({
    mutationFn: (defaultCategoryId: string | null) =>
      api.put(`/treasury/${clientId}/entity-configs/${typeParam}/${tocId}`, {
        defaultCategoryId,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['entity-config', clientId, typeParam, tocId] })
      toast.success('Configuração guardada.')
    },
    onError: (e: unknown) =>
      toast.error((e as { message?: string }).message ?? 'Erro ao guardar a configuração.'),
  })

  const entity = entityQuery.data ?? {}
  const entityName = String(entity.business_name ?? entity.name ?? '—')
  const entityNif = String(entity.tax_registration_number ?? entity.fiscal_id ?? '—')
  const entityEmail = String(entity.email ?? '—')
  const entityPhone = String(entity.phone ?? entity.mobile_phone ?? '—')
  const entityAddress = String(entity.address ?? entity.billing_address ?? '—')

  const allDocs = docsQuery.data?.items ?? []
  const currentDocs = allDocs.filter((d) => ['OPEN', 'PARTIAL'].includes(d.status))
  const historyDocs = allDocs.filter((d) => ['SETTLED', 'VOID'].includes(d.status))
  const displayDocs = tab === 'current' ? currentDocs : historyDocs

  const pendingAmount = currentDocs.reduce((s, d) => s + Number(d.pendingAmount), 0)
  const settledAmount = historyDocs.reduce((s, d) => s + Number(d.totalAmount), 0)

  const categories = categoriesQuery.data ?? []
  const currentCategoryId = configQuery.data?.defaultCategoryId ?? ''

  if (entityQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-gray-600 text-sm">Entidade não encontrada no TOConline.</p>
        <button
          onClick={() => navigate('/empresa')}
          className="text-primary-600 hover:underline text-sm"
        >
          ← Voltar
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-gray-200 bg-white flex-shrink-0">
        <button
          onClick={() => navigate('/empresa')}
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          {isSupplier ? 'Fornecedores' : 'Clientes'}
        </button>
        <span className="text-gray-300">/</span>
        <span className="font-semibold text-gray-900 text-sm">
          {entityQuery.isLoading ? 'A carregar...' : entityName}
        </span>
        <span className="ml-auto text-xs text-gray-500 font-mono">NIF: {entityNif}</span>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left: invoice list */}
        <div className="flex-[3] flex flex-col min-w-0 border-r border-gray-200">

          {/* Tabs */}
          <div className="flex border-b border-gray-200 flex-shrink-0 bg-white">
            {(['current', 'history'] as const).map((t) => {
              const count = t === 'current' ? currentDocs.length : historyDocs.length
              const label = t === 'current' ? 'Atuais' : 'Histórico'
              const active = tab === t
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    active
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                  <span
                    className={`ml-2 text-xs rounded-full px-2 py-0.5 ${
                      active
                        ? 'bg-primary-100 text-primary-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            {docsQuery.isLoading ? (
              <div className="flex items-center justify-center h-32 text-sm text-gray-400">
                A carregar...
              </div>
            ) : displayDocs.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-sm text-gray-400">
                {tab === 'current'
                  ? `Sem ${isSupplier ? 'faturas' : 'recebimentos'} em aberto.`
                  : `Sem histórico de ${isSupplier ? 'faturas' : 'recebimentos'}.`}
              </div>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left border-b border-gray-100 bg-gray-50">
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Documento</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Data</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Vencimento</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Total</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-right">Pendente</th>
                    <th className="px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {displayDocs.map((doc) => (
                    <tr key={doc.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 font-medium text-gray-800">
                        {doc.reference || '—'}
                      </td>
                      <td className="px-5 py-3 text-gray-500">
                        {doc.documentDate ? formatDate(doc.documentDate) : '—'}
                      </td>
                      <td className="px-5 py-3 text-gray-500">
                        {formatDate(doc.dueDate)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-gray-800">
                        {formatCurrency(doc.totalAmount)}
                      </td>
                      <td
                        className={`px-5 py-3 text-right font-semibold ${
                          Number(doc.pendingAmount) > 0 ? 'text-red-600' : 'text-gray-400'
                        }`}
                      >
                        {Number(doc.pendingAmount) > 0
                          ? formatCurrency(doc.pendingAmount)
                          : '—'}
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant={statusVariant(doc.status)}>
                          {statusLabel(doc.status)}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: info + config */}
        <div className="flex-[2] overflow-y-auto bg-gray-50 flex flex-col gap-0">

          {/* KPIs */}
          <div className="grid grid-cols-2 gap-3 p-4 border-b border-gray-200">
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {isSupplier ? 'A pagar' : 'A receber'}
              </div>
              <div
                className={`text-xl font-bold mt-1 ${
                  pendingAmount > 0 ? 'text-red-600' : 'text-gray-400'
                }`}
              >
                {formatCurrency(pendingAmount)}
              </div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-3">
              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                {isSupplier ? 'Pago (histórico)' : 'Recebido (histórico)'}
              </div>
              <div className="text-xl font-bold mt-1 text-green-600">
                {formatCurrency(settledAmount)}
              </div>
            </div>
          </div>

          {/* TOC entity data */}
          <div className="p-4 border-b border-gray-200">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
              Dados TOConline
            </div>
            {entityQuery.isLoading ? (
              <div className="text-sm text-gray-400">A carregar...</div>
            ) : (
              <div className="space-y-2 text-sm">
                {(
                  [
                    ['Nome', entityName],
                    ['NIF', entityNif],
                    ['Email', entityEmail],
                    ['Telefone', entityPhone],
                    ['Morada', entityAddress],
                  ] as [string, string][]
                ).map(([label, value]) => (
                  <div key={label} className="flex gap-2">
                    <span className="text-gray-400 w-20 flex-shrink-0 text-xs">{label}</span>
                    <span className="text-gray-700 text-xs break-all">{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Config */}
          <div className="p-4">
            <div className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
              Configurações
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <label className="block text-xs font-medium text-gray-600 mb-2">
                Categoria automática
              </label>
              <select
                value={currentCategoryId}
                onChange={(e) => updateConfig.mutate(e.target.value || null)}
                disabled={updateConfig.isPending || categoriesQuery.isLoading}
                className="w-full text-sm rounded-lg border border-gray-200 px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-60"
              >
                <option value="">— Sem categoria —</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
              {updateConfig.isPending && (
                <p className="text-xs text-gray-400 mt-1">A guardar...</p>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
