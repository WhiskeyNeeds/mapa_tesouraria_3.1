import { Fragment, useState, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate, isWeekend, refSortKey, shiftToWorkday, statusLabel, statusVariant, tocStatusLabel } from '@/lib/utils'
import { distributeAmount, distributePct, convertEurToPct, convertPctToEur, formatInstallmentValue } from '@/lib/installmentMath'
import { useStickyHScrollbar } from '@/lib/useStickyHScrollbar'
import KpiCard from '@/components/ui/KpiCard'
import Badge from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import TocSyncStatus from '@/components/ui/TocSyncStatus'
import DayOfMonthRangePicker from '@/components/ui/DayOfMonthRangePicker'
import DateRangePopover from '@/components/ui/DateRangePopover'
import WorkdayDatePicker from '@/components/ui/WorkdayDatePicker'
import InlineCategoryPicker from '@/components/ui/InlineCategoryPicker'
import InlineBudgetPicker from '@/components/ui/InlineBudgetPicker'
import { DocLabels } from '@/components/treasury/DocLabels'
import { Plus, ArrowUpFromLine, RefreshCw, Trash2, XCircle, Search, X, CheckCircle, Download, ArrowUpDown, ArrowUp, ArrowDown, Pencil, DollarSign, Repeat2, ChevronRight, ChevronDown, ChevronLeft, Clock, Scissors, CreditCard, Eye } from 'lucide-react'
import FollowupsPanel from '@/components/followups/FollowupsPanel'
import InvoiceAttachmentsButton from '@/components/followups/InvoiceAttachmentsButton'

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

interface TocPayment {
  id: number | string
  document_no: string
  date: string
  gross_total: number
  net_total?: number
  _paid_for_doc?: number | null
  [key: string]: unknown
}

interface PaymentLine {
  payable_id: number | string
  paid_value: number
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
  _doc_external_reference?: string
  [key: string]: unknown
}

interface Payable {
  id: string; reference: string; entityName: string; documentDate: string; dueDate: string
  totalAmount: number; pendingAmount: number; paidAmount: number; status: string; origin: string
  description?: string | null
  tocPurchasesDocId?: string
  tocSupplierId?: string | null
  recurrenceId?: string | null
  promisedPaymentDate?: string | null
  parentId?: string | null
  category?: { id: string; name: string; color: string } | null
  budget?: { id: string; name: string; color?: string | null } | null
  children?: Array<{ id: string; reference: string; dueDate: string; totalAmount: number; pendingAmount: number; paidAmount: number; status: string; entityName: string; promisedPaymentDate?: string | null; recurrenceId?: string | null }>
  _src?: 'local' | 'toc'
  _tocRaw?: TocPurchaseDoc | null
  _statusToc?: string | null
  _statusDiffersFromToc?: boolean
}
interface Category { id: string; name: string; type: string; color?: string | null }
interface BudgetCategory { id: string; name: string; type: 'REVENUE' | 'EXPENSE'; color: string | null; isArchived: boolean }
interface Budget { id: string; name: string; type: 'REVENUE' | 'EXPENSE'; status: 'ACTIVE' | 'ARCHIVED'; totalAmount: number; startDate: string; endDate: string; color?: string | null }
interface TocSupplier { id: string | number; business_name?: string; tax_registration_number?: string;[key: string]: unknown }

const emptyForm = {
  categoryId: '', entityName: '', entityNif: '', reference: '', description: '',
  dueDate: '', totalAmount: '', currency: 'EUR', budgetId: '', budgetCategoryId: '',
}
const emptyRecurrence = {
  isRecurrent: false,
  frequency: 'MONTHLY' as 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL',
  dayOfMonth: 1,
  daysOfWeek: [1] as number[],
  cycleStartDate: '',
  cycleEndDate: '',
  endType: 'none' as 'none' | 'date' | 'occurrences',
  endDate: '',
  occurrences: '',
}
const emptyOutrasForm = {
  categoryId: '', entityName: '', entityNif: '', reference: '', description: '',
  dueDate: '', totalAmount: '', budgetId: '', budgetCategoryId: '',
}


type Row = { _src: 'local'; p: Payable } | { _src: 'toc'; d: TocPurchaseDoc; item: Payable }

