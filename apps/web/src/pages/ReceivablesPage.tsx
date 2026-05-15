import { Fragment, useState, useMemo, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate, statusLabel, statusVariant, tocStatusLabel, tocStatusVariant } from '@/lib/utils'
import KpiCard from '@/components/ui/KpiCard'
import Badge from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import { Plus, ArrowDownToLine, RefreshCw, Trash2, XCircle, Search, X, CheckCircle, Download, ArrowUpDown, ArrowUp, ArrowDown, Pencil, DollarSign, Repeat2, ChevronRight, ChevronDown, Printer, Mail, ChevronLeft, AlertTriangle } from 'lucide-react'

interface TocSalesDoc {
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
  customer_id?: number
  customer_business_name: string
  customer_tax_registration_number?: string
  currency_iso_code: string
  external_reference?: string
  notes?: string
  [key: string]: unknown
}

interface TocReceipt {
  id: number | string
  document_no: string
  date: string
  gross_total: number
  net_total?: number
  receipt_series?: string
  [key: string]: unknown
}

interface ReceiptLine {
  receivable_id: number | string
  received_value: number
  gross_total: number
  net_total?: number
  settlement_percentage?: number
  settlement_amount?: number
  retention_total?: number
  document_no?: string
  _doc_date?: string
  _doc_due_date?: string
  _doc_gross_total?: number
  _doc_pending_total?: number
  _doc_retention?: number
  [key: string]: unknown
}

interface Receivable {
  id: string; reference: string; entityName: string; documentDate: string; dueDate: string
  totalAmount: number; pendingAmount: number; receivedAmount: number; status: string; origin: string
  description?: string | null
  tocSalesDocId?: string
  recurrenceId?: string | null
  category?: { id: string; name: string; color: string; launchToc: boolean } | null
}
interface Category { id: string; name: string; type: string; launchToc: boolean }
interface TocCustomer { id: string | number; business_name?: string; tax_identification_number?: string;[key: string]: unknown }

const emptyForm = {
  categoryId: '', entityName: '', entityNif: '', reference: '', description: '',
  documentDate: '', dueDate: '', totalAmount: '', currency: 'EUR',
}
const emptyRecurrence = {
  isRecurrent: false,
  frequency: 'MONTHLY' as const,
  endType: 'none' as 'none' | 'date' | 'occurrences',
  endDate: '',
  occurrences: '',
}
const emptyTocLine = { item_type: 'Service', description: '', quantity: '1', unit_price: '', tax_code: 'NOR' }
const emptyOutrasForm = {
  categoryId: '', entityName: '', entityNif: '', reference: '', description: '',
  documentDate: '', dueDate: '', totalAmount: '',
}
const TAX_RATES: Record<string, number> = { NOR: 23, INT: 13, RED: 6, ISE: 0 }

type Row = { _src: 'local'; r: Receivable } | { _src: 'toc'; d: TocSalesDoc }

