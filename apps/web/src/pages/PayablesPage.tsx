import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate, statusLabel, statusVariant, tocStatusLabel, tocStatusVariant } from '@/lib/utils'
import KpiCard from '@/components/ui/KpiCard'
import Badge from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import { Plus, ArrowUpFromLine, ArrowDownToLine, RefreshCw, Trash2, XCircle, Search, X, CheckCircle, Download, ArrowUpDown, ArrowUp, ArrowDown, Pencil, DollarSign, Repeat2 } from 'lucide-react'

interface TocPurchaseDoc {
  id: number
  document_no: string
  document_type: string
  status: number
  date: string
  due_date?: string
  gross_total: number
  net_total: number
  pending_total: number
  settlement_total: number
  tax_payable: number
  supplier_id: number
  supplier_business_name: string
  supplier_tax_registration_number?: string
  currency_iso_code: string
  external_reference?: string
  notes?: string
  [key: string]: unknown
}

interface Payable {
  id: string; reference: string; entityName: string; documentDate: string; dueDate: string
  totalAmount: number; pendingAmount: number; paidAmount: number; status: string; origin: string
  description?: string | null
  tocPurchasesDocId?: string
  recurrenceId?: string | null
  category: { id: string; name: string; color: string; launchToc: boolean }
}
interface Category { id: string; name: string; type: string; launchToc: boolean }

const emptyForm = {
  categoryId: '', entityName: '', reference: '', description: '',
  documentDate: '', dueDate: '', totalAmount: '', currency: 'EUR',
}
const emptyRecurrence = {
  isRecurrent: false,
  frequency: 'MONTHLY' as const,
  endType: 'none' as 'none' | 'date' | 'occurrences',
  endDate: '',
  occurrences: '',
}

type Row = { _src: 'local'; p: Payable } | { _src: 'toc'; d: TocPurchaseDoc }

