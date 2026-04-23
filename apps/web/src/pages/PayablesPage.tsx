import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate, statusLabel, statusVariant, tocStatusLabel, tocStatusVariant } from '@/lib/utils'
import KpiCard from '@/components/ui/KpiCard'
import Badge from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import { Plus, ArrowUpFromLine, RefreshCw } from 'lucide-react'

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
  tocPurchasesDocId?: string
  category: { id: string; name: string; color: string; launchToc: boolean }
}
interface Category { id: string; name: string; type: string; launchToc: boolean }

const emptyForm = {
  categoryId: '', entityName: '', reference: '', description: '',
  documentDate: '', dueDate: '', totalAmount: '', currency: 'EUR',
}

type Row = { _src: 'local'; p: Payable } | { _src: 'toc'; d: TocPurchaseDoc }

export default function PayablesPage() {
  const { selectedClientId } = useAuth()
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState(emptyForm)

  const { data: kpis } = useQuery({
    queryKey: ['payables-kpis', selectedClientId],
    queryFn: () => api.get<{ totalPending: number; countOpen: number; countOverdue: number; paidThisMonth: number }>(`/treasury/${selectedClientId}/payables/kpis`),
    enabled: !!selectedClientId,
  })

  const { data } = useQuery({
    queryKey: ['payables', selectedClientId, statusFilter, page],
    queryFn: () => api.get<{ total: number; items: Payable[] }>(`/treasury/${selectedClientId}/payables?page=${page}&limit=25${statusFilter ? `&status=${statusFilter}` : ''}`),
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
    mutationFn: () => api.post(`/treasury/${selectedClientId}/payables`, { ...form, totalAmount: parseFloat(form.totalAmount) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payables'] }); qc.invalidateQueries({ queryKey: ['payables-kpis'] }); setShowNew(false); setForm(emptyForm) },
  })

  // IDs já importados do TOConline
  const importedIds = new Set(
    (data?.items ?? []).map((p) => p.tocPurchasesDocId).filter(Boolean) as string[]
  )

  // Linhas TOConline ainda não importadas
  const tocOnly = (tocDocs ?? []).filter((d) => !importedIds.has(String(d.id)))

  const rows: Row[] = [
    ...(data?.items ?? []).map((p) => ({ _src: 'local' as const, p })),
    ...tocOnly.map((d) => ({ _src: 'toc' as const, d })),
  ].sort((a, b) => {
    const dateA = a._src === 'local' ? a.p.documentDate : a.d.date
    const dateB = b._src === 'local' ? b.p.documentDate : b.d.date
    return new Date(dateB).getTime() - new Date(dateA).getTime()
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Contas a Pagar</h1>
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />Nova Conta a Pagar
        </button>
      </div>

      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard title="Total Pendente" value={formatCurrency(kpis.totalPending)} icon={<ArrowUpFromLine className="w-6 h-6 text-red-500" />} />
          <KpiCard title="Em aberto" value={String(kpis.countOpen)} />
          <KpiCard title="Vencidas" value={String(kpis.countOverdue)} className={kpis.countOverdue > 0 ? 'border-red-200' : ''} />
          <KpiCard title="Pago este mês" value={formatCurrency(kpis.paidThisMonth)} />
        </div>
      )}

      <div className="card">
        <div className="px-5 py-4 border-b border-gray-100 flex gap-3 items-center flex-wrap">
          <select className="input w-auto text-sm py-1" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
            <option value="">Todos os estados</option>
            <option value="OPEN">Aberto</option>
            <option value="PARTIAL">Parcial</option>
            <option value="SETTLED">Pago</option>
            <option value="VOID">Anulado</option>
          </select>
          <span className="text-sm text-gray-400 ml-auto">
            {data?.total ?? 0} locais{tocOnly.length > 0 ? ` · ${tocOnly.length} do TOConline` : ''}
          </span>
          {tocLoading && <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" />}
          <button onClick={() => refetchToc()} className="text-xs text-gray-400 hover:text-gray-600" title="Atualizar TOConline">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                <th className="text-left px-5 py-3">Documento</th>
                <th className="text-left px-5 py-3">Fornecedor</th>
                <th className="text-left px-5 py-3">Categoria</th>
                <th className="text-left px-5 py-3">Vencimento</th>
                <th className="text-right px-5 py-3">Total</th>
                <th className="text-right px-5 py-3">Pendente</th>
                <th className="text-left px-5 py-3">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((row) => {
                if (row._src === 'local') {
                  const p = row.p
                  return (
                    <tr key={`l-${p.id}`} className="hover:bg-gray-50">
                      <td className="px-5 py-3">
                        <div className="font-medium text-gray-900">{p.reference}</div>
                        <div className="text-xs text-gray-400">{formatDate(p.documentDate)}</div>
                      </td>
                      <td className="px-5 py-3 text-gray-700">{p.entityName}</td>
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.category.color }} />
                          <span className="text-gray-700 text-xs">{p.category.name}</span>
                          {!p.category.launchToc && <span className="text-gray-400 text-xs">· local</span>}
                        </span>
                      </td>
                      <td className={`px-5 py-3 whitespace-nowrap ${p.status !== 'SETTLED' && new Date(p.dueDate) < new Date() ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                        {formatDate(p.dueDate)}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-700">{formatCurrency(p.totalAmount)}</td>
                      <td className="px-5 py-3 text-right font-semibold text-red-700">{formatCurrency(p.pendingAmount)}</td>
                      <td className="px-5 py-3"><Badge variant={statusVariant(p.status)}>{statusLabel(p.status)}</Badge></td>
                    </tr>
                  )
                }

                const d = row.d
                const docId = String(d.id)
                const ref = d.document_no
                const supplier = d.supplier_business_name
                const date = d.date
                const dueDate = d.due_date ?? date
                const total = d.gross_total
                const pending = d.pending_total
                return (
                  <tr key={`t-${docId}`} className="hover:bg-blue-50 bg-blue-50/30">
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
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-gray-400">Sem documentos</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {(data?.total ?? 0) > 25 && (
          <div className="px-5 py-3 border-t border-gray-100 flex justify-between items-center">
            <button className="btn-secondary text-xs py-1" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
            <span className="text-xs text-gray-500">Página {page}</span>
            <button className="btn-secondary text-xs py-1" disabled={(data?.items.length ?? 0) < 25} onClick={() => setPage((p) => p + 1)}>Seguinte</button>
          </div>
        )}
      </div>

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
        <div className="flex gap-3 mt-6">
          <button onClick={() => setShowNew(false)} className="btn-secondary flex-1">Cancelar</button>
          <button onClick={() => create.mutate()} className="btn-primary flex-1" disabled={create.isPending || !form.categoryId || !form.entityName || !form.reference || !form.totalAmount}>
            {create.isPending ? 'A guardar...' : 'Criar'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
