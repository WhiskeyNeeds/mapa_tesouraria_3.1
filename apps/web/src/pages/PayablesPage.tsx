import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate, statusLabel, statusVariant } from '@/lib/utils'
import KpiCard from '@/components/ui/KpiCard'
import Badge from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import { Plus, ArrowUpFromLine, Download, Loader2 } from 'lucide-react'

// Raw TOConline purchase document (fields mapped from API response)
interface TocPurchaseDoc {
  id: string | number
  number?: string
  document_number?: string
  date?: string
  document_date?: string
  due_date?: string
  net_total?: number
  gross_total?: number
  outstanding_amount?: number
  status?: string
  document_type?: string
  supplier?: { id?: string | number; name?: string; tax_id?: string }
  supplier_name?: string
  currency_code?: string
  [key: string]: unknown
}

interface Payable {
  id: string; reference: string; entityName: string; documentDate: string; dueDate: string
  totalAmount: number; pendingAmount: number; paidAmount: number; status: string; origin: string
  category: { id: string; name: string; color: string; launchToc: boolean }
}
interface Category { id: string; name: string; type: string; launchToc: boolean }

const emptyForm = {
  categoryId: '', entityName: '', reference: '', description: '',
  documentDate: '', dueDate: '', totalAmount: '', currency: 'EUR',
}