export default function PayablesPage() {
  const { selectedClientId } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [statusFilter, setStatusFilter] = useState('')
  const [entitySearch, setEntitySearch] = useState('')
  const [dueDateFrom, setDueDateFrom] = useState('')
  const [dueDateTo, setDueDateTo] = useState('')
  const [sortBy, setSortBy] = useState<'dueDate' | 'totalAmount' | 'pendingAmount' | 'entityName'>('dueDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [recForm, setRecForm] = useState(emptyRecurrence)
  const [isRecurrentFilter, setIsRecurrentFilter] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ entityName: '', dueDate: '', description: '' })
  const [originFilter, setOriginFilter] = useState('')
  const [partialId, setPartialId] = useState<string | null>(null)
  const [partialAmount, setPartialAmount] = useState('')
  const [partialMax, setPartialMax] = useState(0)
  const [importTocDoc, setImportTocDoc] = useState<TocPurchaseDoc | null>(null)
  const [importTocCatId, setImportTocCatId] = useState('')

  const { data: kpis } = useQuery({
    queryKey: ['payables-kpis', selectedClientId],
    queryFn: () => api.get<{ totalPending: number; countOpen: number; countOverdue: number; paidThisMonth: number; aging: Record<string, number> }>(`/treasury/${selectedClientId}/payables/kpis`),
    enabled: !!selectedClientId,
  })

  const { data } = useQuery({
    queryKey: ['payables', selectedClientId, statusFilter, originFilter, entitySearch, dueDateFrom, dueDateTo, sortBy, sortDir, page, isRecurrentFilter],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '25' })
      if (statusFilter) params.set('status', statusFilter)
      if (originFilter) params.set('origin', originFilter)
      if (entitySearch) params.set('entityName', entitySearch)
      if (dueDateFrom) params.set('dueDateFrom', dueDateFrom)
      if (dueDateTo) params.set('dueDateTo', dueDateTo)
      if (isRecurrentFilter) params.set('isRecurrent', 'true')
      if (sortBy !== 'dueDate' || sortDir !== 'asc') { params.set('sortBy', sortBy); params.set('sortDir', sortDir) }
      return api.get<{ total: number; items: Payable[] }>(`/treasury/${selectedClientId}/payables?${params}`)
    },
    enabled: !!selectedClientId,
  })

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories-expense', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/categories?type=EXPENSE`),
    enabled: !!selectedClientId,
  })

  const { data: tocDocs, isLoading: tocLoading, refetch: refetchToc } = useQuery<TocPurchaseDoc[]>({
    queryKey: ['toc-purchases', selectedClientId],
    queryFn: () => api.get(`/toconline/${selectedClientId}/purchases`),
    enabled: !!selectedClientId,
    retry: false,
    throwOnError: false,
  })


  const create = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { ...form, totalAmount: parseFloat(form.totalAmount) }
      if (recForm.isRecurrent) {
        body.recurrence = {
          frequency: recForm.frequency,
          ...(recForm.endType === 'date' && recForm.endDate ? { endDate: recForm.endDate } : {}),
          ...(recForm.endType === 'occurrences' && recForm.occurrences ? { occurrences: parseInt(recForm.occurrences) } : {}),
        }
      }
      return api.post(`/treasury/${selectedClientId}/payables`, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payables'] })
      qc.invalidateQueries({ queryKey: ['payables-kpis'] })
      setShowNew(false); setForm(emptyForm); setRecForm(emptyRecurrence)
      toast.success(recForm.isRecurrent ? 'Conta recorrente criada.' : 'Conta a pagar criada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const deletePayable = useMutation({
    mutationFn: (id: string) => api.delete(`/treasury/${selectedClientId}/payables/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payables'] }); qc.invalidateQueries({ queryKey: ['payables-kpis'] }); toast.success('Documento eliminado.') },
    onError: (e) => toast.error((e as Error).message),
  })

  const voidPayable = useMutation({
    mutationFn: (id: string) => api.post(`/treasury/${selectedClientId}/payables/${id}/void`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payables'] }); qc.invalidateQueries({ queryKey: ['payables-kpis'] }); toast.success('Documento anulado.') },
    onError: (e) => toast.error((e as Error).message),
  })

  const settlePayable = useMutation({
    mutationFn: (id: string) => api.post(`/treasury/${selectedClientId}/payables/${id}/settle`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payables'] }); qc.invalidateQueries({ queryKey: ['payables-kpis'] }); toast.success('Documento liquidado.') },
    onError: (e) => toast.error((e as Error).message),
  })

  const updatePayable = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { entityName?: string; dueDate?: string; description?: string } }) =>
      api.patch(`/treasury/${selectedClientId}/payables/${id}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payables'] }); setEditId(null); toast.success('Documento atualizado.') },
    onError: (e) => toast.error((e as Error).message),
  })

  const partialPayment = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) =>
      api.post(`/treasury/${selectedClientId}/payables/${id}/partial-payment`, { amount }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payables'] }); qc.invalidateQueries({ queryKey: ['payables-kpis'] }); setPartialId(null); setPartialAmount(''); toast.success('Pagamento parcial registado.') },
    onError: (e) => toast.error((e as Error).message),
  })

  const importFromToc = useMutation({
    mutationFn: () => {
      if (!importTocDoc) return Promise.reject(new Error('No document'))
      const d = importTocDoc
      return api.post(`/treasury/${selectedClientId}/payables`, {
        categoryId: importTocCatId,
        entityName: d.supplier_business_name,
        entityNif: d.supplier_tax_registration_number ?? undefined,
        tocSupplierId: d.supplier_id ? String(d.supplier_id) : undefined,
        tocPurchasesDocId: String(d.id),
        reference: d.document_no,
        documentDate: d.date,
        dueDate: d.due_date ?? d.date,
        totalAmount: d.gross_total,
        currency: d.currency_iso_code ?? 'EUR',
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payables'] })
      qc.invalidateQueries({ queryKey: ['payables-kpis'] })
      setImportTocDoc(null)
      setImportTocCatId('')
      toast.success('Documento importado do TOConline.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const hasFilters = !!(statusFilter || originFilter || entitySearch || dueDateFrom || dueDateTo || isRecurrentFilter)
  function clearFilters() {
    setStatusFilter(''); setOriginFilter(''); setEntitySearch(''); setDueDateFrom(''); setDueDateTo(''); setIsRecurrentFilter(false); setPage(1)
  }

  function toggleSort(field: typeof sortBy) {
    if (sortBy === field) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortDir('asc') }
    setPage(1)
  }
  function SortIcon({ field }: { field: typeof sortBy }) {
    if (sortBy !== field) return <ArrowUpDown className="inline w-3 h-3 ml-1 text-gray-300" />
    return sortDir === 'asc' ? <ArrowUp className="inline w-3 h-3 ml-1 text-primary-500" /> : <ArrowDown className="inline w-3 h-3 ml-1 text-primary-500" />
  }

  async function exportCsv() {
    const token = localStorage.getItem('access_token')
    const p = new URLSearchParams()
    if (statusFilter) p.set('status', statusFilter)
    if (originFilter) p.set('origin', originFilter)
    if (entitySearch) p.set('entityName', entitySearch)
    if (dueDateFrom) p.set('dueDateFrom', dueDateFrom)
    if (dueDateTo) p.set('dueDateTo', dueDateTo)
    const res = await fetch(`/api/v1/treasury/${selectedClientId}/payables/export.csv?${p}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'contas-a-pagar.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  // IDs já importados do TOConline
  const importedIds = new Set(
    (data?.items ?? []).map((p) => p.tocPurchasesDocId).filter(Boolean) as string[]
  )

  // Linhas TOConline ainda não importadas
  const tocOnly = (tocDocs ?? []).filter((d) => {
    if (importedIds.has(String(d.id))) return false
    if (statusFilter) {
      const s = Number(d.status)
      if (statusFilter === 'OPEN' && s !== 1 && s !== 5) return false
      if (statusFilter === 'PARTIAL' && s !== 2) return false
      if (statusFilter === 'SETTLED' && s !== 3) return false
      if (statusFilter === 'VOID' && s !== 4) return false
    }
    return true
  })

  const rows: Row[] = [
    ...(data?.items ?? []).map((p) => ({ _src: 'local' as const, p })),
    ...tocOnly.map((d) => ({ _src: 'toc' as const, d })),
  ].sort((a, b) => {
    const dateA = a._src === 'local' ? a.p.documentDate : a.d.date
    const dateB = b._src === 'local' ? b.p.documentDate : b.d.date
    return new Date(dateB).getTime() - new Date(dateA).getTime()
  })

  // KPIs combinados: locais (endpoint /kpis) + TOConline ainda não importados
  const combinedKpis = useMemo(() => {
    if (!kpis) return null
    const now = new Date()
    const tocPending = tocOnly.reduce((s, d) => s + Number(d.pending_total ?? d.gross_total ?? 0), 0)
    const tocOverdue = tocOnly.filter((d) => d.due_date && new Date(d.due_date) < now).length
    return {
      totalPending: kpis.totalPending + tocPending,
      countOpen: kpis.countOpen + tocOnly.length,
      countOverdue: kpis.countOverdue + tocOverdue,
      paidThisMonth: kpis.paidThisMonth,
      aging: kpis.aging,
    }
  }, [kpis, tocOnly])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Contas a Pagar</h1>
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />Nova Conta a Pagar
        </button>
      </div>

      {combinedKpis && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard title="Total Pendente" value={formatCurrency(combinedKpis.totalPending)} icon={<ArrowUpFromLine className="w-6 h-6 text-red-500" />} />
            <KpiCard title="Em aberto" value={String(combinedKpis.countOpen)} />
            <KpiCard
              title="Vencidas"
              value={String(combinedKpis.countOverdue)}
              className={combinedKpis.countOverdue > 0 ? 'border-red-200 cursor-pointer hover:border-red-400 transition-colors' : ''}
              onClick={combinedKpis.countOverdue > 0 ? () => { setStatusFilter('OPEN'); setDueDateTo(new Date().toISOString().slice(0, 10)); setDueDateFrom(''); setOriginFilter(''); setEntitySearch(''); setPage(1) } : undefined}
            />
            <KpiCard title="Pago este mês" value={formatCurrency(combinedKpis.paidThisMonth)} />
          </div>
        </>
      )}

      <div className="card">
        <div className="px-5 py-4 border-b border-gray-100 flex gap-3 items-center flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            <input
              className="input pl-8 text-sm py-1 w-44"
              placeholder="Fornecedor ou referência..."
              value={entitySearch}
              onChange={(e) => { setEntitySearch(e.target.value); setPage(1) }}
            />
            {entitySearch && (
              <button onClick={() => { setEntitySearch(''); setPage(1) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <select className="input w-auto text-sm py-1" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
            <option value="">Todos os estados</option>
            <option value="OPEN">Emitido / Em aberto</option>
            <option value="PARTIAL">Parcialmente pago</option>
            <option value="SETTLED">Liquidado</option>
            <option value="VOID">Anulado</option>
          </select>
          <select className="input w-auto text-sm py-1" value={originFilter} onChange={(e) => { setOriginFilter(e.target.value); setPage(1) }}>
            <option value="">Todas as origens</option>
            <option value="TOCONLINE">TOConline</option>
            <option value="LOCAL">Local</option>
          </select>
          <div className="flex items-center gap-1.5">
            <input type="date" className="input text-sm py-1 w-36" value={dueDateFrom} onChange={(e) => { setDueDateFrom(e.target.value); setPage(1) }} title="Vencimento de" />
            <span className="text-gray-400 text-xs">–</span>
            <input type="date" className="input text-sm py-1 w-36" value={dueDateTo} onChange={(e) => { setDueDateTo(e.target.value); setPage(1) }} title="Vencimento até" />
            {(dueDateFrom || dueDateTo) && (
              <button onClick={() => { setDueDateFrom(''); setDueDateTo(''); setPage(1) }} className="text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => { setIsRecurrentFilter((v) => !v); setPage(1) }}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${isRecurrentFilter ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
          >
            <Repeat2 className="w-3.5 h-3.5" /> Recorrentes
          </button>
          {hasFilters && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 px-2 py-1.5 hover:bg-gray-50 rounded-lg transition-colors">
              <X className="w-3.5 h-3.5" /> Limpar
            </button>
          )}
          <span className="text-sm text-gray-400 ml-auto">
            {data?.total ?? 0} locais{tocOnly.length > 0 ? ` · ${tocOnly.length} do TOConline` : ''}
          </span>
          {tocLoading && <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" />}
          <button onClick={() => refetchToc()} className="text-xs text-gray-400 hover:text-gray-600" title="Atualizar TOConline">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={exportCsv} title="Exportar CSV" className="text-gray-400 hover:text-gray-600 p-1.5 hover:bg-gray-50 rounded-lg transition-colors">
            <Download className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                <th className="text-left px-5 py-3">Documento</th>
                <th onClick={() => toggleSort('entityName')} className="text-left px-5 py-3 cursor-pointer hover:text-gray-700 select-none">
                  Fornecedor <SortIcon field="entityName" />
                </th>
                <th className="text-left px-5 py-3">Categoria</th>
                <th onClick={() => toggleSort('dueDate')} className="text-left px-5 py-3 cursor-pointer hover:text-gray-700 select-none">
                  Vencimento <SortIcon field="dueDate" />
                </th>
                <th onClick={() => toggleSort('totalAmount')} className="text-right px-5 py-3 cursor-pointer hover:text-gray-700 select-none">
                  Total <SortIcon field="totalAmount" />
                </th>
                <th onClick={() => toggleSort('pendingAmount')} className="text-right px-5 py-3 cursor-pointer hover:text-gray-700 select-none">
                  Pendente <SortIcon field="pendingAmount" />
                </th>
                <th className="text-left px-5 py-3">Estado</th>
                <th className="w-16 px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((row) => {
                if (row._src === 'local') {
                  const p = row.p
                  return (
                    <tr key={`l-${p.id}`} className="hover:bg-gray-50 group">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-gray-900">{p.reference}</span>
                          {p.recurrenceId && <span title="Recorrente"><Repeat2 className="w-3.5 h-3.5 text-primary-400 flex-shrink-0" /></span>}
                        </div>
                        <div className="text-xs text-gray-400">{formatDate(p.documentDate)}{p.description ? ` · ${p.description}` : ''}</div>
                      </td>
                      <td className="px-5 py-3 text-gray-700">{p.entityName}</td>
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.category.color }} />
                          <span className="text-gray-700 text-xs">{p.category.name}</span>
                          {!p.category.launchToc && <span className="text-gray-400 text-xs">· local</span>}
                        </span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        {(() => {
                          const now = Date.now()
                          const due = new Date(p.dueDate).getTime()
                          const isActive = p.status !== 'SETTLED' && p.status !== 'VOID'
                          const overdue = isActive && due < now
                          const daysOverdue = overdue ? Math.floor((now - due) / 86400000) : 0
                          const daysUntil = isActive && !overdue ? Math.floor((due - now) / 86400000) : -1
                          return (
                            <>
                              <div className={overdue ? 'text-red-600 font-medium' : 'text-gray-500'}>{formatDate(p.dueDate)}</div>
                              {overdue && daysOverdue > 0 && <div className="text-xs text-red-400">{daysOverdue} dias</div>}
                              {!overdue && daysUntil >= 0 && daysUntil <= 14 && <div className="text-xs text-amber-500">{daysUntil === 0 ? 'hoje' : `${daysUntil}d`}</div>}
                            </>
                          )
                        })()}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-700">{formatCurrency(p.totalAmount)}</td>
                      <td className="px-5 py-3 text-right">
                        <div className="font-semibold text-red-700">{formatCurrency(p.pendingAmount)}</div>
                        {p.status === 'PARTIAL' && Number(p.paidAmount) > 0 && (
                          <div className="text-xs text-gray-400">pago: {formatCurrency(Number(p.paidAmount))}</div>
                        )}
                      </td>
                      <td className="px-5 py-3"><Badge variant={statusVariant(p.status)}>{statusLabel(p.status)}</Badge></td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            title="Editar"
                            onClick={() => { setEditId(p.id); setEditForm({ entityName: p.entityName, dueDate: p.dueDate.slice(0, 10), description: p.description ?? '' }) }}
                            className="p-1 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {(p.status === 'OPEN' || p.status === 'PARTIAL') && (
                            <button
                              title="Pagamento parcial"
                              onClick={() => { setPartialId(p.id); setPartialAmount(''); setPartialMax(Number(p.pendingAmount)) }}
                              className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            >
                              <DollarSign className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {(p.status === 'OPEN' || p.status === 'PARTIAL') && (
                            <button
                              title="Liquidar totalmente"
                              onClick={() => { if (confirm('Marcar como pago na totalidade?')) settlePayable.mutate(p.id) }}
                              className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {p.status !== 'VOID' && p.status !== 'SETTLED' && (
                            <button
                              title="Anular"
                              onClick={() => { if (confirm('Anular este documento?')) voidPayable.mutate(p.id) }}
                              className="p-1 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            title="Eliminar"
                            onClick={() => { if (confirm('Eliminar permanentemente?')) deletePayable.mutate(p.id) }}
                            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                }

                const d = row.d
                const docId = String(d.id)
                const ref = d.document_no
                const supplier = d.supplier_business_name || '—'
                const date = d.date
                const dueDate = d.due_date ?? date
                const total = d.gross_total
                const pending = d.pending_total
                return (
                  <tr key={`t-${docId}`} className="hover:bg-blue-50 bg-blue-50/30 group">
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-900">{ref}</div>
                      <div className="text-xs text-gray-400">{date ? formatDate(date) : '—'}</div>
                    </td>
                    <td className="px-5 py-3 text-gray-700">{supplier}</td>
                    <td className="px-5 py-3">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">TOConline</span>
                    </td>
                    <td className={`px-5 py-3 whitespace-nowrap ${dueDate && new Date(dueDate) < new Date() ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                      {dueDate ? formatDate(dueDate) : '—'}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-700">{formatCurrency(total)}</td>
                    <td className="px-5 py-3 text-right font-semibold text-red-700">{formatCurrency(pending)}</td>
                    <td className="px-5 py-3"><Badge variant={tocStatusVariant(d.status)}>{tocStatusLabel(d.status)}</Badge></td>
                    <td className="px-3 py-3">
                      <button
                        onClick={() => { setImportTocDoc(d); setImportTocCatId('') }}
                        className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-xs text-blue-700 bg-blue-50 hover:bg-blue-100 px-2 py-1 rounded-lg border border-blue-200 transition-all whitespace-nowrap"
                        title="Importar para local"
                      >
                        <ArrowDownToLine className="w-3 h-3" />
                        Importar
                      </button>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-gray-400">Sem documentos</td></tr>
              )}
            </tbody>
            {rows.length > 0 && (() => {
              // Sem filtros activos: mostrar totais globais vindos do endpoint /kpis
              if (!hasFilters && combinedKpis) {
                const globalCount = (data?.total ?? 0) + tocOnly.length
                return (
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50 text-xs font-semibold text-gray-600 uppercase">
                      <td colSpan={2} className="px-5 py-2">Total ({globalCount} doc.)</td>
                      <td className="px-5 py-2 text-right text-gray-500 normal-case font-normal">Em aberto: {combinedKpis.countOpen}</td>
                      <td className="px-5 py-2 text-right text-gray-500 normal-case font-normal">Vencidas: {combinedKpis.countOverdue > 0 ? <span className="text-red-600 font-semibold">{combinedKpis.countOverdue}</span> : 0}</td>
                      <td className="px-5 py-2 text-right text-gray-400">—</td>
                      <td className="px-5 py-2 text-right text-red-700">{formatCurrency(combinedKpis.totalPending)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )
              }
              // Com filtros: subtotal da página actual
              const totalAmt = rows.reduce((s, row) => s + (row._src === 'local' ? Number(row.p.totalAmount) : Number(row.d.gross_total)), 0)
              const pendingAmt = rows.reduce((s, row) => s + (row._src === 'local' ? Number(row.p.pendingAmount) : Number(row.d.pending_total)), 0)
              return (
                <tfoot>
                  <tr className="border-t-2 border-gray-200 bg-gray-50 text-xs font-semibold text-gray-600 uppercase">
                    <td colSpan={4} className="px-5 py-2">Subtotal — {rows.length} nesta pág. ({data?.total ?? 0} filtrados)</td>
                    <td className="px-5 py-2 text-right">{formatCurrency(totalAmt)}</td>
                    <td className="px-5 py-2 text-right text-red-700">{formatCurrency(pendingAmt)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )
            })()}
          </table>
        </div>

        {(data?.total ?? 0) > 25 && (
          <div className="px-5 py-3 border-t border-gray-100 flex justify-between items-center">
            <button className="btn-secondary text-xs py-1" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹ Anterior</button>
            <span className="text-xs text-gray-500">
              {(page - 1) * 25 + 1}–{Math.min(page * 25, data?.total ?? 0)} de {data?.total ?? 0}
            </span>
            <button className="btn-secondary text-xs py-1" disabled={page * 25 >= (data?.total ?? 0)} onClick={() => setPage((p) => p + 1)}>Seguinte ›</button>
          </div>
        )}
      </div>

      <Modal open={!!partialId} onClose={() => { setPartialId(null); setPartialAmount('') }} title="Registar Pagamento Parcial">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Valor pendente: <span className="font-semibold text-gray-900">{formatCurrency(partialMax)}</span>
          </p>
          <div>
            <label className="label">Valor pago (€)</label>
            <input
              type="number"
              min="0.01"
              max={partialMax}
              step="0.01"
              className="input"
              value={partialAmount}
              onChange={(e) => setPartialAmount(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => { setPartialId(null); setPartialAmount('') }} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={() => {
                const amt = parseFloat(partialAmount)
                if (partialId && amt > 0) partialPayment.mutate({ id: partialId, amount: amt })
              }}
              className="btn-primary flex-1"
              disabled={partialPayment.isPending || !partialAmount || parseFloat(partialAmount) <= 0}
            >
              {partialPayment.isPending ? 'A guardar...' : 'Registar'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!editId} onClose={() => setEditId(null)} title="Editar Conta a Pagar">
        <div className="space-y-4">
          <div>
            <label className="label">Fornecedor / Entidade</label>
            <input className="input" value={editForm.entityName} onChange={(e) => setEditForm({ ...editForm, entityName: e.target.value })} />
          </div>
          <div>
            <label className="label">Data Vencimento</label>
            <input type="date" className="input" value={editForm.dueDate} onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })} />
          </div>
          <div>
            <label className="label">Descrição</label>
            <input className="input" value={editForm.description} placeholder="(opcional)" onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setEditId(null)} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={() => editId && updatePayable.mutate({ id: editId, data: { entityName: editForm.entityName, dueDate: editForm.dueDate, description: editForm.description || undefined } })}
              className="btn-primary flex-1"
              disabled={updatePayable.isPending || !editForm.entityName || !editForm.dueDate}
            >
              {updatePayable.isPending ? 'A guardar...' : 'Guardar'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!importTocDoc} onClose={() => setImportTocDoc(null)} title="Importar do TOConline">
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1.5">
            <div className="flex justify-between"><span className="text-gray-500">Documento</span><span className="font-medium">{importTocDoc?.document_no}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Fornecedor</span><span>{importTocDoc?.supplier_business_name}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Vencimento</span><span>{importTocDoc?.due_date ? formatDate(importTocDoc.due_date) : '—'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Valor</span><span className="font-semibold text-red-700">{formatCurrency(importTocDoc?.gross_total ?? 0)}</span></div>
          </div>
          <div>
            <label className="label">Categoria local</label>
            <select className="input" value={importTocCatId} onChange={(e) => setImportTocCatId(e.target.value)} autoFocus>
              <option value="">Selecionar...</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{!c.launchToc ? ' (local)' : ''}</option>)}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setImportTocDoc(null)} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={() => importFromToc.mutate()}
              className="btn-primary flex-1"
              disabled={importFromToc.isPending || !importTocCatId}
            >
              {importFromToc.isPending ? 'A importar...' : 'Importar'}
            </button>
          </div>
          {importFromToc.isError && <p className="text-sm text-red-600">{(importFromToc.error as Error).message}</p>}
        </div>
      </Modal>

      <Modal open={showNew} onClose={() => setShowNew(false)} title="Nova Conta a Pagar" size="lg">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Categoria</label>
            <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">Selecionar...</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{!c.launchToc ? ' (local)' : ''}</option>)}
            </select>
          </div>
          <div className="col-span-2"><label className="label">Fornecedor / Entidade</label><input className="input" value={form.entityName} onChange={(e) => setForm({ ...form, entityName: e.target.value })} /></div>
          <div><label className="label">Nº Documento</label><input className="input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="FC2024/001" /></div>
          <div><label className="label">Valor (€)</label><input type="number" className="input" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} /></div>
          <div><label className="label">Data Documento</label><input type="date" className="input" value={form.documentDate} onChange={(e) => setForm({ ...form, documentDate: e.target.value })} /></div>
          <div><label className="label">Data Vencimento</label><input type="date" className="input" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></div>
          <div className="col-span-2"><label className="label">Descrição</label><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>

        <div className="mt-4 border-t border-gray-100 pt-4 space-y-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-gray-300 text-primary-600"
              checked={recForm.isRecurrent}
              onChange={(e) => setRecForm({ ...recForm, isRecurrent: e.target.checked })}
            />
            <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
              <Repeat2 className="w-4 h-4 text-primary-500" /> Recorrente
            </span>
          </label>

          {recForm.isRecurrent && (
            <div className="grid grid-cols-2 gap-3 pl-6">
              <div className="col-span-2">
                <label className="label">Frequência</label>
                <select className="input" value={recForm.frequency} onChange={(e) => setRecForm({ ...recForm, frequency: e.target.value as typeof recForm.frequency })}>
                  <option value="MONTHLY">Mensal</option>
                  <option value="QUARTERLY">Trimestral</option>
                  <option value="SEMIANNUAL">Semestral</option>
                  <option value="ANNUAL">Anual</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="label">Terminar</label>
                <select className="input" value={recForm.endType} onChange={(e) => setRecForm({ ...recForm, endType: e.target.value as typeof recForm.endType, endDate: '', occurrences: '' })}>
                  <option value="none">Sem data de fim</option>
                  <option value="date">Na data</option>
                  <option value="occurrences">Após N ocorrências</option>
                </select>
              </div>
              {recForm.endType === 'date' && (
                <div className="col-span-2">
                  <label className="label">Data de fim</label>
                  <input type="date" className="input" value={recForm.endDate} onChange={(e) => setRecForm({ ...recForm, endDate: e.target.value })} />
                </div>
              )}
              {recForm.endType === 'occurrences' && (
                <div className="col-span-2">
                  <label className="label">Nº de ocorrências</label>
                  <input type="number" min="2" max="120" className="input" value={recForm.occurrences} onChange={(e) => setRecForm({ ...recForm, occurrences: e.target.value })} placeholder="ex: 12" />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={() => { setShowNew(false); setRecForm(emptyRecurrence) }} className="btn-secondary flex-1">Cancelar</button>
          <button onClick={() => create.mutate()} className="btn-primary flex-1" disabled={create.isPending || !form.categoryId || !form.entityName || !form.reference || !form.totalAmount}>
            {create.isPending ? 'A guardar...' : (recForm.isRecurrent ? 'Criar Recorrente' : 'Criar')}
          </button>
        </div>
      </Modal>
    </div>
  )
}