function ReceiptDetailModal({
  open, onClose, receipt, clientId, entityName,
}: {
  open: boolean
  onClose: () => void
  receipt: TocReceipt | null
  clientId: string
  entityName: string
}) {
  const { data: lines = [], isLoading } = useQuery<ReceiptLine[]>({
    queryKey: ['toc-receipt-lines', clientId, String(receipt?.id ?? '')],
    queryFn: () => api.get(`/toconline/${clientId}/sales-receipts/${receipt!.id}/lines`),
    enabled: open && !!receipt,
  })

  if (!open || !receipt) return null

  // IVA do recibo = gross_total − net_total (tax_payable não existe neste objeto)
  const taxPayable = Number(receipt.gross_total ?? 0) - Number(receipt.net_total ?? 0)
  const series = receipt.receipt_series ?? receipt.document_no?.match(/[A-Z]+\s+(\d+)\//)?.[1] ?? ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-5xl animate-scale-in overflow-hidden">
        <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900 truncate pr-4">
            {receipt.document_no} - {entityName}
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-start gap-6 px-6 py-4 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-400 mb-0.5">Data de recebimento</div>
            <div className="text-sm font-medium text-gray-700">{formatDate(receipt.date)}</div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-400 mb-0.5">Série de Recibo</div>
            <div className="text-sm font-medium text-gray-700">{series || '—'}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400 mb-0.5">Total de Iva</div>
            <div className="text-xl font-bold text-gray-800">{formatCurrency(taxPayable)}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400 mb-0.5">Total recebido</div>
            <div className="text-xl font-bold text-gray-800">{formatCurrency(receipt.gross_total)}</div>
          </div>
        </div>

        <div className="px-6 py-4 max-h-[calc(100vh-22rem)] overflow-y-auto">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            Documento(s) liquidados ({isLoading ? '…' : lines.length})
          </h3>
          {isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-gray-400 justify-center">
              <RefreshCw className="w-4 h-4 animate-spin" />A carregar documentos...
            </div>
          ) : lines.length === 0 ? (
            <div className="py-8 text-sm text-gray-400 text-center">Sem documentos associados</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-600">
                    <th className="px-3 py-2 text-left font-medium text-xs">Documento</th>
                    <th className="px-3 py-2 text-right font-medium">Valor total</th>
                    <th className="px-3 py-2 text-right font-medium">Valor pendente</th>
                    <th className="px-3 py-2 text-right font-medium">Retenção no pag.</th>
                    <th className="px-3 py-2 text-right font-medium">Valor retido</th>
                    <th className="px-3 py-2 text-right font-medium">% desc. financ.</th>
                    <th className="px-3 py-2 text-right font-medium">Valor desconto</th>
                    <th className="px-3 py-2 text-right font-medium">Valor recebido</th>
                    <th className="px-3 py-2 text-right font-medium">IVA</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => {
                    const retentionPct = Number(line._doc_retention ?? 0)
                    const retentionValue = Number(line.retention_total ?? 0)
                    const discountPct = Number(line.settlement_percentage ?? 0)
                    const discountValue = Number(line.settlement_amount ?? 0)
                    // IVA da linha = valor recebido − base tributável recebida
                    const lineTax = Number(line.received_value ?? 0) - Number(line.net_total ?? 0)
                    return (
                      <tr key={i} className={i % 2 === 0 ? 'bg-slate-50/60' : 'bg-white'}>
                        <td className="px-3 py-2 border-b border-gray-100">
                          <div className="font-medium text-gray-700">{line.document_no ?? String(line.receivable_id)}</div>
                          {line._doc_date && <div className="text-gray-400">{formatDate(line._doc_date)}</div>}
                        </td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">
                          {line._doc_gross_total != null ? formatCurrency(line._doc_gross_total) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">
                          {line._doc_pending_total != null ? formatCurrency(line._doc_pending_total) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">{retentionPct} %</td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">{formatCurrency(retentionValue)}</td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">{discountPct} %</td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">{formatCurrency(discountValue)}</td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 font-semibold text-gray-700">{formatCurrency(line.received_value)}</td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">{lineTax ? formatCurrency(lineTax) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-100">
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-gray-600">
              <Printer className="w-3.5 h-3.5" />Imprimir
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-gray-600">
              <Mail className="w-3.5 h-3.5" />Enviar por email
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-red-200 rounded-lg hover:bg-red-50 transition-colors text-red-500">
              <XCircle className="w-3.5 h-3.5" />Anular
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button className="w-8 h-8 flex items-center justify-center border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-gray-400">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button className="px-4 py-1.5 bg-primary-600 text-white text-xs font-semibold rounded-lg hover:bg-primary-700 transition-colors uppercase tracking-wide">
              Opções de Pagamento
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ReceiptSubRows({ clientId, tocDocId, entityName }: { clientId: string; tocDocId: string; entityName: string }) {
  const [detailReceipt, setDetailReceipt] = useState<TocReceipt | null>(null)

  const { data: receipts = [], isLoading } = useQuery<TocReceipt[]>({
    queryKey: ['toc-sales-receipts', clientId, tocDocId],
    queryFn: () => api.get(`/toconline/${clientId}/sales/${tocDocId}/receipts`),
  })

  if (isLoading) {
    return (
      <tr>
        <td colSpan={8} className="pl-14 py-2 text-xs text-gray-400 bg-gray-50/60 border-b border-gray-100">
          <RefreshCw className="inline w-3 h-3 animate-spin mr-1.5" />A carregar recibos...
        </td>
      </tr>
    )
  }

  if (!receipts.length) {
    return (
      <tr>
        <td colSpan={8} className="pl-14 py-2 text-xs text-gray-400 bg-gray-50/60 border-b border-gray-100">
          Sem recibos associados
        </td>
      </tr>
    )
  }

  return (
    <>
      {receipts.map((rc) => (
        <tr
          key={String(rc.id)}
          className="bg-gray-50/60 border-b border-gray-100/80 cursor-pointer hover:bg-slate-50"
          onClick={() => setDetailReceipt(rc)}
        >
          <td className="pl-10 pr-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              <ChevronRight className="w-3 h-3 text-teal-400 flex-shrink-0" />
              <span className="text-gray-700 font-medium">{rc.document_no}</span>
            </div>
          </td>
          <td className="px-5 py-2 text-xs text-gray-500">{entityName}</td>
          <td className="px-5 py-2" />
          <td className="px-5 py-2 text-xs text-gray-500">{rc.date ? formatDate(rc.date) : '—'}</td>
          <td className="px-5 py-2" />
          <td className="px-5 py-2 text-right text-xs text-gray-600 font-medium">−{formatCurrency(rc.gross_total)}</td>
          <td className="px-5 py-2" />
          <td className="px-3 py-2" />
        </tr>
      ))}
      {createPortal(
        <ReceiptDetailModal
          open={!!detailReceipt}
          onClose={() => setDetailReceipt(null)}
          receipt={detailReceipt}
          clientId={clientId}
          entityName={entityName}
        />,
        document.body
      )}
    </>
  )
}

export default function ReceivablesPage() {
  const { selectedClientId } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [statusFilter, setStatusFilter] = useState('')
  const [entitySearch, setEntitySearch] = useState('')
  const [dueDateFrom, setDueDateFrom] = useState('')
  const [dueDateTo, setDueDateTo] = useState('')
  const [docDateFrom, setDocDateFrom] = useState('')
  const [docDateTo, setDocDateTo] = useState('')
  const [sortBy, setSortBy] = useState<'dueDate' | 'totalAmount' | 'pendingAmount' | 'entityName'>('dueDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [recForm, setRecForm] = useState(emptyRecurrence)
  const [isRecurrentFilter, setIsRecurrentFilter] = useState(false)
  const [isOverdueFilter, setIsOverdueFilter] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [editRow, setEditRow] = useState<Receivable | null>(null)
  const [editForm, setEditForm] = useState({ categoryId: '', entityName: '', reference: '', documentDate: '', dueDate: '', totalAmount: '', description: '' })
  const [deleteRow, setDeleteRow] = useState<Receivable | null>(null)
  const [partialId, setPartialId] = useState<string | null>(null)
  const [partialAmount, setPartialAmount] = useState('')
  const [partialMax, setPartialMax] = useState(0)
  const [importTocDoc, setImportTocDoc] = useState<TocSalesDoc | null>(null)
  const [importTocCatId, setImportTocCatId] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [tocCreate, setTocCreate] = useState(false)
  const [tocDocType, setTocDocType] = useState('FT')
  const [tocLines, setTocLines] = useState([{ ...emptyTocLine }])
  const [taxExemptionCode, setTaxExemptionCode] = useState('M07')
  const [vatIncludedPrices, setVatIncludedPrices] = useState(false)
  const [retentionPct, setRetentionPct] = useState('')
  const [activeTab, setActiveTab] = useState<'clientes' | 'outras'>('clientes')
  const [outrasForm, setOutrasForm] = useState(emptyOutrasForm)
  const [showNewOutras, setShowNewOutras] = useState(false)
  const [outrasContact, setOutrasContact] = useState<TocCustomer | null>(null)
  const [outrasContactSearch, setOutrasContactSearch] = useState('')
  const [showOutrasContactDropdown, setShowOutrasContactDropdown] = useState(false)
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [tocCustomerSearch, setTocCustomerSearch] = useState('')
  const [selectedTocCustomer, setSelectedTocCustomer] = useState<TocCustomer | null>(null)
  const customerInputRef = useRef<HTMLDivElement>(null)

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const { data: kpis } = useQuery({
    queryKey: ['receivables-kpis', selectedClientId],
    queryFn: () => api.get<{ totalPending: number; countOpen: number; countOverdue: number; settledThisMonth: number; aging: Record<string, number> }>(`/treasury/${selectedClientId}/receivables/kpis`),
    enabled: !!selectedClientId,
  })

  const { data } = useQuery({
    queryKey: ['receivables', selectedClientId, statusFilter, entitySearch, dueDateFrom, dueDateTo, docDateFrom, docDateTo, sortBy, sortDir, page, isRecurrentFilter, isOverdueFilter],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '25' })
      if (isOverdueFilter) {
        params.set('overdue', 'true')
      } else {
        if (statusFilter) params.set('status', statusFilter)
      }
      if (entitySearch) params.set('entityName', entitySearch)
      if (dueDateFrom) params.set('dueDateFrom', dueDateFrom)
      if (dueDateTo) params.set('dueDateTo', dueDateTo)
      if (docDateFrom) params.set('docDateFrom', docDateFrom)
      if (docDateTo) params.set('docDateTo', docDateTo)
      if (isRecurrentFilter) params.set('isRecurrent', 'true')
      if (sortBy !== 'dueDate' || sortDir !== 'asc') { params.set('sortBy', sortBy); params.set('sortDir', sortDir) }
      return api.get<{ total: number; items: Receivable[] }>(`/treasury/${selectedClientId}/receivables?${params}`)
    },
    enabled: !!selectedClientId,
  })

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories-revenue', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/categories?type=REVENUE`),
    enabled: !!selectedClientId,
  })

  const { data: tocDocs, isLoading: tocLoading, refetch: refetchToc } = useQuery<TocSalesDoc[]>({
    queryKey: ['toc-sales', selectedClientId],
    queryFn: () => api.get(`/toconline/${selectedClientId}/sales`),
    enabled: !!selectedClientId,
    retry: false,
    throwOnError: false,
  })

  const { data: tocCustomers = [] } = useQuery<TocCustomer[]>({
    queryKey: ['toc-customers', selectedClientId],
    queryFn: () => api.get(`/toconline/${selectedClientId}/customers`),
    enabled: !!selectedClientId,
    retry: false,
    throwOnError: false,
  })

  const filteredCustomers = useMemo(() => {
    const q = tocCustomerSearch.toLowerCase().trim()
    const list = q
      ? tocCustomers.filter((c) => String(c.business_name ?? '').toLowerCase().includes(q))
      : tocCustomers
    return list.slice(0, 10)
  }, [tocCustomers, tocCustomerSearch])

  useEffect(() => {
    if (!showCustomerDropdown) return
    function handleClick(e: MouseEvent) {
      if (customerInputRef.current && !customerInputRef.current.contains(e.target as Node)) {
        setShowCustomerDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showCustomerDropdown])

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === form.categoryId) ?? null,
    [categories, form.categoryId],
  )

  const hasIseLines = tocCreate && tocLines.some((l) => l.tax_code === 'ISE')

  const tocLinesTotal = useMemo(() => {
    if (!tocCreate) return null
    return tocLines.reduce((sum, l) => {
      const qty = parseFloat(l.quantity) || 0
      const price = parseFloat(l.unit_price) || 0
      const vatPct = TAX_RATES[l.tax_code ?? 'NOR'] ?? 23
      return sum + qty * price * (1 + vatPct / 100)
    }, 0)
  }, [tocCreate, tocLines])

  const create = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        ...form,
        totalAmount: parseFloat(form.totalAmount) || 0,
        entityNif: form.entityNif || undefined,
      }
      if (recForm.isRecurrent) {
        body.recurrence = {
          frequency: recForm.frequency,
          ...(recForm.endType === 'date' && recForm.endDate ? { endDate: recForm.endDate } : {}),
          ...(recForm.endType === 'occurrences' && recForm.occurrences ? { occurrences: parseInt(recForm.occurrences) } : {}),
        }
      }
      if (tocCreate && tocLines.some((l) => l.description && l.unit_price)) {
        if (selectedTocCustomer) body.tocCustomerId = String(selectedTocCustomer.id)
        body.tocDocumentType = tocDocType
        body.tocLines = tocLines
          .filter((l) => l.description && l.unit_price)
          .map((l) => ({
            item_type: l.item_type || 'Service',
            description: l.description,
            quantity: parseFloat(l.quantity) || 1,
            unit_price: parseFloat(l.unit_price),
            tax_code: l.tax_code || 'NOR',
          }))
        if (hasIseLines && taxExemptionCode) {
          body.taxExemptionCode = taxExemptionCode
        }
        if (vatIncludedPrices) body.vatIncludedPrices = true
        if (retentionPct) body.retentionPct = parseFloat(retentionPct)
      }
      return api.post(`/treasury/${selectedClientId}/receivables`, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['receivables-kpis'] })
      setShowNew(false)
      setForm(emptyForm)
      setRecForm(emptyRecurrence)
      setTocCreate(false)
      setTocDocType('FT')
      setTocLines([{ ...emptyTocLine }])
      setTaxExemptionCode('M07')
      setVatIncludedPrices(false)
      setRetentionPct('')
      setSelectedTocCustomer(null)
      setTocCustomerSearch('')
      toast.success(recForm.isRecurrent ? 'Conta recorrente criada.' : 'Conta a receber criada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const deleteReceivable = useMutation({
    mutationFn: (id: string) => api.delete(`/treasury/${selectedClientId}/receivables/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['receivables-kpis'] })
      setDeleteRow(null)
      toast.success('Documento eliminado.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const voidReceivable = useMutation({
    mutationFn: (id: string) => api.post(`/treasury/${selectedClientId}/receivables/${id}/void`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['receivables'] }); qc.invalidateQueries({ queryKey: ['receivables-kpis'] }); toast.success('Documento anulado.') },
    onError: (e) => toast.error((e as Error).message),
  })

  const settleReceivable = useMutation({
    mutationFn: (id: string) => api.post(`/treasury/${selectedClientId}/receivables/${id}/settle`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['receivables'] }); qc.invalidateQueries({ queryKey: ['receivables-kpis'] }); toast.success('Documento liquidado.') },
    onError: (e) => toast.error((e as Error).message),
  })

  const updateReceivable = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/treasury/${selectedClientId}/receivables/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['receivables-kpis'] })
      setEditId(null)
      setEditRow(null)
      toast.success('Documento atualizado.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const partialPayment = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) =>
      api.post(`/treasury/${selectedClientId}/receivables/${id}/partial-payment`, { amount }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['receivables'] }); qc.invalidateQueries({ queryKey: ['receivables-kpis'] }); setPartialId(null); setPartialAmount(''); toast.success('Pagamento parcial registado.') },
    onError: (e) => toast.error((e as Error).message),
  })

  const importFromToc = useMutation({
    mutationFn: () => {
      if (!importTocDoc) return Promise.reject(new Error('No document'))
      const d = importTocDoc
      return api.post(`/treasury/${selectedClientId}/receivables`, {
        ...(importTocCatId ? { categoryId: importTocCatId } : {}),
        entityName: d.customer_business_name,
        entityNif: d.customer_tax_registration_number ?? undefined,
        tocCustomerId: d.customer_id ? String(d.customer_id) : undefined,
        tocSalesDocId: String(d.id),
        reference: d.document_no,
        documentDate: d.date,
        dueDate: d.due_date ?? d.date,
        totalAmount: d.gross_total,
        currency: d.currency_iso_code ?? 'EUR',
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['receivables-kpis'] })
      setImportTocDoc(null)
      setImportTocCatId('')
      toast.success('Documento importado do TOConline.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const createOutras = useMutation({
    mutationFn: () =>
      api.post(`/treasury/${selectedClientId}/receivables`, {
        ...(outrasForm.categoryId ? { categoryId: outrasForm.categoryId } : {}),
        entityName: outrasForm.entityName,
        entityNif: outrasForm.entityNif || undefined,
        reference: outrasForm.reference || undefined,
        description: outrasForm.description || undefined,
        documentDate: outrasForm.documentDate,
        dueDate: outrasForm.dueDate,
        totalAmount: parseFloat(outrasForm.totalAmount) || 0,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['receivables-kpis'] })
      setOutrasForm(emptyOutrasForm)
      setShowNewOutras(false)
      toast.success('Operação criada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const outrasRows = (data?.items ?? []).filter((r) => !r.tocSalesDocId)

  const hasFilters = !!(statusFilter || entitySearch || dueDateFrom || dueDateTo || docDateFrom || docDateTo || isRecurrentFilter || isOverdueFilter)
  function clearFilters() {
    setStatusFilter(''); setEntitySearch(''); setDueDateFrom(''); setDueDateTo(''); setDocDateFrom(''); setDocDateTo(''); setIsRecurrentFilter(false); setIsOverdueFilter(false); setPage(1)
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
    if (entitySearch) p.set('entityName', entitySearch)
    if (dueDateFrom) p.set('dueDateFrom', dueDateFrom)
    if (dueDateTo) p.set('dueDateTo', dueDateTo)
    if (docDateFrom) p.set('docDateFrom', docDateFrom)
    if (docDateTo) p.set('docDateTo', docDateTo)
    const res = await fetch(`/api/v1/treasury/${selectedClientId}/receivables/export.csv?${p}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'contas-a-receber.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  // IDs já importados do TOConline
  const importedIds = new Set(
    (data?.items ?? []).map((r) => r.tocSalesDocId).filter(Boolean) as string[]
  )

  // Apenas faturas de venda (FT, FS, FR); sem rascunhos (0) nem anulados (4)
  const SALES_INVOICE_TYPES = new Set(['ft', 'fs', 'fr'])
  const tocOnly = (tocDocs ?? []).filter((d) => {
    if (importedIds.has(String(d.id))) return false
    const t = (d.document_type ?? '').toLowerCase()
    if (!SALES_INVOICE_TYPES.has(t)) return false
    const s = Number(d.status)
    if (s === 0 || s === 4) return false
    if (isOverdueFilter) {
      if (s !== 1 && s !== 2 && s !== 5) return false
      if (!d.due_date || new Date(d.due_date) >= new Date()) return false
    } else if (statusFilter) {
      if (statusFilter === 'OPEN' && s !== 1 && s !== 5) return false
      if (statusFilter === 'OPEN,PARTIAL' && s !== 1 && s !== 2 && s !== 5) return false
      if (statusFilter === 'PARTIAL' && s !== 2) return false
      if (statusFilter === 'SETTLED' && s !== 3) return false
      if (statusFilter === 'VOID') return false
    }
    if (dueDateFrom && d.due_date && d.due_date < dueDateFrom) return false
    if (dueDateTo && d.due_date && d.due_date > dueDateTo) return false
    if (docDateFrom && d.date && d.date < docDateFrom) return false
    if (docDateTo && d.date && d.date > docDateTo) return false
    return true
  })

  // Mapa NC → faturas-pai (para mostrar NCs dentro da fatura associada)
  const tocNcMap = useMemo(() => {
    const map = new Map<string, TocSalesDoc[]>()
    for (const d of tocDocs ?? []) {
      if ((d.document_type ?? '').toLowerCase() !== 'nc') continue
      const pids = Array.isArray(d.parent_documents_ids)
        ? (d.parent_documents_ids as unknown[])
        : d.parent_documents_ids != null ? [d.parent_documents_ids] : []
      for (const pid of pids) {
        const key = String(pid)
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(d)
      }
    }
    return map
  }, [tocDocs])

  const rows: Row[] = [
    ...(data?.items ?? []).filter((r) => !!r.tocSalesDocId).map((r) => ({ _src: 'local' as const, r })),
    ...tocOnly.map((d) => ({ _src: 'toc' as const, d })),
  ].sort((a, b) => {
    const dateA = a._src === 'local' ? a.r.documentDate : a.d.date
    const dateB = b._src === 'local' ? b.r.documentDate : b.d.date
    return new Date(dateB).getTime() - new Date(dateA).getTime()
  })

  // KPIs combinados: locais (endpoint /kpis) + TOConline ainda não importados
  // Docs TOConline liquidados (status=3) ficam visíveis na lista mas não contam nos KPIs
  const combinedKpis = useMemo(() => {
    if (!kpis) return null
    const now = new Date()
    const tocPending = (pendingToc => pendingToc.reduce((s, d) => s + Number(d.pending_total ?? d.gross_total ?? 0), 0))(tocOnly.filter(d => Number(d.status) !== 3))
    const tocOpenCount = tocOnly.filter(d => Number(d.status) !== 3).length
    const tocOverdue = tocOnly.filter((d) => Number(d.status) !== 3 && d.due_date && new Date(d.due_date) < now).length
    const totalOpen = kpis.countOpen + tocOpenCount
    const totalOverdue = kpis.countOverdue + tocOverdue
    return {
      totalPending: kpis.totalPending + tocPending,
      countOpen: totalOpen - totalOverdue,
      countOverdue: totalOverdue,
      settledThisMonth: kpis.settledThisMonth,
      aging: kpis.aging,
    }
  }, [kpis, tocOnly])

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Contas a Receber</h1>

      {combinedKpis && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard title="Total Pendente" value={formatCurrency(combinedKpis.totalPending)} icon={<ArrowDownToLine className="w-6 h-6 text-green-500" />} />
            <KpiCard title="Em aberto" value={String(combinedKpis.countOpen)} />
            <KpiCard
              title="Vencidas"
              value={String(combinedKpis.countOverdue)}
              className={combinedKpis.countOverdue > 0 ? 'border-red-200' : ''}
            />
            <KpiCard title="Recebido este mês" value={formatCurrency(combinedKpis.settledThisMonth)} />
          </div>
        </>
      )}

      <div>
        <div className="border-b border-gray-200 flex gap-0">
          <button
            onClick={() => setActiveTab('clientes')}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'clientes'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
          >
            Clientes
          </button>
          <button
            onClick={() => setActiveTab('outras')}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'outras'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
          >
            Outras Operações
          </button>
        </div>

        {activeTab === 'clientes' && (
          <div className="space-y-4 pt-5">
            <div className="flex justify-end">
              <button onClick={() => { setShowNew(true); setTocCreate(true) }} className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" />Nova Conta a Receber
              </button>
            </div>
            <div className="card">
              <div className="px-5 py-4 border-b border-gray-100 flex gap-3 items-center flex-wrap">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                  <input
                    className="input pl-8 text-sm py-1 w-44"
                    placeholder="Cliente ou referência..."
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
                  <option value="OPEN,PARTIAL">Pendente</option>
                  <option value="OPEN">Emitido / Em aberto</option>
                  <option value="PARTIAL">Parcialmente liquidado</option>
                  <option value="SETTLED">Liquidado</option>
                  <option value="VOID">Anulado</option>
                </select>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500 whitespace-nowrap">Data doc.</span>
                  <input type="date" className="input text-sm py-1 w-36" value={docDateFrom} onChange={(e) => { setDocDateFrom(e.target.value); setPage(1) }} title="De" />
                  <span className="text-gray-400 text-xs">–</span>
                  <input type="date" className="input text-sm py-1 w-36" value={docDateTo} onChange={(e) => { setDocDateTo(e.target.value); setPage(1) }} title="Até" />
                  {(docDateFrom || docDateTo) && (
                    <button onClick={() => { setDocDateFrom(''); setDocDateTo(''); setPage(1) }} className="text-gray-400 hover:text-gray-600">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500 whitespace-nowrap">Vencimento</span>
                  <input type="date" className="input text-sm py-1 w-36" value={dueDateFrom} onChange={(e) => { setDueDateFrom(e.target.value); setPage(1) }} title="De" />
                  <span className="text-gray-400 text-xs">–</span>
                  <input type="date" className="input text-sm py-1 w-36" value={dueDateTo} onChange={(e) => { setDueDateTo(e.target.value); setPage(1) }} title="Até" />
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
                <button
                  onClick={() => { setIsOverdueFilter((v) => !v); setPage(1) }}
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${isOverdueFilter ? 'bg-red-50 border-red-300 text-red-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                >
                  <AlertTriangle className="w-3.5 h-3.5" /> Vencidas
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
                        Cliente <SortIcon field="entityName" />
                      </th>
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
                        const r = row.r
                        return (
                          <tr key={`l-${r.id}`} className="hover:bg-gray-50 group">
                            <td className="px-5 py-3">
                              <div className="flex items-start gap-1.5">
                                <span className="w-4 flex-shrink-0" />
                                <div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-medium text-gray-900">{r.reference}</span>
                                    {r.recurrenceId && <span title="Recorrente"><Repeat2 className="w-3.5 h-3.5 text-primary-400 flex-shrink-0" /></span>}
                                  </div>
                                  <div className="text-xs text-gray-400">{formatDate(r.documentDate)}{r.description ? ` · ${r.description}` : ''}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-3 text-gray-700">{r.entityName}</td>
                            <td className="px-5 py-3 whitespace-nowrap">
                              {(() => {
                                const now = Date.now()
                                const due = new Date(r.dueDate).getTime()
                                const isActive = r.status !== 'SETTLED' && r.status !== 'VOID'
                                const overdue = isActive && due < now
                                const daysOverdue = overdue ? Math.floor((now - due) / 86400000) : 0
                                const daysUntil = isActive && !overdue ? Math.floor((due - now) / 86400000) : -1
                                return (
                                  <>
                                    <div className={overdue ? 'text-red-600 font-medium' : 'text-gray-500'}>{formatDate(r.dueDate)}</div>
                                    {overdue && daysOverdue > 0 && <div className="text-xs text-red-400">{daysOverdue} dias</div>}
                                    {!overdue && daysUntil >= 0 && daysUntil <= 14 && <div className="text-xs text-amber-500">{daysUntil === 0 ? 'hoje' : `${daysUntil}d`}</div>}
                                  </>
                                )
                              })()}
                            </td>
                            <td className="px-5 py-3 text-right text-gray-700">{formatCurrency(r.totalAmount)}</td>
                            <td className="px-5 py-3 text-right">
                              <div className="font-semibold text-green-700">{formatCurrency(r.pendingAmount)}</div>
                              {r.status === 'PARTIAL' && Number(r.receivedAmount) > 0 && (
                                <div className="text-xs text-gray-400">recebido: {formatCurrency(Number(r.receivedAmount))}</div>
                              )}
                            </td>
                            <td className="px-5 py-3"><Badge variant={statusVariant(r.status)}>{statusLabel(r.status)}</Badge></td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  title="Editar"
                                  onClick={() => {
                                    setEditId(r.id)
                                    setEditRow(r)
                                    setEditForm({
                                      categoryId: r.category?.id ?? '',
                                      entityName: r.entityName,
                                      reference: r.reference,
                                      documentDate: r.documentDate.slice(0, 10),
                                      dueDate: r.dueDate.slice(0, 10),
                                      totalAmount: String(r.totalAmount),
                                      description: r.description ?? '',
                                    })
                                  }}
                                  className="p-1 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                {(r.status === 'OPEN' || r.status === 'PARTIAL') && (
                                  <button
                                    title="Pagamento parcial"
                                    onClick={() => { setPartialId(r.id); setPartialAmount(''); setPartialMax(Number(r.pendingAmount)) }}
                                    className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                  >
                                    <DollarSign className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {(r.status === 'OPEN' || r.status === 'PARTIAL') && (
                                  <button
                                    title="Liquidar totalmente"
                                    onClick={() => settleReceivable.mutate(r.id)}
                                    className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                                  >
                                    <CheckCircle className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {r.status !== 'VOID' && r.status !== 'SETTLED' && (
                                  <button
                                    title="Anular"
                                    onClick={() => voidReceivable.mutate(r.id)}
                                    className="p-1 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                                  >
                                    <XCircle className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  title="Eliminar"
                                  onClick={() => setDeleteRow(r)}
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
                      const customer = d.customer_business_name || '—'
                      const date = d.date
                      const dueDate = d.due_date ?? date
                      const total = d.gross_total
                      const pending = d.pending_total
                      const key = `t-${docId}`
                      const isExpanded = expandedIds.has(key)
                      const receiptCount = Array.isArray(d.receipts_ids) ? (d.receipts_ids as unknown[]).length : 0
                      const ncs = tocNcMap.get(docId) ?? []
                      const expandCount = receiptCount + ncs.length
                      return (
                        <Fragment key={key}>
                          <tr className="hover:bg-green-50 bg-green-50/30 group">
                            <td className="px-5 py-3">
                              <div className="flex items-start gap-1.5">
                                {expandCount > 0 ? (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); toggleExpand(key) }}
                                    className="mt-0.5 flex-shrink-0 flex items-center gap-0.5 text-gray-400 hover:text-gray-700 transition-colors"
                                    title={isExpanded ? 'Ocultar detalhe' : 'Ver recibos e notas de crédito'}
                                  >
                                    {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                    <span className="text-xs font-semibold leading-none">{expandCount}</span>
                                  </button>
                                ) : (
                                  <span className="w-4 flex-shrink-0" />
                                )}
                                <div>
                                  <div className="font-medium text-gray-900">{ref}</div>
                                  <div className="text-xs text-gray-400">{date ? formatDate(date) : '—'}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-3 text-gray-700">{customer}</td>
                            <td className={`px-5 py-3 whitespace-nowrap ${dueDate && new Date(dueDate) < new Date() ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                              {dueDate ? formatDate(dueDate) : '—'}
                            </td>
                            <td className="px-5 py-3 text-right text-gray-700">{formatCurrency(total)}</td>
                            <td className="px-5 py-3 text-right font-semibold text-green-700">{formatCurrency(pending)}</td>
                            <td className="px-5 py-3"><Badge variant={tocStatusVariant(d.status)}>{tocStatusLabel(d.status)}</Badge></td>
                            <td className="px-3 py-3">
                              <button
                                onClick={() => { setImportTocDoc(d); setImportTocCatId('') }}
                                className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-xs text-green-700 bg-green-50 hover:bg-green-100 px-2 py-1 rounded-lg border border-green-200 transition-all whitespace-nowrap"
                                title="Importar para local"
                              >
                                <ArrowDownToLine className="w-3 h-3" />
                                Importar
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <>
                              {ncs.map((nc) => (
                                <tr key={`nc-${nc.id}`} className="bg-amber-50/40 border-b border-amber-100/80">
                                  <td className="pl-10 pr-3 py-2">
                                    <div className="flex items-center gap-2 text-xs">
                                      <span className="text-[10px] font-bold uppercase px-1 py-0.5 rounded bg-amber-100 text-amber-700 flex-shrink-0">NC</span>
                                      <div>
                                        <div className="text-gray-700 font-medium">{nc.document_no}</div>
                                        <div className="text-gray-400">{nc.date ? formatDate(nc.date) : '—'}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-5 py-2 text-xs text-gray-500">{customer}</td>
                                  <td className="px-5 py-2" />
                                  <td className="px-5 py-2 text-xs text-gray-400">{(nc.due_date as string | undefined) ? formatDate(nc.due_date as string) : '—'}</td>
                                  <td className="px-5 py-2 text-right text-xs text-amber-700 font-medium">−{formatCurrency(nc.gross_total)}</td>
                                  <td className="px-5 py-2" />
                                  <td className="px-5 py-2"><Badge variant="yellow">{tocStatusLabel(nc.status)}</Badge></td>
                                  <td className="px-3 py-2" />
                                </tr>
                              ))}
                              {receiptCount > 0 && (
                                <ReceiptSubRows
                                  clientId={selectedClientId!}
                                  tocDocId={docId}
                                  entityName={customer}
                                />
                              )}
                            </>
                          )}
                        </Fragment>
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
                            <td className="px-5 py-2 text-right text-green-700">{formatCurrency(combinedKpis.totalPending)}</td>
                            <td colSpan={1} />
                          </tr>
                        </tfoot>
                      )
                    }
                    // Com filtros: subtotal da página actual
                    const totalAmt = rows.reduce((s, row) => s + (row._src === 'local' ? Number(row.r.totalAmount) : Number(row.d.gross_total)), 0)
                    const pendingAmt = rows.reduce((s, row) => s + (row._src === 'local' ? Number(row.r.pendingAmount) : Number(row.d.pending_total)), 0)
                    return (
                      <tfoot>
                        <tr className="border-t-2 border-gray-200 bg-gray-50 text-xs font-semibold text-gray-600 uppercase">
                          <td colSpan={3} className="px-5 py-2">Subtotal — {rows.length} nesta pág. ({data?.total ?? 0} filtrados)</td>
                          <td className="px-5 py-2 text-right">{formatCurrency(totalAmt)}</td>
                          <td className="px-5 py-2 text-right text-green-700">{formatCurrency(pendingAmt)}</td>
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
          </div>
        )}

        {activeTab === 'outras' && (
          <div className="space-y-4 pt-1">
            <div className="flex justify-end">
              <button onClick={() => setShowNewOutras(true)} className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" />Nova Operação
              </button>
            </div>
            <div className="card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                      <th className="text-left px-5 py-3">Documento</th>
                      <th className="text-left px-5 py-3">Cliente</th>
                      <th onClick={() => toggleSort('dueDate')} className="text-left px-5 py-3 cursor-pointer hover:text-gray-700 select-none">Vencimento <SortIcon field="dueDate" /></th>
                      <th onClick={() => toggleSort('totalAmount')} className="text-right px-5 py-3 cursor-pointer hover:text-gray-700 select-none">Total <SortIcon field="totalAmount" /></th>
                      <th onClick={() => toggleSort('pendingAmount')} className="text-right px-5 py-3 cursor-pointer hover:text-gray-700 select-none">Pendente <SortIcon field="pendingAmount" /></th>
                      <th className="text-left px-5 py-3">Estado</th>
                      <th className="w-16 px-3 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {outrasRows.length === 0 ? (
                      <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-gray-400">Sem operações registadas. Usa o botão acima para registar a primeira.</td></tr>
                    ) : outrasRows.map((r) => {
                      const now = Date.now()
                      const due = new Date(r.dueDate).getTime()
                      const isActive = r.status !== 'SETTLED' && r.status !== 'VOID'
                      const overdue = isActive && due < now
                      const daysOverdue = overdue ? Math.floor((now - due) / 86400000) : 0
                      const daysUntil = isActive && !overdue ? Math.floor((due - now) / 86400000) : -1
                      return (
                        <tr key={`o-${r.id}`} className="hover:bg-gray-50 group">
                          <td className="px-5 py-3">
                            <div className="flex items-start gap-1.5">
                              <span className="w-4 flex-shrink-0" />
                              <div>
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium text-gray-900">{r.reference}</span>
                                </div>
                                <div className="text-xs text-gray-400">{formatDate(r.documentDate)}{r.description ? ` · ${r.description}` : ''}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-gray-700">{r.entityName}</td>
                          <td className="px-5 py-3 whitespace-nowrap">
                            <div className={overdue ? 'text-red-600 font-medium' : 'text-gray-500'}>{formatDate(r.dueDate)}</div>
                            {overdue && daysOverdue > 0 && <div className="text-xs text-red-400">{daysOverdue} dias</div>}
                            {!overdue && daysUntil >= 0 && daysUntil <= 14 && <div className="text-xs text-amber-500">{daysUntil === 0 ? 'hoje' : `${daysUntil}d`}</div>}
                          </td>
                          <td className="px-5 py-3 text-right text-gray-700">{formatCurrency(r.totalAmount)}</td>
                          <td className="px-5 py-3 text-right">
                            <div className="font-semibold text-green-700">{formatCurrency(r.pendingAmount)}</div>
                            {r.status === 'PARTIAL' && Number(r.receivedAmount) > 0 && (
                              <div className="text-xs text-gray-400">recebido: {formatCurrency(Number(r.receivedAmount))}</div>
                            )}
                          </td>
                          <td className="px-5 py-3"><Badge variant={statusVariant(r.status)}>{statusLabel(r.status)}</Badge></td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                title="Editar"
                                onClick={() => { setEditId(r.id); setEditRow(r); setEditForm({ categoryId: r.category?.id ?? '', entityName: r.entityName, reference: r.reference, documentDate: r.documentDate.slice(0, 10), dueDate: r.dueDate.slice(0, 10), totalAmount: String(r.totalAmount), description: r.description ?? '' }) }}
                                className="p-1 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              {(r.status === 'OPEN' || r.status === 'PARTIAL') && (
                                <button title="Pagamento parcial" onClick={() => { setPartialId(r.id); setPartialAmount(''); setPartialMax(Number(r.pendingAmount)) }} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                                  <DollarSign className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {r.status !== 'VOID' && r.status !== 'SETTLED' && (
                                <button title="Anular" onClick={() => voidReceivable.mutate(r.id)} className="p-1 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors">
                                  <XCircle className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button title="Eliminar" onClick={() => setDeleteRow(r)} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <Modal open={!!partialId} onClose={() => { setPartialId(null); setPartialAmount('') }} title="Registar Recebimento Parcial">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Valor pendente: <span className="font-semibold text-gray-900">{formatCurrency(partialMax)}</span>
          </p>
          <div>
            <label className="label">Valor recebido (€)</label>
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

      <Modal open={!!editId} onClose={() => { setEditId(null); setEditRow(null) }} title="Editar Conta a Receber" size="lg">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Categoria</label>
            <select className="input" value={editForm.categoryId} onChange={(e) => setEditForm({ ...editForm, categoryId: e.target.value })}>
              <option value="">Selecionar...</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Cliente / Entidade</label>
            <input className="input" value={editForm.entityName} onChange={(e) => setEditForm({ ...editForm, entityName: e.target.value })} />
          </div>
          <div>
            <label className="label">Nº Documento</label>
            <input className="input" value={editForm.reference} onChange={(e) => setEditForm({ ...editForm, reference: e.target.value })} />
          </div>
          <div>
            <label className="label">
              Valor (€)
              {editRow && editRow.status !== 'OPEN' && (
                <span className="ml-1 text-xs text-gray-400 font-normal">(só editável em aberto)</span>
              )}
            </label>
            <input
              type="number"
              className="input"
              value={editForm.totalAmount}
              onChange={(e) => setEditForm({ ...editForm, totalAmount: e.target.value })}
              disabled={editRow?.status !== 'OPEN'}
            />
          </div>
          <div>
            <label className="label">Data Documento</label>
            <input type="date" className="input" value={editForm.documentDate} onChange={(e) => setEditForm({ ...editForm, documentDate: e.target.value })} />
          </div>
          <div>
            <label className="label">Data Vencimento</label>
            <input type="date" className="input" value={editForm.dueDate} onChange={(e) => setEditForm({ ...editForm, dueDate: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="label">Descrição</label>
            <input className="input" value={editForm.description} placeholder="(opcional)" onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
          </div>
        </div>
        {updateReceivable.isError && (
          <p className="mt-3 text-sm text-red-600 bg-white border border-red-200 rounded-lg px-3 py-2">{(updateReceivable.error as Error).message}</p>
        )}
        <div className="flex gap-3 mt-6">
          <button onClick={() => { setEditId(null); setEditRow(null) }} className="btn-secondary flex-1">Cancelar</button>
          <button
            onClick={() => {
              if (!editId) return
              const body: Record<string, unknown> = {
                categoryId: editForm.categoryId || undefined,
                entityName: editForm.entityName,
                reference: editForm.reference || undefined,
                documentDate: editForm.documentDate || undefined,
                dueDate: editForm.dueDate || undefined,
                description: editForm.description || undefined,
              }
              if (editRow?.status === 'OPEN' && editForm.totalAmount)
                body.totalAmount = parseFloat(editForm.totalAmount)
              updateReceivable.mutate({ id: editId, data: body })
            }}
            className="btn-primary flex-1"
            disabled={updateReceivable.isPending || !editForm.entityName || !editForm.dueDate}
          >
            {updateReceivable.isPending ? 'A guardar...' : 'Guardar'}
          </button>
        </div>
      </Modal>

      <Modal open={!!deleteRow} onClose={() => setDeleteRow(null)} title="Eliminar Conta a Receber">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            O documento <span className="font-semibold text-gray-900">{deleteRow?.reference}</span> de{' '}
            <span className="font-semibold text-gray-900">{deleteRow?.entityName}</span> será permanentemente eliminado. Esta acção não pode ser revertida.
          </p>
          {deleteReceivable.isError && (
            <p className="text-sm text-red-600 bg-white border border-red-200 rounded-lg px-3 py-2">{(deleteReceivable.error as Error).message}</p>
          )}
          <div className="flex gap-3 pt-2">
            <button onClick={() => setDeleteRow(null)} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={() => deleteRow && deleteReceivable.mutate(deleteRow.id)}
              className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
              disabled={deleteReceivable.isPending}
            >
              {deleteReceivable.isPending ? 'A eliminar...' : 'Eliminar'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!importTocDoc} onClose={() => setImportTocDoc(null)} title="Importar do TOConline">
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-3 text-sm space-y-1.5">
            <div className="flex justify-between"><span className="text-gray-500">Documento</span><span className="font-medium">{importTocDoc?.document_no}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Cliente</span><span>{importTocDoc?.customer_business_name}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Vencimento</span><span>{importTocDoc?.due_date ? formatDate(importTocDoc.due_date) : '—'}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Valor</span><span className="font-semibold text-green-700">{formatCurrency(importTocDoc?.gross_total ?? 0)}</span></div>
          </div>
          <div>
            <label className="label">Categoria local <span className="text-gray-400 font-normal">(opcional)</span></label>
            <select className="input" value={importTocCatId} onChange={(e) => setImportTocCatId(e.target.value)} autoFocus>
              <option value="">Sem categoria</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setImportTocDoc(null)} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={() => importFromToc.mutate()}
              className="btn-primary flex-1"
              disabled={importFromToc.isPending}
            >
              {importFromToc.isPending ? 'A importar...' : 'Importar'}
            </button>
          </div>
          {importFromToc.isError && <p className="text-sm text-red-600">{(importFromToc.error as Error).message}</p>}
        </div>
      </Modal>

      <Modal open={showNew} onClose={() => { setShowNew(false); setTocCreate(false); setTocDocType('FT'); setTocLines([{ ...emptyTocLine }]); setTaxExemptionCode('M07'); setVatIncludedPrices(false); setRetentionPct(''); setSelectedTocCustomer(null); setTocCustomerSearch('') }} title="Nova Conta a Receber" size="lg">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Categoria</label>
            <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
              <option value="">Selecionar...</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Cliente / Entidade</label>
            <div className="relative" ref={customerInputRef}>
              {selectedTocCustomer ? (
                <div className="input flex items-center gap-2 bg-gray-50 cursor-default">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">{String(selectedTocCustomer.business_name ?? '')}</div>
                    {selectedTocCustomer.tax_identification_number && (
                      <div className="text-xs text-gray-400 leading-tight">NIF {String(selectedTocCustomer.tax_identification_number)}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedTocCustomer(null); setTocCustomerSearch(''); setForm({ ...form, entityName: '', entityNif: '' }) }}
                    className="flex-shrink-0 p-0.5 text-gray-400 hover:text-gray-700 rounded transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                  <input
                    className="input pl-8"
                    value={tocCustomerSearch}
                    onChange={(e) => { setTocCustomerSearch(e.target.value); setShowCustomerDropdown(true) }}
                    onFocus={() => setShowCustomerDropdown(true)}
                    autoComplete="off"
                    placeholder="Pesquisar cliente do TOConline..."
                  />
                </>
              )}
              {showCustomerDropdown && !selectedTocCustomer && (
                <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
                  {filteredCustomers.length > 0 ? filteredCustomers.map((c) => (
                    <button
                      key={String(c.id)}
                      type="button"
                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex flex-col transition-colors"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setSelectedTocCustomer(c)
                        setForm({ ...form, entityName: String(c.business_name ?? ''), entityNif: String(c.tax_identification_number ?? '') })
                        setTocCustomerSearch('')
                        setShowCustomerDropdown(false)
                      }}
                    >
                      <span className="font-medium text-gray-800 truncate">{String(c.business_name ?? '')}</span>
                      {c.tax_identification_number && (
                        <span className="text-xs text-gray-400">NIF {String(c.tax_identification_number)}</span>
                      )}
                    </button>
                  )) : (
                    <div className="px-4 py-3 text-sm text-gray-400">
                      {tocCustomers.length === 0 ? 'Sem clientes no TOConline' : 'Nenhum cliente encontrado'}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="label">NIF Cliente <span className="text-gray-400 font-normal">(opcional)</span></label>
            <input className="input" value={form.entityNif} onChange={(e) => setForm({ ...form, entityNif: e.target.value })} placeholder="123456789" />
          </div>
          <div>
            <label className="label">
              Nº Documento
              {tocCreate && <span className="ml-1 text-xs text-gray-400 font-normal">(preenchido pelo TOConline)</span>}
            </label>
            <input className="input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder={tocCreate ? 'automático' : 'FT2024/001'} disabled={tocCreate} />
          </div>
          <div>
            <label className="label">
              Valor (€)
              {tocCreate && tocLinesTotal !== null && <span className="ml-1 text-xs text-gray-400 font-normal">estimado: {tocLinesTotal.toFixed(2)}</span>}
            </label>
            <input type="number" className="input" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} disabled={tocCreate} placeholder={tocCreate ? 'calculado das linhas' : ''} />
          </div>
          <div><label className="label">Data Documento <span className="text-red-500">*</span></label><input type="date" className="input" value={form.documentDate} onChange={(e) => setForm({ ...form, documentDate: e.target.value })} /></div>
          <div><label className="label">Data Vencimento <span className="text-red-500">*</span></label><input type="date" className="input" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></div>
          <div className="col-span-2"><label className="label">Descrição / Notas</label><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        </div>

        <div className="mt-4 border-t border-green-100 pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded-full">TOConline</span>
            <div>
              <label className="label mb-0 inline">Tipo de documento</label>
              <select className="input w-auto ml-2" value={tocDocType} onChange={(e) => setTocDocType(e.target.value)}>
                <option value="FT">FT — Fatura</option>
                <option value="FS">FS — Fatura Simplificada</option>
                <option value="FR">FR — Fatura-Recibo</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="label mb-0">Linhas do documento</label>
              <button
                type="button"
                onClick={() => setTocLines((prev) => [...prev, { ...emptyTocLine }])}
                className="text-xs text-green-600 hover:text-green-800 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Adicionar linha
              </button>
            </div>
            <div className="space-y-2">
              {tocLines.map((line, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-start p-2 bg-green-50/40 rounded-lg border border-green-100">
                  <div className="col-span-2">
                    {i === 0 && <div className="text-[10px] text-gray-400 uppercase mb-1">Tipo</div>}
                    <select
                      className="input text-sm py-1"
                      value={line.item_type}
                      onChange={(e) => setTocLines((prev) => prev.map((l, idx) => idx === i ? { ...l, item_type: e.target.value } : l))}
                    >
                      <option value="Service">Serviço</option>
                      <option value="Product">Produto</option>
                    </select>
                  </div>
                  <div className="col-span-4">
                    {i === 0 && <div className="text-[10px] text-gray-400 uppercase mb-1">Descrição</div>}
                    <input
                      className="input text-sm py-1"
                      placeholder="Descrição"
                      value={line.description}
                      onChange={(e) => setTocLines((prev) => prev.map((l, idx) => idx === i ? { ...l, description: e.target.value } : l))}
                    />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <div className="text-[10px] text-gray-400 uppercase mb-1">Qtd.</div>}
                    <input
                      type="number"
                      className="input text-sm py-1"
                      min="0.001"
                      step="1"
                      value={line.quantity}
                      onChange={(e) => setTocLines((prev) => prev.map((l, idx) => idx === i ? { ...l, quantity: e.target.value } : l))}
                    />
                  </div>
                  <div className="col-span-2">
                    {i === 0 && <div className="text-[10px] text-gray-400 uppercase mb-1">Preço unit.</div>}
                    <input
                      type="number"
                      className="input text-sm py-1"
                      min="0"
                      step="0.01"
                      placeholder="0.00"
                      value={line.unit_price}
                      onChange={(e) => setTocLines((prev) => prev.map((l, idx) => idx === i ? { ...l, unit_price: e.target.value } : l))}
                    />
                  </div>
                  <div className="col-span-1">
                    {i === 0 && <div className="text-[10px] text-gray-400 uppercase mb-1">IVA</div>}
                    <select
                      className="input text-sm py-1"
                      value={line.tax_code}
                      onChange={(e) => setTocLines((prev) => prev.map((l, idx) => idx === i ? { ...l, tax_code: e.target.value } : l))}
                    >
                      <option value="NOR">NOR 23%</option>
                      <option value="INT">INT 13%</option>
                      <option value="RED">RED 6%</option>
                      <option value="ISE">ISE 0%</option>
                    </select>
                  </div>
                  <div className="col-span-1 flex items-end justify-center pb-0.5">
                    {i === 0 && <div className="text-[10px] text-transparent uppercase mb-1">Del</div>}
                    {tocLines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setTocLines((prev) => prev.filter((_, idx) => idx !== i))}
                        className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {(tocLinesTotal ?? 0) > 0 && (
              <div className="mt-2 text-right text-sm text-green-700 font-semibold">
                Total c/IVA: {(tocLinesTotal ?? 0).toFixed(2)} €
              </div>
            )}
            {hasIseLines && (
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg space-y-2">
                <p className="text-xs text-amber-700 font-medium">Linha isenta de IVA — motivo de isenção obrigatório</p>
                <select
                  className="input text-sm py-1 w-full"
                  value={taxExemptionCode}
                  onChange={(e) => setTaxExemptionCode(e.target.value)}
                >
                  <option value="M07">M07 — Artigo 9.º do CIVA</option>
                  <option value="M08">M08 — Artigo 14.º do CIVA</option>
                  <option value="M09">M09 — Artigo 15.º do CIVA</option>
                  <option value="M10">M10 — Regime especial de isenção (Art. 53.º)</option>
                  <option value="M11">M11 — Regime especial dos tabaceiros</option>
                  <option value="M12">M12 — Regime de IVA de caixa</option>
                  <option value="M16">M16 — Artigo 14.º do RITI</option>
                  <option value="M19">M19 — Outras isenções</option>
                  <option value="M20">M20 — IVA — regime forfetário</option>
                  <option value="M99">M99 — Não sujeito; não tributado</option>
                </select>
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-4 items-start">
              <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="rounded border-gray-300 text-green-600"
                  checked={vatIncludedPrices}
                  onChange={(e) => setVatIncludedPrices(e.target.checked)}
                />
                Preços com IVA incluído
              </label>
              <div className="flex items-center gap-2">
                <label className="text-sm text-gray-700 whitespace-nowrap">Retenção na fonte (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  className="input text-sm py-1 w-20"
                  placeholder="ex: 25"
                  value={retentionPct}
                  onChange={(e) => setRetentionPct(e.target.value)}
                />
              </div>
            </div>
          </div>
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

        {create.isError && (
          <p className="mt-3 text-sm text-red-600 bg-white border border-red-200 rounded-lg px-3 py-2">{(create.error as Error).message}</p>
        )}
        <div className="flex gap-3 mt-6">
          <button onClick={() => { setShowNew(false); setRecForm(emptyRecurrence); setTocCreate(false); setTocDocType('FT'); setTocLines([{ ...emptyTocLine }]); setTaxExemptionCode('M07'); setVatIncludedPrices(false); setRetentionPct(''); setSelectedTocCustomer(null); setTocCustomerSearch('') }} className="btn-secondary flex-1">Cancelar</button>
          <button
            onClick={() => create.mutate()}
            className="btn-primary flex-1"
            disabled={create.isPending || !form.entityName || !form.documentDate || !form.dueDate || !tocLines.some((l) => l.description && l.unit_price)}
          >
            {create.isPending ? 'A guardar...' : (recForm.isRecurrent ? 'Criar Recorrente' : 'Criar')}
          </button>
        </div>
      </Modal>

      <Modal open={showNewOutras} onClose={() => { setShowNewOutras(false); setOutrasForm(emptyOutrasForm); setOutrasContact(null); setOutrasContactSearch('') }} title="Nova Operação" size="lg">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Categoria</label>
            <select className="input" value={outrasForm.categoryId} onChange={(e) => setOutrasForm({ ...outrasForm, categoryId: e.target.value })}>
              <option value="">Selecionar...</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="label">Entidade / Fonte</label>
            <div className="relative">
              {outrasContact ? (
                <div className="input flex items-center gap-2 bg-gray-50 cursor-default">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">{outrasContact.business_name as string}</div>
                    {outrasContact.tax_identification_number && <div className="text-xs text-gray-400">NIF {outrasContact.tax_identification_number as string}</div>}
                  </div>
                  <button onClick={() => { setOutrasContact(null); setOutrasContactSearch(''); setOutrasForm({ ...outrasForm, entityName: '', entityNif: '' }) }} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                </div>
              ) : (
                <>
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                  <input
                    className="input pl-8"
                    placeholder="Pesquisar cliente..."
                    value={outrasContactSearch}
                    onChange={(e) => setOutrasContactSearch(e.target.value)}
                    onFocus={() => setShowOutrasContactDropdown(true)}
                    onBlur={() => setTimeout(() => setShowOutrasContactDropdown(false), 150)}
                  />
                </>
              )}
              {showOutrasContactDropdown && !outrasContact && (
                <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {tocCustomers.filter(c => !outrasContactSearch || (c.business_name ?? '').toLowerCase().includes(outrasContactSearch.toLowerCase()) || (c.tax_identification_number ?? '').includes(outrasContactSearch)).slice(0, 10).length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-400">
                      {tocCustomers.length === 0 ? 'Sem clientes disponíveis' : 'Nenhum cliente encontrado'}
                    </div>
                  ) : tocCustomers.filter(c => !outrasContactSearch || (c.business_name ?? '').toLowerCase().includes(outrasContactSearch.toLowerCase()) || (c.tax_identification_number ?? '').includes(outrasContactSearch)).slice(0, 10).map(c => (
                    <button
                      key={c.id}
                      className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex flex-col gap-0.5"
                      onMouseDown={(e) => { e.preventDefault(); setOutrasContact(c); setOutrasForm({ ...outrasForm, entityName: c.business_name ?? '', entityNif: c.tax_identification_number ?? '' }); setOutrasContactSearch(''); setShowOutrasContactDropdown(false) }}
                    >
                      <span className="font-medium text-gray-800 text-sm">{c.business_name}</span>
                      {c.tax_identification_number && <span className="text-xs text-gray-400">NIF {c.tax_identification_number}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {outrasContact && (outrasContact.phone || outrasContact.mobile) && (
            <div className="col-span-2 grid grid-cols-2 gap-4">
              {outrasContact.phone && (
                <div>
                  <label className="label">Telefone</label>
                  <input className="input bg-gray-50" value={outrasContact.phone} readOnly inputMode="numeric" maxLength={9} />
                </div>
              )}
              {outrasContact.mobile && (
                <div>
                  <label className="label">Telemóvel</label>
                  <input className="input bg-gray-50" value={outrasContact.mobile} readOnly inputMode="numeric" maxLength={9} />
                </div>
              )}
            </div>
          )}
          <div>
            <label className="label">NIF <span className="text-red-500">*</span></label>
            <input
              className="input"
              value={outrasForm.entityNif}
              onChange={(e) => { if (/^\d{0,9}$/.test(e.target.value)) setOutrasForm({ ...outrasForm, entityNif: e.target.value }) }}
              placeholder="123456789"
              maxLength={9}
              inputMode="numeric"
              readOnly={!!outrasContact}
            />
          </div>
          <div>
            <label className="label">Referência <span className="text-red-500">*</span></label>
            <input className="input" value={outrasForm.reference} onChange={(e) => setOutrasForm({ ...outrasForm, reference: e.target.value })} placeholder="REF001" />
          </div>
          <div>
            <label className="label">Valor (€)</label>
            <input type="number" className="input" value={outrasForm.totalAmount} onChange={(e) => setOutrasForm({ ...outrasForm, totalAmount: e.target.value })} placeholder="0.00" />
          </div>
          <div>
            <label className="label">Data Documento <span className="text-red-500">*</span></label>
            <input type="date" className="input" value={outrasForm.documentDate} onChange={(e) => setOutrasForm({ ...outrasForm, documentDate: e.target.value })} />
          </div>
          <div>
            <label className="label">Data Vencimento <span className="text-red-500">*</span></label>
            <input type="date" className="input" value={outrasForm.dueDate} onChange={(e) => setOutrasForm({ ...outrasForm, dueDate: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="label">Descrição <span className="text-gray-400 font-normal">(opcional)</span></label>
            <input className="input" value={outrasForm.description} onChange={(e) => setOutrasForm({ ...outrasForm, description: e.target.value })} placeholder="Notas sobre a operação" />
          </div>
        </div>
        {createOutras.isError && (
          <p className="mt-3 text-sm text-red-600 bg-white border border-red-200 rounded-lg px-3 py-2">{(createOutras.error as Error).message}</p>
        )}
        <div className="flex gap-3 mt-6">
          <button onClick={() => { setShowNewOutras(false); setOutrasForm(emptyOutrasForm); setOutrasContact(null); setOutrasContactSearch('') }} className="btn-secondary flex-1">Cancelar</button>
          <button
            onClick={() => createOutras.mutate()}
            className="btn-primary flex-1"
            disabled={createOutras.isPending || !outrasForm.entityName || outrasForm.entityNif.length !== 9 || !outrasForm.reference || !outrasForm.totalAmount || !outrasForm.documentDate || !outrasForm.dueDate}
          >
            {createOutras.isPending ? 'A guardar...' : 'Criar'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
