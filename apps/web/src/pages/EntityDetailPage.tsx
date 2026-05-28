// apps/web/src/pages/EntityDetailPage.tsx
import { Fragment, useState, type ElementType } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ChevronDown, RefreshCw, Hash, Mail, Phone, MapPin, Building2, FileText } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate, cn } from '@/lib/utils'
import Badge from '@/components/ui/Badge'
import KpiCard from '@/components/ui/KpiCard'

interface Props {
  entityType: 'supplier' | 'customer'
}

interface EntityConfig {
  id: string
  defaultCategoryId: string | null
  category: { id: string; name: string; color: string } | null
}

interface TocDoc {
  id: number
  document_no: string
  document_type: string
  status: number   // 0=rascunho, 1=finalizado, 2=parcial, 3=liquidado, 4=anulado, 5=aberto (compras)
  date: string
  due_date?: string
  gross_total: number
  pending_total: number
  settlement_total?: number
  supplier_id?: number
  customer_id?: number
  receipts_ids?: unknown[]
  payments_ids?: unknown[]
  [key: string]: unknown
}

interface TocSubItem {
  id: number | string
  document_no: string
  date: string
  gross_total: number
  [key: string]: unknown
}

interface Category {
  id: string
  name: string
  type: string
  color?: string | null
}

interface EntityPaymentTiming {
  thisYear: number | null
  lastYear: number | null
  delayThisYear: number | null
  delayLastYear: number | null
}

function tocDocStatusLabel(doc: TocDoc): string {
  if (doc.status === 4) return 'Anulado'
  if (doc.status === 0) return 'Rascunho'
  if (doc.status === 3 || Number(doc.pending_total) === 0) return 'Liquidado'
  if (doc.status === 2) return 'Parcial'
  const due = doc.due_date ? new Date(doc.due_date) : null
  if (due && due < new Date()) return 'Em atraso'
  return 'Pendente'
}

function tocDocStatusVariant(doc: TocDoc): 'gray' | 'green' | 'red' | 'yellow' {
  if (doc.status === 4 || doc.status === 0) return 'gray'
  if (doc.status === 3 || Number(doc.pending_total) === 0) return 'green'
  if (doc.status === 2) return 'yellow'
  const due = doc.due_date ? new Date(doc.due_date) : null
  if (due && due < new Date()) return 'red'
  return 'yellow'
}

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500',
  'bg-rose-500', 'bg-indigo-500', 'bg-teal-500', 'bg-orange-500',
]

function getAvatarColor(name: string): string {
  const hash = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

function getInitials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
}

function DocSubRows({ clientId, tocDocId, isSupplier }: { clientId: string; tocDocId: string; isSupplier: boolean }) {
  const { data = [], isLoading } = useQuery<TocSubItem[]>({
    queryKey: isSupplier
      ? ['toc-purchase-payments', clientId, tocDocId]
      : ['toc-sales-receipts', clientId, tocDocId],
    queryFn: () => api.get(
      isSupplier
        ? `/toconline/${clientId}/purchases/${tocDocId}/payments`
        : `/toconline/${clientId}/sales/${tocDocId}/receipts`,
    ),
  })

  if (isLoading) {
    return (
      <tr>
        <td colSpan={6} className="pl-14 py-2 text-xs text-gray-400 bg-gray-50/60 border-b border-gray-100">
          <RefreshCw className="inline w-3 h-3 animate-spin mr-1.5" />
          A carregar {isSupplier ? 'pagamentos' : 'recibos'}...
        </td>
      </tr>
    )
  }

  if (!data.length) {
    return (
      <tr>
        <td colSpan={6} className="pl-14 py-2 text-xs text-gray-400 bg-gray-50/60 border-b border-gray-100">
          Sem {isSupplier ? 'pagamentos' : 'recibos'} associados
        </td>
      </tr>
    )
  }

  return (
    <>
      {data.map((item) => (
        <tr
          key={String(item.id)}
          className={cn(
            'border-b border-gray-100/80',
            isSupplier ? 'bg-gray-50/60 hover:bg-red-50/40' : 'bg-gray-50/60 hover:bg-slate-50',
          )}
        >
          <td className="pl-10 pr-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              <ChevronRight className="w-3 h-3 text-teal-400 flex-shrink-0" />
              <span className="text-gray-700 font-medium">{item.document_no}</span>
            </div>
          </td>
          <td className="px-4 py-2" />
          <td className="px-4 py-2 text-xs text-gray-500 tabular-nums">
            {item.date ? formatDate(item.date) : '—'}
          </td>
          <td className="px-4 py-2" />
          <td className="px-4 py-2 text-right text-xs text-gray-600 font-medium tabular-nums">
            −{formatCurrency(item.gross_total)}
          </td>
          <td className="px-4 py-2" />
        </tr>
      ))}
    </>
  )
}

