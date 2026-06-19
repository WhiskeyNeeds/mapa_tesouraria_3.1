import { Fragment, useState, useMemo, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate, isWeekend, refSortKey, shiftToWorkday, statusLabel, statusVariant, tocStatusLabel } from '@/lib/utils'
import { distributeAmount, distributePct, convertEurToPct, convertPctToEur, formatInstallmentValue } from '@/lib/installmentMath'
import Badge from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import TocSyncStatus from '@/components/ui/TocSyncStatus'
import DateRangePopover from '@/components/ui/DateRangePopover'
import WorkdayDatePicker from '@/components/ui/WorkdayDatePicker'
import InlineCategoryPicker from '@/components/ui/InlineCategoryPicker'
import InlineBudgetPicker from '@/components/ui/InlineBudgetPicker'
import { DocLabels } from '@/components/treasury/DocLabels'
import { ReceivedPeriodToggle } from '@/components/treasury/ReceivedPeriodToggle'
import { useStickyHScrollbar } from '@/lib/useStickyHScrollbar'
import { Plus, RefreshCw, Trash2, XCircle, Search, X, CheckCircle, Download, ArrowUpDown, ArrowUp, ArrowDown, ArrowUpRight, Pencil, Repeat2, ChevronRight, ChevronDown, ChevronLeft, AlertTriangle, Clock, Scissors, CreditCard, Eye, Tags, Wallet, FileClock, CalendarClock, TimerOff } from 'lucide-react'
import FollowupsPanel from '@/components/followups/FollowupsPanel'
import InvoiceAttachmentsButton from '@/components/followups/InvoiceAttachmentsButton'

/** Separa o montante formatado do símbolo de moeda para os estilizar à parte. */
function splitMoney(value: number): { amount: string; symbol: string } {
  const s = formatCurrency(value)
  const m = s.match(/^(.*?)[\s  ]*(€)[\s  ]*$/)
  return m ? { amount: m[1].trim(), symbol: m[2] } : { amount: s, symbol: '' }
}

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
  _received_for_doc?: number | null
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
  tocCustomerId?: string | null
  recurrenceId?: string | null
  promisedPaymentDate?: string | null
  receivedDate?: string | null
  receiptReference?: string | null
  receiptAmount?: number | null
  parentId?: string | null
  settledVia?: 'LOCAL' | 'INSTALLMENTS' | 'RECONCILIATION' | null
  category?: { id: string; name: string; color?: string | null } | null
  budget?: { id: string; name: string; color?: string | null } | null
  children?: Array<{ id: string; reference: string; dueDate: string; totalAmount: number; pendingAmount: number; receivedAmount: number; status: string; entityName: string; promisedPaymentDate?: string | null; recurrenceId?: string | null }>
  _src?: 'local' | 'toc'
  _tocRaw?: TocSalesDoc | null
  _statusToc?: string | null
  _statusDiffersFromToc?: boolean
  _pendingActionDueAt?: string | null
}
interface Category { id: string; name: string; type: string; color?: string | null }
interface Budget { id: string; name: string; type: 'REVENUE' | 'EXPENSE'; status: 'ACTIVE' | 'ARCHIVED'; totalAmount: number; startDate: string; endDate: string; color?: string | null }
interface TocCustomer { id: string | number; business_name?: string; tax_identification_number?: string;[key: string]: unknown }

const emptyForm = {
  categoryId: '', entityName: '', entityNif: '', reference: '', description: '',
  dueDate: '', totalAmount: '', currency: 'EUR', budgetId: '',
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
  dueDate: '', totalAmount: '', budgetId: '',
}

// Identidade visual de cada cartão de ação rápida: ícone semântico + paleta.
// Classes estáticas (literais) para o Tailwind as detetar no purge.
const cardMeta = {
  uncategorized: { label: 'Sem categoria', Icon: Tags, chip: 'bg-amber-100 text-amber-600', chipActive: 'bg-amber-500 text-white', chipRing: 'ring-amber-200', glow: 'bg-amber-300', bar: 'bg-amber-400', activeBg: 'bg-amber-50 border-amber-200', num: 'text-amber-700' },
  unbudgeted: { label: 'Sem budget', Icon: Wallet, chip: 'bg-violet-100 text-violet-600', chipActive: 'bg-violet-500 text-white', chipRing: 'ring-violet-200', glow: 'bg-violet-300', bar: 'bg-violet-400', activeBg: 'bg-violet-50 border-violet-200', num: 'text-violet-700' },
  pending: { label: 'Pendentes / Em aberto', Icon: FileClock, chip: 'bg-blue-100 text-blue-600', chipActive: 'bg-blue-500 text-white', chipRing: 'ring-blue-200', glow: 'bg-blue-300', bar: 'bg-blue-400', activeBg: 'bg-blue-50 border-blue-200', num: 'text-blue-700' },
  overdue: { label: 'Vencidas', Icon: AlertTriangle, chip: 'bg-red-100 text-red-600', chipActive: 'bg-red-500 text-white', chipRing: 'ring-red-200', glow: 'bg-red-300', bar: 'bg-red-400', activeBg: 'bg-red-50 border-red-200', num: 'text-red-700' },
  thisWeek: { label: 'A receber esta semana', Icon: CalendarClock, chip: 'bg-teal-100 text-teal-600', chipActive: 'bg-teal-500 text-white', chipRing: 'ring-teal-200', glow: 'bg-teal-300', bar: 'bg-teal-400', activeBg: 'bg-teal-50 border-teal-200', num: 'text-teal-700' },
  pastDeadline: { label: 'Passou prazo pagamento', Icon: TimerOff, chip: 'bg-orange-100 text-orange-600', chipActive: 'bg-orange-500 text-white', chipRing: 'ring-orange-200', glow: 'bg-orange-300', bar: 'bg-orange-400', activeBg: 'bg-orange-50 border-orange-200', num: 'text-orange-700' },
} as const


type Row = { _src: 'local'; r: Receivable } | { _src: 'toc'; d: TocSalesDoc; item: Receivable }

function ReceiptDetailModal({
  open, onClose, receipt, clientId, entityName, onInvoiceClick,
}: {
  open: boolean
  onClose: () => void
  receipt: TocReceipt | null
  clientId: string
  entityName: string
  onInvoiceClick?: (receivableId: string | number) => void
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
                    const canNavigate = !!onInvoiceClick && line.receivable_id != null
                    return (
                      <tr
                        key={i}
                        className={`${i % 2 === 0 ? 'bg-slate-50/60' : 'bg-white'} ${canNavigate ? 'cursor-pointer hover:bg-primary-50' : ''}`}
                        onClick={canNavigate ? () => onInvoiceClick!(line.receivable_id as string | number) : undefined}
                      >
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

      </div>
    </div>
  )
}

function ReceiptSubRows({ clientId, tocDocId, entityName, onReceiptClick }: { clientId: string; tocDocId: string; entityName: string; onReceiptClick: (rc: TocReceipt) => void }) {
  const { data: receipts = [], isLoading } = useQuery<TocReceipt[]>({
    queryKey: ['toc-sales-receipts', clientId, tocDocId],
    queryFn: () => api.get(`/toconline/${clientId}/sales/${tocDocId}/receipts`),
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading) {
    return (
      <tr>
        <td colSpan={12} className="pl-14 py-2 text-xs text-gray-400 bg-gray-50/60 border-b border-gray-100">
          <RefreshCw className="inline w-3 h-3 animate-spin mr-1.5" />A carregar recibos...
        </td>
      </tr>
    )
  }

  if (!receipts.length) {
    return (
      <tr>
        <td colSpan={12} className="pl-14 py-2 text-xs text-gray-400 bg-gray-50/60 border-b border-gray-100">
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
          onClick={() => onReceiptClick(rc)}
        >
          <td className="px-3 py-2" />
          <td className="px-2 py-2" />
          <td className="pl-2 pr-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              <ChevronRight className="w-3 h-3 text-teal-400 flex-shrink-0" />
              <span className="text-gray-700 font-medium">{rc.document_no}</span>
            </div>
          </td>
          <td className="px-3 py-2 text-xs text-gray-500">{entityName}</td>
          <td className="px-3 py-2" />
          <td className="px-3 py-2 text-xs text-gray-500">{rc.date ? formatDate(rc.date) : '—'}</td>
          <td className="px-3 py-2" />
          <td className="px-3 py-2 text-right text-xs text-gray-600 font-medium">
            {(() => {
              const forDoc = rc._received_for_doc != null ? Number(rc._received_for_doc) : null
              const showSplit = forDoc != null && forDoc !== Number(rc.gross_total)
              return <>−{formatCurrency(forDoc ?? rc.gross_total)}{showSplit && <span className="block text-[10px] text-gray-400 font-normal">de {formatCurrency(rc.gross_total)}</span>}</>
            })()}
          </td>
          <td className="px-3 py-2" />
          <td className="px-3 py-2" />
          <td className="px-3 py-2" />
        </tr>
      ))}
    </>
  )
}