function PaymentDetailModal({
  open, onClose, payment, clientId, entityName, onInvoiceClick,
}: {
  open: boolean
  onClose: () => void
  payment: TocPayment | null
  clientId: string
  entityName: string
  onInvoiceClick?: (payableId: string | number) => void
}) {
  const { data: lines = [], isLoading } = useQuery<PaymentLine[]>({
    queryKey: ['toc-payment-lines', clientId, String(payment?.id ?? '')],
    queryFn: () => api.get(`/toconline/${clientId}/purchase-payments/${payment!.id}/lines`),
    enabled: open && !!payment,
  })

  if (!open || !payment) return null

  const series = payment.document_no?.match(/[A-Z]+\s+(\d+)\//)?.[1] ?? ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-5xl animate-scale-in overflow-hidden">
        <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900 truncate pr-4">
            {payment.document_no} - {entityName}
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
            <div className="text-xs text-gray-400 mb-0.5">Data de pagamento</div>
            <div className="text-sm font-medium text-gray-700">{formatDate(payment.date)}</div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-400 mb-0.5">Série de Pagamento</div>
            <div className="text-sm font-medium text-gray-700">{series || '—'}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400 mb-0.5">Total pago</div>
            <div className="text-xl font-bold text-gray-800">{formatCurrency(payment.gross_total)}</div>
          </div>
        </div>

        <div className="px-6 py-4 max-h-[calc(100vh-20rem)] overflow-y-auto">
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
                    <th className="px-3 py-2 text-left font-medium">Vossa referência</th>
                    <th className="px-3 py-2 text-right font-medium">Valor total</th>
                    <th className="px-3 py-2 text-right font-medium">Valor pendente</th>
                    <th className="px-3 py-2 text-right font-medium">Valor retido</th>
                    <th className="px-3 py-2 text-right font-medium">% desc. financ.</th>
                    <th className="px-3 py-2 text-right font-medium">Valor desconto</th>
                    <th className="px-3 py-2 text-right font-medium">Valor pago</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => {
                    const retentionValue = Number(line.retention_total ?? 0)
                    const discountPct = Number(line.settlement_percentage ?? 0)
                    const discountValue = Number(line.settlement_amount ?? 0)
                    const canNavigate = !!onInvoiceClick && line.payable_id != null
                    return (
                      <tr
                        key={i}
                        className={`${i % 2 === 0 ? 'bg-slate-50/60' : 'bg-white'} ${canNavigate ? 'cursor-pointer hover:bg-primary-50' : ''}`}
                        onClick={canNavigate ? () => onInvoiceClick!(line.payable_id as string | number) : undefined}
                      >
                        <td className="px-3 py-2 border-b border-gray-100">
                          <div className="font-medium text-gray-700">{line.document_no ?? String(line.payable_id)}</div>
                          {line._doc_date && <div className="text-gray-400">{formatDate(line._doc_date)}</div>}
                        </td>
                        <td className="px-3 py-2 border-b border-gray-100 text-gray-500">
                          {line._doc_external_reference || '—'}
                        </td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">
                          {line._doc_gross_total != null ? formatCurrency(line._doc_gross_total) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">
                          {line._doc_pending_total != null ? formatCurrency(line._doc_pending_total) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">{formatCurrency(retentionValue)}</td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">{discountPct} %</td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">{formatCurrency(discountValue)}</td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 font-semibold text-gray-700">{formatCurrency(line.paid_value)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

function PaymentSubRows({ clientId, tocDocId, entityName, onPaymentClick }: { clientId: string; tocDocId: string; entityName: string; onPaymentClick: (pm: TocPayment) => void }) {
  const { data: payments = [], isLoading } = useQuery<TocPayment[]>({
    queryKey: ['toc-purchase-payments', clientId, tocDocId],
    queryFn: () => api.get(`/toconline/${clientId}/purchases/${tocDocId}/payments`),
  })

  if (isLoading) {
    return (
      <tr>
        <td colSpan={12} className="pl-14 py-2 text-xs text-gray-400 bg-gray-50/60 border-b border-gray-100">
          <RefreshCw className="inline w-3 h-3 animate-spin mr-1.5" />A carregar pagamentos...
        </td>
      </tr>
    )
  }

  if (!payments.length) {
    return (
      <tr>
        <td colSpan={12} className="pl-14 py-2 text-xs text-gray-400 bg-gray-50/60 border-b border-gray-100">
          Sem pagamentos associados
        </td>
      </tr>
    )
  }

  return (
    <>
      {payments.map((pm) => (
        <tr
          key={String(pm.id)}
          className="bg-gray-50/60 border-b border-gray-100/80 cursor-pointer hover:bg-red-50/40"
          onClick={() => onPaymentClick(pm)}
        >
          <td className="px-3 py-2" />
          <td className="px-2 py-2" />
          <td className="pl-2 pr-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              <ChevronRight className="w-3 h-3 text-teal-400 flex-shrink-0" />
              <span className="text-gray-700 font-medium">{pm.document_no}</span>
            </div>
          </td>
          <td className="px-3 py-2 text-xs text-gray-500">{entityName}</td>
          <td className="px-3 py-2" />
          <td className="px-3 py-2 text-xs text-gray-500">{pm.date ? formatDate(pm.date) : '—'}</td>
          <td className="px-3 py-2" />
          <td className="px-3 py-2 text-right text-xs text-gray-600 font-medium">−{formatCurrency(pm.gross_total)}</td>
          <td className="px-3 py-2" />
          <td className="px-3 py-2" />
          <td className="px-3 py-2" />
          <td className="px-3 py-2" />
        </tr>
      ))}
    </>
  )
}

export default function PayablesPage() {
  const { selectedClientId, isTocEnabled } = useAuth()
  const navigate = useNavigate()
  // Barra de scroll horizontal fixa ao fundo da janela (tabelas Fornecedores/Outras
  // são mutuamente exclusivas → partilham uma instância).
  const hScroll = useStickyHScrollbar<HTMLDivElement>()
  const qc = useQueryClient()
  const toast = useToast()
  // Centralised guard for every <input type="date"> on this page: rejects weekend
  // selections (treasury operations only land on working days) and surfaces a toast.
  const pickWorkday = (next: string, fallback: string): string => {
    if (next && isWeekend(next)) {
      toast.error('Apenas dias úteis (segunda a sexta) são permitidos')
      return fallback
    }
    return next
  }
  const [statusFilter, setStatusFilter] = useState('OPEN,PARTIAL')
  const [entitySearch, setEntitySearch] = useState('')
  const [dueDateFrom, setDueDateFrom] = useState('')
  const [dueDateTo, setDueDateTo] = useState('')
  const [docDateFrom, setDocDateFrom] = useState('')
  const [docDateTo, setDocDateTo] = useState('')
  const [paymentDateFrom, setPaymentDateFrom] = useState('')
  const [paymentDateTo, setPaymentDateTo] = useState('')
  const [sortBy, setSortBy] = useState<'dueDate' | 'totalAmount' | 'pendingAmount' | 'entityName' | 'reference' | 'promisedPaymentDate' | 'status'>('promisedPaymentDate')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [recForm, setRecForm] = useState(emptyRecurrence)
  const [isOverdueFilter, setIsOverdueFilter] = useState(false)
  const [pastDeadlineFilter, setPastDeadlineFilter] = useState(false)
  const [uncategorizedFilter, setUncategorizedFilter] = useState(false)
  const [unbudgetedFilter, setUnbudgetedFilter] = useState(false)
  const [activeCard, setActiveCard] = useState<'uncategorized' | 'unbudgeted' | 'pending' | 'overdue' | 'thisWeek' | 'pastDeadline' | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editRow, setEditRow] = useState<Payable | null>(null)
  const [editForm, setEditForm] = useState({ categoryId: '', entityName: '', reference: '', documentDate: '', dueDate: '', totalAmount: '', description: '' })
  const [deleteRow, setDeleteRow] = useState<Payable | null>(null)
  const [partialId, setPartialId] = useState<string | null>(null)
  const [partialAmount, setPartialAmount] = useState('')
  const [partialMax, setPartialMax] = useState(0)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  // Seleção para atribuição de categoria em massa (âmbito: página visível).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const [bulkBudgetId, setBulkBudgetId] = useState('')
  const [activeTab, setActiveTab] = useState<'fornecedores' | 'outras'>('fornecedores')
  const [outrasSubTab, setOutrasSubTab] = useState<'fechadas' | 'futuras' | 'programadas' | 'abertas'>('abertas')
  // Filtros das "Outras Operações" são independentes por sub-separador: cada uma
  // das 4 divisões mantém o seu próprio conjunto de filtros (aplicados no cliente).
  type OutrasSubTab = 'fechadas' | 'futuras' | 'programadas' | 'abertas'
  type OutrasFilterState = {
    statusFilter: string; entitySearch: string
    docDateFrom: string; docDateTo: string
    dueDateFrom: string; dueDateTo: string
    paymentDateFrom: string; paymentDateTo: string
    isOverdue: boolean
  }
  const emptyOutrasFilter: OutrasFilterState = {
    statusFilter: '', entitySearch: '', docDateFrom: '', docDateTo: '',
    dueDateFrom: '', dueDateTo: '', paymentDateFrom: '', paymentDateTo: '', isOverdue: false,
  }
  const [outrasFilters, setOutrasFilters] = useState<Record<OutrasSubTab, OutrasFilterState>>({
    abertas: { ...emptyOutrasFilter }, fechadas: { ...emptyOutrasFilter },
    futuras: { ...emptyOutrasFilter }, programadas: { ...emptyOutrasFilter },
  })
  const outrasFilter = outrasFilters[outrasSubTab]
  const setOutrasFilter = (patch: Partial<OutrasFilterState>) =>
    setOutrasFilters((prev) => ({ ...prev, [outrasSubTab]: { ...prev[outrasSubTab], ...patch } }))
  const clearOutrasFilter = () =>
    setOutrasFilters((prev) => ({ ...prev, [outrasSubTab]: { ...emptyOutrasFilter } }))
  const outrasHasFilters = (f: OutrasFilterState) =>
    !!(f.statusFilter || f.entitySearch || f.dueDateFrom || f.dueDateTo || f.docDateFrom || f.docDateTo || f.paymentDateFrom || f.paymentDateTo || f.isOverdue)
  const [showNewOutras, setShowNewOutras] = useState(false)
  const [outrasForm, setOutrasForm] = useState(emptyOutrasForm)
  const [outrasContact, setOutrasContact] = useState<TocSupplier | null>(null)
  const [outrasContactSearch, setOutrasContactSearch] = useState('')
  const [showOutrasContactDropdown, setShowOutrasContactDropdown] = useState(false)
  const [panelDoc, setPanelDoc] = useState<Payable | null>(null)
  const [panelTocDoc, setPanelTocDoc] = useState<TocPurchaseDoc | null>(null)
  const [detailPayment, setDetailPayment] = useState<TocPayment | null>(null)
  const [panelTab, setPanelTab] = useState<'details' | 'parcelas' | 'followups'>('details')
  const [panelSection, setPanelSection] = useState<null | 'promised' | 'split'>(null)
  const [panelPromisedDate, setPanelPromisedDate] = useState('')
  const [splitInstallments, setSplitInstallments] = useState([{ amount: '', paymentDate: '' }, { amount: '', paymentDate: '' }])
  const [splitCount, setSplitCount] = useState(2)
  const [splitValueMode, setSplitValueMode] = useState<'EUR' | 'PCT'>('EUR')

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const { data: kpis } = useQuery({
    queryKey: ['payables-kpis', selectedClientId],
    queryFn: () => api.get<{ totalPending: number; countOpen: number; countOverdue: number; paidThisMonth: number; aging: Record<string, number>; cards: { uncategorized: number; unbudgeted: number; pending: number; overdue: number; dueThisWeek: number; pastPaymentDeadline: number } }>(`/treasury/${selectedClientId}/payables/kpis`),
    enabled: !!selectedClientId,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['payables', selectedClientId, activeTab, statusFilter, entitySearch, dueDateFrom, dueDateTo, docDateFrom, docDateTo, paymentDateFrom, paymentDateTo, sortBy, sortDir, page, isOverdueFilter, pastDeadlineFilter, uncategorizedFilter, unbudgetedFilter],
    queryFn: () => {
      // Cada separador pagina o seu próprio conjunto no servidor (bucket). As
      // "Outras Operações" são poucas (operações manuais) e têm sub-separadores
      // categorizados no cliente, por isso trazemos o conjunto completo.
      const bucket = activeTab === 'outras' ? 'outras' : 'fornecedores'
      const params = new URLSearchParams({
        bucket,
        page: bucket === 'outras' ? '1' : String(page),
        limit: bucket === 'outras' ? '1000' : '25',
      })
      // O bucket "outras" traz o conjunto completo sem filtros: a filtragem é
      // feita no cliente, de forma independente por sub-separador.
      if (bucket !== 'outras') {
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
        if (paymentDateFrom) params.set('paymentDateFrom', paymentDateFrom)
        if (paymentDateTo) params.set('paymentDateTo', paymentDateTo)
        if (pastDeadlineFilter) params.set('pastPaymentDeadline', 'true')
        if (uncategorizedFilter) params.set('uncategorized', 'true')
        if (unbudgetedFilter) params.set('unbudgeted', 'true')
      }
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

  const { data: budgets = [] } = useQuery<Budget[]>({
    queryKey: ['budgets-expense-active', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/budgets?type=EXPENSE&status=ACTIVE`),
    enabled: !!selectedClientId,
  })

  const { data: budgetCategories = [] } = useQuery<BudgetCategory[]>({
    queryKey: ['budget-categories-expense', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/budget-categories?type=EXPENSE`),
    enabled: !!selectedClientId,
  })

  const { data: tocSuppliers = [] } = useQuery<TocSupplier[]>({
    queryKey: ['toc-suppliers', selectedClientId],
    queryFn: () => api.get(`/toconline/${selectedClientId}/suppliers`),
    enabled: !!selectedClientId && isTocEnabled,
    retry: false,
    throwOnError: false,
  })

  const { data: panelDocDetail } = useQuery<Payable>({
    queryKey: ['payable-detail', selectedClientId, panelDoc?.id],
    queryFn: () => api.get(`/treasury/${selectedClientId}/payables/${panelDoc!.id}`),
    enabled: !!selectedClientId && !!panelDoc?.id && panelDoc.origin !== 'TOC',
  })

  // ID do documento TOC para carregar pagamentos no painel (origem TOC ou local importado)
  const panelTocDocId = panelTocDoc?.id != null ? String(panelTocDoc.id) : panelDoc?.tocPurchasesDocId ?? null
  const { data: panelPayments = [] } = useQuery<TocPayment[]>({
    queryKey: ['toc-purchase-payments', selectedClientId, panelTocDocId],
    queryFn: () => api.get(`/toconline/${selectedClientId}/purchases/${panelTocDocId}/payments`),
    enabled: !!selectedClientId && !!panelTocDocId,
  })


  const create = useMutation({
    mutationFn: () => {
      const isMonthlyRec = recForm.isRecurrent && ['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'].includes(recForm.frequency)
      const computedDocDate = isMonthlyRec ? shiftToWorkday(recForm.cycleStartDate) : (form as { documentDate?: string }).documentDate
      const body: Record<string, unknown> = {
        ...form,
        dueDate: form.dueDate,
        ...(computedDocDate ? { documentDate: computedDocDate } : {}),
        totalAmount: parseFloat(form.totalAmount) || 0,
        entityNif: form.entityNif || undefined,
        budgetId: form.budgetId || undefined,
        budgetCategoryId: form.budgetCategoryId || undefined,
      }
      if (recForm.isRecurrent) {
        body.recurrence = {
          frequency: recForm.frequency,
          ...(recForm.frequency === 'WEEKLY' ? { daysOfWeek: recForm.daysOfWeek.length ? recForm.daysOfWeek : [1] } : {}),
          ...(isMonthlyRec && recForm.cycleStartDate ? { dayOfMonth: parseInt(recForm.cycleStartDate.slice(8, 10)) } : {}),
          ...(recForm.endType === 'date' && recForm.endDate ? { endDate: recForm.endDate } : {}),
          ...(recForm.endType === 'occurrences' && recForm.occurrences ? { occurrences: parseInt(recForm.occurrences) } : {}),
        }
      }
      return api.post(`/treasury/${selectedClientId}/payables`, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payables'] })
      qc.invalidateQueries({ queryKey: ['payables-kpis'] })
      setShowNew(false)
      setForm(emptyForm)
      setRecForm(emptyRecurrence)
      toast.success(recForm.isRecurrent ? 'Conta recorrente criada.' : 'Conta a pagar criada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const deletePayable = useMutation({
    mutationFn: (id: string) => api.delete(`/treasury/${selectedClientId}/payables/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payables'] })
      qc.invalidateQueries({ queryKey: ['payables-kpis'] })
      setDeleteRow(null)
      toast.success('Documento eliminado.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const voidPayable = useMutation({
    mutationFn: (id: string) => api.post(`/treasury/${selectedClientId}/payables/${id}/void`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payables'] }); qc.invalidateQueries({ queryKey: ['payables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] }); toast.success('Documento anulado.') },
    onError: (e) => toast.error((e as Error).message),
  })

  const bulkCategory = useMutation({
    mutationFn: ({ ids, categoryId }: { ids: string[]; categoryId: string | null }) =>
      api.patch<{ updated: number; failed: number }>(`/treasury/${selectedClientId}/payables/bulk-category`, { ids, categoryId }),
    onSuccess: (res, { categoryId }) => {
      qc.invalidateQueries({ queryKey: ['payables'] }); qc.invalidateQueries({ queryKey: ['payables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] })
      const verb = categoryId === null ? 'Categoria removida de' : 'Categoria aplicada a'
      toast.success(res.failed > 0
        ? `${verb} ${res.updated} de ${res.updated + res.failed} documentos (${res.failed} falharam).`
        : `${verb} ${res.updated} documento(s).`)
      setSelectedIds(new Set()); setBulkCategoryId('')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const bulkBudget = useMutation({
    mutationFn: ({ ids, budgetId }: { ids: string[]; budgetId: string | null }) =>
      api.patch<{ updated: number; failed: number }>(`/treasury/${selectedClientId}/payables/bulk-budget`, { ids, budgetId }),
    onSuccess: (res, { budgetId }) => {
      qc.invalidateQueries({ queryKey: ['payables'] }); qc.invalidateQueries({ queryKey: ['payables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] })
      const verb = budgetId === null ? 'Budget removido de' : 'Budget aplicado a'
      toast.success(res.failed > 0
        ? `${verb} ${res.updated} de ${res.updated + res.failed} documentos (${res.failed} falharam).`
        : `${verb} ${res.updated} documento(s).`)
      setSelectedIds(new Set()); setBulkBudgetId('')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const bulkStatusMut = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: string }) =>
      api.patch<{ updated: number; failed: number }>(`/treasury/${selectedClientId}/payables/bulk-status`, { ids, status }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['payables'] }); qc.invalidateQueries({ queryKey: ['payables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] })
      toast.success(res.failed > 0
        ? `Estado aplicado a ${res.updated} de ${res.updated + res.failed} documentos (${res.failed} falharam).`
        : `Estado aplicado a ${res.updated} documento(s).`)
      setSelectedIds(new Set())
    },
    onError: (e) => toast.error((e as Error).message),
  })
  // Atribuição unitária de categoria (picker inline na célula, como nos movimentos).
  const classify = useMutation({
    mutationFn: ({ id, categoryId }: { id: string; categoryId: string | null }) =>
      api.patch(`/treasury/${selectedClientId}/payables/${id}`, { categoryId }),
    onSuccess: (_, { categoryId }) => {
      qc.invalidateQueries({ queryKey: ['payables'] }); qc.invalidateQueries({ queryKey: ['payables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] })
      toast.success(categoryId === null ? 'Categoria removida.' : 'Documento classificado.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  // Atribuição unitária de budget (picker inline na célula, gémeo da categoria).
  const classifyBudget = useMutation({
    mutationFn: ({ id, budgetId }: { id: string; budgetId: string | null }) =>
      api.patch(`/treasury/${selectedClientId}/payables/${id}`, { budgetId }),
    onSuccess: (_, { budgetId }) => {
      qc.invalidateQueries({ queryKey: ['payables'] }); qc.invalidateQueries({ queryKey: ['payables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] })
      toast.success(budgetId === null ? 'Budget removido.' : 'Budget atribuído.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const toggleSelect = (id: string) => setSelectedIds((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggleSelectMany = (ids: string[], select: boolean) => setSelectedIds((prev) => {
    const next = new Set(prev)
    for (const id of ids) { if (select) next.add(id); else next.delete(id) }
    return next
  })
  // A seleção é por página visível: limpa ao trocar de separador, sub-separador ou página.
  useEffect(() => { setSelectedIds(new Set()); setBulkCategoryId(''); setBulkBudgetId('') }, [activeTab, outrasSubTab, page])

  const payPayable = useMutation({
    mutationFn: (id: string) => api.post(`/treasury/${selectedClientId}/payables/${id}/pay`, {}),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['payables'] }); qc.invalidateQueries({ queryKey: ['payables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] })
      const payChildren = <T extends { recurrenceId?: string | null; status: string; totalAmount: number | string }>(arr: T[] | undefined) =>
        (arr ?? []).map((c) => c.recurrenceId || c.status === 'PAID' || c.status === 'SETTLED' || c.status === 'VOID'
          ? c
          : { ...c, status: 'PAID', pendingAmount: 0, paidAmount: Number(c.totalAmount) })
      setPanelDoc((d) => d ? {
        ...d,
        status: 'PAID',
        pendingAmount: 0,
        paidAmount: d.totalAmount,
        promisedPaymentDate: null,
        children: payChildren(d.children),
      } : d)
      qc.setQueryData<Payable>(['payable-detail', selectedClientId, id], (old) => old ? {
        ...old,
        status: 'PAID',
        pendingAmount: 0,
        paidAmount: old.totalAmount,
        promisedPaymentDate: null,
        children: payChildren(old.children),
      } : old)
      toast.success('Documento marcado como pago.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const settlePayable = useMutation({
    mutationFn: (id: string) => api.post(`/treasury/${selectedClientId}/payables/${id}/settle`, {}),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['payables'] }); qc.invalidateQueries({ queryKey: ['payables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] })
      const settleChildren = <T extends { recurrenceId?: string | null; status: string; totalAmount: number | string }>(arr: T[] | undefined) =>
        (arr ?? []).map((c) => c.recurrenceId || c.status === 'SETTLED' || c.status === 'VOID'
          ? c
          : { ...c, status: 'SETTLED', pendingAmount: 0, paidAmount: Number(c.totalAmount) })
      setPanelDoc((d) => d ? {
        ...d,
        status: 'SETTLED',
        pendingAmount: 0,
        paidAmount: d.totalAmount,
        promisedPaymentDate: null,
        children: settleChildren(d.children),
      } : d)
      qc.setQueryData<Payable>(['payable-detail', selectedClientId, id], (old) => old ? {
        ...old,
        status: 'SETTLED',
        pendingAmount: 0,
        paidAmount: old.totalAmount,
        promisedPaymentDate: null,
        children: settleChildren(old.children),
      } : old)
      toast.success('Documento marcado como liquidado.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const unsettlePayable = useMutation({
    mutationFn: (id: string) => api.post(`/treasury/${selectedClientId}/payables/${id}/unsettle`, {}),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['payables'] }); qc.invalidateQueries({ queryKey: ['payables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] })
      const revertChildren = <T extends { recurrenceId?: string | null; status: string; totalAmount: number | string }>(arr: T[] | undefined) =>
        (arr ?? []).map((c) => c.recurrenceId || (c.status !== 'SETTLED' && c.status !== 'PAID')
          ? c
          : { ...c, status: 'OPEN', pendingAmount: Number(c.totalAmount), paidAmount: 0 })
      setPanelDoc((d) => d ? {
        ...d,
        status: 'OPEN',
        pendingAmount: d.totalAmount,
        paidAmount: 0,
        children: revertChildren(d.children),
      } : d)
      qc.setQueryData<Payable>(['payable-detail', selectedClientId, id], (old) => old ? {
        ...old,
        status: 'OPEN',
        pendingAmount: old.totalAmount,
        paidAmount: 0,
        children: revertChildren(old.children),
      } : old)
      toast.success('Liquidação anulada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const updatePayable = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/treasury/${selectedClientId}/payables/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payables'] })
      qc.invalidateQueries({ queryKey: ['payables-kpis'] })
      // Edição de programada propaga aos filhos futuros — refresh do dashboard.
      qc.invalidateQueries({ queryKey: ['dashboard-cashflow-statement'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setEditId(null)
      setEditRow(null)
      toast.success('Documento atualizado.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const partialPayment = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) =>
      api.post(`/treasury/${selectedClientId}/payables/${id}/partial-payment`, { amount }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payables'] }); qc.invalidateQueries({ queryKey: ['payables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] }); setPartialId(null); setPartialAmount(''); toast.success('Pagamento parcial registado.') },
    onError: (e) => toast.error((e as Error).message),
  })

  const setPromisedDate = useMutation({
    mutationFn: ({ id, date }: { id: string; date: string | null }) =>
      api.patch(`/treasury/${selectedClientId}/payables/${id}/promised-date`, { date }),
    onSuccess: (_, { date }) => {
      qc.invalidateQueries({ queryKey: ['payables'] })
      setPanelDoc((d) => d ? { ...d, promisedPaymentDate: date } : d)
      setPanelSection(null)
      toast.success(date ? 'Data prometida definida.' : 'Data prometida removida.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const unsplitPayable = useMutation({
    mutationFn: (id: string) => api.post(`/treasury/${selectedClientId}/payables/${id}/unsplit`, {}),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['payables'] })
      qc.invalidateQueries({ queryKey: ['payables-kpis'] })
      qc.invalidateQueries({ queryKey: ['payable-detail', selectedClientId, id] })
      setPanelDoc((prev) => prev ? { ...prev, status: 'OPEN', children: [] } : prev)
      toast.success('Divisão desfeita com sucesso.')
    },
    onError: () => toast.error('Não foi possível desfazer a divisão.'),
  })

  const splitPayable = useMutation({
    mutationFn: ({ id, installments }: { id: string; installments: Array<{ promisedPaymentDate: string; amount: number }> }) =>
      api.post(`/treasury/${selectedClientId}/payables/${id}/split`, { installments }),
    onSuccess: (children, { id }) => {
      qc.invalidateQueries({ queryKey: ['payables'] })
      qc.invalidateQueries({ queryKey: ['payables-kpis'] })
      qc.invalidateQueries({ queryKey: ['payable-detail', selectedClientId, id] })
      setPanelDoc((prev) => prev ? { ...prev, children: children as Payable['children'] } : prev)
      setPanelSection(null)
      toast.success('Fatura dividida com sucesso.')
    },
    onError: (e) => toast.error((e as Error).message),
  })



  const createOutras = useMutation({
    mutationFn: () => {
      const computedDocDate = recForm.isRecurrent ? shiftToWorkday(recForm.cycleStartDate) : undefined
      const body: Record<string, unknown> = {
        categoryId: outrasForm.categoryId || undefined,
        entityName: outrasForm.entityName || undefined,
        entityNif: outrasForm.entityNif || undefined,
        reference: outrasForm.reference || undefined,
        description: outrasForm.description || undefined,
        dueDate: outrasForm.dueDate,
        ...(computedDocDate ? { documentDate: computedDocDate } : {}),
        totalAmount: parseFloat(outrasForm.totalAmount) || 0,
        budgetId: outrasForm.budgetId || undefined,
        budgetCategoryId: outrasForm.budgetCategoryId || undefined,
      }
      if (recForm.isRecurrent) {
        body.recurrence = {
          frequency: recForm.frequency,
          ...(recForm.cycleStartDate ? { dayOfMonth: parseInt(recForm.cycleStartDate.slice(8, 10)) } : {}),
          ...(recForm.endType === 'date' && recForm.endDate ? { endDate: recForm.endDate } : {}),
          ...(recForm.endType === 'occurrences' && recForm.occurrences ? { occurrences: parseInt(recForm.occurrences) } : {}),
        }
      }
      return api.post(`/treasury/${selectedClientId}/payables`, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payables'] })
      qc.invalidateQueries({ queryKey: ['payables-kpis'] })
      setShowNewOutras(false)
      setOutrasForm(emptyOutrasForm)
      setRecForm(emptyRecurrence)
      setOutrasContact(null)
      setOutrasContactSearch('')
      toast.success(recForm.isRecurrent ? 'Conta recorrente criada.' : 'Operação criada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const hasFilters = !!(statusFilter || entitySearch || dueDateFrom || dueDateTo || docDateFrom || docDateTo || paymentDateFrom || paymentDateTo || isOverdueFilter || pastDeadlineFilter || uncategorizedFilter || unbudgetedFilter)
  function clearFilters() {
    setStatusFilter(''); setEntitySearch(''); setDueDateFrom(''); setDueDateTo(''); setDocDateFrom(''); setDocDateTo(''); setPaymentDateFrom(''); setPaymentDateTo(''); setIsOverdueFilter(false); setUncategorizedFilter(false); setUnbudgetedFilter(false); setActiveCard(null); setPage(1)
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

  // NCFs (notas de crédito de compra) podem ser reactivadas quando o backend
  // as incluir no payload de payables; por agora o map fica vazio.
  const tocNcMap = useMemo(() => new Map<string, TocPurchaseDoc[]>(), [])

  // A lista vem unificada do backend: cada item traz `_src: 'local' | 'toc'`
  // e `_tocRaw` quando origem TOC. Ordenação, paginação e bucket
  // ('fornecedores' = só TOConline) são feitos no servidor; aqui só
  // convertemos para o shape `Row` da UI.
  const rows: Row[] = (data?.items ?? []).map((p) => {
    if (p._src === 'toc' && p._tocRaw) return { _src: 'toc' as const, d: p._tocRaw, item: p }
    return { _src: 'local' as const, p }
  })
  // Ids selecionáveis visíveis no separador Fornecedores (para o "selecionar todos").
  // `outrasVisibleIds` é definido mais abaixo, após `outrasRows`.
  const fornecedoresVisibleIds = rows.map((row) => row._src === 'local' ? row.p.id : row.item.id)
  const allSelected = (ids: string[]) => ids.length > 0 && ids.every((id) => selectedIds.has(id))

  // Barra de ação de categorização em massa, partilhada pelos dois separadores.
  const renderBulkBar = () => selectedIds.size === 0 ? null : (
    <div className="sticky -top-4 lg:-top-6 z-20 px-3 py-3 bg-primary-50 border-b border-primary-100 flex items-center gap-3 flex-wrap">
      <span className="text-sm font-medium text-primary-800">{selectedIds.size} selecionado(s)</span>
      <select className="input w-auto text-sm py-1" value={bulkCategoryId} onChange={(e) => setBulkCategoryId(e.target.value)}>
        <option value="" disabled hidden>Atribuir categoria…</option>
        <option value="__none__">Remover categoria</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <button
        className="btn-primary text-sm py-1.5 px-3"
        disabled={!bulkCategoryId || bulkCategory.isPending}
        onClick={() => bulkCategory.mutate({ ids: [...selectedIds], categoryId: bulkCategoryId === '__none__' ? null : bulkCategoryId })}
      >
        {bulkCategory.isPending ? 'A aplicar…' : 'Aplicar'}
      </button>
      <span className="w-px h-5 bg-primary-200" />
      <select className="input w-auto text-sm py-1" value={bulkBudgetId} onChange={(e) => setBulkBudgetId(e.target.value)}>
        <option value="" disabled hidden>Atribuir budget…</option>
        <option value="__none__">Remover budget</option>
        {budgets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <button
        className="btn-primary text-sm py-1.5 px-3"
        disabled={!bulkBudgetId || bulkBudget.isPending}
        onClick={() => bulkBudget.mutate({ ids: [...selectedIds], budgetId: bulkBudgetId === '__none__' ? null : bulkBudgetId })}
      >
        {bulkBudget.isPending ? 'A aplicar…' : 'Aplicar'}
      </button>
      <span className="w-px h-5 bg-primary-200" />
      <button
        className="text-sm py-1.5 px-3 rounded-lg bg-teal-600 text-white font-medium hover:bg-teal-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={bulkStatusMut.isPending}
        onClick={() => bulkStatusMut.mutate({ ids: [...selectedIds], status: 'PAID' })}
      >
        Marcar como Pago
      </button>
      <button
        className="text-sm py-1.5 px-3 rounded-lg border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={bulkStatusMut.isPending}
        onClick={() => bulkStatusMut.mutate({ ids: [...selectedIds], status: 'OPEN' })}
      >
        Reverter p/ Em Aberto
      </button>
      <button className="text-sm text-gray-500 hover:text-gray-700" onClick={() => { setSelectedIds(new Set()); setBulkCategoryId(''); setBulkBudgetId('') }}>Limpar seleção</button>
    </div>
  )

  // KPIs vêm do endpoint /kpis, que já agrega locais + TOC pendentes.
  // Subtraímos `countOverdue` ao `countOpen` para manter a UX existente
  // (cards "Em aberto" e "Vencidas" como números separados).
  // Cartões compactos clicáveis: cada um aplica um preset de filtros à tabela
  // de Fornecedores. Clicar no cartão ativo limpa os filtros.
  const cardWeekRange = () => {
    const d = new Date(); d.setHours(0, 0, 0, 0)
    const wd = d.getDay()
    const start = new Date(d); start.setDate(d.getDate() + (wd === 0 ? -6 : 1 - wd))
    const end = new Date(start); end.setDate(start.getDate() + 6)
    const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    return { start: ymd(start), end: ymd(end) }
  }
  const resetCardFilters = () => {
    setActiveCard(null); setStatusFilter('OPEN,PARTIAL'); setIsOverdueFilter(false); setPastDeadlineFilter(false)
    setUncategorizedFilter(false); setUnbudgetedFilter(false); setPaymentDateFrom(''); setPaymentDateTo(''); setPage(1)
  }
  const applyCard = (card: 'uncategorized' | 'unbudgeted' | 'pending' | 'overdue' | 'thisWeek' | 'pastDeadline') => {
    if (activeCard === card) { resetCardFilters(); return }
    setActiveTab('fornecedores'); setPage(1); setActiveCard(card)
    setIsOverdueFilter(false); setPastDeadlineFilter(false); setUncategorizedFilter(false); setUnbudgetedFilter(false); setPaymentDateFrom(''); setPaymentDateTo('')
    if (card === 'uncategorized') { setUncategorizedFilter(true); setStatusFilter('OPEN,PARTIAL,PAID,SETTLED') }
    else if (card === 'unbudgeted') { setUnbudgetedFilter(true); setStatusFilter('OPEN,PARTIAL,PAID,SETTLED') }
    else if (card === 'pending') { setStatusFilter('OPEN,PARTIAL') }
    else if (card === 'overdue') { setStatusFilter(''); setIsOverdueFilter(true) }
    else if (card === 'thisWeek') { const w = cardWeekRange(); setStatusFilter('OPEN,PARTIAL'); setPaymentDateFrom(w.start); setPaymentDateTo(w.end) }
    else if (card === 'pastDeadline') {
      setStatusFilter('OPEN,PARTIAL'); setPastDeadlineFilter(true)
    }
  }

  const combinedKpis = kpis ? {
    ...kpis,
    countOpen: Math.max(0, kpis.countOpen - kpis.countOverdue),
  } : null

  const isClosed = (status: string) => status === 'PAID' || status === 'SETTLED' || status === 'VOID'
  const outrasAll = (data?.items ?? []).filter((p) => !p.tocPurchasesDocId && (!p.parentId || !!p.recurrenceId))
  const todayYmd = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })()
  const outrasCategorise = (p: Payable) => {
    if (p.recurrenceId && !p.parentId) return 'programadas' as const
    if (p.recurrenceId && p.parentId && String(p.dueDate).slice(0, 10) > todayYmd) return 'futuras' as const
    return isClosed(p.status) ? ('fechadas' as const) : ('abertas' as const)
  }
  const matchesOutrasFilter = (p: Payable, f: OutrasFilterState): boolean => {
    if (f.entitySearch) {
      const q = f.entitySearch.toLowerCase()
      if (!`${p.entityName ?? ''} ${p.reference ?? ''}`.toLowerCase().includes(q)) return false
    }
    if (f.statusFilter && !f.statusFilter.split(',').includes(p.status)) return false
    const dueYmd = String(p.dueDate).slice(0, 10)
    if (f.dueDateFrom && dueYmd < f.dueDateFrom) return false
    if (f.dueDateTo && dueYmd > f.dueDateTo) return false
    const docYmd = p.documentDate ? String(p.documentDate).slice(0, 10) : ''
    if (f.docDateFrom && (!docYmd || docYmd < f.docDateFrom)) return false
    if (f.docDateTo && (!docYmd || docYmd > f.docDateTo)) return false
    const payYmd = p.promisedPaymentDate ? String(p.promisedPaymentDate).slice(0, 10) : ''
    if (f.paymentDateFrom && (!payYmd || payYmd < f.paymentDateFrom)) return false
    if (f.paymentDateTo && (!payYmd || payYmd > f.paymentDateTo)) return false
    if (f.isOverdue) {
      const isActive = p.status !== 'PAID' && p.status !== 'SETTLED' && p.status !== 'VOID'
      if (!(isActive && new Date(dueYmd).getTime() < Date.now())) return false
    }
    return true
  }
  // Contagem por sub-separador é sempre o total da divisão, independente dos filtros.
  const outrasCount = { fechadas: 0, futuras: 0, programadas: 0, abertas: 0 }
  for (const p of outrasAll) outrasCount[outrasCategorise(p)]++
  const outrasRows = (() => {
    const filtered = outrasAll.filter((p) => outrasCategorise(p) === outrasSubTab && matchesOutrasFilter(p, outrasFilter))
    if (sortBy === 'reference') {
      return [...filtered].sort((a, b) => {
        const cmp = refSortKey(a.reference).localeCompare(refSortKey(b.reference))
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return filtered
  })()
  const outrasVisibleIds = outrasRows.map((p) => p.id)

  return (
    <>
      <div className="flex -m-4 lg:-m-6 h-[calc(100vh-4rem)]">
        <div className="flex-1 min-w-0 overflow-y-auto overflow-x-auto p-4 lg:p-6">
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900">Contas a Pagar</h1>
              <TocSyncStatus invalidateKeys={[
                ['payables', selectedClientId ?? ''],
                ['payables-kpis', selectedClientId ?? ''],
              ]} />
            </div>

            {combinedKpis && (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <KpiCard title="Total Pendente" value={formatCurrency(combinedKpis.totalPending)} icon={<ArrowUpFromLine className="w-6 h-6 text-red-500" />} />
                  <KpiCard title="Em aberto" value={String(combinedKpis.countOpen)} />
                  <KpiCard
                    title="Vencidas"
                    value={String(combinedKpis.countOverdue)}
                    className={combinedKpis.countOverdue > 0 ? 'border-red-200' : ''}
                  />
                  <KpiCard title="Pago este mês" value={formatCurrency(combinedKpis.paidThisMonth)} />
                </div>
                {kpis?.cards && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    {([
                      ['uncategorized', 'Sem categoria', kpis.cards.uncategorized],
                      ['unbudgeted', 'Sem budget', kpis.cards.unbudgeted],
                      ['pending', 'Pendentes / Em aberto', kpis.cards.pending],
                      ['overdue', 'Vencidas', kpis.cards.overdue],
                      ['thisWeek', 'A pagar esta semana', kpis.cards.dueThisWeek],
                      ['pastDeadline', 'Passou prazo pagamento', kpis.cards.pastPaymentDeadline],
                    ] as const).map(([key, label, count]) => {
                      const active = activeCard === key
                      return (
                        <button
                          key={key}
                          onClick={() => applyCard(key)}
                          className={`rounded-xl border px-3 py-2 text-left flex items-center justify-between gap-2 transition-all ${active ? 'border-primary-300 bg-primary-50 shadow-sm' : 'border-gray-100 bg-white hover:border-gray-200 hover:shadow-card-md'}`}
                        >
                          <span className="text-[11px] font-medium text-gray-500 leading-tight">{label}</span>
                          <span className={`text-lg font-bold tabular-nums ${active ? 'text-primary-700' : 'text-gray-900'}`}>{count}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </>
            )}

            {/* Tabs */}
            <div className="flex gap-1 border-b border-gray-200">
              {([['fornecedores', 'Fornecedores'], ['outras', 'Outras Operações']] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === id ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {activeTab === 'fornecedores' && (
              <div className="space-y-4 pt-1">

                <div className="card">
                  <div className="px-3 py-4 border-b border-gray-100 flex gap-3 items-center flex-wrap">
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
                    <select className="input w-auto text-sm py-1" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setUncategorizedFilter(false); setActiveCard(null); setPage(1) }}>
                      <option value="">Todos os estados</option>
                      <option value="OPEN,PARTIAL">Pendente</option>
                      <option value="OPEN">Emitido / Em aberto</option>
                      <option value="PARTIAL">Parcialmente liquidado</option>
                      <option value="PAID">Pago</option>
                      <option value="SETTLED">Liquidado</option>
                      <option value="VOID">Anulado</option>
                    </select>
                    <DateRangePopover
                      label="Data doc."
                      startDate={docDateFrom}
                      endDate={docDateTo}
                      onChange={(s, e) => { setDocDateFrom(s); setDocDateTo(e); setPage(1) }}
                    />
                    <DateRangePopover
                      label="Vencimento"
                      startDate={dueDateFrom}
                      endDate={dueDateTo}
                      onChange={(s, e) => { setDueDateFrom(s); setDueDateTo(e); setPage(1) }}
                    />
                    <DateRangePopover
                      label="Pagamento"
                      startDate={paymentDateFrom}
                      endDate={paymentDateTo}
                      onChange={(s, e) => { setPaymentDateFrom(s); setPaymentDateTo(e); setPage(1) }}
                    />
                    {hasFilters && (
                      <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 px-2 py-1.5 hover:bg-gray-50 rounded-lg transition-colors">
                        <X className="w-3.5 h-3.5" /> Limpar
                      </button>
                    )}
                    <span className="text-sm text-gray-400 ml-auto">
                      {data == null && isLoading ? 'A carregar…' : `${data?.total ?? 0} documentos`}
                    </span>
                    <button onClick={exportCsv} title="Exportar CSV" className="text-gray-400 hover:text-gray-600 p-1.5 hover:bg-gray-50 rounded-lg transition-colors">
                      <Download className="w-4 h-4" />
                    </button>
                  </div>

                  {renderBulkBar()}

                  <div ref={hScroll} className="overflow-x-auto">
                    <table className="w-full table-fixed text-sm min-w-[1180px] lg:min-w-0">
                      <thead>
                        <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                          <th className="w-12 px-3 py-3 select-none">
                            <input
                              type="checkbox"
                              className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                              checked={allSelected(fornecedoresVisibleIds)}
                              onChange={(e) => toggleSelectMany(fornecedoresVisibleIds, e.target.checked)}
                            />
                          </th>
                          <th className="w-12 px-2 py-3" />
                          <th onClick={() => toggleSort('reference')} className="text-left pl-1 pr-3 py-3 cursor-pointer hover:text-gray-700 select-none">Documento <SortIcon field="reference" /></th>
                          <th onClick={() => toggleSort('entityName')} className="text-left px-3 py-3 cursor-pointer hover:text-gray-700 select-none">
                            Fornecedor <SortIcon field="entityName" />
                          </th>
                          <th onClick={() => toggleSort('dueDate')} className="text-left px-3 py-3 cursor-pointer hover:text-gray-700 select-none">
                            Vencimento <SortIcon field="dueDate" />
                          </th>
                          <th onClick={() => toggleSort('promisedPaymentDate')} className="text-left pl-3 pr-1 py-3 cursor-pointer hover:text-gray-700 select-none">
                            Pagamento <SortIcon field="promisedPaymentDate" />
                          </th>
                          <th onClick={() => toggleSort('totalAmount')} className="text-center pl-1 pr-3 py-3 cursor-pointer hover:text-gray-700 select-none">
                            Total <SortIcon field="totalAmount" />
                          </th>
                          <th onClick={() => toggleSort('pendingAmount')} className="text-center px-3 py-3 cursor-pointer hover:text-gray-700 select-none">
                            Pendente <SortIcon field="pendingAmount" />
                          </th>
                          <th onClick={() => toggleSort('status')} className="text-left px-3 py-3 cursor-pointer hover:text-gray-700 select-none">
                            Estado <SortIcon field="status" />
                          </th>
                          <th className="text-left px-3 py-3">Categoria</th>
                          <th className="text-left px-3 py-3">Budget</th>
                          <th className="w-16 px-3 py-3" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {rows.map((row) => {
                          if (row._src === 'local') {
                            const p = row.p
                            return (
                              <tr key={`l-${p.id}`} className="hover:bg-primary-50 transition-colors group cursor-pointer" onClick={() => { setPanelDoc(p); setPanelTocDoc(null); setPanelTab((p.children ?? []).some((c) => !c.recurrenceId) ? 'parcelas' : 'details'); setPanelSection(null); setPanelPromisedDate(p.promisedPaymentDate?.slice(0, 10) ?? ''); setSplitCount(2); setSplitValueMode('EUR') }}>
                                <td className="px-3 py-3 align-top">
                                  <input
                                    type="checkbox"
                                    className="w-4 h-4 mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer flex-shrink-0"
                                    checked={selectedIds.has(p.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={() => toggleSelect(p.id)}
                                  />
                                </td>
                                <td className="px-2 py-3 align-top whitespace-nowrap">
                                  <DocLabels splitCount={(p.children ?? []).filter((c) => !c.recurrenceId).length} />
                                </td>
                                <td className="pl-1 pr-3 py-3">
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-medium text-gray-900">{p.reference}</span>
                                      {p.recurrenceId && <span title="Recorrente"><Repeat2 className="w-3.5 h-3.5 text-primary-400 flex-shrink-0" /></span>}
                                    </div>
                                    <div className="text-xs text-gray-400">{p.documentDate ? formatDate(p.documentDate) : ''}{p.description ? ` · ${p.description}` : ''}</div>
                                  </div>
                                </td>
                                <td className="px-3 py-3 text-gray-700 truncate">
                                  {p.tocSupplierId ? (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); navigate(`/empresa/fornecedores/${p.tocSupplierId}`, { state: { from: '/contas-a-pagar', fromLabel: 'Contas a Pagar' } }) }}
                                      className="text-primary-600 hover:underline text-left"
                                    >
                                      {p.entityName}
                                    </button>
                                  ) : (
                                    p.entityName
                                  )}
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap">
                                  {(() => {
                                    const isSplit = (p.children ?? []).some((c) => !c.recurrenceId)
                                    const displayDate = isSplit && p.promisedPaymentDate ? p.promisedPaymentDate : p.dueDate
                                    const now = Date.now()
                                    const due = new Date(displayDate).getTime()
                                    const isActive = p.status !== 'PAID' && p.status !== 'SETTLED' && p.status !== 'VOID'
                                    const overdue = isActive && due < now
                                    const daysOverdue = overdue ? Math.floor((now - due) / 86400000) : 0
                                    const daysUntil = isActive && !overdue ? Math.floor((due - now) / 86400000) : -1
                                    return (
                                      <>
                                        <div className={overdue ? 'text-red-600 font-medium' : 'text-gray-500'}>{formatDate(displayDate)}</div>
                                        {overdue && daysOverdue > 0 && <div className="text-xs text-red-400">{daysOverdue} dias</div>}
                                        {!overdue && daysUntil >= 0 && daysUntil <= 14 && <div className="text-xs text-amber-500">{daysUntil === 0 ? 'hoje' : `${daysUntil}d`}</div>}
                                      </>
                                    )
                                  })()}
                                </td>
                                <td className="pl-3 pr-1 py-3 whitespace-nowrap">{(() => {
                                  const payDate = p.promisedPaymentDate ?? p.dueDate
                                  const overdue = (p.status === 'OPEN' || p.status === 'PARTIAL') && new Date(payDate).getTime() < Date.now()
                                  return <span className={overdue ? 'text-red-600 font-medium' : 'text-gray-500'}>{formatDate(payDate)}</span>
                                })()}</td>
                                <td className="pl-1 pr-3 py-3 text-center text-gray-700">{formatCurrency(p.totalAmount)}</td>
                                <td className="px-3 py-3 text-center">
                                  <div className="font-semibold text-red-700">{formatCurrency(p.pendingAmount)}</div>
                                  {p.status === 'PARTIAL' && Number(p.paidAmount) > 0 && (
                                    <div className="text-xs text-gray-400">pago: {formatCurrency(Number(p.paidAmount))}</div>
                                  )}
                                </td>
                                <td className="px-3 py-3">
                                  <Badge variant={statusVariant(p.status)}>{statusLabel(p.status, p._statusToc === 'SETTLED')}</Badge>
                                  {p._statusDiffersFromToc && (
                                    <span className="ml-1.5 text-[10px] text-amber-600 font-medium" title={`No TOConline: ${p._statusToc ?? '—'}`}>(Local)</span>
                                  )}
                                </td>
                                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                                  <InlineCategoryPicker
                                    category={p.category}
                                    categories={categories}
                                    typeLabel="Despesa"
                                    onSelect={(categoryId) => classify.mutate({ id: p.id, categoryId })}
                                  />
                                </td>
                                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                                  <InlineBudgetPicker
                                    budget={p.budget}
                                    budgets={budgets}
                                    onSelect={(budgetId) => classifyBudget.mutate({ id: p.id, budgetId })}
                                  />
                                </td>
                                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      title="Editar"
                                      onClick={() => {
                                        setEditId(p.id)
                                        setEditRow(p)
                                        setEditForm({
                                          categoryId: p.category?.id ?? '',
                                          entityName: p.entityName,
                                          reference: p.reference,
                                          documentDate: p.documentDate?.slice(0, 10) ?? '',
                                          dueDate: p.dueDate.slice(0, 10),
                                          totalAmount: String(p.totalAmount),
                                          description: p.description ?? '',
                                        })
                                      }}
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
                                    {(p.status === 'OPEN' || p.status === 'PARTIAL') && (() => {
                                      const isFutureRec = !!(p.recurrenceId && p.parentId && String(p.dueDate).slice(0, 10) > todayYmd)
                                      return (
                                        <button
                                          title={isFutureRec ? 'Recorrência futura — só pode ser paga a partir da data de vencimento' : 'Marcar como pago'}
                                          onClick={() => { if (!isFutureRec) payPayable.mutate(p.id) }}
                                          disabled={isFutureRec}
                                          className="p-1 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:bg-transparent"
                                        >
                                          <CreditCard className="w-3.5 h-3.5" />
                                        </button>
                                      )
                                    })()}
                                    {p.origin !== 'TOCONLINE' && (p.status === 'OPEN' || p.status === 'PARTIAL' || p.status === 'PAID') && (() => {
                                      const isFutureRec = !!(p.recurrenceId && p.parentId && String(p.dueDate).slice(0, 10) > todayYmd)
                                      return (
                                        <button
                                          title={isFutureRec ? 'Recorrência futura — só pode ser liquidada a partir da data de vencimento' : 'Marcar como liquidada'}
                                          onClick={() => { if (!isFutureRec) settlePayable.mutate(p.id) }}
                                          disabled={isFutureRec}
                                          className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:bg-transparent"
                                        >
                                          <CheckCircle className="w-3.5 h-3.5" />
                                        </button>
                                      )
                                    })()}
                                    {p.status !== 'VOID' && p.status !== 'SETTLED' && (
                                      <button
                                        title="Anular"
                                        onClick={() => voidPayable.mutate(p.id)}
                                        className="p-1 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                                      >
                                        <XCircle className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button
                                      title="Eliminar"
                                      onClick={() => setDeleteRow(p)}
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
                          const key = `t-${docId}`
                          const isExpanded = expandedIds.has(key)
                          const paymentCount = Array.isArray(d.payments_ids) ? (d.payments_ids as unknown[]).length : 0
                          const ncs = tocNcMap.get(docId) ?? []
                          const expandCount = paymentCount + ncs.length
                          return (
                            <Fragment key={key}>
                              <tr
                                className="hover:bg-primary-50 transition-colors group cursor-pointer"
                                onClick={() => {
                                  setPanelDoc(row.item)
                                  setPanelTocDoc(d)
                                  setPanelTab((row.item.children ?? []).some((c) => !c.recurrenceId) ? 'parcelas' : 'details')
                                  setPanelSection(null)
                                  setPanelPromisedDate(row.item.promisedPaymentDate?.slice(0, 10) ?? '')
                                  setSplitCount(2)
                                  setSplitValueMode('EUR')
                                }}
                              >
                                <td className="px-3 py-3 align-top">
                                  <input
                                    type="checkbox"
                                    className="w-4 h-4 mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer flex-shrink-0"
                                    checked={selectedIds.has(row.item.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={() => toggleSelect(row.item.id)}
                                  />
                                </td>
                                <td className="px-2 py-3 align-top whitespace-nowrap">
                                  <DocLabels splitCount={(row.item.children ?? []).filter((c) => !c.recurrenceId).length} />
                                </td>
                                <td className="pl-1 pr-3 py-3">
                                  <div className="flex items-start gap-1.5">
                                    {expandCount > 0 ? (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); toggleExpand(key) }}
                                        className="mt-0.5 flex-shrink-0 flex items-center gap-0.5 text-gray-400 hover:text-gray-700 transition-colors"
                                        title={isExpanded ? 'Ocultar detalhe' : 'Ver pagamentos e notas de crédito'}
                                      >
                                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                        <span className="text-xs font-semibold leading-none">{expandCount}</span>
                                      </button>
                                    ) : (
                                      <span className="w-4 flex-shrink-0" />
                                    )}
                                    <div>
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-medium text-gray-900">{ref}</span>
                                      </div>
                                      <div className="text-xs text-gray-400">{date ? formatDate(date) : '—'}</div>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-3 py-3 text-gray-700 truncate">
                                  {d.supplier_id != null ? (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); navigate(`/empresa/fornecedores/${d.supplier_id}`, { state: { from: '/contas-a-pagar', fromLabel: 'Contas a Pagar' } }) }}
                                      className="text-primary-600 hover:underline text-left"
                                    >
                                      {supplier}
                                    </button>
                                  ) : (
                                    supplier
                                  )}
                                </td>
                                <td className={`px-3 py-3 whitespace-nowrap ${dueDate && new Date(dueDate) < new Date() && Number(d.status) !== 3 && Number(d.status) !== 4 ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                                  {dueDate ? formatDate(dueDate) : '—'}
                                </td>
                                <td className="pl-3 pr-1 py-3 whitespace-nowrap">{(() => {
                                  // Data de pagamento efetiva (prometida ou, na ausência, vencimento).
                                  // Tem de vir do overlay (row.item), não do due_date cru do TOC, senão
                                  // a coluna não coincide com a ordenação por data de pagamento do servidor.
                                  const payDate = row.item.promisedPaymentDate ?? row.item.dueDate ?? dueDate
                                  if (!payDate) return <span className="text-gray-400">—</span>
                                  const overdue = (row.item.status === 'OPEN' || row.item.status === 'PARTIAL') && new Date(payDate).getTime() < Date.now()
                                  return <span className={overdue ? 'text-red-600 font-medium' : 'text-gray-500'}>{formatDate(payDate)}</span>
                                })()}</td>
                                <td className="pl-1 pr-3 py-3 text-center text-gray-700">{formatCurrency(total)}</td>
                                <td className="px-3 py-3 text-center font-semibold text-red-700">{formatCurrency(pending)}</td>
                                <td className="px-3 py-3">
                                  <Badge variant={statusVariant(row.item.status)}>{statusLabel(row.item.status, row.item._statusToc === 'SETTLED')}</Badge>
                                  {row.item._statusDiffersFromToc && (
                                    <span className="ml-1.5 text-[10px] text-amber-600 font-medium" title={`No TOConline: ${row.item._statusToc ?? '—'}`}>(Local)</span>
                                  )}
                                </td>
                                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                                  <InlineCategoryPicker
                                    category={row.item.category}
                                    categories={categories}
                                    typeLabel="Despesa"
                                    onSelect={(categoryId) => classify.mutate({ id: row.item.id, categoryId })}
                                  />
                                </td>
                                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                                  <InlineBudgetPicker
                                    budget={row.item.budget}
                                    budgets={budgets}
                                    onSelect={(budgetId) => classifyBudget.mutate({ id: row.item.id, budgetId })}
                                  />
                                </td>
                                <td className="px-3 py-3" />
                              </tr>
                              {isExpanded && (
                                <>
                                  {ncs.map((nc) => (
                                    <tr key={`nc-${nc.id}`} className="bg-amber-50/40 border-b border-amber-100/80">
                                      <td className="px-3 py-2" />
                                      <td className="px-2 py-2" />
                                      <td className="pl-2 pr-3 py-2">
                                        <div className="flex items-center gap-2 text-xs">
                                          <span className="text-[10px] font-bold uppercase px-1 py-0.5 rounded bg-amber-100 text-amber-700 flex-shrink-0">NC</span>
                                          <div>
                                            <div className="text-gray-700 font-medium">{nc.document_no}</div>
                                            <div className="text-gray-400">{nc.date ? formatDate(nc.date) : '—'}</div>
                                          </div>
                                        </div>
                                      </td>
                                      <td className="px-3 py-2 text-xs text-gray-500">{supplier}</td>
                                      <td className="px-3 py-2" />
                                      <td className="px-3 py-2 text-xs text-gray-400">{(nc.due_date as string | undefined) ? formatDate(nc.due_date as string) : '—'}</td>
                                      <td className="px-3 py-2 text-right text-xs text-amber-700 font-medium">−{formatCurrency(nc.gross_total)}</td>
                                      <td className="px-3 py-2" />
                                      <td className="px-3 py-2"><Badge variant="yellow">{tocStatusLabel(nc.status)}</Badge></td>
                                      <td className="px-3 py-2" />
                                      <td className="px-3 py-2" />
                                      <td className="px-3 py-2" />
                                    </tr>
                                  ))}
                                  {paymentCount > 0 && (
                                    <PaymentSubRows
                                      clientId={selectedClientId!}
                                      tocDocId={docId}
                                      entityName={supplier}
                                      onPaymentClick={setDetailPayment}
                                    />
                                  )}
                                </>
                              )}
                            </Fragment>
                          )
                        })}
                        {rows.length === 0 && (
                          <tr><td colSpan={12} className="px-3 py-10 text-center text-sm text-gray-400">{isLoading ? 'A carregar…' : 'Sem documentos'}</td></tr>
                        )}
                      </tbody>
                      {rows.length > 0 && (() => {
                        // Sem filtros activos: mostrar totais globais vindos do endpoint /kpis
                        if (!hasFilters && combinedKpis) {
                          const globalCount = data?.total ?? 0
                          return (
                            <tfoot>
                              <tr className="border-t-2 border-gray-200 bg-gray-50 text-xs font-semibold text-gray-600 uppercase">
                                <td colSpan={4} className="px-3 py-2">Total ({globalCount} doc.)</td>
                                <td className="px-3 py-2 text-right text-gray-500 normal-case font-normal">Em aberto: {combinedKpis.countOpen}</td>
                                <td className="px-3 py-2 text-right text-gray-400">—</td>
                                <td className="px-3 py-2 text-right text-gray-500 normal-case font-normal">Vencidas: {combinedKpis.countOverdue > 0 ? <span className="text-red-600 font-semibold">{combinedKpis.countOverdue}</span> : 0}</td>
                                <td className="px-3 py-2 text-right text-gray-400">—</td>
                                <td className="px-3 py-2 text-right text-red-700">{formatCurrency(combinedKpis.totalPending)}</td>
                                <td colSpan={3} />
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
                              <td colSpan={6} className="px-3 py-2">Subtotal — {rows.length} nesta pág. ({data?.total ?? 0} filtrados)</td>
                              <td className="px-3 py-2 text-right">{formatCurrency(totalAmt)}</td>
                              <td className="px-3 py-2 text-right text-red-700">{formatCurrency(pendingAmt)}</td>
                              <td colSpan={4} />
                            </tr>
                          </tfoot>
                        )
                      })()}
                    </table>
                  </div>

                  {(data?.total ?? 0) > 25 && (
                    <div className="px-3 py-3 border-t border-gray-100 flex justify-between items-center">
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
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden text-sm">
                    {([
                      { key: 'abertas', label: 'Abertas' },
                      { key: 'fechadas', label: 'Fechadas' },
                      { key: 'futuras', label: 'Futuras' },
                      { key: 'programadas', label: 'Programadas' },
                    ] as const).map((t) => (
                      <button key={t.key}
                        onClick={() => setOutrasSubTab(t.key)}
                        className={`px-4 py-1.5 font-medium transition-colors ${outrasSubTab === t.key ? 'bg-primary-50 text-primary-700' : 'text-gray-500 hover:bg-gray-50'}`}>
                        {t.label} <span className="ml-1 text-xs text-gray-400">{outrasCount[t.key]}</span>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setShowNewOutras(true)} className="btn-primary flex items-center gap-2">
                    <Plus className="w-4 h-4" />Nova Operação
                  </button>
                </div>

                <div className="card">
                  <div className="px-3 py-4 border-b border-gray-100 flex gap-3 items-center flex-wrap">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                      <input
                        className="input pl-8 text-sm py-1 w-44"
                        placeholder="Fornecedor ou referência..."
                        value={outrasFilter.entitySearch}
                        onChange={(e) => setOutrasFilter({ entitySearch: e.target.value })}
                      />
                      {outrasFilter.entitySearch && (
                        <button onClick={() => setOutrasFilter({ entitySearch: '' })} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {outrasSubTab === 'abertas' && (
                      <select className="input w-auto text-sm py-1" value={outrasFilter.statusFilter} onChange={(e) => setOutrasFilter({ statusFilter: e.target.value })}>
                        <option value="">Todos os estados</option>
                        <option value="OPEN,PARTIAL">Pendente</option>
                        <option value="OPEN">Emitido / Em aberto</option>
                        <option value="PARTIAL">Parcialmente liquidado</option>
                        <option value="SETTLED">Liquidado</option>
                        <option value="VOID">Anulado</option>
                      </select>
                    )}
                    <DateRangePopover
                      label="Data doc."
                      startDate={outrasFilter.docDateFrom}
                      endDate={outrasFilter.docDateTo}
                      onChange={(s, e) => setOutrasFilter({ docDateFrom: s, docDateTo: e })}
                    />
                    <DateRangePopover
                      label="Vencimento"
                      startDate={outrasFilter.dueDateFrom}
                      endDate={outrasFilter.dueDateTo}
                      onChange={(s, e) => setOutrasFilter({ dueDateFrom: s, dueDateTo: e })}
                    />
                    <DateRangePopover
                      label="Pagamento"
                      startDate={outrasFilter.paymentDateFrom}
                      endDate={outrasFilter.paymentDateTo}
                      onChange={(s, e) => setOutrasFilter({ paymentDateFrom: s, paymentDateTo: e })}
                    />
                    {outrasHasFilters(outrasFilter) && (
                      <button onClick={clearOutrasFilter} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 px-2 py-1.5 hover:bg-gray-50 rounded-lg transition-colors">
                        <X className="w-3.5 h-3.5" /> Limpar
                      </button>
                    )}
                  </div>
                  {renderBulkBar()}
                  <div ref={hScroll} className="overflow-x-auto">
                    <table className="w-full table-fixed text-sm min-w-[1180px] lg:min-w-0">
                      <thead>
                        <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                          <th className="w-12 px-3 py-3 select-none">
                            <input
                              type="checkbox"
                              className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                              checked={allSelected(outrasVisibleIds)}
                              onChange={(e) => toggleSelectMany(outrasVisibleIds, e.target.checked)}
                            />
                          </th>
                          <th className="w-12 px-2 py-3" />
                          <th onClick={() => toggleSort('reference')} className="text-left pl-1 pr-3 py-3 cursor-pointer hover:text-gray-700 select-none">Documento <SortIcon field="reference" /></th>
                          <th onClick={() => toggleSort('entityName')} className="text-left px-3 py-3 cursor-pointer hover:text-gray-700 select-none">Fornecedor <SortIcon field="entityName" /></th>
                          <th onClick={() => toggleSort('dueDate')} className="text-left px-3 py-3 cursor-pointer hover:text-gray-700 select-none">Vencimento <SortIcon field="dueDate" /></th>
                          <th onClick={() => toggleSort('promisedPaymentDate')} className="text-left pl-3 pr-1 py-3 cursor-pointer hover:text-gray-700 select-none">Pagamento <SortIcon field="promisedPaymentDate" /></th>
                          <th onClick={() => toggleSort('totalAmount')} className="text-center pl-1 pr-3 py-3 cursor-pointer hover:text-gray-700 select-none">Total <SortIcon field="totalAmount" /></th>
                          <th onClick={() => toggleSort('pendingAmount')} className="text-center px-3 py-3 cursor-pointer hover:text-gray-700 select-none">Pendente <SortIcon field="pendingAmount" /></th>
                          <th onClick={() => toggleSort('status')} className="text-left px-3 py-3 cursor-pointer hover:text-gray-700 select-none">Estado <SortIcon field="status" /></th>
                          <th className="text-left px-3 py-3">Categoria</th>
                          <th className="text-left px-3 py-3">Budget</th>
                          <th className="w-16 px-3 py-3" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {(() => {
                          const renderRow = (p: Payable) => {
                            const isSplit = (p.children ?? []).some((c) => !c.recurrenceId)
                            const displayDate = isSplit && p.promisedPaymentDate ? p.promisedPaymentDate : p.dueDate
                            const now = Date.now()
                            const due = new Date(displayDate).getTime()
                            const isActive = p.status !== 'SETTLED' && p.status !== 'VOID'
                            const overdue = isActive && due < now
                            const daysOverdue = overdue ? Math.floor((now - due) / 86400000) : 0
                            const daysUntil = isActive && !overdue ? Math.floor((due - now) / 86400000) : -1
                            return (
                              <tr key={`o-${p.id}`} className="hover:bg-primary-50 transition-colors group cursor-pointer" onClick={() => { setPanelDoc(p); setPanelTocDoc(null); setPanelTab((p.children ?? []).some((c) => !c.recurrenceId) ? 'parcelas' : 'details'); setPanelSection(null); setPanelPromisedDate(p.promisedPaymentDate?.slice(0, 10) ?? ''); setSplitCount(2); setSplitValueMode('EUR') }}>
                                <td className="px-3 py-3 align-top">
                                  <input
                                    type="checkbox"
                                    className="w-4 h-4 mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer flex-shrink-0"
                                    checked={selectedIds.has(p.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={() => toggleSelect(p.id)}
                                  />
                                </td>
                                <td className="px-2 py-3 align-top whitespace-nowrap">
                                  <DocLabels splitCount={(p.children ?? []).filter((c) => !c.recurrenceId).length} />
                                </td>
                                <td className="pl-1 pr-3 py-3">
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-medium text-gray-900">{p.reference}</span>
                                    </div>
                                    <div className="text-xs text-gray-400">{p.documentDate ? formatDate(p.documentDate) : ''}{p.description ? ` · ${p.description}` : ''}</div>
                                  </div>
                                </td>
                                <td className="px-3 py-3 text-gray-700 truncate">
                                  {p.tocSupplierId ? (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); navigate(`/empresa/fornecedores/${p.tocSupplierId}`, { state: { from: '/contas-a-pagar', fromLabel: 'Contas a Pagar' } }) }}
                                      className="text-primary-600 hover:underline text-left"
                                    >
                                      {p.entityName}
                                    </button>
                                  ) : (
                                    p.entityName
                                  )}
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap">
                                  <div className={overdue ? 'text-red-600 font-medium' : 'text-gray-500'}>{formatDate(displayDate)}</div>
                                  {overdue && daysOverdue > 0 && <div className="text-xs text-red-400">{daysOverdue} dias</div>}
                                  {!overdue && daysUntil >= 0 && daysUntil <= 14 && <div className="text-xs text-amber-500">{daysUntil === 0 ? 'hoje' : `${daysUntil}d`}</div>}
                                </td>
                                <td className="pl-3 pr-1 py-3 whitespace-nowrap">{(() => {
                                  const payDate = p.promisedPaymentDate ?? p.dueDate
                                  const overdue = (p.status === 'OPEN' || p.status === 'PARTIAL') && new Date(payDate).getTime() < Date.now()
                                  return <span className={overdue ? 'text-red-600 font-medium' : 'text-gray-500'}>{formatDate(payDate)}</span>
                                })()}</td>
                                <td className="pl-1 pr-3 py-3 text-center text-gray-700">{formatCurrency(p.totalAmount)}</td>
                                <td className="px-3 py-3 text-center">
                                  <div className="font-semibold text-red-700">{formatCurrency(p.pendingAmount)}</div>
                                  {p.status === 'PARTIAL' && Number(p.paidAmount) > 0 && (
                                    <div className="text-xs text-gray-400">pago: {formatCurrency(Number(p.paidAmount))}</div>
                                  )}
                                </td>
                                <td className="px-3 py-3"><Badge variant={statusVariant(p.status)}>{statusLabel(p.status, p._statusToc === 'SETTLED')}</Badge></td>
                                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                                  <InlineCategoryPicker
                                    category={p.category}
                                    categories={categories}
                                    typeLabel="Despesa"
                                    onSelect={(categoryId) => classify.mutate({ id: p.id, categoryId })}
                                  />
                                </td>
                                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                                  <InlineBudgetPicker
                                    budget={p.budget}
                                    budgets={budgets}
                                    onSelect={(budgetId) => classifyBudget.mutate({ id: p.id, budgetId })}
                                  />
                                </td>
                                <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      title="Editar"
                                      onClick={() => {
                                        setEditId(p.id)
                                        setEditRow(p)
                                        setEditForm({
                                          categoryId: p.category?.id ?? '',
                                          entityName: p.entityName,
                                          reference: p.reference,
                                          documentDate: p.documentDate?.slice(0, 10) ?? '',
                                          dueDate: p.dueDate.slice(0, 10),
                                          totalAmount: String(p.totalAmount),
                                          description: p.description ?? '',
                                        })
                                      }}
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
                                    {p.status !== 'VOID' && p.status !== 'SETTLED' && (
                                      <button
                                        title="Anular"
                                        onClick={() => voidPayable.mutate(p.id)}
                                        className="p-1 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded transition-colors"
                                      >
                                        <XCircle className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    <button
                                      title="Eliminar"
                                      onClick={() => setDeleteRow(p)}
                                      className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          }

                          if (outrasRows.length === 0) {
                            return <tr><td colSpan={12} className="px-3 py-16 text-center text-sm text-gray-400">Sem operações registadas. Usa o botão acima para registar a primeira operação.</td></tr>
                          }

                          return outrasRows.map(renderRow)
                        })()}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

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

            <Modal open={!!editId} onClose={() => { setEditId(null); setEditRow(null) }} title="Editar Conta a Pagar" size="lg">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="label">Categoria</label>
                  <select className="input" value={editForm.categoryId} onChange={(e) => setEditForm({ ...editForm, categoryId: e.target.value })}>
                    <option value="">Selecionar...</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="label">Fornecedor / Entidade</label>
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
                  <input type="date" className="input" value={editForm.documentDate} onChange={(e) => setEditForm({ ...editForm, documentDate: pickWorkday(e.target.value, editForm.documentDate) })} />
                </div>
                <div>
                  <label className="label">Data Vencimento</label>
                  <input type="date" className="input" value={editForm.dueDate} onChange={(e) => setEditForm({ ...editForm, dueDate: pickWorkday(e.target.value, editForm.dueDate) })} />
                </div>
                <div className="col-span-2">
                  <label className="label">Descrição</label>
                  <input className="input" value={editForm.description} placeholder="(opcional)" onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
                </div>
              </div>
              {updatePayable.isError && (
                <p className="mt-3 text-sm text-red-600 bg-white border border-red-200 rounded-lg px-3 py-2">{(updatePayable.error as Error).message}</p>
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
                    updatePayable.mutate({ id: editId, data: body })
                  }}
                  className="btn-primary flex-1"
                  disabled={updatePayable.isPending || !editForm.entityName || !editForm.dueDate}
                >
                  {updatePayable.isPending ? 'A guardar...' : 'Guardar'}
                </button>
              </div>
            </Modal>

            <Modal open={!!deleteRow} onClose={() => setDeleteRow(null)} title="Eliminar Conta a Pagar">
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  O documento <span className="font-semibold text-gray-900">{deleteRow?.reference}</span> de{' '}
                  <span className="font-semibold text-gray-900">{deleteRow?.entityName}</span> será permanentemente eliminado. Esta acção não pode ser revertida.
                </p>
                {deletePayable.isError && (
                  <p className="text-sm text-red-600 bg-white border border-red-200 rounded-lg px-3 py-2">{(deletePayable.error as Error).message}</p>
                )}
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setDeleteRow(null)} className="btn-secondary flex-1">Cancelar</button>
                  <button
                    onClick={() => deleteRow && deletePayable.mutate(deleteRow.id)}
                    className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                    disabled={deletePayable.isPending}
                  >
                    {deletePayable.isPending ? 'A eliminar...' : 'Eliminar'}
                  </button>
                </div>
              </div>
            </Modal>

            <Modal open={showNew} onClose={() => setShowNew(false)} title="Nova Conta a Pagar" size="lg">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="label">Categoria</label>
                  <select className="input" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                    <option value="">Selecionar...</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Categoria de Budget <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <select className="input" value={form.budgetCategoryId} onChange={(e) => setForm({ ...form, budgetCategoryId: e.target.value })}>
                    <option value="">Sem categoria de budget</option>
                    {budgetCategories.map((bc) => <option key={bc.id} value={bc.id}>{bc.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Budget <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <select className="input" value={form.budgetId} onChange={(e) => setForm({ ...form, budgetId: e.target.value })}>
                    <option value="">Auto pela categoria</option>
                    {budgets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="label">Fornecedor / Entidade</label>
                  <input className="input" value={form.entityName} onChange={(e) => setForm({ ...form, entityName: e.target.value })} />
                </div>
                <div>
                  <label className="label">NIF Fornecedor <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <input className="input" value={form.entityNif} onChange={(e) => setForm({ ...form, entityNif: e.target.value })} placeholder="123456789" />
                </div>
                <div>
                  <label className="label">Nº Documento</label>
                  <input className="input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="FC2024/001" />
                </div>
                <div>
                  <label className="label">Valor (€)</label>
                  <input type="number" className="input" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} />
                </div>
                <div><label className="label">Data Vencimento <span className="text-red-500">*</span></label><WorkdayDatePicker value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} /></div>
                <div className="col-span-2"><label className="label">Descrição / Notas</label><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
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
                        <option value="DAILY">Diariamente</option>
                        <option value="WEEKLY">Semanalmente</option>
                        <option value="MONTHLY">Mensal</option>
                        <option value="QUARTERLY">Trimestral</option>
                        <option value="SEMIANNUAL">Semestral</option>
                        <option value="ANNUAL">Anual</option>
                      </select>
                    </div>
                    {recForm.frequency === 'WEEKLY' && (
                      <div className="col-span-2">
                        <label className="label">Dias da semana</label>
                        <div className="flex gap-1.5 flex-wrap">
                          {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((d, i) => (
                            <button key={i} type="button"
                              onClick={() => {
                                const cur = recForm.daysOfWeek
                                setRecForm({ ...recForm, daysOfWeek: cur.includes(i) ? (cur.length > 1 ? cur.filter(x => x !== i) : cur) : [...cur, i].sort() })
                              }}
                              className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${recForm.daysOfWeek.includes(i) ? 'bg-primary-600 border-primary-600 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                            >{d}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    {['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'].includes(recForm.frequency) && (
                      <div className="col-span-2">
                        <label className="label">Período de facturação</label>
                        <DayOfMonthRangePicker
                          startDate={recForm.cycleStartDate}
                          endDate={recForm.cycleEndDate}
                          onStartChange={(d) => setRecForm({ ...recForm, cycleStartDate: d, cycleEndDate: recForm.cycleEndDate && recForm.cycleEndDate >= d ? recForm.cycleEndDate : d })}
                          onEndChange={(d) => setRecForm({ ...recForm, cycleEndDate: d })}
                        />
                      </div>
                    )}
                    <div className="col-span-2">
                      <label className="label">Terminar</label>
                      <select className="input" value={recForm.endType} onChange={(e) => setRecForm({ ...recForm, endType: e.target.value as typeof recForm.endType, endDate: '', occurrences: '' })}>
                        <option value="none">Sem data de fim</option>
                        <option value="date">Na data</option>
                        <option value="occurrences">Após X ocorrências</option>
                      </select>
                    </div>
                    {recForm.endType === 'date' && (
                      <div className="col-span-2">
                        <label className="label">Data de fim da recorrência</label>
                        <input type="date" className="input" value={recForm.endDate} onChange={(e) => setRecForm({ ...recForm, endDate: pickWorkday(e.target.value, recForm.endDate) })} />
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
                <button onClick={() => { setShowNew(false); setRecForm(emptyRecurrence) }} className="btn-secondary flex-1">Cancelar</button>
                <button
                  onClick={() => create.mutate()}
                  className="btn-primary flex-1"
                  disabled={(() => {
                    if (create.isPending || !form.totalAmount || !form.dueDate) return true
                    const isMonthlyRec = recForm.isRecurrent && ['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'].includes(recForm.frequency)
                    if (isMonthlyRec && (!recForm.cycleStartDate || !recForm.cycleEndDate || recForm.cycleEndDate < recForm.cycleStartDate)) return true
                    if (recForm.isRecurrent && recForm.endType === 'date') {
                      if (!recForm.endDate) return true
                      if (recForm.endDate <= form.dueDate) return true
                    }
                    return false
                  })()}
                >
                  {create.isPending ? 'A guardar...' : (recForm.isRecurrent ? 'Criar Recorrente' : 'Criar')}
                </button>
              </div>
            </Modal>

            <Modal open={showNewOutras} onClose={() => { setShowNewOutras(false); setOutrasForm(emptyOutrasForm); setRecForm(emptyRecurrence); setOutrasContact(null); setOutrasContactSearch('') }} title="Nova Operação" size="lg">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="label">Categoria</label>
                  <select className="input" value={outrasForm.categoryId} onChange={(e) => setOutrasForm({ ...outrasForm, categoryId: e.target.value })}>
                    <option value="">Selecionar...</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Categoria de Budget <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <select className="input" value={outrasForm.budgetCategoryId} onChange={(e) => setOutrasForm({ ...outrasForm, budgetCategoryId: e.target.value })}>
                    <option value="">Sem categoria de budget</option>
                    {budgetCategories.map((bc) => <option key={bc.id} value={bc.id}>{bc.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Budget <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <select className="input" value={outrasForm.budgetId} onChange={(e) => setOutrasForm({ ...outrasForm, budgetId: e.target.value })}>
                    <option value="">Auto pela categoria</option>
                    {budgets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="label">Entidade / Fonte</label>
                  <div className="relative">
                    {outrasContact ? (
                      <div className="input flex items-center gap-2 bg-gray-50 cursor-default">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800 truncate">{outrasContact.business_name as string}</div>
                          {outrasContact.tax_registration_number && <div className="text-xs text-gray-400">NIF {outrasContact.tax_registration_number as string}</div>}
                        </div>
                        <button onClick={() => { setOutrasContact(null); setOutrasContactSearch(''); setOutrasForm({ ...outrasForm, entityName: '', entityNif: '' }) }} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <>
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                        <input
                          className="input pl-8"
                          placeholder="Pesquisar fornecedor..."
                          value={outrasContactSearch}
                          onChange={(e) => setOutrasContactSearch(e.target.value)}
                          onFocus={() => setShowOutrasContactDropdown(true)}
                          onBlur={() => setTimeout(() => setShowOutrasContactDropdown(false), 150)}
                        />
                      </>
                    )}
                    {showOutrasContactDropdown && !outrasContact && (
                      <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {tocSuppliers.filter(c => !outrasContactSearch || (c.business_name ?? '').toLowerCase().includes(outrasContactSearch.toLowerCase()) || (c.tax_registration_number ?? '').includes(outrasContactSearch)).slice(0, 10).length === 0 ? (
                          <div className="px-4 py-3 text-sm text-gray-400">
                            {tocSuppliers.length === 0 ? 'Sem fornecedores disponíveis' : 'Nenhum fornecedor encontrado'}
                          </div>
                        ) : tocSuppliers.filter(c => !outrasContactSearch || (c.business_name ?? '').toLowerCase().includes(outrasContactSearch.toLowerCase()) || (c.tax_registration_number ?? '').includes(outrasContactSearch)).slice(0, 10).map(c => (
                          <button
                            key={c.id}
                            className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex flex-col gap-0.5"
                            onMouseDown={(e) => { e.preventDefault(); setOutrasContact(c); setOutrasForm({ ...outrasForm, entityName: c.business_name ?? '', entityNif: c.tax_registration_number ?? '' }); setOutrasContactSearch(''); setShowOutrasContactDropdown(false) }}
                          >
                            <span className="font-medium text-gray-800 text-sm">{c.business_name}</span>
                            {c.tax_registration_number && <span className="text-xs text-gray-400">NIF {c.tax_registration_number}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="label">NIF</label>
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
                  <label className="label">Referência</label>
                  <input className="input" value={outrasForm.reference} onChange={(e) => setOutrasForm({ ...outrasForm, reference: e.target.value })} placeholder="REF001" />
                </div>
                <div>
                  <label className="label">Valor (€) <span className="text-red-500">*</span></label>
                  <input type="number" className="input" value={outrasForm.totalAmount} onChange={(e) => setOutrasForm({ ...outrasForm, totalAmount: e.target.value })} placeholder="0.00" />
                </div>
                <div>
                  <label className="label">Data Vencimento <span className="text-red-500">*</span></label>
                  <WorkdayDatePicker value={outrasForm.dueDate} onChange={(v) => setOutrasForm({ ...outrasForm, dueDate: v })} />
                </div>
                <div className="col-span-2">
                  <label className="label">Descrição</label>
                  <input className="input" value={outrasForm.description} onChange={(e) => setOutrasForm({ ...outrasForm, description: e.target.value })} placeholder="Notas sobre a operação" />
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
                      <label className="label">Período de facturação</label>
                      <DayOfMonthRangePicker
                        startDate={recForm.cycleStartDate}
                        endDate={recForm.cycleEndDate}
                        onStartChange={(d) => setRecForm({ ...recForm, cycleStartDate: d, cycleEndDate: recForm.cycleEndDate && recForm.cycleEndDate >= d ? recForm.cycleEndDate : d })}
                        onEndChange={(d) => setRecForm({ ...recForm, cycleEndDate: d })}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="label">Terminar</label>
                      <select className="input" value={recForm.endType} onChange={(e) => setRecForm({ ...recForm, endType: e.target.value as typeof recForm.endType, endDate: '', occurrences: '' })}>
                        <option value="none">Sem data de fim</option>
                        <option value="date">Na data</option>
                        <option value="occurrences">Após X ocorrências</option>
                      </select>
                    </div>
                    {recForm.endType === 'date' && (
                      <div className="col-span-2">
                        <label className="label">Data de fim da recorrência</label>
                        <input type="date" className="input" value={recForm.endDate} onChange={(e) => setRecForm({ ...recForm, endDate: pickWorkday(e.target.value, recForm.endDate) })} />
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

              {createOutras.isError && (
                <p className="mt-3 text-sm text-red-600 bg-white border border-red-200 rounded-lg px-3 py-2">{(createOutras.error as Error).message}</p>
              )}
              <div className="flex gap-3 mt-6">
                <button onClick={() => { setShowNewOutras(false); setOutrasForm(emptyOutrasForm); setRecForm(emptyRecurrence); setOutrasContact(null); setOutrasContactSearch('') }} className="btn-secondary flex-1">Cancelar</button>
                <button
                  onClick={() => createOutras.mutate()}
                  className="btn-primary flex-1"
                  disabled={(() => {
                    if (createOutras.isPending || !outrasForm.totalAmount || !outrasForm.dueDate) return true
                    if (recForm.isRecurrent && (!recForm.cycleStartDate || !recForm.cycleEndDate || recForm.cycleEndDate < recForm.cycleStartDate)) return true
                    if (recForm.isRecurrent && recForm.endType === 'date') {
                      if (!recForm.endDate) return true
                      if (recForm.endDate <= outrasForm.dueDate) return true
                    }
                    return false
                  })()}
                >
                  {createOutras.isPending ? 'A guardar...' : (recForm.isRecurrent ? 'Criar Recorrente' : 'Criar')}
                </button>
              </div>
            </Modal>
          </div>
        </div>

        {/* ── Painel lateral de detalhes ── */}
        {panelDoc && (
          <div className="fixed inset-0 z-50 w-full bg-white flex flex-col overflow-hidden lg:sticky lg:inset-auto lg:top-0 lg:z-auto lg:w-80 xl:w-96 lg:flex-shrink-0 lg:h-[calc(100vh-4rem)] lg:border-l lg:border-gray-200">
            {/* Cabeçalho */}
            <div className="p-5 border-b border-gray-100">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-1">
                  {panelDoc.parentId && !panelDoc.recurrenceId && (
                    <button
                      onClick={async () => {
                        const parent = await api.get<Payable>(`/treasury/${selectedClientId}/payables/${panelDoc.parentId}`)
                        setPanelDoc(parent); setPanelTab((parent.children ?? []).some((c) => !c.recurrenceId) ? 'parcelas' : 'details'); setPanelSection(null)
                        setPanelPromisedDate(parent.promisedPaymentDate?.slice(0, 10) ?? '')
                        setSplitCount(2); setSplitValueMode('EUR')
                      }}
                      className="p-1 text-gray-400 hover:text-gray-700 rounded transition-colors"
                      title="Voltar à fatura mãe"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                  )}
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">Conta a Pagar</div>
                </div>
                <button onClick={() => { setPanelDoc(null); setPanelTocDoc(null) }} className="p-1 text-gray-400 hover:text-gray-700 rounded transition-colors"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-2xl font-bold text-gray-900">{formatCurrency(panelDoc.totalAmount)}</div>
                {(() => {
                  const tocRaw = panelTocDoc ?? panelDoc._tocRaw
                  const link = tocRaw && typeof tocRaw.public_link === 'string' ? tocRaw.public_link : null
                  return link ? (
                    <a
                      href={link}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Pré-visualizar documento"
                      className="text-gray-400 hover:text-primary-600 hover:bg-primary-50 p-1.5 rounded-lg transition-colors"
                    >
                      <Eye className="w-4 h-4 text-primary-600" />
                    </a>
                  ) : null
                })()}
              </div>
              <div className="text-sm font-medium mt-0.5">
                {panelDoc.tocSupplierId ? (
                  <button onClick={() => navigate(`/empresa/fornecedores/${panelDoc.tocSupplierId}`, { state: { from: '/contas-a-pagar', fromLabel: 'Contas a Pagar' } })} className="text-primary-700 hover:underline text-left">
                    {panelDoc.entityName || '—'}
                  </button>
                ) : (
                  <span className="text-primary-700">{panelDoc.entityName || '—'}</span>
                )}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{panelDoc.reference || '—'} · Venc. {formatDate(panelDoc.dueDate)} · Pag. {formatDate(panelDoc.promisedPaymentDate ?? panelDoc.dueDate)}</div>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <Badge variant={statusVariant(panelDoc.status)}>{statusLabel(panelDoc.status, panelDoc._statusToc === 'SETTLED', true)}</Badge>
                {panelDoc._statusDiffersFromToc && (
                  <span className="ml-1.5 text-[10px] text-amber-600 font-medium" title={`No TOConline: ${panelDoc._statusToc ?? '—'}`}>(Local)</span>
                )}
                {(() => {
                  const n = (panelDoc.children ?? []).filter((c) => !c.recurrenceId).length
                  return n > 0 ? (
                    <span title={`Dividida em ${n} parcelas`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[11px] font-medium">
                      <Scissors className="w-3 h-3" />Dividida em {n} {n === 1 ? 'parcela' : 'parcelas'}
                    </span>
                  ) : null
                })()}
                <InlineCategoryPicker
                  category={panelDoc.category}
                  categories={categories}
                  typeLabel="Despesa"
                  onSelect={(categoryId) => classify.mutate({ id: panelDoc.id, categoryId })}
                />
                {panelDoc.promisedPaymentDate && (
                  <span className="text-xs text-blue-600 flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(panelDoc.promisedPaymentDate)}</span>
                )}
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs flex-wrap">
                <span className="text-gray-500">Pendente: <span className="font-semibold text-gray-700">{formatCurrency(panelDoc.pendingAmount)}</span></span>
                {Number(panelDoc.paidAmount) > 0 && (
                  <span className="text-red-600">Pago: <span className="font-semibold">{formatCurrency(Number(panelDoc.paidAmount))}</span></span>
                )}
              </div>
            </div>

            {/* Pagamentos associados (TOC) */}
            {panelPayments.length > 0 && (
              <div className="border-b border-gray-100 px-4 py-3 space-y-2">
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">{panelPayments.length} {panelPayments.length === 1 ? 'pagamento associado' : 'pagamentos associados'}</div>
                {panelPayments.map((pm) => {
                  const paidForDoc = pm._paid_for_doc != null ? Number(pm._paid_for_doc) : null
                  const showSplit = paidForDoc != null && paidForDoc !== Number(pm.gross_total)
                  return (
                    <button key={String(pm.id)}
                      onClick={() => setDetailPayment(pm)}
                      className="w-full text-left rounded-lg border border-gray-200 p-2.5 hover:bg-primary-50 hover:border-primary-200 transition-colors">
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs text-gray-400">Pagamento</span>
                        <div className="text-right">
                          <div className="text-xs font-semibold text-gray-700">{formatCurrency(paidForDoc ?? pm.gross_total)}</div>
                          {showSplit && (
                            <div className="text-[10px] text-gray-400">de {formatCurrency(pm.gross_total)}</div>
                          )}
                        </div>
                      </div>
                      <div className="font-medium text-sm text-gray-900">{pm.document_no}</div>
                      <div className="text-xs text-gray-500">{pm.date ? formatDate(pm.date) : '—'}</div>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Tabs */}
            <div className="flex border-b border-gray-100">
              {(['parcelas', 'details', 'followups'] as const).map((t) => (
                <button key={t} onClick={() => { setPanelTab(t); setPanelSection(null) }}
                  className={`flex-1 py-2.5 text-sm font-medium transition-colors ${panelTab === t ? 'border-b-2 border-primary-600 text-primary-700' : 'text-gray-500 hover:text-gray-700'}`}>
                  {t === 'details' ? 'Detalhes' : t === 'parcelas' ? 'Parcelas' : 'Follow-ups'}
                </button>
              ))}
            </div>

            {/* Conteúdo */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {panelTab === 'details' && (
                <>
                  {/* Nota de liquidado */}
                  {panelDoc.status === 'SETTLED' && (
                    <div className="flex items-center gap-3 p-3.5 bg-green-50 border border-green-200 rounded-xl">
                      <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                        <CheckCircle className="w-4 h-4 text-green-700" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-green-900 text-sm">Liquidado</div>
                        <div className="text-xs text-green-600 mt-0.5">
                          {panelDoc._statusToc === 'SETTLED' ? 'Recibo emitido no TOConline' : 'Liquidado manualmente nesta plataforma'}
                        </div>
                      </div>
                      {panelDoc._statusToc === 'SETTLED' ? (
                        <span className="text-xs text-green-700/70 flex-shrink-0">Gerido no TOConline</span>
                      ) : (
                        <button
                          onClick={() => unsettlePayable.mutate(panelDoc.id)}
                          disabled={unsettlePayable.isPending}
                          className="text-xs text-green-700 hover:text-red-700 border border-green-200 hover:border-red-200 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-green-700 disabled:hover:border-green-200 disabled:hover:bg-transparent"
                        >
                          {unsettlePayable.isPending ? '...' : 'Anular'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Nota de pago — aguarda liquidação */}
                  {panelDoc.status === 'PAID' && (
                    <div className="flex items-center gap-3 p-3.5 bg-teal-50 border border-teal-200 rounded-xl">
                      <div className="w-9 h-9 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0">
                        <CreditCard className="w-4 h-4 text-teal-700" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-teal-900 text-sm">Pago</div>
                        <div className="text-xs text-teal-600 mt-0.5">
                          {panelDoc.tocPurchasesDocId ? 'Pagamento registado — liquida quando houver recibo no TOConline' : 'Pagamento registado — aguarda liquidação'}
                        </div>
                      </div>
                      <button
                        onClick={() => unsettlePayable.mutate(panelDoc.id)}
                        disabled={unsettlePayable.isPending}
                        className="text-xs text-teal-700 hover:text-red-700 border border-teal-200 hover:border-red-200 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-teal-700 disabled:hover:border-teal-200 disabled:hover:bg-transparent"
                      >
                        {unsettlePayable.isPending ? '...' : 'Anular'}
                      </button>
                    </div>
                  )}

                  {/* Marcar como Pago — bloqueado em recorrências futuras (dueDate > hoje) */}
                  {(panelDoc.status === 'OPEN' || panelDoc.status === 'PARTIAL') && (() => {
                    const isFutureRec = !!(panelDoc.recurrenceId && panelDoc.parentId && String(panelDoc.dueDate).slice(0, 10) > todayYmd)
                    return (
                      <button
                        onClick={() => {
                          if (isFutureRec) return
                          payPayable.mutate(panelDoc.id)
                        }}
                        disabled={payPayable.isPending || isFutureRec}
                        title={isFutureRec ? 'Recorrência futura — só pode ser paga a partir da data de vencimento' : undefined}
                        className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-200 hover:bg-teal-50 hover:border-teal-200 text-left transition-colors group disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <div className="w-9 h-9 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0 group-hover:bg-teal-200 transition-colors">
                          <CreditCard className="w-4 h-4 text-teal-700" />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 text-sm">Marcar como Pago</div>
                          <div className="text-xs text-gray-500">{isFutureRec ? 'Disponível a partir de ' + formatDate(panelDoc.dueDate) : 'Registar pagamento total (sem liquidar)'}</div>
                        </div>
                      </button>
                    )
                  })()}

                  {/* Marcar como Liquidada — direto ou a partir de "Pago" (não disponível em documentos TOC) */}
                  {panelDoc.origin !== 'TOCONLINE' && (panelDoc.status === 'OPEN' || panelDoc.status === 'PARTIAL' || panelDoc.status === 'PAID') && (() => {
                    const isFutureRec = !!(panelDoc.recurrenceId && panelDoc.parentId && String(panelDoc.dueDate).slice(0, 10) > todayYmd)
                    return (
                      <button
                        onClick={() => {
                          if (isFutureRec) return
                          settlePayable.mutate(panelDoc.id)
                        }}
                        disabled={settlePayable.isPending || isFutureRec}
                        title={isFutureRec ? 'Recorrência futura — só pode ser liquidada a partir da data de vencimento' : undefined}
                        className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-200 hover:bg-green-50 hover:border-green-200 text-left transition-colors group disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0 group-hover:bg-green-200 transition-colors">
                          <CheckCircle className="w-4 h-4 text-green-700" />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 text-sm">Marcar como Liquidada</div>
                          <div className="text-xs text-gray-500">{isFutureRec ? 'Disponível a partir de ' + formatDate(panelDoc.dueDate) : 'Registar recibo / liquidação total'}</div>
                        </div>
                      </button>
                    )
                  })()}

                  {/* Data prometida — bloqueada em faturas pagas/liquidadas */}
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <button
                      onClick={() => { if (panelDoc.status !== 'SETTLED' && panelDoc.status !== 'PAID') setPanelSection(panelSection === 'promised' ? null : 'promised') }}
                      disabled={panelDoc.status === 'SETTLED' || panelDoc.status === 'PAID'}
                      title={(panelDoc.status === 'SETTLED' || panelDoc.status === 'PAID') ? 'Fatura paga/liquidada — não é possível definir data de pagamento' : undefined}
                      className={`w-full flex items-center gap-3 p-3.5 text-left transition-colors group ${(panelDoc.status === 'SETTLED' || panelDoc.status === 'PAID') ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-50 hover:border-blue-200'}`}
                    >
                      <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200 transition-colors">
                        <Clock className="w-4 h-4 text-blue-700" />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-gray-900 text-sm">Definir Data Pagamento</div>
                        {panelDoc.promisedPaymentDate
                          ? <div className="text-xs text-blue-600">{formatDate(panelDoc.promisedPaymentDate)}</div>
                          : <div className="text-xs text-gray-500">Sem data prometida</div>
                        }
                      </div>
                    </button>
                    {panelSection === 'promised' && panelDoc.status !== 'SETTLED' && panelDoc.status !== 'PAID' && (
                      <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
                        <input type="date" className="input" value={panelPromisedDate} onChange={(e) => setPanelPromisedDate(pickWorkday(e.target.value, panelPromisedDate))} />
                        <div className="flex gap-2">
                          <button onClick={() => setPromisedDate.mutate({ id: panelDoc.id, date: panelPromisedDate || null })}
                            disabled={setPromisedDate.isPending} className="btn-primary flex-1 text-sm py-1.5">
                            {setPromisedDate.isPending ? 'A guardar...' : 'Guardar'}
                          </button>
                          {panelDoc.promisedPaymentDate && (
                            <button onClick={() => setPromisedDate.mutate({ id: panelDoc.id, date: null })}
                              disabled={setPromisedDate.isPending} className="btn-secondary text-sm py-1.5 px-3">
                              Remover
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Dividir Fatura — bloqueada em faturas pagas/liquidadas */}
                  {(panelDoc.status === 'OPEN' || panelDoc.status === 'PAID' || panelDoc.status === 'SETTLED') && !panelDoc.parentId && (panelDocDetail?.children ?? panelDoc.children ?? []).length === 0 && (
                    <div className="rounded-xl border border-gray-200 overflow-hidden">
                      <button
                        onClick={() => {
                          // Helper local: cria as parcelas iniciais com valores que somam exatamente o total.
                          const buildInitialInstallments = (doc: { totalAmount: number | string; dueDate: string }, n: number) => {
                            const amounts = distributeAmount(Number(doc.totalAmount), n)
                            return amounts.map((amount, i) => {
                              const d = new Date(doc.dueDate); d.setMonth(d.getMonth() + i)
                              return { amount: formatInstallmentValue(amount, 'EUR'), paymentDate: shiftToWorkday(d.toISOString().slice(0, 10)) }
                            })
                          }
                          if (panelSection !== 'split') {
                            setSplitInstallments(buildInitialInstallments(panelDoc, splitCount))
                            setSplitValueMode('EUR')
                          }
                          setPanelSection(panelSection === 'split' ? null : 'split')
                        }}
                        disabled={panelDoc.status === 'SETTLED' || panelDoc.status === 'PAID'}
                        title={(panelDoc.status === 'SETTLED' || panelDoc.status === 'PAID') ? 'Fatura paga/liquidada — não é possível dividir' : undefined}
                        className="w-full flex items-center gap-3 p-3.5 hover:bg-purple-50 text-left transition-colors group disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0 group-hover:bg-purple-200 transition-colors">
                          <Scissors className="w-4 h-4 text-purple-700" />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 text-sm">Dividir Fatura</div>
                          <div className="text-xs text-gray-500">Criar parcelas a partir desta fatura</div>
                        </div>
                      </button>
                      {panelSection === 'split' && panelDoc.status !== 'SETTLED' && panelDoc.status !== 'PAID' && (
                        <div className="px-4 pb-4 pt-3 border-t border-gray-100 space-y-3">
                          {/* Controlo do nº de parcelas */}
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-500 font-medium">Nº de parcelas</span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => {
                                  const n = Math.max(2, splitCount - 1)
                                  const total = Number(panelDoc.totalAmount)
                                  const values = splitValueMode === 'PCT' ? distributePct(n) : distributeAmount(total, n)
                                  setSplitCount(n)
                                  setSplitInstallments(Array.from({ length: n }, (_, i) => {
                                    const d = new Date(splitInstallments[i]?.paymentDate || panelDoc.dueDate)
                                    if (!splitInstallments[i]?.paymentDate) d.setMonth(d.getMonth() + i)
                                    return { amount: formatInstallmentValue(values[i], splitValueMode), paymentDate: shiftToWorkday(d.toISOString().slice(0, 10)) }
                                  }))
                                }}
                                className="w-6 h-6 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center justify-center text-sm font-bold"
                              >−</button>
                              <span className="w-8 text-center text-sm font-semibold text-gray-800">{splitCount}</span>
                              <button
                                onClick={() => {
                                  const n = splitCount + 1
                                  const total = Number(panelDoc.totalAmount)
                                  const values = splitValueMode === 'PCT' ? distributePct(n) : distributeAmount(total, n)
                                  setSplitCount(n)
                                  setSplitInstallments(Array.from({ length: n }, (_, i) => {
                                    const prevDate = splitInstallments[i - 1]?.paymentDate
                                    const d = prevDate
                                      ? (() => { const dd = new Date(prevDate); dd.setMonth(dd.getMonth() + 1); return dd })()
                                      : (() => { const dd = new Date(panelDoc.dueDate); dd.setMonth(dd.getMonth() + i); return dd })()
                                    const existingDate = splitInstallments[i]?.paymentDate || shiftToWorkday(d.toISOString().slice(0, 10))
                                    return { amount: formatInstallmentValue(values[i], splitValueMode), paymentDate: existingDate }
                                  }))
                                }}
                                className="w-6 h-6 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center justify-center text-sm font-bold"
                              >+</button>
                            </div>
                          </div>

                          {/* Toggle €/% */}
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-500 font-medium">Tipo de valor</span>
                            <div className="flex border border-gray-200 rounded-lg overflow-hidden text-xs">
                              <button
                                onClick={() => {
                                  if (splitValueMode === 'PCT') {
                                    const total = Number(panelDoc.totalAmount)
                                    const pcts = splitInstallments.map((x) => parseFloat(x.amount) || 0)
                                    const eurs = convertPctToEur(pcts, total)
                                    setSplitInstallments(splitInstallments.map((x, i) => ({ ...x, amount: formatInstallmentValue(eurs[i], 'EUR') })))
                                    setSplitValueMode('EUR')
                                  }
                                }}
                                className={`px-3 py-1 transition-colors ${splitValueMode === 'EUR' ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                              >€</button>
                              <button
                                onClick={() => {
                                  if (splitValueMode === 'EUR') {
                                    const total = Number(panelDoc.totalAmount)
                                    const eurs = splitInstallments.map((x) => parseFloat(x.amount) || 0)
                                    const pcts = convertEurToPct(eurs, total)
                                    setSplitInstallments(splitInstallments.map((x, i) => ({ ...x, amount: formatInstallmentValue(pcts[i], 'PCT') })))
                                    setSplitValueMode('PCT')
                                  }
                                }}
                                className={`px-3 py-1 transition-colors ${splitValueMode === 'PCT' ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                              >%</button>
                            </div>
                          </div>

                          {/* Lista de parcelas */}
                          <div className="flex gap-1.5 items-center text-[11px] text-gray-500 font-medium px-1">
                            <span className="w-4 flex-shrink-0" />
                            <span className="flex-1">Valor</span>
                            <span className="flex-1">Data de pagamento</span>
                            {splitInstallments.length > 2 && <span className="w-6" />}
                          </div>
                          {splitInstallments.map((inst, i) => (
                            <div key={i} className="flex gap-1.5 items-center">
                              <span className="text-xs text-gray-400 w-4 flex-shrink-0 text-right">{i + 1}.</span>
                              <div className="relative flex-1">
                                <input type="number" step={splitValueMode === 'EUR' ? '0.01' : '0.01'} min="0"
                                  max={splitValueMode === 'PCT' ? '100' : undefined}
                                  placeholder={splitValueMode === 'EUR' ? '0.00' : '0.00'}
                                  className="input text-sm py-1.5 pr-6 w-full"
                                  value={inst.amount}
                                  onChange={(e) => setSplitInstallments(splitInstallments.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">{splitValueMode === 'EUR' ? '€' : '%'}</span>
                              </div>
                              <input type="date" className="input text-sm py-1.5 flex-1"
                                value={inst.paymentDate}
                                onChange={(e) => setSplitInstallments(splitInstallments.map((x, j) => j === i ? { ...x, paymentDate: pickWorkday(e.target.value, x.paymentDate) } : x))} />
                              {splitInstallments.length > 2 && (
                                <button onClick={() => { setSplitInstallments(splitInstallments.filter((_, j) => j !== i)); setSplitCount(splitCount - 1) }} className="p-1 text-gray-300 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
                              )}
                            </div>
                          ))}

                          {/* Validação */}
                          {(() => {
                            const total = Number(panelDoc.totalAmount)
                            const sum = splitInstallments.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0)
                            if (splitValueMode === 'EUR') {
                              const diff = sum - total
                              if (diff > 0.001) {
                                const pct = total > 0 ? (diff / total * 100).toFixed(3) : '0.000'
                                return <p className="text-xs text-red-600 font-medium">Acima por {formatCurrency(diff)} ({pct}%) — soma: {formatCurrency(sum)}</p>
                              }
                              if (diff < -0.001) {
                                const pct = total > 0 ? (Math.abs(diff) / total * 100).toFixed(3) : '0.000'
                                return <p className="text-xs text-red-600 font-medium">Abaixo por {formatCurrency(Math.abs(diff))} ({pct}%) — soma: {formatCurrency(sum)}</p>
                              }
                              return <p className="text-xs text-green-600 font-medium">✓ Soma correcta: {formatCurrency(sum)}</p>
                            } else {
                              const diff = sum - 100
                              if (diff > 0.001) {
                                const eur = (diff / 100 * total)
                                return <p className="text-xs text-red-600 font-medium">Acima por {diff.toFixed(3)}% ({formatCurrency(eur)}) — total: {sum.toFixed(3)}%</p>
                              }
                              if (diff < -0.001) {
                                const eur = (Math.abs(diff) / 100 * total)
                                return <p className="text-xs text-red-600 font-medium">Abaixo por {Math.abs(diff).toFixed(3)}% ({formatCurrency(eur)}) — total: {sum.toFixed(3)}%</p>
                              }
                              return <p className="text-xs text-green-600 font-medium">✓ Total: 100%</p>
                            }
                          })()}

                          <button
                            onClick={() => {
                              const total = Number(panelDoc.totalAmount)
                              // Garante soma exata em € (em cêntimos) qualquer que seja o modo de input.
                              // No modo PCT, converte preservando soma; no EUR, ajusta a última parcela
                              // para absorver eventuais resíduos de edição manual.
                              const rawValues = splitInstallments.map((x) => parseFloat(x.amount) || 0)
                              const finalEurs = splitValueMode === 'PCT'
                                ? convertPctToEur(rawValues, total)
                                : (() => {
                                  // closeAmountsTo é safe mesmo se rawValues já somar total
                                  // (resíduo absorvido pela última parcela).
                                  const cents = rawValues.reduce((s, v) => s + Math.round(v * 100), 0)
                                  const target = Math.round(total * 100)
                                  if (cents === target) return rawValues
                                  return rawValues.map((v, i) =>
                                    i === rawValues.length - 1 ? (Math.round(v * 100) + (target - cents)) / 100 : v,
                                  )
                                })()
                              const installments = splitInstallments.map((x, i) => ({
                                amount: finalEurs[i],
                                promisedPaymentDate: x.paymentDate,
                              }))
                              splitPayable.mutate({ id: panelDoc.id, installments })
                            }}
                            disabled={(() => {
                              if (splitPayable.isPending || splitInstallments.some((x) => !x.amount || !x.paymentDate)) return true
                              const total = Number(panelDoc.totalAmount)
                              const sum = splitInstallments.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0)
                              if (splitValueMode === 'EUR') return Math.abs(sum - total) > 0.001
                              return Math.abs(sum - 100) > 0.001
                            })()}
                            className="btn-primary w-full text-sm py-1.5"
                          >
                            {splitPayable.isPending ? 'A dividir...' : `Confirmar divisão em ${splitInstallments.length} parcelas`}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Anexar documento — abaixo das restantes ações */}
                  {selectedClientId && (
                    <InvoiceAttachmentsButton
                      clientId={selectedClientId}
                      direction="PAYABLE"
                      docId={panelDoc.id}
                      origin={panelDoc.origin}
                    />
                  )}

                  {/* Info adicional */}
                  {(panelDoc.description || panelDoc.category) && (
                    <div className="mt-4 pt-4 border-t border-gray-100 space-y-2 text-xs text-gray-500">
                      {panelDoc.description && <div><span className="font-medium text-gray-700">Descrição:</span> {panelDoc.description}</div>}
                      {panelDoc.category && <div><span className="font-medium text-gray-700">Categoria:</span> {panelDoc.category.name}</div>}
                    </div>
                  )}
                </>
              )}

              {panelTab === 'parcelas' && (() => {
                const kids = panelDocDetail?.children ?? panelDoc.children ?? []
                if (kids.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center h-40 text-gray-400 text-sm text-center px-4">
                      <Scissors className="w-8 h-8 mb-2 opacity-30" />
                      Esta fatura não está dividida em parcelas
                    </div>
                  )
                }
                const allOpen = kids.every((c) => c.status === 'OPEN')
                return (
                  <div className="space-y-2">
                    <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">{kids.length} parcelas</div>
                    {kids.map((child, i) => (
                      <button key={child.id}
                        onClick={() => { setPanelDoc(child as Payable); setPanelTab('details'); setPanelSection(null); setPanelPromisedDate(child.promisedPaymentDate?.slice(0, 10) ?? ''); setSplitCount(2); setSplitValueMode('EUR') }}
                        className="w-full text-left rounded-lg border border-gray-200 p-2.5 hover:bg-primary-50 hover:border-primary-200 transition-colors">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs text-gray-400">Parcela {i + 1}</span>
                          <Badge variant={statusVariant(child.status)}>{statusLabel(child.status, false)}</Badge>
                        </div>
                        <div className="font-semibold text-sm text-gray-900">{formatCurrency(child.totalAmount)}</div>
                        <div className="text-xs text-gray-500">{child.reference} · Pag. {formatDate(child.promisedPaymentDate ?? child.dueDate)}</div>
                      </button>
                    ))}
                    {!panelDoc.recurrenceId && (
                      <button
                        onClick={() => unsplitPayable.mutate(panelDoc.id)}
                        disabled={unsplitPayable.isPending || !allOpen}
                        title={!allOpen ? 'Não é possível desfazer: algumas parcelas já foram pagas' : undefined}
                        className={`w-full text-xs px-3 py-1.5 rounded-lg transition-colors ${allOpen ? 'text-orange-700 hover:text-red-700 border border-orange-200 hover:border-red-300 hover:bg-red-50' : 'text-gray-400 border border-gray-200 cursor-not-allowed'}`}
                      >
                        {unsplitPayable.isPending ? 'A desfazer...' : 'Desfazer divisão'}
                      </button>
                    )}
                  </div>
                )
              })()}

              {panelTab === 'followups' && selectedClientId && (
                <FollowupsPanel
                  clientId={selectedClientId}
                  direction="PAYABLE"
                  doc={{
                    id: panelDoc.id,
                    reference: panelDoc.reference,
                    entityName: panelDoc.entityName,
                    totalAmount: panelDoc.totalAmount,
                    dueDate: panelDoc.dueDate,
                    origin: panelDoc.origin as 'TOC' | 'LOCAL',
                    tocPurchasesDocId: panelDoc.tocPurchasesDocId ?? (panelTocDoc ? String(panelTocDoc.id) : null),
                  }}
                />
              )}
            </div>
          </div>
        )}

        {createPortal(
          <PaymentDetailModal
            open={!!detailPayment}
            onClose={() => setDetailPayment(null)}
            payment={detailPayment}
            clientId={selectedClientId ?? ''}
            entityName={panelDoc?.entityName ?? ''}
            onInvoiceClick={(payableId) => {
              const match = (data?.items ?? []).find((p) => p._tocRaw && String(p._tocRaw.id) === String(payableId))
              if (!match || !match._tocRaw) return
              setPanelDoc(match)
              setPanelTocDoc(match._tocRaw)
              setPanelTab('details')
              setPanelSection(null)
              setDetailPayment(null)
            }}
          />,
          document.body
        )}
      </div>
    </>
  )
}