export default function EntityDetailPage({ entityType }: Props) {
  const { tocId } = useParams<{ tocId: string }>()
  const navigate = useNavigate()
  const { selectedClientId: clientId } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState<'current' | 'history'>('current')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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

  const entityFilterParam = isSupplier
    ? `filter[supplier_id]=${tocId}`
    : `filter[customer_id]=${tocId}`

  const docsQuery = useQuery<TocDoc[]>({
    queryKey: isSupplier
      ? ['toc-purchases', clientId, tocId]
      : ['toc-sales', clientId, tocId],
    queryFn: () =>
      api.get(
        isSupplier
          ? `/toconline/${clientId}/purchases?${entityFilterParam}`
          : `/toconline/${clientId}/sales?${entityFilterParam}`,
      ),
    enabled: !!clientId && !!tocId,
    staleTime: 2 * 60 * 1000,
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

  const paymentTimingQuery = useQuery<EntityPaymentTiming>({
    queryKey: ['entity-payment-timing', clientId, typeParam, tocId],
    queryFn: () =>
      api.get(
        `/toconline/${clientId}/entity-payment-timing?entityType=${typeParam}&tocEntityId=${tocId}`,
      ),
    enabled: !!clientId && !!tocId,
    staleTime: 0,
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

  const entityIdNum = Number(tocId)
  const allDocs = (docsQuery.data ?? []).filter((d) =>
    isSupplier ? d.supplier_id === entityIdNum : d.customer_id === entityIdNum,
  )
  const currentDocs = allDocs.filter((d) => (d.status === 1 || d.status === 2 || d.status === 5) && Number(d.pending_total ?? d.gross_total ?? 0) > 0)
  const historyDocs = allDocs.filter((d) => d.status === 3 || d.status === 4 || ((d.status === 1 || d.status === 5) && Number(d.pending_total ?? d.gross_total ?? 0) === 0))

  const sortByDate = (a: TocDoc, b: TocDoc) => (b.date ?? '').localeCompare(a.date ?? '')
  const displayDocs = (tab === 'current' ? currentDocs : historyDocs).slice().sort(sortByDate)

  const pendingAmount = currentDocs.reduce((s, d) => s + Number(d.pending_total ?? d.gross_total ?? 0), 0)
  const settledAmount = historyDocs
    .filter((d) => d.status !== 4)
    .reduce((s, d) => s + Number(d.gross_total) - Number(d.pending_total), 0)

  const thisYear = new Date().getFullYear()
  const lastYear = thisYear - 1

  const avgDaysThisYear = paymentTimingQuery.data?.thisYear ?? null
  const avgDaysLastYear = paymentTimingQuery.data?.lastYear ?? null
  const delayThisYear = paymentTimingQuery.data?.delayThisYear ?? null
  const delayLastYear = paymentTimingQuery.data?.delayLastYear ?? null

  const categories = categoriesQuery.data ?? []
  const currentCategoryId = configQuery.data?.defaultCategoryId ?? ''

  const avatarColor = entityQuery.isLoading ? 'bg-gray-300' : getAvatarColor(entityName)
  const initials = entityQuery.isLoading ? '…' : getInitials(entityName)

  if (entityQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
          <FileText className="w-5 h-5 text-red-400" />
        </div>
        <p className="text-gray-500 text-sm">Entidade não encontrada no TOConline.</p>
        <button
          onClick={() => navigate('/empresa')}
          className="btn-secondary text-sm"
        >
          ← Voltar
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0 animate-fade-in">

      {/* Breadcrumb / Header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-100 bg-white flex-shrink-0">
        <button
          onClick={() => navigate('/empresa')}
          className="group flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition-colors"
        >
          <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
          {isSupplier ? 'Fornecedores' : 'Clientes'}
        </button>

        <span className="text-gray-200 select-none">/</span>

        <div className="flex items-center gap-2">
          <div className={cn('w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0', avatarColor)}>
            {initials}
          </div>
          <span className="font-semibold text-gray-900 text-sm truncate max-w-xs">
            {entityQuery.isLoading ? 'A carregar...' : entityName}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Hash className="w-3 h-3 text-gray-300" />
          <span className="text-xs font-mono text-gray-500 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-md">
            {entityNif}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left: invoice list */}
        <div className="flex-[3] flex flex-col min-w-0 border-r border-gray-100">

          {/* Tabs */}
          <div className="flex items-center gap-1 px-4 py-2.5 border-b border-gray-100 bg-white flex-shrink-0">
            {(['current', 'history'] as const).map((t) => {
              const count = t === 'current' ? currentDocs.length : historyDocs.length
              const label = t === 'current' ? 'Atuais' : 'Histórico'
              const active = tab === t
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    'flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-150',
                    active
                      ? 'bg-primary-50 text-primary-700 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
                  )}
                >
                  {label}
                  <span className={cn(
                    'inline-flex items-center justify-center min-w-[1.25rem] h-4 px-1 rounded-full text-xs font-semibold',
                    active
                      ? 'bg-primary-100 text-primary-700'
                      : 'bg-gray-100 text-gray-500',
                  )}>
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Table */}
          <div className="flex-1 overflow-y-auto">
            {docsQuery.isLoading ? (
              <div className="p-5 space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-11 bg-gray-100 rounded-lg animate-pulse" style={{ opacity: 1 - i * 0.15 }} />
                ))}
              </div>
            ) : displayDocs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-3 text-center px-6">
                <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-gray-400" />
                </div>
                <p className="text-sm text-gray-400">
                  {tab === 'current'
                    ? `Sem ${isSupplier ? 'faturas' : 'recebimentos'} em aberto.`
                    : `Sem histórico de ${isSupplier ? 'faturas' : 'recebimentos'}.`}
                </p>
              </div>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left border-b border-gray-100 bg-gray-50 sticky top-0 z-10">
                    <th className="px-5 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Documento</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Vencimento</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">{isSupplier ? 'Pagamento' : 'Recebimento'}</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide text-right">Total</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide text-right">Pendente</th>
                    <th className="px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {displayDocs.map((doc) => {
                    const key = String(doc.id)
                    const isExpanded = expandedIds.has(key)
                    const expandCount = isSupplier
                      ? (Array.isArray(doc.payments_ids) ? doc.payments_ids.length : 0)
                      : (Array.isArray(doc.receipts_ids) ? doc.receipts_ids.length : 0)
                    const isOverdue = tocDocStatusLabel(doc) === 'Em atraso'
                    const pendingVal = Number(doc.pending_total ?? doc.gross_total ?? 0)
                    return (
                      <Fragment key={key}>
                        <tr className={cn(
                          'border-b border-gray-50 transition-colors duration-100',
                          isOverdue ? 'hover:bg-red-50/40' : 'hover:bg-blue-50/30',
                        )}>
                          <td className="px-5 py-3">
                            <div className="flex items-start gap-1.5">
                              {expandCount > 0 ? (
                                <button
                                  onClick={() => toggleExpand(key)}
                                  className="mt-0.5 flex-shrink-0 flex items-center gap-0.5 text-gray-400 hover:text-gray-700 transition-colors"
                                  title={isExpanded ? 'Ocultar detalhe' : isSupplier ? 'Ver pagamentos' : 'Ver recibos'}
                                >
                                  {isExpanded
                                    ? <ChevronDown className="w-3.5 h-3.5" />
                                    : <ChevronRight className="w-3.5 h-3.5" />}
                                  <span className="text-xs font-semibold leading-none">{expandCount}</span>
                                </button>
                              ) : (
                                <span className="w-4 flex-shrink-0" />
                              )}
                              <div>
                                <div className="font-semibold text-gray-800">
                                  {doc.document_no || `${doc.document_type} (rascunho)`}
                                </div>
                                <div className="text-xs text-gray-400">
                                  {doc.date ? formatDate(doc.date) : '—'}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className={cn(
                            'px-4 py-3 tabular-nums font-medium',
                            isOverdue ? 'text-red-500' : 'text-gray-500',
                          )}>
                            {doc.due_date ? formatDate(doc.due_date) : '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-400 tabular-nums">
                            {doc.due_date ? formatDate(doc.due_date) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-gray-800 tabular-nums">
                            {formatCurrency(doc.gross_total)}
                          </td>
                          <td className={cn(
                            'px-4 py-3 text-right font-semibold tabular-nums',
                            pendingVal > 0 ? 'text-red-600' : 'text-gray-300',
                          )}>
                            {pendingVal > 0 ? formatCurrency(pendingVal) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <Badge variant={tocDocStatusVariant(doc)}>
                              {tocDocStatusLabel(doc)}
                            </Badge>
                          </td>
                        </tr>
                        {isExpanded && clientId && (
                          <DocSubRows
                            clientId={clientId}
                            tocDocId={key}
                            isSupplier={isSupplier}
                          />
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: info + config */}
        <div className="flex-[2] overflow-y-auto bg-gray-50/50 flex flex-col">

          {/* KPIs */}
          <div className="p-4 border-b border-gray-100 grid grid-cols-2 gap-3">
            <KpiCard
              title={isSupplier ? 'A Pagar' : 'A Receber'}
              value={formatCurrency(pendingAmount)}
              valueColor={pendingAmount > 0 ? 'red' : 'default'}
              rawValue={pendingAmount}
            />
            <KpiCard
              title={isSupplier ? 'Pago (histórico)' : 'Recebido (histórico)'}
              value={formatCurrency(settledAmount)}
              valueColor="green"
            />
          </div>

          {/* Comportamento de pagamento — prazo médio + atraso */}
          <div className="p-4 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Comportamento de {isSupplier ? 'Pagamento' : 'Recebimento'}
            </p>
            {paymentTimingQuery.isLoading ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />
                <div className="h-24 bg-gray-100 rounded-xl animate-pulse opacity-40" />
              </div>
            ) : (avgDaysThisYear == null && delayThisYear == null) ? (
              <p className="text-xs text-gray-400">Sem dados de pagamentos liquidados.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">

                {/* Ano atual */}
                <div className="rounded-xl border border-primary-100 bg-white p-3 flex flex-col gap-2.5">
                  <span className="text-[10px] font-bold text-primary-500 uppercase tracking-widest">{thisYear}</span>
                  <div>
                    <div className="flex items-baseline gap-1 leading-none">
                      <span className="text-2xl font-bold text-gray-900">
                        {avgDaysThisYear ?? '—'}
                      </span>
                      {avgDaysThisYear != null && (
                        <span className="text-xs text-gray-400">dias</span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1">fatura → pagamento</div>
                  </div>
                  {delayThisYear != null && (
                    <span className={cn(
                      'self-start text-[11px] font-semibold rounded-md px-1.5 py-0.5',
                      delayThisYear === 0 ? 'bg-gray-100 text-gray-500'
                        : delayThisYear > 0 ? 'bg-red-50 text-red-600'
                          : 'bg-emerald-50 text-emerald-700',
                    )}>
                      {delayThisYear === 0 ? 'Na data'
                        : delayThisYear > 0 ? `+${delayThisYear}d vs venc.`
                          : `−${Math.abs(delayThisYear)}d vs venc.`}
                    </span>
                  )}
                </div>

                {/* Ano anterior */}
                <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 flex flex-col gap-2.5">
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{lastYear}</span>
                  <div>
                    <div className="flex items-baseline gap-1 leading-none">
                      <span className="text-2xl font-bold text-gray-300">
                        {avgDaysLastYear ?? '—'}
                      </span>
                      {avgDaysLastYear != null && (
                        <span className="text-xs text-gray-300">dias</span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-1">fatura → pagamento</div>
                  </div>
                  {delayLastYear != null ? (
                    <span className={cn(
                      'self-start text-[11px] font-semibold rounded-md px-1.5 py-0.5 opacity-70',
                      delayLastYear === 0 ? 'bg-gray-100 text-gray-500'
                        : delayLastYear > 0 ? 'bg-red-50 text-red-500'
                          : 'bg-emerald-50 text-emerald-600',
                    )}>
                      {delayLastYear === 0 ? 'Na data'
                        : delayLastYear > 0 ? `+${delayLastYear}d vs venc.`
                          : `−${Math.abs(delayLastYear)}d vs venc.`}
                    </span>
                  ) : (
                    <span className="text-[11px] text-gray-300">sem dados</span>
                  )}
                </div>

              </div>
            )}
          </div>

          {/* TOC entity data */}
          <div className="p-4 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Dados TOConline
            </p>
            {entityQuery.isLoading ? (
              <div className="space-y-2.5">
                {[80, 50, 65, 45, 70].map((w, i) => (
                  <div key={i} className="h-3.5 bg-gray-200 rounded-full animate-pulse" style={{ width: `${w}%` }} />
                ))}
              </div>
            ) : (
              <div className="space-y-2.5">
                {([
                  [Building2, entityName],
                  [Hash,      entityNif],
                  [Mail,      entityEmail],
                  [Phone,     entityPhone],
                  [MapPin,    entityAddress],
                ] as [ElementType, string][]).map(([Icon, value], i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <Icon className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                    <span className="text-xs text-gray-700 leading-snug break-all">{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Config */}
          <div className="p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Configurações
            </p>
            <div className="bg-white rounded-xl border border-gray-100 shadow-card p-4">
              <label className="label">
                Categoria automática
              </label>
              <select
                value={currentCategoryId}
                onChange={(e) => updateConfig.mutate(e.target.value || null)}
                disabled={updateConfig.isPending || categoriesQuery.isLoading}
                className="input"
              >
                <option value="">— Sem categoria —</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
              {updateConfig.isPending && (
                <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                  <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-primary-500 rounded-full animate-spin" />
                  A guardar...
                </p>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