export default function ReceivablesPage() {
  const { selectedClientId, isTocEnabled } = useAuth()
  const navigate = useNavigate()
  // Barra de scroll horizontal fixa ao fundo da janela para as tabelas largas.
  // As tabelas Clientes/Outras são mutuamente exclusivas, por isso partilham
  // uma instância (só uma está montada de cada vez).
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
  const [editRow, setEditRow] = useState<Receivable | null>(null)
  const [editForm, setEditForm] = useState({ categoryId: '', entityName: '', reference: '', documentDate: '', dueDate: '', totalAmount: '', description: '' })
  const [deleteRow, setDeleteRow] = useState<Receivable | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  // Seleção para atribuição de categoria em massa (âmbito: página visível).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const [bulkBudgetId, setBulkBudgetId] = useState('')
  const [activeTab, setActiveTab] = useState<'clientes' | 'outras'>('clientes')
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
  const [outrasForm, setOutrasForm] = useState(emptyOutrasForm)
  const [showNewOutras, setShowNewOutras] = useState(false)
  const [outrasContact, setOutrasContact] = useState<TocCustomer | null>(null)
  const [outrasContactSearch, setOutrasContactSearch] = useState('')
  const [showOutrasContactDropdown, setShowOutrasContactDropdown] = useState(false)
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false)
  const [tocCustomerSearch, setTocCustomerSearch] = useState('')
  const [selectedTocCustomer, setSelectedTocCustomer] = useState<TocCustomer | null>(null)
  const customerInputRef = useRef<HTMLDivElement>(null)
  const [panelDoc, setPanelDoc] = useState<Receivable | null>(null)
  const [panelTocDoc, setPanelTocDoc] = useState<TocSalesDoc | null>(null)
  const [panelTab, setPanelTab] = useState<'details' | 'parcelas' | 'followups'>('details')
  const [panelSection, setPanelSection] = useState<null | 'promised' | 'split' | 'settle' | 'commit'>(null)
  const [panelPromisedDate, setPanelPromisedDate] = useState('')
  const [settleRef, setSettleRef] = useState('')
  const [settleDate, setSettleDate] = useState('')
  const [commitRef, setCommitRef] = useState('')
  const [commitAmount, setCommitAmount] = useState('')
  const [commitDate, setCommitDate] = useState('')
  const [detailReceipt, setDetailReceipt] = useState<TocReceipt | null>(null)
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
    queryKey: ['receivables-kpis', selectedClientId],
    queryFn: () => api.get<{ totalPending: number; countOpen: number; countOverdue: number; settledThisMonth: number; aging: Record<string, number>; cards: { uncategorized: number; unbudgeted: number; pending: number; overdue: number; dueThisWeek: number; pastPaymentDeadline: number } }>(`/treasury/${selectedClientId}/receivables/kpis`),
    enabled: !!selectedClientId,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['receivables', selectedClientId, activeTab, statusFilter, entitySearch, dueDateFrom, dueDateTo, docDateFrom, docDateTo, paymentDateFrom, paymentDateTo, sortBy, sortDir, page, isOverdueFilter, pastDeadlineFilter, uncategorizedFilter, unbudgetedFilter],
    queryFn: () => {
      // Cada separador pagina o seu próprio conjunto no servidor (bucket). As
      // "Outras Operações" são poucas (operações manuais) e têm sub-separadores
      // categorizados no cliente, por isso trazemos o conjunto completo.
      const bucket = activeTab === 'outras' ? 'outras' : 'clientes'
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
      return api.get<{ total: number; items: Receivable[] }>(`/treasury/${selectedClientId}/receivables?${params}`)
    },
    enabled: !!selectedClientId,
  })

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories-revenue', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/categories?type=REVENUE`),
    enabled: !!selectedClientId,
  })

  const { data: budgets = [] } = useQuery<Budget[]>({
    queryKey: ['budgets-revenue-active', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/budgets?type=REVENUE&status=ACTIVE`),
    enabled: !!selectedClientId,
  })

  const [budgetSuggestion, setBudgetSuggestion] = useState<{ budgetId: string; budgetName: string; ruleDescription: string } | null>(null)
  const [outrasBudgetSuggestion, setOutrasBudgetSuggestion] = useState<{ budgetId: string; budgetName: string; ruleDescription: string } | null>(null)

  const { data: panelDocDetail } = useQuery<Receivable>({
    queryKey: ['receivable-detail', selectedClientId, panelDoc?.id],
    queryFn: () => api.get(`/treasury/${selectedClientId}/receivables/${panelDoc!.id}`),
    enabled: !!selectedClientId && !!panelDoc?.id && panelDoc.origin !== 'TOC',
  })

  // ID do documento TOC para carregar recibos no painel (origem TOC ou local importado)
  const panelTocDocId = panelTocDoc?.id != null ? String(panelTocDoc.id) : panelDoc?.tocSalesDocId ?? null
  const { data: panelReceipts = [] } = useQuery<TocReceipt[]>({
    queryKey: ['toc-sales-receipts', selectedClientId, panelTocDocId],
    queryFn: () => api.get(`/toconline/${selectedClientId}/sales/${panelTocDocId}/receipts`),
    enabled: !!selectedClientId && !!panelTocDocId,
    staleTime: 5 * 60 * 1000,
  })

  const { data: tocCustomers = [] } = useQuery<TocCustomer[]>({
    queryKey: ['toc-customers', selectedClientId],
    queryFn: () => api.get(`/toconline/${selectedClientId}/customers`),
    enabled: !!selectedClientId && isTocEnabled,
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

  const create = useMutation({
    mutationFn: () => {
      const isMonthlyRec = recForm.isRecurrent && ['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL'].includes(recForm.frequency)
      // Recorrência: o dia em que repete vem da própria Data de Vencimento (a 1.ª data).
      const computedDocDate = isMonthlyRec ? shiftToWorkday(form.dueDate) : (form as { documentDate?: string }).documentDate
      const body: Record<string, unknown> = {
        ...form,
        dueDate: form.dueDate,
        ...(computedDocDate ? { documentDate: computedDocDate } : {}),
        totalAmount: parseFloat(form.totalAmount) || 0,
        entityNif: form.entityNif || undefined,
        budgetId: form.budgetId || undefined,
      }
      // Recorrências são estimadas e sem referência: o backend ignora-a, mas
      // evitamos enviá-la para manter o payload coerente.
      if (recForm.isRecurrent) delete body.reference
      if (recForm.isRecurrent) {
        body.recurrence = {
          frequency: recForm.frequency,
          ...(recForm.frequency === 'WEEKLY' ? { daysOfWeek: recForm.daysOfWeek.length ? recForm.daysOfWeek : [1] } : {}),
          ...(isMonthlyRec && form.dueDate ? { dayOfMonth: parseInt(form.dueDate.slice(8, 10)) } : {}),
          ...(recForm.endType === 'date' && recForm.endDate ? { endDate: recForm.endDate } : {}),
          ...(recForm.endType === 'occurrences' && recForm.occurrences ? { occurrences: parseInt(recForm.occurrences) } : {}),
        }
      }
      if (selectedTocCustomer) body.tocCustomerId = String(selectedTocCustomer.id)
      return api.post(`/treasury/${selectedClientId}/receivables`, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['receivables-kpis'] })
      setShowNew(false)
      setForm(emptyForm)
      setRecForm(emptyRecurrence)
      setSelectedTocCustomer(null)
      setTocCustomerSearch('')
      setBudgetSuggestion(null)
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
      setPanelDoc((d) => d && deleteRow && d.id === deleteRow.id ? null : d)
      toast.success('Documento eliminado.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const voidReceivable = useMutation({
    mutationFn: (id: string) => api.post(`/treasury/${selectedClientId}/receivables/${id}/void`, {}),
    onSuccess: (_, id) => { qc.invalidateQueries({ queryKey: ['receivables'] }); qc.invalidateQueries({ queryKey: ['receivables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] }); setPanelDoc((d) => d && d.id === id ? { ...d, status: 'VOID' } : d); toast.success('Documento anulado.') },
    onError: (e) => toast.error((e as Error).message),
  })

  const bulkCategory = useMutation({
    mutationFn: ({ ids, categoryId }: { ids: string[]; categoryId: string | null }) =>
      api.patch<{ updated: number; failed: number }>(`/treasury/${selectedClientId}/receivables/bulk-category`, { ids, categoryId }),
    onSuccess: (res, { categoryId }) => {
      qc.invalidateQueries({ queryKey: ['receivables'] }); qc.invalidateQueries({ queryKey: ['receivables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] })
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
      api.patch<{ updated: number; failed: number }>(`/treasury/${selectedClientId}/receivables/bulk-budget`, { ids, budgetId }),
    onSuccess: (res, { budgetId }) => {
      qc.invalidateQueries({ queryKey: ['receivables'] }); qc.invalidateQueries({ queryKey: ['receivables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] })
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
      api.patch<{ updated: number; failed: number }>(`/treasury/${selectedClientId}/receivables/bulk-status`, { ids, status }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['receivables'] }); qc.invalidateQueries({ queryKey: ['receivables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] })
      toast.success(res.failed > 0
        ? `Estado aplicado a ${res.updated} de ${res.updated + res.failed} documentos (${res.failed} falharam).`
        : `Estado aplicado a ${res.updated} documento(s).`)
      setSelectedIds(new Set())
    },
    onError: (e) => toast.error((e as Error).message),
  })
  const bulkDeleteMut = useMutation({
    mutationFn: (ids: string[]) =>
      api.post<{ updated: number; failed: number }>(`/treasury/${selectedClientId}/receivables/bulk-delete`, { ids }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['receivables'] }); qc.invalidateQueries({ queryKey: ['receivables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] })
      toast.success(res.failed > 0
        ? `Eliminados ${res.updated} de ${res.updated + res.failed} documentos (${res.failed} falharam).`
        : `${res.updated} documento(s) eliminado(s).`)
      setSelectedIds(new Set()); setBulkDeleteOpen(false)
    },
    onError: (e) => toast.error((e as Error).message),
  })
  // Atribuição unitária de categoria (picker inline na célula, como nos movimentos).
  const classify = useMutation({
    mutationFn: ({ id, categoryId }: { id: string; categoryId: string | null }) =>
      api.patch(`/treasury/${selectedClientId}/receivables/${id}`, { categoryId }),
    onSuccess: (_, { id, categoryId }) => {
      qc.invalidateQueries({ queryKey: ['receivables'] }); qc.invalidateQueries({ queryKey: ['receivables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] })
      // Update panel state immediately so user sees change without refresh
      setPanelDoc((d) => d ? { ...d, category: categories.find((c) => c.id === categoryId) ?? null } : d)
      qc.setQueryData<Receivable>(['receivable-detail', selectedClientId, id], (old) => old ? { ...old, category: categories.find((c) => c.id === categoryId) ?? null, categoryId } : old)
      toast.success(categoryId === null ? 'Categoria removida.' : 'Documento classificado.')
    },
    onError: (e) => toast.error((e as Error).message),
  })
  // Atribuição unitária de budget (picker inline na célula, gémeo da categoria).
  const classifyBudget = useMutation({
    mutationFn: ({ id, budgetId }: { id: string; budgetId: string | null }) =>
      api.patch(`/treasury/${selectedClientId}/receivables/${id}`, { budgetId }),
    onSuccess: (_, { id, budgetId }) => {
      qc.invalidateQueries({ queryKey: ['receivables'] }); qc.invalidateQueries({ queryKey: ['receivables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] })
      // Update panel state immediately so user sees change without refresh
      setPanelDoc((d) => d ? { ...d, budget: budgets.find((b) => b.id === budgetId) ?? null } : d)
      qc.setQueryData<Receivable>(['receivable-detail', selectedClientId, id], (old) => old ? { ...old, budget: budgets.find((b) => b.id === budgetId) ?? null, budgetId } : old)
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

  const payReceivable = useMutation({
    mutationFn: (id: string) => api.post(`/treasury/${selectedClientId}/receivables/${id}/pay`, {}),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['receivables'] }); qc.invalidateQueries({ queryKey: ['receivables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] })
      const payChildren = <T extends { recurrenceId?: string | null; status: string; totalAmount: number | string }>(arr: T[] | undefined) =>
        (arr ?? []).map((c) => c.recurrenceId || c.status === 'PAID' || c.status === 'SETTLED' || c.status === 'VOID'
          ? c
          : { ...c, status: 'PAID', pendingAmount: 0, receivedAmount: Number(c.totalAmount) })
      setPanelDoc((d) => d ? {
        ...d,
        status: 'PAID',
        pendingAmount: 0,
        receivedAmount: d.totalAmount,
        promisedPaymentDate: null,
        children: payChildren(d.children),
      } : d)
      qc.setQueryData<Receivable>(['receivable-detail', selectedClientId, id], (old) => old ? {
        ...old,
        status: 'PAID',
        pendingAmount: 0,
        receivedAmount: old.totalAmount,
        promisedPaymentDate: null,
        children: payChildren(old.children),
      } : old)
      toast.success('Documento marcado como pago.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const settleReceivable = useMutation({
    mutationFn: (vars: { id: string; receiptReference?: string; date?: string }) =>
      api.post<Receivable>(`/treasury/${selectedClientId}/receivables/${vars.id}/settle`, { receiptReference: vars.receiptReference, date: vars.date }),
    onSuccess: (updated, vars) => {
      const id = vars.id
      qc.invalidateQueries({ queryKey: ['receivables'] }); qc.invalidateQueries({ queryKey: ['receivables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] })
      const settleChildren = <T extends { recurrenceId?: string | null; status: string; totalAmount: number | string }>(arr: T[] | undefined) =>
        (arr ?? []).map((c) => c.recurrenceId || c.status === 'SETTLED' || c.status === 'VOID'
          ? c
          : { ...c, status: 'SETTLED', pendingAmount: 0, receivedAmount: Number(c.totalAmount) })
      setPanelDoc((d) => d ? {
        ...d,
        status: 'SETTLED',
        pendingAmount: 0,
        receivedAmount: d.totalAmount,
        promisedPaymentDate: null,
        receiptReference: vars.receiptReference ?? d.receiptReference,
        receiptAmount: updated?.receiptAmount ?? d.receiptAmount,
        receivedDate: vars.date ?? d.receivedDate,
        children: settleChildren(d.children),
      } : d)
      // Sync the detail cache so panelDocDetail (used as primary source for children) reflects the change synchronously.
      qc.setQueryData<Receivable>(['receivable-detail', selectedClientId, id], (old) => old ? {
        ...old,
        status: 'SETTLED',
        pendingAmount: 0,
        receivedAmount: old.totalAmount,
        promisedPaymentDate: null,
        receiptReference: vars.receiptReference ?? old.receiptReference,
        children: settleChildren(old.children),
      } : old)
      setPanelSection(null)
      toast.success('Documento marcado como liquidado.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  // Promove uma fatura SCHEDULED (programada/estimada) para OPEN, fixando
  // referência, valor e data. O backend devolve a fatura atualizada.
  const commitReceivable = useMutation({
    mutationFn: (vars: { id: string; reference: string; amount: number; date: string }) =>
      api.post<Receivable>(`/treasury/${selectedClientId}/receivables/${vars.id}/commit`, { reference: vars.reference, amount: vars.amount, date: vars.date }),
    onSuccess: (updated, vars) => {
      const id = vars.id
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['receivables-kpis'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
      // A promoção altera os valores/datas projetadas — refrescar o dashboard.
      qc.invalidateQueries({ queryKey: ['dashboard-cashflow-statement'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setPanelDoc((d) => d && d.id === id ? {
        ...d,
        status: updated?.status ?? 'OPEN',
        reference: updated?.reference ?? vars.reference,
        totalAmount: updated?.totalAmount ?? vars.amount,
        pendingAmount: updated?.pendingAmount ?? vars.amount,
        dueDate: updated?.dueDate ?? vars.date,
      } : d)
      qc.setQueryData<Receivable>(['receivable-detail', selectedClientId, id], (old) => old ? { ...old, ...updated } : old)
      setPanelSection(null)
      toast.success('Fatura marcada como comprometida.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const unsettleReceivable = useMutation({
    mutationFn: (id: string) => api.post(`/treasury/${selectedClientId}/receivables/${id}/unsettle`, {}),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['receivables'] }); qc.invalidateQueries({ queryKey: ['receivables-kpis'] }); qc.invalidateQueries({ queryKey: ['activity'] })
      const revertChildren = <T extends { recurrenceId?: string | null; status: string; totalAmount: number | string }>(arr: T[] | undefined) =>
        (arr ?? []).map((c) => c.recurrenceId || (c.status !== 'SETTLED' && c.status !== 'PAID')
          ? c
          : { ...c, status: 'OPEN', pendingAmount: Number(c.totalAmount), receivedAmount: 0 })
      setPanelDoc((d) => d ? {
        ...d,
        status: 'OPEN',
        pendingAmount: d.totalAmount,
        receivedAmount: 0,
        children: revertChildren(d.children),
      } : d)
      qc.setQueryData<Receivable>(['receivable-detail', selectedClientId, id], (old) => old ? {
        ...old,
        status: 'OPEN',
        pendingAmount: old.totalAmount,
        receivedAmount: 0,
        children: revertChildren(old.children),
      } : old)
      toast.success('Liquidação anulada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const updateReceivable = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      api.patch(`/treasury/${selectedClientId}/receivables/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['receivables-kpis'] })
      // Edição de programada propaga aos filhos futuros — refresh do dashboard
      // (cashflow statement + cash positioning) para refletir os novos valores.
      qc.invalidateQueries({ queryKey: ['dashboard-cashflow-statement'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setEditId(null)
      setEditRow(null)
      toast.success('Documento atualizado.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const setPromisedDate = useMutation({
    mutationFn: ({ id, date }: { id: string; date: string | null }) =>
      api.patch(`/treasury/${selectedClientId}/receivables/${id}/promised-date`, { date }),
    onSuccess: (_, { date }) => {
      qc.invalidateQueries({ queryKey: ['receivables'] })
      // A data prometida alimenta os cartões "A receber esta semana" e "Passou
      // prazo pagamento" — refrescar os KPIs para a contagem mudar de imediato.
      qc.invalidateQueries({ queryKey: ['receivables-kpis'] })
      qc.invalidateQueries({ queryKey: ['activity'] })
      setPanelDoc((d) => d ? { ...d, promisedPaymentDate: date } : d)
      setPanelSection(null)
      toast.success(date ? 'Data prometida definida.' : 'Data prometida removida.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const unsplitReceivable = useMutation({
    mutationFn: (id: string) => api.post(`/treasury/${selectedClientId}/receivables/${id}/unsplit`, {}),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['receivables-kpis'] })
      qc.invalidateQueries({ queryKey: ['receivable-detail', selectedClientId, id] })
      setPanelDoc((prev) => prev ? { ...prev, status: 'OPEN', children: [] } : prev)
      toast.success('Divisão desfeita com sucesso.')
    },
    onError: () => toast.error('Não foi possível desfazer a divisão.'),
  })

  const splitReceivable = useMutation({
    mutationFn: ({ id, installments }: { id: string; installments: Array<{ promisedPaymentDate: string; amount: number }> }) =>
      api.post(`/treasury/${selectedClientId}/receivables/${id}/split`, { installments }),
    onSuccess: (children, { id }) => {
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['receivables-kpis'] })
      qc.invalidateQueries({ queryKey: ['receivable-detail', selectedClientId, id] })
      setPanelDoc((prev) => prev ? { ...prev, children: children as Receivable['children'] } : prev)
      setPanelSection(null)
      toast.success('Fatura dividida com sucesso.')
    },
    onError: (e) => toast.error((e as Error).message),
  })


  const createOutras = useMutation({
    mutationFn: () => {
      const computedDocDate = recForm.isRecurrent ? shiftToWorkday(outrasForm.dueDate) : undefined
      const body: Record<string, unknown> = {
        ...(outrasForm.categoryId ? { categoryId: outrasForm.categoryId } : {}),
        entityName: outrasForm.entityName || undefined,
        entityNif: outrasForm.entityNif || undefined,
        ...(recForm.isRecurrent ? {} : { reference: outrasForm.reference || undefined }),
        description: outrasForm.description || undefined,
        dueDate: outrasForm.dueDate,
        ...(computedDocDate ? { documentDate: computedDocDate } : {}),
        totalAmount: parseFloat(outrasForm.totalAmount) || 0,
        budgetId: outrasForm.budgetId || undefined,
      }
      if (recForm.isRecurrent) {
        body.recurrence = {
          frequency: recForm.frequency,
          ...(outrasForm.dueDate ? { dayOfMonth: parseInt(outrasForm.dueDate.slice(8, 10)) } : {}),
          ...(recForm.endType === 'date' && recForm.endDate ? { endDate: recForm.endDate } : {}),
          ...(recForm.endType === 'occurrences' && recForm.occurrences ? { occurrences: parseInt(recForm.occurrences) } : {}),
        }
      }
      return api.post(`/treasury/${selectedClientId}/receivables`, body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['receivables-kpis'] })
      setOutrasForm(emptyOutrasForm)
      setRecForm(emptyRecurrence)
      setShowNewOutras(false)
      setOutrasBudgetSuggestion(null)
      toast.success(recForm.isRecurrent ? 'Conta recorrente criada.' : 'Operação criada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const isClosed = (status: string) => status === 'PAID' || status === 'SETTLED' || status === 'VOID'
  // Estado SCHEDULED (programada/estimada): etiqueta dedicada local. Mantemos a
  // alteração contida neste ficheiro (utils é partilhado com Pagamentos).
  const recvStatusLabel = (status: string, settledInToc = true, full = false) =>
    status === 'SCHEDULED' ? 'Programada' : statusLabel(status, settledInToc, full)
  const recvStatusVariant = (status: string): ReturnType<typeof statusVariant> =>
    status === 'SCHEDULED' ? 'yellow' : statusVariant(status)
  const outrasAll = (data?.items ?? []).filter((r) => !r.tocSalesDocId && (!r.parentId || !!r.recurrenceId))
  const outrasCategorise = (r: Receivable) => {
    if (r.recurrenceId && !r.parentId) return 'programadas' as const
    // "Futuras" = ocorrências ainda não comprometidas (SCHEDULED). Ao comprometer
    // passam a OPEN → caem em "abertas" (mesmo com data futura), por isso a
    // classificação é pelo ESTADO, não pela data.
    if (r.status === 'SCHEDULED') return 'futuras' as const
    return isClosed(r.status) ? ('fechadas' as const) : ('abertas' as const)
  }
  const matchesOutrasFilter = (r: Receivable, f: OutrasFilterState): boolean => {
    if (f.entitySearch) {
      const q = f.entitySearch.toLowerCase()
      if (!`${r.entityName ?? ''} ${r.reference ?? ''}`.toLowerCase().includes(q)) return false
    }
    if (f.statusFilter && !f.statusFilter.split(',').includes(r.status)) return false
    const dueYmd = String(r.dueDate).slice(0, 10)
    if (f.dueDateFrom && dueYmd < f.dueDateFrom) return false
    if (f.dueDateTo && dueYmd > f.dueDateTo) return false
    const docYmd = r.documentDate ? String(r.documentDate).slice(0, 10) : ''
    if (f.docDateFrom && (!docYmd || docYmd < f.docDateFrom)) return false
    if (f.docDateTo && (!docYmd || docYmd > f.docDateTo)) return false
    const payYmd = r.promisedPaymentDate ? String(r.promisedPaymentDate).slice(0, 10) : ''
    if (f.paymentDateFrom && (!payYmd || payYmd < f.paymentDateFrom)) return false
    if (f.paymentDateTo && (!payYmd || payYmd > f.paymentDateTo)) return false
    if (f.isOverdue) {
      const isActive = r.status !== 'PAID' && r.status !== 'SETTLED' && r.status !== 'VOID'
      if (!(isActive && new Date(dueYmd).getTime() < Date.now())) return false
    }
    return true
  }
  // Contagem por sub-separador é sempre o total da divisão, independente dos filtros.
  const outrasCount = { fechadas: 0, futuras: 0, programadas: 0, abertas: 0 }
  for (const r of outrasAll) outrasCount[outrasCategorise(r)]++
  const outrasRows = (() => {
    const filtered = outrasAll.filter((r) => outrasCategorise(r) === outrasSubTab && matchesOutrasFilter(r, outrasFilter))
    if (sortBy === 'reference') {
      return [...filtered].sort((a, b) => {
        const cmp = refSortKey(a.reference).localeCompare(refSortKey(b.reference))
        return sortDir === 'asc' ? cmp : -cmp
      })
    }
    return filtered
  })()

  async function onCategoryChange(categoryId: string) {
    setForm((f) => ({ ...f, categoryId }))
    setBudgetSuggestion(null)
    if (!categoryId || !selectedClientId) return
    try {
      const text = [form.entityName, form.description].filter(Boolean).join(' ')
      const suggestion = await api.get<{ budgetId: string; budgetName: string; ruleDescription: string } | null>(
        `/treasury/${selectedClientId}/budget-rules/suggest?categoryId=${categoryId}&text=${encodeURIComponent(text)}`,
      )
      if (suggestion) setBudgetSuggestion(suggestion)
    } catch { /* ignora erros silenciosamente */ }
  }

  async function onOutrasCategoryChange(categoryId: string) {
    setOutrasForm((f) => ({ ...f, categoryId }))
    setOutrasBudgetSuggestion(null)
    if (!categoryId || !selectedClientId) return
    try {
      const text = [outrasForm.entityName, outrasForm.description].filter(Boolean).join(' ')
      const suggestion = await api.get<{ budgetId: string; budgetName: string; ruleDescription: string } | null>(
        `/treasury/${selectedClientId}/budget-rules/suggest?categoryId=${categoryId}&text=${encodeURIComponent(text)}`,
      )
      if (suggestion) setOutrasBudgetSuggestion(suggestion)
    } catch { /* ignora erros silenciosamente */ }
  }

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

  // NCs (notas de crédito) podem ser reactivadas quando o backend as incluir
  // no payload de receivables; por agora o map fica vazio.
  const tocNcMap = useMemo(() => new Map<string, TocSalesDoc[]>(), [])

  // A lista vem unificada do backend: cada item traz `_src: 'local' | 'toc'`
  // e `_tocRaw` quando origem TOC. A ordenação principal e a paginação são
  // feitas no servidor; o bucket ('clientes' = só TOConline) também, por isso
  // aqui só convertemos para o shape `Row` da UI.
  const rows: Row[] = (data?.items ?? []).map((r) => {
    if (r._src === 'toc' && r._tocRaw) return { _src: 'toc' as const, d: r._tocRaw, item: r }
    return { _src: 'local' as const, r }
  })
  // Ids selecionáveis visíveis em cada separador (para o "selecionar todos").
  const clientesVisibleIds = rows.map((row) => row._src === 'local' ? row.r.id : row.item.id)
  const outrasVisibleIds = outrasRows.map((r) => r.id)
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
      <span className="w-px h-5 bg-primary-200" />
      <button
        className="inline-flex items-center gap-1.5 text-sm py-1.5 px-3 rounded-lg border border-red-200 bg-white text-red-600 font-medium hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        disabled={bulkDeleteMut.isPending}
        onClick={() => setBulkDeleteOpen(true)}
      >
        <Trash2 className="w-3.5 h-3.5" />
        Eliminar
      </button>
      <button className="text-sm text-gray-500 hover:text-gray-700" onClick={() => { setSelectedIds(new Set()); setBulkCategoryId(''); setBulkBudgetId('') }}>Limpar seleção</button>
    </div>
  )

  // KPIs vêm do endpoint /kpis, que já agrega locais + TOC pendentes.
  // Subtraímos `countOverdue` ao `countOpen` para mostrar como "Em aberto"
  // (não-overdue) e "Vencidas" separadamente, mantendo a UX existente.
  // Cartões compactos clicáveis: cada um aplica um preset de filtros à tabela
  // de Clientes. Clicar no cartão ativo limpa os filtros.
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
    setActiveTab('clientes'); setPage(1); setActiveCard(card)
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
  // Always keep one selection active; default to 30 days.
  const [receivedDays, setReceivedDays] = useState<number | 'ALL'>(30)
  const { data: kpisRange } = useQuery({
    // Aninhada sob o prefixo 'receivables-kpis' para que as invalidações de
    // pagar/liquidar/reconciliar (que invalidam ['receivables-kpis']) também
    // refresquem o valor "Recebido" por janela.
    queryKey: ['receivables-kpis', selectedClientId, 'range', receivedDays],
    queryFn: () => {
      const qs = receivedDays === 'ALL' ? 'all=true' : `days=${receivedDays}`
      return api.get<{ settledThisMonth: number }>(`/treasury/${selectedClientId}/receivables/kpis?${qs}`)
    },
    enabled: !!selectedClientId,
  })

  // Valor "Recebido" na janela escolhida (Todo período / 30d / 60d / 90d).
  const displayedSettled = kpisRange?.settledThisMonth ?? combinedKpis?.settledThisMonth ?? 0

  return (
    <>
      <div className="flex -m-4 lg:-m-6 h-[calc(100vh-4rem)]">
        <div className="flex-1 min-w-0 overflow-y-auto overflow-x-auto p-4 lg:p-6">
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900">Contas a Receber</h1>
              <TocSyncStatus invalidateKeys={[
                ['receivables', selectedClientId ?? ''],
                ['receivables-kpis', selectedClientId ?? ''],
              ]} />
            </div>

            {combinedKpis && (
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                {/* Cartões de ação rápida (filtros): grelha 3×2 com ícone semântico,
                    barra de acento e micro-interação de hover/estado ativo. */}
                <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-3 gap-3 content-start">
                  {kpis?.cards && ([
                    ['uncategorized', kpis.cards.uncategorized],
                    ['unbudgeted', kpis.cards.unbudgeted],
                    ['pending', kpis.cards.pending],
                    ['overdue', kpis.cards.overdue],
                    ['thisWeek', kpis.cards.dueThisWeek],
                    ['pastDeadline', kpis.cards.pastPaymentDeadline],
                  ] as const).map(([key, count], i) => {
                    const c = cardMeta[key]
                    const active = activeCard === key
                    return (
                      <button
                        key={key}
                        onClick={() => applyCard(key)}
                        style={{ animationDelay: `${i * 45}ms` }}
                        title={active ? 'Clique para limpar o filtro' : `Filtrar: ${c.label}`}
                        className={`group relative overflow-hidden rounded-xl border px-3.5 py-3 text-left flex items-center gap-3 animate-fade-in transition-all duration-200 ${active ? `${c.activeBg} shadow-card-md` : 'bg-white border-gray-100 hover:-translate-y-0.5 hover:shadow-card-md hover:border-gray-200'}`}
                      >
                        {/* Glow de canto na cor semântica — identidade discreta em repouso,
                            intensifica no hover/activo. */}
                        <span className={`pointer-events-none absolute -top-7 -right-5 h-20 w-20 rounded-full ${c.glow} blur-2xl transition-opacity duration-300 ${active ? 'opacity-25' : 'opacity-0 group-hover:opacity-20'}`} />
                        {/* Barra de acento sempre presente (ténue), cresce no hover/activo. */}
                        <span className={`absolute inset-y-0 left-0 w-1 ${c.bar} transition-all duration-200 ${active ? 'opacity-100' : 'opacity-30 group-hover:opacity-80'}`} />
                        <span className={`relative w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ring-1 ring-inset transition-all duration-200 ${active ? `${c.chipActive} ring-transparent shadow-sm` : `${c.chip} ${c.chipRing} group-hover:scale-105`}`}>
                          <c.Icon className="w-4 h-4" strokeWidth={2.2} />
                        </span>
                        <div className="relative min-w-0 flex-1">
                          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-gray-400 leading-tight truncate">{c.label}</div>
                          <div className={`text-xl font-bold tabular-nums tracking-tight leading-snug transition-colors duration-200 ${active ? c.num : 'text-gray-900'}`}>{count}</div>
                        </div>
                        {active && (
                          <span className="absolute top-1.5 right-1.5 text-gray-300 group-hover:text-gray-500 transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>

                {/* Cartão-herói: Total Pendente + Recebido (janela seleccionável).
                    Em lg fica absoluto a preencher a célula → altura = 2 cartões
                    de ação empilhados. */}
                <div className="relative animate-fade-in" style={{ animationDelay: '120ms' }}>
                  {/* Cartão-herói "ink": superfície slate profunda (ecoa a sidebar)
                      com acento esmeralda para o valor realizado. Profundidade
                      radial em direcção ao canto do brilho, hairline de vidro no
                      topo e um "€" decorativo muito ténue dão carácter premium. */}
                  <div className="group relative lg:absolute lg:inset-0 overflow-hidden rounded-2xl px-4 py-3.5 flex flex-col justify-between text-white shadow-card-lg ring-1 ring-inset ring-white/10 bg-[radial-gradient(130%_130%_at_100%_0%,#13294a_0%,#0f172a_42%,#0a0f1d_100%)]">
                    {/* Atmosfera: brilho esmeralda (canto do acento), profundidade
                        fria oposta, grão fino, hairline superior e reflexo que varre */}
                    <div className="pointer-events-none absolute -top-16 -right-12 h-48 w-48 rounded-full bg-emerald-400/20 blur-3xl transition-colors duration-500 group-hover:bg-emerald-400/30" />
                    <div className="pointer-events-none absolute -bottom-20 -left-12 h-48 w-48 rounded-full bg-blue-900/40 blur-3xl" />
                    <div className="pointer-events-none absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)', backgroundSize: '14px 14px' }} />
                    <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                    <span className="pointer-events-none absolute -bottom-7 -right-1 text-[7.5rem] font-black leading-none text-white/[0.035] select-none">€</span>
                    <div className="pointer-events-none absolute inset-0 overflow-hidden">
                      <div className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-sheen" />
                    </div>

                    {/* Total pendente */}
                    <div className="relative">
                      <div className="flex items-center gap-1.5">
                        <span className="h-1 w-4 rounded-full bg-gradient-to-r from-emerald-400 to-emerald-400/0" />
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">Total pendente</p>
                      </div>
                      <div className="mt-1 flex items-baseline gap-1.5">
                        <span className="text-[1.7rem] sm:text-[1.85rem] font-bold tracking-tight tabular-nums leading-none bg-gradient-to-b from-white to-white/75 bg-clip-text text-transparent">{splitMoney(combinedKpis.totalPending).amount}</span>
                        <span className="text-sm font-semibold text-white/40">{splitMoney(combinedKpis.totalPending).symbol}</span>
                      </div>
                    </div>

                    {/* Recebido + selector de janela */}
                    <div className="relative">
                      <div className="h-px bg-gradient-to-r from-white/0 via-white/15 to-white/0" />
                      <div className="mt-2.5 flex items-center justify-between gap-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-white/55">Recebido</p>
                        <ReceivedPeriodToggle value={receivedDays} onChange={setReceivedDays} />
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1.5">
                        <span key={displayedSettled} className="text-[1.3rem] sm:text-[1.4rem] font-bold tracking-tight tabular-nums leading-none text-emerald-300 animate-value-in">{splitMoney(displayedSettled).amount}</span>
                        <span className="text-[13px] font-semibold text-emerald-300/50">{splitMoney(displayedSettled).symbol}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div>
              <div className="border-b border-gray-200 flex gap-0">
                <button
                  onClick={() => setActiveTab('clientes')}
                  className={`px-3 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'clientes'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                >
                  Clientes
                </button>
                <button
                  onClick={() => setActiveTab('outras')}
                  className={`px-3 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'outras'
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                >
                  Outras Operações
                </button>
              </div>

              {activeTab === 'clientes' && (
                <div className="space-y-4 pt-5">
                  <div className="card">
                    <div className="px-3 py-4 border-b border-gray-100 flex gap-3 items-center flex-wrap">
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
                      <div className="ml-auto flex items-center gap-2 pl-3 border-l border-gray-200">
                        <span className="text-sm text-gray-400 tabular-nums whitespace-nowrap">
                          {data == null && isLoading ? 'A carregar…' : `${data?.total ?? 0} documentos`}
                        </span>
                        <button onClick={exportCsv} title="Exportar CSV" className="text-gray-400 hover:text-gray-600 p-1.5 hover:bg-gray-50 rounded-lg transition-colors">
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {renderBulkBar()}

                    <div ref={hScroll} className="overflow-x-auto">
                      <table className="w-full table-fixed text-sm min-w-[1180px]">
                        <thead>
                          <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                            <th className="w-12 px-3 py-3 select-none">
                              <input
                                type="checkbox"
                                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer"
                                checked={allSelected(clientesVisibleIds)}
                                onChange={(e) => toggleSelectMany(clientesVisibleIds, e.target.checked)}
                              />
                            </th>
                            <th className="w-12 px-2 py-3" />
                            <th onClick={() => toggleSort('reference')} className="w-36 text-left pl-1 pr-3 py-3 cursor-pointer hover:text-gray-700 select-none">Documento <SortIcon field="reference" /></th>
                            <th onClick={() => toggleSort('entityName')} className="w-[13rem] text-left px-3 py-3 cursor-pointer hover:text-gray-700 select-none">
                              Cliente <SortIcon field="entityName" />
                            </th>
                            <th onClick={() => toggleSort('dueDate')} className="text-left px-3 py-3 cursor-pointer hover:text-gray-700 select-none">
                              Vencimento <SortIcon field="dueDate" />
                            </th>
                            <th onClick={() => toggleSort('promisedPaymentDate')} className="text-left pl-3 pr-1 py-3 cursor-pointer hover:text-gray-700 select-none">
                              Pagamento <SortIcon field="promisedPaymentDate" />
                            </th>
                            <th onClick={() => toggleSort('totalAmount')} className="text-right pl-1 pr-3 py-3 cursor-pointer hover:text-gray-700 select-none">
                              Total <SortIcon field="totalAmount" />
                            </th>
                            <th onClick={() => toggleSort('pendingAmount')} className="text-right px-3 py-3 cursor-pointer hover:text-gray-700 select-none">
                              Pendente <SortIcon field="pendingAmount" />
                            </th>
                            <th onClick={() => toggleSort('status')} className="text-left px-3 py-3 cursor-pointer hover:text-gray-700 select-none">
                              Estado <SortIcon field="status" />
                            </th>
                            <th className="text-left px-3 py-3">Categoria</th>
                            <th className="text-left px-3 py-3">Budget</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {rows.map((row) => {
                            if (row._src === 'local') {
                              const r = row.r
                              return (
                                <tr key={`l-${r.id}`} className="hover:bg-primary-50 transition-colors group cursor-pointer" onClick={() => { setPanelDoc(r); setPanelTocDoc(null); setPanelTab((r.children ?? []).some((c) => !c.recurrenceId) ? 'parcelas' : 'details'); setPanelSection(null); setPanelPromisedDate(r.promisedPaymentDate?.slice(0, 10) ?? ''); setSplitCount(2); setSplitValueMode('EUR') }}>
                                  <td className="px-3 py-3 align-top">
                                    <input
                                      type="checkbox"
                                      className="w-4 h-4 mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer flex-shrink-0"
                                      checked={selectedIds.has(r.id)}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={() => toggleSelect(r.id)}
                                    />
                                  </td>
                                  <td className="px-2 py-3 align-top whitespace-nowrap">
                                    <DocLabels splitCount={(r.children ?? []).filter((c) => !c.recurrenceId).length} awaitingReceipt={r.origin === 'TOCONLINE' && r.status === 'PAID'} pendingActionDueAt={r._pendingActionDueAt} />
                                  </td>
                                  <td className="pl-1 pr-3 py-3">
                                    <div>
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-medium text-gray-900 whitespace-nowrap tabular-nums">{r.reference}</span>
                                        {r.recurrenceId && <span title="Recorrente"><Repeat2 className="w-3.5 h-3.5 text-primary-400 flex-shrink-0" /></span>}
                                      </div>
                                      <div className="text-xs text-gray-400">{r.documentDate ? formatDate(r.documentDate) : ''}{r.description ? ` · ${r.description}` : ''}</div>
                                    </div>
                                  </td>
                                  <td className="w-[13rem] px-3 py-3 text-gray-700 truncate">
                                    {r.tocCustomerId ? (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); navigate(`/empresa/clientes/${r.tocCustomerId}`, { state: { from: '/contas-a-receber', fromLabel: 'Contas a Receber' } }) }}
                                        className="text-primary-600 hover:underline text-left"
                                      >
                                        {r.entityName}
                                      </button>
                                    ) : (
                                      r.entityName
                                    )}
                                  </td>
                                  <td className="px-3 py-3 whitespace-nowrap">
                                    {(() => {
                                      const isSplit = (r.children ?? []).some((c) => !c.recurrenceId)
                                      const displayDate = isSplit && r.promisedPaymentDate ? r.promisedPaymentDate : r.dueDate
                                      const now = Date.now()
                                      const due = new Date(displayDate).getTime()
                                      const isActive = r.status !== 'PAID' && r.status !== 'SETTLED' && r.status !== 'VOID'
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
                                    const payDate = r.promisedPaymentDate ?? r.dueDate
                                    const overdue = (r.status === 'OPEN' || r.status === 'PARTIAL') && new Date(payDate).getTime() < Date.now()
                                    return (
                                      <div>
                                        <span className={overdue ? 'text-red-500' : 'text-gray-500'}>{formatDate(payDate)}</span>
                                        {r.receivedDate && (
                                          <div className="text-xs text-green-600 flex items-center gap-0.5" title="Data de recebimento">
                                            <CheckCircle className="w-3 h-3 flex-shrink-0" />{formatDate(r.receivedDate)} recebido
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })()}</td>
                                  <td className="pl-1 pr-3 py-3 text-right tabular-nums whitespace-nowrap text-gray-700">{formatCurrency(r.totalAmount)}</td>
                                  <td className="px-3 py-3 text-right">
                                    <div className="font-semibold tabular-nums text-green-700">{formatCurrency(r.pendingAmount)}</div>
                                    {r.status === 'PARTIAL' && Number(r.receivedAmount) > 0 && (
                                      <div className="text-xs text-gray-400 tabular-nums">recebido: {formatCurrency(Number(r.receivedAmount))}</div>
                                    )}
                                  </td>
                                  <td className="px-3 py-3">
                                    <Badge variant={recvStatusVariant(r.status)}>{recvStatusLabel(r.status, r._statusToc === 'SETTLED')}</Badge>
                                    {r._statusDiffersFromToc && (
                                      <span className="ml-1.5 text-[10px] text-amber-600 font-medium" title={`No TOConline: ${r._statusToc ?? '—'}`}>(Local)</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                                    <InlineCategoryPicker
                                      category={r.category}
                                      categories={categories}
                                      typeLabel="Receita"
                                      onSelect={(categoryId) => classify.mutate({ id: r.id, categoryId })}
                                    />
                                  </td>
                                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                                    <InlineBudgetPicker
                                      budget={r.budget}
                                      budgets={budgets}
                                      onSelect={(budgetId) => classifyBudget.mutate({ id: r.id, budgetId })}
                                    />
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
                            // Valores com overlay TOC (row.item) — respeitam o override
                            // local (ex.: marcado "Recebido" -> pendente 0), ao contrário
                            // dos valores crus do espelho TOC (d.gross_total/d.pending_total).
                            const total = row.item.totalAmount
                            const pending = row.item.pendingAmount
                            const key = `t-${docId}`
                            const isExpanded = expandedIds.has(key)
                            const receiptCount = Array.isArray(d.receipts_ids) ? (d.receipts_ids as unknown[]).length : 0
                            const ncs = tocNcMap.get(docId) ?? []
                            const hasInternalReceipt = !!row.item.receiptReference
                            const expandCount = receiptCount + ncs.length + (hasInternalReceipt ? 1 : 0)
                            return (
                              <Fragment key={key}>
                                <tr
                                  className="hover:bg-primary-50 transition-colors group cursor-pointer"
                                  onClick={() => {
                                    // Usa o item da lista (que já tem overlay TOC + status local) em
                                    // vez de construir à mão a partir do raw — assim o estado local
                                    // (SETTLED/PARTIAL/VOID/promisedPaymentDate) é respeitado.
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
                                    <DocLabels splitCount={(row.item.children ?? []).filter((c) => !c.recurrenceId).length} awaitingReceipt={row.item.origin === 'TOCONLINE' && row.item.status === 'PAID'} pendingActionDueAt={row.item._pendingActionDueAt} />
                                  </td>
                                  <td className="pl-1 pr-3 py-3">
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
                                        <div className="flex items-center gap-1.5">
                                          <span className="font-medium text-gray-900 whitespace-nowrap tabular-nums">{ref}</span>
                                        </div>
                                        <div className="text-xs text-gray-400">{date ? formatDate(date) : '—'}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-3 py-3 text-gray-700 truncate">
                                    {d.customer_id != null ? (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); navigate(`/empresa/clientes/${d.customer_id}`, { state: { from: '/contas-a-receber', fromLabel: 'Contas a Receber' } }) }}
                                        className="text-primary-600 hover:underline text-left"
                                      >
                                        {customer}
                                      </button>
                                    ) : (
                                      customer
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
                                    return (
                                      <div>
                                        <span className={overdue ? 'text-red-500' : 'text-gray-500'}>{formatDate(payDate)}</span>
                                        {row.item.receivedDate && (
                                          <div className="text-xs text-green-600 flex items-center gap-0.5" title="Data de recebimento">
                                            <CheckCircle className="w-3 h-3 flex-shrink-0" />{formatDate(row.item.receivedDate)} recebido
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })()}</td>
                                  <td className="pl-1 pr-3 py-3 text-right tabular-nums whitespace-nowrap text-gray-700">{formatCurrency(total)}</td>
                                  <td className="px-3 py-3 text-right tabular-nums font-semibold text-green-700">{formatCurrency(pending)}</td>
                                  <td className="px-3 py-3">
                                    <Badge variant={recvStatusVariant(row.item.status)}>{recvStatusLabel(row.item.status, row.item._statusToc === 'SETTLED')}</Badge>
                                    {row.item._statusDiffersFromToc && (
                                      <span className="ml-1.5 text-[10px] text-amber-600 font-medium" title={`No TOConline: ${row.item._statusToc ?? '—'}`}>(Local)</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                                    <InlineCategoryPicker
                                      category={row.item.category}
                                      categories={categories}
                                      typeLabel="Receita"
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
                                        <td className="px-3 py-2 text-xs text-gray-500">{customer}</td>
                                        <td className="px-3 py-2" />
                                        <td className="px-3 py-2 text-xs text-gray-400">{(nc.due_date as string | undefined) ? formatDate(nc.due_date as string) : '—'}</td>
                                        <td className="px-3 py-2 text-right text-xs text-amber-700 font-medium">−{formatCurrency(nc.gross_total)}</td>
                                        <td className="px-3 py-2" />
                                        <td className="px-3 py-2"><Badge variant="yellow">{tocStatusLabel(nc.status)}</Badge></td>
                                        <td className="px-3 py-2" />
                                        <td className="px-3 py-2" />
                                      </tr>
                                    ))}
                                    {receiptCount > 0 && (
                                      <ReceiptSubRows
                                        clientId={selectedClientId!}
                                        tocDocId={docId}
                                        entityName={customer}
                                        onReceiptClick={setDetailReceipt}
                                      />
                                    )}
                                    {hasInternalReceipt && (
                                      <tr className="bg-gray-50/60 border-b border-gray-100/80">
                                        <td className="px-3 py-2" />
                                        <td className="px-2 py-2" />
                                        <td className="pl-2 pr-3 py-2">
                                          <div className="flex items-center gap-2 text-xs">
                                            <span className="text-[10px] font-bold uppercase px-1 py-0.5 rounded bg-slate-100 text-slate-600 flex-shrink-0">Interno</span>
                                            <span className="text-gray-700 font-medium">{row.item.receiptReference}</span>
                                          </div>
                                        </td>
                                        <td className="px-3 py-2 text-xs text-gray-500">{customer}</td>
                                        <td className="px-3 py-2" />
                                        <td className="px-3 py-2 text-xs text-gray-500">{row.item.receivedDate ? formatDate(row.item.receivedDate) : '—'}</td>
                                        <td className="px-3 py-2" />
                                        <td className="px-3 py-2 text-right text-xs text-gray-600 font-medium">−{formatCurrency(row.item.receiptAmount ?? 0)}</td>
                                        <td className="px-3 py-2" />
                                        <td className="px-3 py-2" />
                                        <td className="px-3 py-2" />
                                      </tr>
                                    )}
                                  </>
                                )}
                              </Fragment>
                            )
                          })}
                          {rows.length === 0 && (
                            <tr><td colSpan={11} className="px-3 py-10 text-center text-sm text-gray-400">{isLoading ? 'A carregar…' : 'Sem documentos'}</td></tr>
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
                                  <td className="px-3 py-2 text-right text-green-700">{formatCurrency(combinedKpis.totalPending)}</td>
                                  <td colSpan={2} />
                                </tr>
                              </tfoot>
                            )
                          }
                          // Com filtros: subtotal da página actual
                          const totalAmt = rows.reduce((s, row) => s + (row._src === 'local' ? Number(row.r.totalAmount) : Number(row.item.totalAmount)), 0)
                          const pendingAmt = rows.reduce((s, row) => s + (row._src === 'local' ? Number(row.r.pendingAmount) : Number(row.item.pendingAmount)), 0)
                          return (
                            <tfoot>
                              <tr className="border-t-2 border-gray-200 bg-gray-50 text-xs font-semibold text-gray-600 uppercase">
                                <td colSpan={6} className="px-3 py-2">Subtotal — {rows.length} nesta pág. ({data?.total ?? 0} filtrados)</td>
                                <td className="px-3 py-2 text-right">{formatCurrency(totalAmt)}</td>
                                <td className="px-3 py-2 text-right text-green-700">{formatCurrency(pendingAmt)}</td>
                                <td colSpan={3} />
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
                          placeholder="Cliente ou referência..."
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
                      <table className="w-full table-fixed text-sm min-w-[1180px]">
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
                            <th onClick={() => toggleSort('reference')} className="w-36 text-left pl-1 pr-3 py-3 cursor-pointer hover:text-gray-700 select-none">Documento <SortIcon field="reference" /></th>
                            <th onClick={() => toggleSort('entityName')} className="w-[13rem] text-left px-3 py-3 cursor-pointer hover:text-gray-700 select-none">Cliente <SortIcon field="entityName" /></th>
                            <th onClick={() => toggleSort('dueDate')} className="text-left px-3 py-3 cursor-pointer hover:text-gray-700 select-none">Vencimento <SortIcon field="dueDate" /></th>
                            <th onClick={() => toggleSort('promisedPaymentDate')} className="text-left pl-3 pr-1 py-3 cursor-pointer hover:text-gray-700 select-none">Pagamento <SortIcon field="promisedPaymentDate" /></th>
                            <th onClick={() => toggleSort('totalAmount')} className="text-right pl-1 pr-3 py-3 cursor-pointer hover:text-gray-700 select-none">Total <SortIcon field="totalAmount" /></th>
                            <th onClick={() => toggleSort('pendingAmount')} className="text-right px-3 py-3 cursor-pointer hover:text-gray-700 select-none">Pendente <SortIcon field="pendingAmount" /></th>
                            <th onClick={() => toggleSort('status')} className="text-left px-3 py-3 cursor-pointer hover:text-gray-700 select-none">Estado <SortIcon field="status" /></th>
                            <th className="text-left px-3 py-3">Categoria</th>
                            <th className="text-left px-3 py-3">Budget</th>
                            {!panelDoc && <th className="w-28 px-3 py-3" />}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {(() => {
                            const renderRow = (r: Receivable) => {
                              const isSplit = (r.children ?? []).some((c) => !c.recurrenceId)
                              const displayDate = isSplit && r.promisedPaymentDate ? r.promisedPaymentDate : r.dueDate
                              const now = Date.now()
                              const due = new Date(displayDate).getTime()
                              const isActive = r.status !== 'SETTLED' && r.status !== 'VOID'
                              const overdue = isActive && due < now
                              const daysOverdue = overdue ? Math.floor((now - due) / 86400000) : 0
                              const daysUntil = isActive && !overdue ? Math.floor((due - now) / 86400000) : -1
                              return (
                                <tr key={`o-${r.id}`} className="hover:bg-primary-50 transition-colors group cursor-pointer" onClick={() => { setPanelDoc(r); setPanelTocDoc(null); setPanelTab((r.children ?? []).some((c) => !c.recurrenceId) ? 'parcelas' : 'details'); setPanelSection(null); setPanelPromisedDate(r.promisedPaymentDate?.slice(0, 10) ?? ''); setSplitCount(2); setSplitValueMode('EUR') }}>
                                  <td className="px-3 py-3 align-top">
                                    <input
                                      type="checkbox"
                                      className="w-4 h-4 mt-0.5 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer flex-shrink-0"
                                      checked={selectedIds.has(r.id)}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={() => toggleSelect(r.id)}
                                    />
                                  </td>
                                  <td className="px-2 py-3 align-top whitespace-nowrap">
                                    <DocLabels splitCount={(r.children ?? []).filter((c) => !c.recurrenceId).length} awaitingReceipt={r.origin === 'TOCONLINE' && r.status === 'PAID'} pendingActionDueAt={r._pendingActionDueAt} />
                                  </td>
                                  <td className="pl-1 pr-3 py-3">
                                    <div>
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-medium text-gray-900">{r.reference}</span>
                                      </div>
                                      <div className="text-xs text-gray-400">{r.documentDate ? formatDate(r.documentDate) : ''}{r.description ? ` · ${r.description}` : ''}</div>
                                    </div>
                                  </td>
                                  <td className="w-[13rem] px-3 py-3 text-gray-700 truncate">{r.tocCustomerId ? (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); navigate(`/empresa/clientes/${r.tocCustomerId}`) }}
                                      className="text-primary-600 hover:underline text-left"
                                    >
                                      {r.entityName}
                                    </button>
                                  ) : (
                                    r.entityName || '—'
                                  )}</td>
                                  <td className="px-3 py-3 whitespace-nowrap">
                                    <div className={overdue ? 'text-red-600 font-medium' : 'text-gray-500'}>{formatDate(displayDate)}</div>
                                    {overdue && daysOverdue > 0 && <div className="text-xs text-red-400">{daysOverdue} dias</div>}
                                    {!overdue && daysUntil >= 0 && daysUntil <= 14 && <div className="text-xs text-amber-500">{daysUntil === 0 ? 'hoje' : `${daysUntil}d`}</div>}
                                  </td>
                                  <td className="pl-3 pr-1 py-3 whitespace-nowrap">{(() => {
                                    const payDate = r.promisedPaymentDate ?? r.dueDate
                                    const overdue = (r.status === 'OPEN' || r.status === 'PARTIAL') && new Date(payDate).getTime() < Date.now()
                                    return (
                                      <div>
                                        <span className={overdue ? 'text-red-500' : 'text-gray-500'}>{formatDate(payDate)}</span>
                                        {r.receivedDate && (
                                          <div className="text-xs text-green-600 flex items-center gap-0.5" title="Data de recebimento">
                                            <CheckCircle className="w-3 h-3 flex-shrink-0" />{formatDate(r.receivedDate)} recebido
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })()}</td>
                                  <td className="pl-1 pr-3 py-3 text-right tabular-nums whitespace-nowrap text-gray-700">{formatCurrency(r.totalAmount)}</td>
                                  <td className="px-3 py-3 text-right">
                                    <div className="font-semibold tabular-nums text-green-700">{formatCurrency(r.pendingAmount)}</div>
                                    {r.status === 'PARTIAL' && Number(r.receivedAmount) > 0 && (
                                      <div className="text-xs text-gray-400 tabular-nums">recebido: {formatCurrency(Number(r.receivedAmount))}</div>
                                    )}
                                  </td>
                                  <td className="px-3 py-3"><Badge variant={recvStatusVariant(r.status)}>{recvStatusLabel(r.status, r._statusToc === 'SETTLED')}</Badge></td>
                                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                                    <InlineCategoryPicker
                                      category={r.category}
                                      categories={categories}
                                      typeLabel="Receita"
                                      onSelect={(categoryId) => classify.mutate({ id: r.id, categoryId })}
                                    />
                                  </td>
                                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                                    <InlineBudgetPicker
                                      budget={r.budget}
                                      budgets={budgets}
                                      onSelect={(budgetId) => classifyBudget.mutate({ id: r.id, budgetId })}
                                    />
                                  </td>
                                  {!panelDoc && (
                                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
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
                                              documentDate: r.documentDate?.slice(0, 10) ?? '',
                                              dueDate: r.dueDate.slice(0, 10),
                                              totalAmount: String(r.totalAmount),
                                              description: r.description ?? '',
                                            })
                                          }}
                                          className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                                        >
                                          <Pencil className="w-4 h-4" />
                                        </button>
                                        {r.status !== 'VOID' && r.status !== 'SETTLED' && (
                                          <button
                                            title="Anular"
                                            onClick={() => voidReceivable.mutate(r.id)}
                                            disabled={voidReceivable.isPending}
                                            className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                          >
                                            <XCircle className="w-4 h-4" />
                                          </button>
                                        )}
                                        <button
                                          title="Eliminar"
                                          onClick={() => setDeleteRow(r)}
                                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </div>
                                    </td>
                                  )}
                                </tr>
                              )
                            }

                            if (outrasRows.length === 0) {
                              return <tr><td colSpan={panelDoc ? 11 : 12} className="px-3 py-10 text-center text-sm text-gray-400">Sem operações registadas. Usa o botão acima para registar a primeira.</td></tr>
                            }

                            return outrasRows.map(renderRow)
                          })()}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

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

            <Modal open={bulkDeleteOpen} onClose={() => setBulkDeleteOpen(false)} title="Eliminar documentos">
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  Vão ser permanentemente eliminados <span className="font-semibold text-gray-900">{selectedIds.size}</span> documento(s) selecionado(s). Esta acção não pode ser revertida.
                </p>
                {bulkDeleteMut.isError && (
                  <p className="text-sm text-red-600 bg-white border border-red-200 rounded-lg px-3 py-2">{(bulkDeleteMut.error as Error).message}</p>
                )}
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setBulkDeleteOpen(false)} className="btn-secondary flex-1">Cancelar</button>
                  <button
                    onClick={() => bulkDeleteMut.mutate([...selectedIds])}
                    className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50 transition-colors"
                    disabled={bulkDeleteMut.isPending}
                  >
                    {bulkDeleteMut.isPending ? 'A eliminar...' : `Eliminar ${selectedIds.size}`}
                  </button>
                </div>
              </div>
            </Modal>

            <Modal open={showNew} onClose={() => { setShowNew(false); setSelectedTocCustomer(null); setTocCustomerSearch(''); setBudgetSuggestion(null) }} title="Nova Conta a Receber" size="lg">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="label">Categoria</label>
                  <select className="input" value={form.categoryId} onChange={(e) => onCategoryChange(e.target.value)}>
                    <option value="">Selecionar...</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  {budgetSuggestion && !form.budgetId && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-xs font-semibold text-blue-700 mb-0.5">Sugestão de budget</p>
                          <p className="text-sm font-medium text-gray-900">{budgetSuggestion.budgetName}</p>
                          <p className="text-xs text-gray-500">Regra: {budgetSuggestion.ruleDescription}</p>
                        </div>
                        <button onClick={() => setBudgetSuggestion(null)} className="text-gray-400 hover:text-gray-600 text-xs">x</button>
                      </div>
                      <button
                        onClick={() => { setForm((f) => ({ ...f, budgetId: budgetSuggestion.budgetId })); setBudgetSuggestion(null) }}
                        className="mt-2 w-full text-xs bg-blue-600 text-white rounded py-1.5 hover:bg-blue-700"
                      >
                        Aceitar — Budget "{budgetSuggestion.budgetName}"
                      </button>
                    </div>
                  )}
                </div>
                <div className="col-span-2">
                  <label className="label">Budget <span className="text-gray-400 font-normal">(opcional)</span></label>
                  <select className="input" value={form.budgetId} onChange={(e) => setForm({ ...form, budgetId: e.target.value })}>
                    <option value="">Auto pela categoria</option>
                    {budgets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
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
                {!recForm.isRecurrent && (
                  <div>
                    <label className="label">Nº Documento</label>
                    <input className="input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="FT2024/001" />
                  </div>
                )}
                <div>
                  <label className="label">{recForm.isRecurrent ? 'Valor estimado (€)' : 'Valor (€)'} <span className="text-red-500">*</span></label>
                  <input type="number" className="input" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} />
                </div>
                <div><label className="label">{recForm.isRecurrent ? 'Vencimento (dia que se repete)' : 'Data Vencimento'} <span className="text-red-500">*</span></label><WorkdayDatePicker value={form.dueDate} onChange={(v) => setForm({ ...form, dueDate: v })} /></div>
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
                <button onClick={() => { setShowNew(false); setRecForm(emptyRecurrence); setSelectedTocCustomer(null); setTocCustomerSearch(''); setBudgetSuggestion(null) }} className="btn-secondary flex-1">Cancelar</button>
                <button
                  onClick={() => create.mutate()}
                  className="btn-primary flex-1"
                  disabled={(() => {
                    if (create.isPending || !form.dueDate || !(parseFloat(form.totalAmount) > 0)) return true
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

            <Modal open={showNewOutras} onClose={() => { setShowNewOutras(false); setOutrasForm(emptyOutrasForm); setRecForm(emptyRecurrence); setOutrasContact(null); setOutrasContactSearch(''); setOutrasBudgetSuggestion(null) }} title="Nova Operação" size="lg">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="label">Categoria</label>
                  <select className="input" value={outrasForm.categoryId} onChange={(e) => onOutrasCategoryChange(e.target.value)}>
                    <option value="">Selecionar...</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  {outrasBudgetSuggestion && !outrasForm.budgetId && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-xs font-semibold text-blue-700 mb-0.5">Sugestão de budget</p>
                          <p className="text-sm font-medium text-gray-900">{outrasBudgetSuggestion.budgetName}</p>
                          <p className="text-xs text-gray-500">Regra: {outrasBudgetSuggestion.ruleDescription}</p>
                        </div>
                        <button onClick={() => setOutrasBudgetSuggestion(null)} className="text-gray-400 hover:text-gray-600 text-xs">x</button>
                      </div>
                      <button
                        onClick={() => { setOutrasForm((f) => ({ ...f, budgetId: outrasBudgetSuggestion.budgetId })); setOutrasBudgetSuggestion(null) }}
                        className="mt-2 w-full text-xs bg-blue-600 text-white rounded py-1.5 hover:bg-blue-700"
                      >
                        Aceitar — Budget "{outrasBudgetSuggestion.budgetName}"
                      </button>
                    </div>
                  )}
                </div>
                <div className="col-span-2">
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
                {!recForm.isRecurrent && (
                  <div>
                    <label className="label">Referência</label>
                    <input className="input" value={outrasForm.reference} onChange={(e) => setOutrasForm({ ...outrasForm, reference: e.target.value })} placeholder="REF001" />
                  </div>
                )}
                <div>
                  <label className="label">{recForm.isRecurrent ? 'Valor estimado (€)' : 'Valor (€)'} <span className="text-red-500">*</span></label>
                  <input type="number" className="input" value={outrasForm.totalAmount} onChange={(e) => setOutrasForm({ ...outrasForm, totalAmount: e.target.value })} placeholder="0.00" />
                </div>
                <div>
                  <label className="label">{recForm.isRecurrent ? 'Vencimento (dia que se repete)' : 'Data Vencimento'} <span className="text-red-500">*</span></label>
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
                <button onClick={() => { setShowNewOutras(false); setOutrasForm(emptyOutrasForm); setRecForm(emptyRecurrence); setOutrasContact(null); setOutrasContactSearch(''); setOutrasBudgetSuggestion(null) }} className="btn-secondary flex-1">Cancelar</button>
                <button
                  onClick={() => createOutras.mutate()}
                  className="btn-primary flex-1"
                  disabled={(() => {
                    if (createOutras.isPending || !outrasForm.totalAmount || !outrasForm.dueDate) return true
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
          <div className="fixed inset-0 z-50 w-full bg-white flex flex-col overflow-hidden animate-slide-in lg:sticky lg:inset-auto lg:top-0 lg:z-auto lg:w-80 xl:w-96 lg:flex-shrink-0 lg:h-[calc(100vh-4rem)] lg:border-l lg:border-gray-200">
            {/* Faixa de acento fintech removida */}
            {/* Cabeçalho */}
            <div className="p-5 border-b border-gray-100 bg-gradient-to-b from-blue-50/50 to-transparent">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-1">
                  {panelDoc.parentId && !panelDoc.recurrenceId && (
                    <button
                      onClick={async () => {
                        const parent = await api.get<Receivable>(`/treasury/${selectedClientId}/receivables/${panelDoc.parentId}`)
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
                  <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">Conta a Receber</div>
                </div>
                <button onClick={() => { setPanelDoc(null); setPanelTocDoc(null) }} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-[1.7rem] font-bold tracking-tight tabular-nums text-gray-900 leading-none">{formatCurrency(panelDoc.totalAmount)}</div>
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
                {!panelDoc.tocSalesDocId && (
                  <div className="flex items-center gap-1 ml-auto">
                    <button
                      title="Editar"
                      onClick={() => {
                        setEditId(panelDoc.id)
                        setEditRow(panelDoc)
                        setEditForm({
                          categoryId: panelDoc.category?.id ?? '',
                          entityName: panelDoc.entityName,
                          reference: panelDoc.reference,
                          documentDate: panelDoc.documentDate?.slice(0, 10) ?? '',
                          dueDate: panelDoc.dueDate.slice(0, 10),
                          totalAmount: String(panelDoc.totalAmount),
                          description: panelDoc.description ?? '',
                        })
                      }}
                      className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    {panelDoc.status !== 'VOID' && panelDoc.status !== 'SETTLED' && (
                      <button
                        title="Anular"
                        onClick={() => voidReceivable.mutate(panelDoc.id)}
                        disabled={voidReceivable.isPending}
                        className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      title="Eliminar"
                      onClick={() => setDeleteRow(panelDoc)}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              <div className="text-sm font-medium mt-0.5">
                {panelDoc.tocCustomerId ? (
                  <button onClick={() => navigate(`/empresa/clientes/${panelDoc.tocCustomerId}`, { state: { from: '/contas-a-receber', fromLabel: 'Contas a Receber' } })} className="text-primary-700 hover:underline text-left">
                    {panelDoc.entityName || '—'}
                  </button>
                ) : (
                  <span className="text-primary-700">{panelDoc.entityName || '—'}</span>
                )}
              </div>
              <div className="mt-2">
                <div className="text-sm font-semibold text-gray-800">{panelDoc.reference || '—'}</div>
                <div className="text-xs text-gray-500">Venc. {formatDate(panelDoc.dueDate)} · Pag. {formatDate(panelDoc.promisedPaymentDate ?? panelDoc.dueDate)}</div>
              </div>
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <Badge variant={recvStatusVariant(panelDoc.status)}>{recvStatusLabel(panelDoc.status, panelDoc._statusToc === 'SETTLED', true)}</Badge>
                {panelDoc._statusDiffersFromToc && (
                  <span className="ml-1.5 text-[10px] text-amber-600 font-medium" title={`No TOConline: ${panelDoc._statusToc ?? '—'}`}>(Local)</span>
                )}
                {panelDoc.origin === 'TOCONLINE' && panelDoc.status === 'PAID' && (
                  <span title="Pago localmente — ainda sem recibo no TOConline" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-medium">
                    <AlertTriangle className="w-3 h-3" />Aguarda Recibo
                  </span>
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
                  typeLabel="Receita"
                  onSelect={(categoryId) => classify.mutate({ id: panelDoc.id, categoryId })}
                />
                <span className="inline-flex items-center gap-1">
                  <InlineBudgetPicker
                    budget={panelDoc.budget}
                    budgets={budgets}
                    onSelect={(budgetId) => classifyBudget.mutate({ id: panelDoc.id, budgetId })}
                  />
                  {panelDoc.budget && (
                    <button
                      onClick={() => navigate(`/budgets?budget=${panelDoc.budget!.id}`)}
                      title={`Ir para o budget "${panelDoc.budget.name}"`}
                      aria-label={`Ir para o budget ${panelDoc.budget.name}`}
                      style={{ color: panelDoc.budget.color ?? '#3b82f6' }}
                      className="budget-goto inline-flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0"
                    >
                      <ArrowUpRight className="budget-goto-arrow w-3.5 h-3.5" strokeWidth={2.5} />
                    </button>
                  )}
                </span>
                {panelDoc.promisedPaymentDate && (
                  <span className="text-xs text-blue-600 flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(panelDoc.promisedPaymentDate)}</span>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs flex-wrap">
                <span className="inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-100">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Pendente</span>
                  <span className="font-bold tabular-nums text-gray-800">{formatCurrency(panelDoc.pendingAmount)}</span>
                </span>
                {Number(panelDoc.receivedAmount) > 0 && (
                  <span className="inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-100">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-500">Recebido</span>
                    <span className="font-bold tabular-nums text-emerald-700">{formatCurrency(Number(panelDoc.receivedAmount))}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Recibos associados (TOC) */}
            {panelReceipts.length > 0 && (
              <div className="border-b border-gray-100 px-4 py-3 space-y-2">
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">{panelReceipts.length} {panelReceipts.length === 1 ? 'recibo associado' : 'recibos associados'}</div>
                {panelReceipts.map((rc) => {
                  const receivedForDoc = rc._received_for_doc != null ? Number(rc._received_for_doc) : null
                  const showSplit = receivedForDoc != null && receivedForDoc !== Number(rc.gross_total)
                  return (
                    <button key={String(rc.id)}
                      onClick={() => setDetailReceipt(rc)}
                      className="w-full text-left rounded-lg border border-gray-200 p-2.5 hover:bg-primary-50 hover:border-primary-200 transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-sm text-gray-900 truncate">{rc.document_no}</div>
                          <div className="text-xs text-gray-500">{rc.date ? formatDate(rc.date) : '—'}</div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm font-semibold text-gray-800">{formatCurrency(receivedForDoc ?? rc.gross_total)}</div>
                          {showSplit && (
                            <div className="text-[10px] text-gray-400">de {formatCurrency(rc.gross_total)}</div>
                          )}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}

            {/* Recibo interno (stand-in até vir o recibo do TOConline) — pode coexistir
                com os recibos do TOC: cobre a parte ainda não coberta por eles. */}
            {panelDoc.status === 'SETTLED' && panelDoc.receiptReference && (
              <div className="border-b border-gray-100 px-4 py-3 space-y-2">
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">Recibo interno</div>
                <div className="rounded-lg border border-gray-200 p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-gray-900 truncate">{panelDoc.receiptReference}</div>
                      <div className="text-xs text-gray-500">{panelDoc.receivedDate ? formatDate(panelDoc.receivedDate) : '—'}</div>
                    </div>
                    <div className="text-sm font-semibold text-gray-800 flex-shrink-0">{panelDoc.receiptAmount != null ? formatCurrency(panelDoc.receiptAmount) : '—'}</div>
                  </div>
                </div>
              </div>
            )}

            {/* Tabs — controlo segmentado */}
            <div className="px-4 py-3 border-b border-gray-100">
              <div className="flex gap-1 p-1 bg-gray-100/80 rounded-xl">
                {(['parcelas', 'details', 'followups'] as const).map((t) => (
                  <button key={t} onClick={() => { setPanelTab(t); setPanelSection(null) }}
                    className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-all duration-200 ${panelTab === t ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                    {t === 'details' ? 'Detalhes' : t === 'parcelas' ? 'Parcelas' : 'Follow-ups'}
                  </button>
                ))}
              </div>
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
                          {panelDoc._statusToc === 'SETTLED' ? 'Recibo emitido no TOConline'
                            : panelDoc.settledVia === 'INSTALLMENTS' ? 'Liquidado pelas parcelas'
                            : panelDoc.settledVia === 'RECONCILIATION' ? 'Liquidado por reconciliação'
                            : 'Liquidado manualmente nesta plataforma'}
                        </div>
                      </div>
                      {panelDoc._statusToc === 'SETTLED' ? (
                        <span className="text-xs text-green-700/70 flex-shrink-0">Gerido no TOConline</span>
                      ) : panelDoc.settledVia === 'RECONCILIATION' ? (
                        <span className="text-xs text-green-700/70 flex-shrink-0 whitespace-nowrap">Reverter na reconciliação</span>
                      ) : (
                        <button
                          onClick={() => panelDoc.settledVia === 'INSTALLMENTS' ? undefined : unsettleReceivable.mutate(panelDoc.id)}
                          disabled={unsettleReceivable.isPending || panelDoc.settledVia === 'INSTALLMENTS'}
                          title={panelDoc.settledVia === 'INSTALLMENTS' ? 'Reverta parcela a parcela' : undefined}
                          className="text-xs text-green-700 hover:text-red-700 border border-green-200 hover:border-red-200 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-green-700 disabled:hover:border-green-200 disabled:hover:bg-transparent"
                        >
                          {unsettleReceivable.isPending ? '...' : 'Anular'}
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
                          {panelDoc.settledVia === 'INSTALLMENTS' ? 'Liquidado pelas parcelas'
                            : panelDoc.settledVia === 'RECONCILIATION' ? 'Liquidado por reconciliação'
                            : panelDoc.tocSalesDocId ? 'Recebimento registado — liquida quando houver recibo no TOConline'
                            : 'Recebimento registado — aguarda liquidação'}
                        </div>
                      </div>
                      {panelDoc.settledVia === 'RECONCILIATION' ? (
                        <span className="text-xs text-teal-700/70 flex-shrink-0 whitespace-nowrap">Reverter na reconciliação</span>
                      ) : (
                        <button
                          onClick={() => panelDoc.settledVia === 'INSTALLMENTS' ? undefined : unsettleReceivable.mutate(panelDoc.id)}
                          disabled={unsettleReceivable.isPending || panelDoc.settledVia === 'INSTALLMENTS'}
                          title={panelDoc.settledVia === 'INSTALLMENTS' ? 'Reverta parcela a parcela' : undefined}
                          className="text-xs text-teal-700 hover:text-red-700 border border-teal-200 hover:border-red-200 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors whitespace-nowrap flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-teal-700 disabled:hover:border-teal-200 disabled:hover:bg-transparent"
                        >
                          {unsettleReceivable.isPending ? '...' : 'Anular'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Marcar como Comprometido — só para faturas programadas (SCHEDULED) */}
                  {panelDoc.status === 'SCHEDULED' && (
                    <div className="rounded-xl border border-gray-200 overflow-hidden">
                      <button
                        onClick={() => {
                          if (panelSection !== 'commit') {
                            setCommitRef('')
                            setCommitAmount(String(panelDoc.totalAmount ?? ''))
                            setCommitDate(panelDoc.dueDate ? String(panelDoc.dueDate).slice(0, 10) : '')
                          }
                          setPanelSection(panelSection === 'commit' ? null : 'commit')
                        }}
                        className="w-full flex items-center gap-3 p-3.5 hover:bg-green-50 text-left transition-colors group"
                      >
                        <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0 group-hover:bg-green-200 transition-colors">
                          <CheckCircle className="w-4 h-4 text-green-700" />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 text-sm">Marcar como Comprometido</div>
                          <div className="text-xs text-gray-500">Fixar referência, valor e data</div>
                        </div>
                      </button>
                      {panelSection === 'commit' && (
                        <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
                          <div>
                            <label className="text-xs text-gray-500 font-medium">Referência</label>
                            <input className="input mt-1" value={commitRef} onChange={(e) => setCommitRef(e.target.value)} placeholder="FT2024/001" />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 font-medium">Valor (€)</label>
                            <input type="number" className="input mt-1" value={commitAmount} onChange={(e) => setCommitAmount(e.target.value)} />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 font-medium">Data de vencimento</label>
                            <input type="date" className="input mt-1" value={commitDate} onChange={(e) => setCommitDate(pickWorkday(e.target.value, commitDate))} />
                          </div>
                          <button
                            onClick={() => commitReceivable.mutate({ id: panelDoc.id, reference: commitRef.trim(), amount: parseFloat(commitAmount) || 0, date: commitDate })}
                            disabled={commitReceivable.isPending || !commitRef.trim() || !(parseFloat(commitAmount) > 0) || !commitDate}
                            className="btn-primary w-full text-sm py-1.5"
                          >
                            {commitReceivable.isPending ? 'A guardar...' : 'Marcar como Comprometido'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Marcar como Pago — indisponível em programadas (SCHEDULED) */}
                  {(panelDoc.status === 'OPEN' || panelDoc.status === 'PARTIAL') && (
                      <button
                        onClick={() => payReceivable.mutate(panelDoc.id)}
                        disabled={payReceivable.isPending}
                        className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-200 hover:bg-teal-50 hover:border-teal-200 text-left transition-colors group disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <div className="w-9 h-9 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0 group-hover:bg-teal-200 transition-colors">
                          <CreditCard className="w-4 h-4 text-teal-700" />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 text-sm">Marcar como Pago</div>
                          <div className="text-xs text-gray-500">Registar recebimento total (sem liquidar)</div>
                        </div>
                      </button>
                  )}

                  {/* Marcar como Liquidada — só a partir de Pago; exige registar recibo (referência + data). */}
                  {panelDoc.status === 'PAID' && panelDoc.settledVia !== 'INSTALLMENTS' && panelDoc.settledVia !== 'RECONCILIATION' && (
                    <div className="rounded-xl border border-gray-200 overflow-hidden">
                      <button
                        onClick={() => { if (panelSection !== 'settle') { setSettleRef(''); setSettleDate('') } setPanelSection(panelSection === 'settle' ? null : 'settle') }}
                        className="w-full flex items-center gap-3 p-3.5 hover:bg-green-50 text-left transition-colors group"
                      >
                        <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0 group-hover:bg-green-200 transition-colors">
                          <CheckCircle className="w-4 h-4 text-green-700" />
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 text-sm">Marcar como Liquidada</div>
                          <div className="text-xs text-gray-500">Registar recibo (referência + data)</div>
                        </div>
                      </button>
                      {panelSection === 'settle' && (
                        <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
                          <div>
                            <label className="text-xs text-gray-500 font-medium">Referência do recibo</label>
                            <input className="input mt-1" value={settleRef} onChange={(e) => setSettleRef(e.target.value)} placeholder="ex.: FR 2025/12" />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 font-medium">Data do recibo</label>
                            <input type="date" className="input mt-1" value={settleDate} onChange={(e) => setSettleDate(e.target.value)} />
                          </div>
                          <button
                            onClick={() => settleReceivable.mutate({ id: panelDoc.id, receiptReference: settleRef.trim(), date: settleDate })}
                            disabled={settleReceivable.isPending || !settleRef.trim() || !settleDate}
                            className="btn-primary w-full text-sm py-1.5"
                          >
                            {settleReceivable.isPending ? 'A liquidar...' : 'Confirmar liquidação'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Data prometida — bloqueada em faturas pagas/liquidadas; oculta em programadas (SCHEDULED) */}
                  {panelDoc.status !== 'SCHEDULED' && (
                  <div className="rounded-xl border border-gray-200 overflow-hidden">
                    <button
                      onClick={() => { if (panelDoc.status !== 'SETTLED' && panelDoc.status !== 'PAID') setPanelSection(panelSection === 'promised' ? null : 'promised') }}
                      disabled={panelDoc.status === 'SETTLED' || panelDoc.status === 'PAID'}
                      title={(panelDoc.status === 'SETTLED' || panelDoc.status === 'PAID') ? 'Fatura paga/liquidada — não é possível definir data de pagamento' : undefined}
                      className={`w-full flex items-center gap-3 p-3.5 text-left transition-colors group ${(panelDoc.status === 'SETTLED' || panelDoc.status === 'PAID') ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-50'}`}
                    >
                      <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200 transition-colors">
                        <Clock className="w-4 h-4 text-blue-700" />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-gray-900 text-sm">Definir Data Pagamento</div>
                        {panelDoc.promisedPaymentDate
                          ? <div className="text-xs text-blue-600">{formatDate(panelDoc.promisedPaymentDate)}</div>
                          : <div className="text-xs text-gray-500">{formatDate(panelDoc.dueDate)} <span className="text-gray-400">(vencimento)</span></div>
                        }
                      </div>
                    </button>
                    {panelSection === 'promised' && panelDoc.status !== 'SETTLED' && panelDoc.status !== 'PAID' && (
                      <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
                        <input type="date" className="input" value={panelPromisedDate || (panelDoc.dueDate ? String(panelDoc.dueDate).slice(0, 10) : '')} onChange={(e) => setPanelPromisedDate(pickWorkday(e.target.value, panelPromisedDate))} />
                        <div className="flex gap-2">
                          <button onClick={() => setPromisedDate.mutate({ id: panelDoc.id, date: (panelPromisedDate || (panelDoc.dueDate ? String(panelDoc.dueDate).slice(0, 10) : '')) || null })}
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
                  )}

                  {/* Dividir Fatura — bloqueada em faturas pagas/liquidadas */}
                  {(panelDoc.status === 'OPEN' || panelDoc.status === 'PAID' || panelDoc.status === 'SETTLED') && !panelDoc.parentId && (panelDocDetail?.children ?? panelDoc.children ?? []).length === 0 && (
                    <div className="rounded-xl border border-gray-200 overflow-hidden">
                      <button
                        onClick={() => {
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
                                <input type="number" step="0.01" min="0"
                                  max={splitValueMode === 'PCT' ? '100' : undefined}
                                  placeholder="0.00"
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
                              const rawValues = splitInstallments.map((x) => parseFloat(x.amount) || 0)
                              const finalEurs = splitValueMode === 'PCT'
                                ? convertPctToEur(rawValues, total)
                                : (() => {
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
                              splitReceivable.mutate({ id: panelDoc.id, installments })
                            }}
                            disabled={(() => {
                              if (splitReceivable.isPending || splitInstallments.some((x) => !x.amount || !x.paymentDate)) return true
                              const total = Number(panelDoc.totalAmount)
                              const sum = splitInstallments.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0)
                              if (splitValueMode === 'EUR') return Math.abs(sum - total) > 0.001
                              return Math.abs(sum - 100) > 0.001
                            })()}
                            className="btn-primary w-full text-sm py-1.5"
                          >
                            {splitReceivable.isPending ? 'A dividir...' : `Confirmar divisão em ${splitInstallments.length} parcelas`}
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Anexar documento — abaixo das restantes ações */}
                  {selectedClientId && (
                    <InvoiceAttachmentsButton
                      clientId={selectedClientId}
                      direction="RECEIVABLE"
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
                        onClick={() => { setPanelDoc(child as Receivable); setPanelTab('details'); setPanelSection(null); setPanelPromisedDate(child.promisedPaymentDate?.slice(0, 10) ?? ''); setSplitCount(2); setSplitValueMode('EUR') }}
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
                        onClick={() => unsplitReceivable.mutate(panelDoc.id)}
                        disabled={unsplitReceivable.isPending || !allOpen}
                        title={!allOpen ? 'Não é possível desfazer: algumas parcelas já foram pagas' : undefined}
                        className={`w-full text-xs px-3 py-1.5 rounded-lg transition-colors ${allOpen ? 'text-orange-700 hover:text-red-700 border border-orange-200 hover:border-red-300 hover:bg-red-50' : 'text-gray-400 border border-gray-200 cursor-not-allowed'}`}
                      >
                        {unsplitReceivable.isPending ? 'A desfazer...' : 'Desfazer divisão'}
                      </button>
                    )}
                  </div>
                )
              })()}

              {panelTab === 'followups' && selectedClientId && (
                <FollowupsPanel
                  clientId={selectedClientId}
                  direction="RECEIVABLE"
                  doc={{
                    id: panelDoc.id,
                    reference: panelDoc.reference,
                    entityName: panelDoc.entityName,
                    totalAmount: panelDoc.totalAmount,
                    dueDate: panelDoc.dueDate,
                    origin: panelDoc.origin as 'TOC' | 'LOCAL',
                    tocSalesDocId: panelDoc.tocSalesDocId ?? (panelTocDoc ? String(panelTocDoc.id) : null),
                  }}
                />
              )}
            </div>
          </div>
        )}

        {createPortal(
          <ReceiptDetailModal
            open={!!detailReceipt}
            onClose={() => setDetailReceipt(null)}
            receipt={detailReceipt}
            clientId={selectedClientId ?? ''}
            entityName={panelDoc?.entityName ?? ''}
            onInvoiceClick={(receivableId) => {
              const match = (data?.items ?? []).find((r) => r._tocRaw && String(r._tocRaw.id) === String(receivableId))
              if (!match || !match._tocRaw) return
              setPanelDoc(match)
              setPanelTocDoc(match._tocRaw)
              setPanelTab('details')
              setPanelSection(null)
              setDetailReceipt(null)
            }}
          />,
          document.body
        )}
      </div>
    </>
  )
}