export default function PayablesPage() {
  const { selectedClientId } = useAuth()
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [showTocImport, setShowTocImport] = useState(false)
  const [selectedTocIds, setSelectedTocIds] = useState<Set<string>>(new Set())

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

  const { data: tocDocs, isLoading: tocLoading, error: tocError, refetch: fetchTocDocs } = useQuery<TocPurchaseDoc[]>({
    queryKey: ['toc-purchases', selectedClientId],
    queryFn: () => api.get(`/toconline/${selectedClientId}/purchases`),
    enabled: false,
    retry: false,
  })

  const importToc = useMutation({
    mutationFn: async (docs: TocPurchaseDoc[]) => {
      const { data: cats } = await Promise.resolve({ data: categories })
      const defaultCat = cats[0]?.id ?? ''
      const payloads = docs.map((d) => ({
        categoryId: defaultCat,
        entityName: d.supplier?.name ?? d.supplier_name ?? 'Desconhecido',
        entityNif: undefined as string | undefined,
        tocSupplierId: d.supplier?.id ? String(d.supplier.id) : undefined,
        tocPurchasesDocId: String(d.id),
        reference: d.number ?? d.document_number ?? String(d.id),
        description: d.document_type ?? '',
        documentDate: d.date ?? d.document_date ?? new Date().toISOString().slice(0, 10),
        dueDate: d.due_date ?? d.date ?? d.document_date ?? new Date().toISOString().slice(0, 10),
        totalAmount: d.gross_total ?? d.net_total ?? 0,
        currency: d.currency_code ?? 'EUR',
      }))
      return Promise.all(payloads.map((p) => api.post(`/treasury/${selectedClientId}/payables`, p)))
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payables'] })
      qc.invalidateQueries({ queryKey: ['payables-kpis'] })
      setShowTocImport(false)
      setSelectedTocIds(new Set())
    },
  })

  function toggleTocDoc(id: string) {
    setSelectedTocIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAllToc() {
    if (!tocDocs) return
    if (selectedTocIds.size === tocDocs.length) setSelectedTocIds(new Set())
    else setSelectedTocIds(new Set(tocDocs.map((d) => String(d.id))))
  }

  const create = useMutation({
    mutationFn: () => api.post(`/treasury/${selectedClientId}/payables`, { ...form, totalAmount: parseFloat(form.totalAmount) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payables'] }); qc.invalidateQueries({ queryKey: ['payables-kpis'] }); setShowNew(false); setForm(emptyForm) },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Contas a Pagar</h1>
        <div className="flex gap-2">
          <button onClick={() => { setShowTocImport(true); fetchTocDocs() }} className="btn-secondary flex items-center gap-2">
            <Download className="w-4 h-4" />Importar do TOConline
          </button>
          <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" />Nova Conta a Pagar</button>
        </div>
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
        <div className="px-5 py-4 border-b border-gray-100 flex gap-3 items-center">
          <select className="input w-auto text-sm py-1" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
            <option value="">Todos os estados</option>
            <option value="OPEN">Aberto</option>
            <option value="PARTIAL">Parcial</option>
            <option value="SETTLED">Pago</option>
            <option value="VOID">Anulado</option>
          </select>
          <span className="text-sm text-gray-400 ml-auto">{data?.total ?? 0} documentos</span>
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
              {data?.items.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-900">{p.reference}</div>
                    <div className="text-xs text-gray-400">{formatDate(p.documentDate)}</div>
                  </td>
                  <td className="px-5 py-3 text-gray-700">{p.entityName}</td>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.category.color }} />
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
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={showTocImport} onClose={() => { setShowTocImport(false); setSelectedTocIds(new Set()) }} title="Importar faturas do TOConline" size="lg">
        {tocLoading && (
          <div className="flex items-center justify-center py-12 gap-3 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">A carregar documentos...</span>
          </div>
        )}
        {tocError && (
          <div className="py-8 text-center text-sm text-red-600">
            {(tocError as Error).message}
          </div>
        )}
        {tocDocs && tocDocs.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-500">Nenhum documento encontrado no TOConline.</p>
        )}
        {tocDocs && tocDocs.length > 0 && (
          <div className="space-y-4">
            <p className="text-xs text-gray-500">{tocDocs.length} documentos encontrados. Selecione os que pretende importar.</p>
            <div className="overflow-x-auto max-h-96 overflow-y-auto border border-gray-100 rounded-lg">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50 z-10">
                  <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                    <th className="px-3 py-2">
                      <input type="checkbox" checked={selectedTocIds.size === tocDocs.length} onChange={toggleAllToc} className="rounded" />
                    </th>
                    <th className="text-left px-3 py-2">Nº Documento</th>
                    <th className="text-left px-3 py-2">Fornecedor</th>
                    <th className="text-left px-3 py-2">Data</th>
                    <th className="text-left px-3 py-2">Vencimento</th>
                    <th className="text-right px-3 py-2">Total</th>
                    <th className="text-left px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {tocDocs.map((d) => {
                    const docId = String(d.id)
                    const ref = d.number ?? d.document_number ?? docId
                    const supplier = d.supplier?.name ?? d.supplier_name ?? '—'
                    const date = d.date ?? d.document_date
                    const total = d.gross_total ?? d.net_total
                    return (
                      <tr key={docId} className={`hover:bg-gray-50 cursor-pointer ${selectedTocIds.has(docId) ? 'bg-primary-50' : ''}`} onClick={() => toggleTocDoc(docId)}>
                        <td className="px-3 py-2">
                          <input type="checkbox" checked={selectedTocIds.has(docId)} onChange={() => toggleTocDoc(docId)} onClick={(e) => e.stopPropagation()} className="rounded" />
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-900">{ref}</td>
                        <td className="px-3 py-2 text-gray-700">{supplier}</td>
                        <td className="px-3 py-2 text-gray-500">{date ? formatDate(date) : '—'}</td>
                        <td className="px-3 py-2 text-gray-500">{d.due_date ? formatDate(d.due_date) : '—'}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{total != null ? formatCurrency(total) : '—'}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">{d.status ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-4 pt-2">
              <button
                onClick={() => importToc.mutate(tocDocs.filter((d) => selectedTocIds.has(String(d.id))))}
                disabled={importToc.isPending || selectedTocIds.size === 0}
                className="btn-primary"
              >
                {importToc.isPending ? 'A importar...' : `Importar ${selectedTocIds.size} documento${selectedTocIds.size !== 1 ? 's' : ''}`}
              </button>
              <button onClick={() => { setShowTocImport(false); setSelectedTocIds(new Set()) }} className="btn-secondary">Cancelar</button>
              {importToc.isError && <p className="text-sm text-red-600">{(importToc.error as Error).message}</p>}
            </div>
          </div>
        )}
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
