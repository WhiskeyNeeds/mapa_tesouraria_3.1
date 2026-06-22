import { useState, useRef, useEffect, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { api, API_BASE } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { formatIbanInput, sanitizeIban, validateIban } from '@/lib/iban'
import { useStickyHScrollbar } from '@/lib/useStickyHScrollbar'
import KpiCard from '@/components/ui/KpiCard'
import Modal from '@/components/ui/Modal'
import { Plus, Upload, Building2, FileUp, FileText, FileSpreadsheet, CheckCircle2, Circle, Trash2, Search, X, ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, ChevronDown, PenLine, AlertTriangle, Tag, Download, Pencil, FilterX, RefreshCw, History, RotateCcw } from 'lucide-react'

const SUPPORTED_BANKS = ['CGD', 'BCP', 'BPI', 'Bankinter', 'Santander', 'NovoBanco'] as const
type SupportedBank = typeof SUPPORTED_BANKS[number]

const PORTUGUESE_BANKS = [
  'Bankinter',
  'Millennium BCP',
  'Banco BPI',
  'Caixa Geral de Depósitos',
  'Novo Banco',
  'Santander',
]

const BANK_PARSER_CODES: Record<string, SupportedBank> = {
  'Caixa Geral de Depósitos': 'CGD',
  'Millennium BCP': 'BCP',
  'Banco BPI': 'BPI',
  'Bankinter': 'Bankinter',
  'Santander': 'Santander',
  'Novo Banco': 'NovoBanco',
}

const BANK_CODE_TO_NAME: Record<SupportedBank, string> = Object.fromEntries(
  Object.entries(BANK_PARSER_CODES).map(([name, code]) => [code, name])
) as Record<SupportedBank, string>

const BANK_IMPORT_OPTIONS = PORTUGUESE_BANKS.map((name) => ({
  name,
  code: BANK_PARSER_CODES[name] ?? name,
  supported: name in BANK_PARSER_CODES,
}))

// Bancos com parser de extrato em PDF suportado
const PDF_IMPORT_BANKS: ReadonlySet<SupportedBank> = new Set(['Santander', 'BPI'])

const BANK_BRAND: Record<string, { abbr: string; bg: string }> = {
  'Bankinter': { abbr: 'BK', bg: '#FF6200' },
  'Millennium BCP': { abbr: 'BCP', bg: '#DA2128' },
  'Banco BPI': { abbr: 'BPI', bg: '#F47920' },
  'Caixa Geral de Depósitos': { abbr: 'CGD', bg: '#008A3B' },
  'Novo Banco': { abbr: 'NB', bg: '#C8000A' },
  'Santander': { abbr: 'SAN', bg: '#EC0000' },
}

function BankAvatar({ bankName }: { bankName: string }) {
  const brand = BANK_BRAND[bankName]
  const bg = brand?.bg ?? '#6B7280'
  const abbr = brand?.abbr ?? bankName.slice(0, 2).toUpperCase()
  return (
    <div
      className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-white ${abbr.length <= 2 ? 'text-sm' : 'text-xs'}`}
      style={{ backgroundColor: bg }}
    >
      {abbr}
    </div>
  )
}

interface BankAccount { id: string; name: string; bankName: string; currentBalance: number; openingBalance?: number; minBalance?: number | null; ibanLast4: string; currency: string; lowBalanceWarning?: boolean; importedCount: number }
interface Movement { id: string; date: string; amount: number; description: string; status: string; source: string; balanceAfter?: number | null; category?: { id: string; name: string; color: string }; bankAccount?: { id: string; name: string; bankName: string }; reconciliation?: { state: 'RECONCILED' | 'PARTIAL'; isDryRun: boolean; allocated: number } | null }

interface ReconciliationLink {
  reconciliationId: string
  movementId: string
  amount: number
  reconciliation: {
    id: string
    status: string
    isDryRun: boolean
    direction: string
    receivables: Array<{
      receivableId: string
      amountAllocated: number
      receivable: { id: string; reference: string; entityName: string }
    }>
    payables: Array<{
      payableId: string
      amountAllocated: number
      payable: { id: string; reference: string; entityName: string }
    }>
  }
}

function MovementReconciliationsSubRows({ clientId, movementId, movementAmount, colSpan }: {
  clientId: string
  movementId: string
  movementAmount: number
  colSpan: number
}) {
  const { data: links = [], isLoading } = useQuery<ReconciliationLink[]>({
    queryKey: ['movement-reconciliation-links', clientId, movementId],
    queryFn: () => api.get(`/treasury/${clientId}/movements/${movementId}/reconciliations`),
  })

  if (isLoading) {
    return (
      <tr>
        <td colSpan={colSpan} className="pl-14 py-2 text-xs text-gray-400 bg-primary-50/30 border-b border-gray-100">
          <RefreshCw className="inline w-3 h-3 animate-spin mr-1.5" />A carregar documentos reconciliados...
        </td>
      </tr>
    )
  }

  type DocRow = {
    key: string
    type: 'receivable' | 'payable'
    reference: string
    entityName: string
    allocatedAmount: number
    reconStatus: string
    isDryRun: boolean
  }

  const rows: DocRow[] = links.flatMap((link) => [
    ...link.reconciliation.receivables.map((r) => ({
      key: `r-${link.reconciliationId}-${r.receivableId}`,
      type: 'receivable' as const,
      reference: r.receivable.reference,
      entityName: r.receivable.entityName,
      allocatedAmount: Number(r.amountAllocated),
      reconStatus: link.reconciliation.status,
      isDryRun: link.reconciliation.isDryRun,
    })),
    ...link.reconciliation.payables.map((p) => ({
      key: `p-${link.reconciliationId}-${p.payableId}`,
      type: 'payable' as const,
      reference: p.payable.reference,
      entityName: p.payable.entityName,
      allocatedAmount: Number(p.amountAllocated),
      reconStatus: link.reconciliation.status,
      isDryRun: link.reconciliation.isDryRun,
    })),
  ])

  const reconciledTotal = links
    .filter((l) => l.reconciliation.status === 'CONFIRMED')
    .reduce((s, l) => s + Math.abs(Number(l.amount)), 0)
  const remaining = Math.abs(movementAmount) - reconciledTotal

  if (!rows.length) {
    return (
      <tr>
        <td colSpan={colSpan} className="pl-14 py-2 text-xs text-gray-400 bg-primary-50/30 border-b border-gray-100">
          Sem documentos associados
        </td>
      </tr>
    )
  }

  return (
    <>
      {rows.map((row) => (
        <tr key={row.key} className={`bg-primary-50/20 border-b border-gray-100/80 ${row.reconStatus === 'REVERSED' ? 'opacity-60' : ''}`}>
          <td colSpan={colSpan} className="pl-10 pr-4 py-1.5">
            <div className="flex items-center gap-2 text-xs">
              <ChevronRight className="w-3 h-3 text-primary-400 flex-shrink-0" />
              <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded flex-shrink-0 ${row.type === 'receivable' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                {row.type === 'receivable' ? 'A Receber' : 'A Pagar'}
              </span>
              <span className="font-medium text-gray-700">{row.reference}</span>
              <span className="text-gray-400 truncate">{row.entityName}</span>
              {row.isDryRun && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 flex-shrink-0">Dry-run</span>
              )}
              {row.reconStatus === 'REVERSED' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 flex-shrink-0">Revertida</span>
              )}
              <span className="ml-auto font-semibold text-gray-700 flex-shrink-0">{formatCurrency(row.allocatedAmount)}</span>
            </div>
          </td>
        </tr>
      ))}
      <tr className="bg-primary-50/30 border-b border-gray-200">
        <td colSpan={colSpan} className="pl-10 pr-4 py-1.5 text-xs text-gray-500">
          <div className="flex items-center justify-end gap-1.5">
            <span>Restante disponível no movimento:</span>
            <span className={`font-semibold ${remaining > 0.01 ? 'text-amber-600' : 'text-green-600'}`}>
              {formatCurrency(remaining)}
            </span>
          </div>
        </td>
      </tr>
    </>
  )
}
interface MovementsResponse { total: number; page: number; limit: number; items: Movement[] }
interface Summary { totalIncome: number; totalExpense: number; countIncome: number; countExpense: number; byStatus: Record<string, number> }
interface Category { id: string; name: string; type: string; color: string; isArchived: boolean }
interface BalanceGap { afterMovementId: string; afterDate: string; afterDescription: string; afterBalance: number; beforeMovementId: string; beforeDate: string; beforeDescription: string; expectedBalance: number; actualBalance: number; gap: number }
interface BalanceCheckResult { accountId: string; accountName: string; gaps: BalanceGap[] }

export default function BanksPage() {
  const { selectedClientId } = useAuth()
  const qc = useQueryClient()
  const hScroll = useStickyHScrollbar<HTMLDivElement>()
  const toast = useToast()
  const [selectedAccount, setSelectedAccount] = useState<string>('')
  const [page, setPage] = useState(1)
  const [showNewAccount, setShowNewAccount] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [historyAccountId, setHistoryAccountId] = useState<string | null>(null)
  const [revertConfirmId, setRevertConfirmId] = useState<string | null>(null)
  const [confirmDeleteMovementId, setConfirmDeleteMovementId] = useState<string | null>(null)
  const [editAccountId, setEditAccountId] = useState<string | null>(null)
  const [editAccountForm, setEditAccountForm] = useState({ name: '', openingBalance: '', minBalance: '' })
  const [newAccount, setNewAccount] = useState({ name: '', bankName: '', iban: '', openingBalance: '0', minBalance: '' })
  const [bankSearch, setBankSearch] = useState('')
  const [showBankDropdown, setShowBankDropdown] = useState(false)
  const [ibanTouched, setIbanTouched] = useState(false)
  // Limpa o form de nova conta. Usado ao abrir o modal, ao fechá-lo (cancel/X) e
  // após uma criação bem-sucedida, para o IBAN/nome da conta anterior não persistir.
  function resetNewAccountForm() {
    setNewAccount({ name: '', bankName: '', iban: '', openingBalance: '0', minBalance: '' })
    setBankSearch('')
    setShowBankDropdown(false)
    setIbanTouched(false)
  }
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [direction, setDirection] = useState<'' | 'income' | 'expense'>('')
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'description' | 'balanceAfter'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [statusFilter, setStatusFilter] = useState<'' | 'UNCLASSIFIED' | 'CLASSIFIED' | 'RECONCILED'>('')
  const [classifyMovementId, setClassifyMovementId] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [importBank, setImportBank] = useState<SupportedBank>('CGD')
  const [importAccountId, setImportAccountId] = useState<string>('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importPdfFile, setImportPdfFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<{ imported: number; duplicated: number; failed: number; parsed: number; gaps?: BalanceGap[] } | null>(null)
  const [replaceConfirm, setReplaceConfirm] = useState<{ file: File; bank: string; bankAccountId: string; existingCount: number } | null>(null)
  const [previewWarning, setPreviewWarning] = useState<{ issues: Array<{ row: number; field: string; message: string }>; uploadArgs: { file: File; bank: string; bankAccountId: string } } | null>(null)
  const [showNewMovement, setShowNewMovement] = useState(false)
  const [newMovement, setNewMovement] = useState({ bankAccountId: '', date: new Date().toISOString().slice(0, 10), description: '', amount: '', direction: 'income' as 'income' | 'expense' })
  const [editDescId, setEditDescId] = useState<string | null>(null)
  const [editDesc, setEditDesc] = useState('')
  const [expandedMovementIds, setExpandedMovementIds] = useState<Set<string>>(new Set())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pdfFileInputRef = useRef<HTMLInputElement>(null)
  const bankDropdownRef = useRef<HTMLDivElement>(null)
  const carouselRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  function checkScroll() {
    const el = carouselRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 2)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }

  useEffect(() => {
    if (!showBankDropdown) return
    function handleClickOutside(e: MouseEvent) {
      if (bankDropdownRef.current && !bankDropdownRef.current.contains(e.target as Node)) {
        setShowBankDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showBankDropdown])

  useEffect(() => {
    if (!classifyMovementId) return
    function handleClickOutside() { setClassifyMovementId(null) }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [classifyMovementId])

  const filteredBanks = PORTUGUESE_BANKS.filter((b) =>
    b.toLowerCase().includes(bankSearch.toLowerCase())
  )

  const { data: accounts = [] } = useQuery<BankAccount[]>({
    queryKey: ['bank-accounts', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/bank-accounts`),
    enabled: !!selectedClientId,
  })

  useEffect(() => { setTimeout(checkScroll, 0) }, [accounts])

  const { data: summary } = useQuery<Summary>({
    queryKey: ['movements-summary', selectedClientId, selectedAccount, dateFrom, dateTo, search, direction, statusFilter, categoryFilter],
    queryFn: () => {
      const p = new URLSearchParams()
      if (selectedAccount) p.set('bankAccountId', selectedAccount)
      if (dateFrom) p.set('dateFrom', dateFrom)
      if (dateTo) p.set('dateTo', dateTo)
      if (search) p.set('search', search)
      if (direction) p.set('direction', direction)
      if (statusFilter) p.set('status', statusFilter)
      if (categoryFilter) p.set('categoryId', categoryFilter)
      const qs = p.toString()
      return api.get(`/treasury/${selectedClientId}/movements/summary${qs ? `?${qs}` : ''}`)
    },
    enabled: !!selectedClientId && accounts.length > 0,
  })

  const { data: movements } = useQuery<MovementsResponse>({
    queryKey: ['movements', selectedClientId, selectedAccount, page, search, dateFrom, dateTo, direction, statusFilter, categoryFilter, sortBy, sortDir],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), limit: '20' })
      if (selectedAccount) p.set('bankAccountId', selectedAccount)
      if (search) p.set('search', search)
      if (dateFrom) p.set('dateFrom', dateFrom)
      if (dateTo) p.set('dateTo', dateTo)
      if (direction) p.set('direction', direction)
      if (statusFilter) p.set('status', statusFilter)
      if (categoryFilter) p.set('categoryId', categoryFilter)
      if (sortBy !== 'date' || sortDir !== 'desc') { p.set('sortBy', sortBy); p.set('sortDir', sortDir) }
      return api.get(`/treasury/${selectedClientId}/movements?${p.toString()}`)
    },
    enabled: !!selectedClientId && accounts.length > 0,
    placeholderData: keepPreviousData,
  })

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories-all', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/categories`),
    enabled: !!selectedClientId,
  })

  const { data: balanceCheck = [] } = useQuery<BalanceCheckResult[]>({
    queryKey: ['balance-check', selectedClientId, selectedAccount],
    queryFn: () => {
      const p = new URLSearchParams()
      if (selectedAccount) p.set('bankAccountId', selectedAccount)
      const qs = p.toString()
      return api.get(`/treasury/${selectedClientId}/movements/balance-check${qs ? `?${qs}` : ''}`)
    },
    enabled: !!selectedClientId && !!selectedAccount,
  })

  // Shares the ['balance-check', …] prefix so every invalidateQueries(['balance-check'])
  // refreshes the per-card alerts instantly (React Query matches keys by prefix).
  const { data: balanceCheckAll = [] } = useQuery<BalanceCheckResult[]>({
    queryKey: ['balance-check', 'all', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/movements/balance-check`),
    enabled: !!selectedClientId && accounts.length > 0,
  })

  const currentAccountGaps = balanceCheck.find((r) => r.accountId === selectedAccount)?.gaps ?? []
  const gapMap = new Map(currentAccountGaps.map((g) => [g.beforeMovementId, g]))

  const createAccount = useMutation({
    mutationFn: (data: typeof newAccount) => api.post(`/treasury/${selectedClientId}/bank-accounts`, {
      ...data,
      iban: data.iban ? sanitizeIban(data.iban) : undefined,
      openingBalance: parseFloat(data.openingBalance) || 0,
      minBalance: data.minBalance ? parseFloat(data.minBalance) : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bank-accounts'] }); setShowNewAccount(false); resetNewAccountForm() },
  })

  const deleteAccount = useMutation({
    mutationFn: (id: string) => api.delete(`/treasury/${selectedClientId}/bank-accounts/${id}`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['bank-accounts'] })
      qc.invalidateQueries({ queryKey: ['movements'] })
      qc.invalidateQueries({ queryKey: ['movements-summary'] })
      if (selectedAccount === id) setSelectedAccount('')
      setConfirmDeleteId(null)
    },
  })

  const deleteMovement = useMutation({
    mutationFn: (id: string) => api.delete(`/treasury/${selectedClientId}/movements/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movements'] })
      qc.invalidateQueries({ queryKey: ['movements-summary'] })
      qc.invalidateQueries({ queryKey: ['bank-accounts'] })
      qc.invalidateQueries({ queryKey: ['balance-check'] })
      setConfirmDeleteMovementId(null)
    },
  })

  const updateAccount = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { name?: string; openingBalance?: number; minBalance?: number | null } }) =>
      api.patch(`/treasury/${selectedClientId}/bank-accounts/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bank-accounts'] })
      setEditAccountId(null)
      toast.success('Conta atualizada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const updateDescription = useMutation({
    mutationFn: ({ id, description }: { id: string; description: string }) =>
      api.patch(`/treasury/${selectedClientId}/movements/${id}`, { description }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movements'] })
      setEditDescId(null)
      toast.success('Descrição atualizada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const classify = useMutation({
    mutationFn: ({ id, categoryId }: { id: string; categoryId: string | null }) =>
      api.patch(`/treasury/${selectedClientId}/movements/${id}/classify`, { categoryId }),
    onSuccess: (_, { categoryId }) => {
      qc.invalidateQueries({ queryKey: ['movements'] })
      qc.invalidateQueries({ queryKey: ['movements-summary'] })
      qc.invalidateQueries({ queryKey: ['dashboard', selectedClientId] })
      qc.invalidateQueries({ queryKey: ['dashboard-monthly', selectedClientId] })
      qc.invalidateQueries({ queryKey: ['dashboard-categories', selectedClientId] })
      qc.invalidateQueries({ queryKey: ['dashboard-cashflow-statement', selectedClientId] })
      qc.invalidateQueries({ queryKey: ['dashboard-cash-positioning', selectedClientId] })
      setClassifyMovementId(null)
      toast.success(categoryId === null ? 'Categoria removida.' : 'Movimento classificado.')
    },
    onError: (e) => toast.error((e as Error).message),
  })


  interface ImportRecord {
    id: string; originalFileName: string | null; createdAt: string
    rowsImported: number; rowsDuplicated: number; rowsFailed: number
    createdBy: string; activeMovements: number
  }
  interface AccountHistory {
    account: { name: string; bankName: string; createdAt: string; openingBalance: number; ibanLast4: string }
    timeline: Array<{ id: string; entityId: string | null; type: string; date: string; user: string | null; payload: Record<string, unknown> }>
    reconciliations: Array<{ id: string; status: string; isDryRun: boolean; direction: string; totalMovements: number; totalAllocated: number; createdAt: string; createdBy: string; reversedAt: string | null; reversedBy: string | null; reversedReason: string | null; movementsCount: number }>
    monthlySummary: Array<{ month: string; income: number; expense: number; net: number }>
  }

  const { data: importHistory = [], isLoading: importsLoading } = useQuery<ImportRecord[]>({
    queryKey: ['import-history', selectedClientId, historyAccountId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/movements/imports?bankAccountId=${historyAccountId}`),
    enabled: !!historyAccountId && !!selectedClientId,
  })

  const { data: accountHistory, isLoading: accountHistoryLoading } = useQuery<AccountHistory>({
    queryKey: ['account-history', selectedClientId, historyAccountId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/movements/history?bankAccountId=${historyAccountId}`),
    enabled: !!historyAccountId && !!selectedClientId,
  })

  const revertDescriptionMutation = useMutation({
    mutationFn: ({ movementId, description }: { movementId: string; description: string }) =>
      api.patch(`/treasury/${selectedClientId}/movements/${movementId}`, { description }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movements'] })
      qc.invalidateQueries({ queryKey: ['account-history', selectedClientId, historyAccountId] })
      toast.success('Descrição revertida.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const restoreMovementMutation = useMutation({
    mutationFn: (movementId: string) =>
      api.patch(`/treasury/${selectedClientId}/movements/${movementId}/restore`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movements'] })
      qc.invalidateQueries({ queryKey: ['movements-summary'] })
      qc.invalidateQueries({ queryKey: ['bank-accounts'] })
      qc.invalidateQueries({ queryKey: ['balance-check'] })
      qc.invalidateQueries({ queryKey: ['account-history', selectedClientId, historyAccountId] })
      toast.success('Movimento restaurado.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const revertImportMutation = useMutation({
    mutationFn: (importId: string) =>
      api.delete<{ reverted: number }>(`/treasury/${selectedClientId}/movements/imports/${importId}`),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['movements'] })
      qc.invalidateQueries({ queryKey: ['movements-summary'] })
      qc.invalidateQueries({ queryKey: ['bank-accounts'] })
      qc.invalidateQueries({ queryKey: ['balance-check'] })
      qc.invalidateQueries({ queryKey: ['import-history', selectedClientId, historyAccountId] })
      setRevertConfirmId(null)
      toast.success(`Importação revertida (${data.reverted} movimento(s) eliminado(s)).`)
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const deduplicateMutation = useMutation({
    mutationFn: () => api.post<{ removed: number }>(`/treasury/${selectedClientId}/movements/deduplicate`, selectedAccount ? { bankAccountId: selectedAccount } : {}),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['movements'] })
      qc.invalidateQueries({ queryKey: ['movements-summary'] })
      qc.invalidateQueries({ queryKey: ['balance-check'] })
      if (data.removed > 0) toast.success(`${data.removed} movimento(s) duplicado(s) removido(s).`)
      else toast.info('Nenhum duplicado encontrado.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const createMovement = useMutation({
    mutationFn: (data: { bankAccountId: string; date: string; amount: number; description: string }) =>
      api.post(`/treasury/${selectedClientId}/movements`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movements'] })
      qc.invalidateQueries({ queryKey: ['movements-summary'] })
      qc.invalidateQueries({ queryKey: ['bank-accounts'] })
      qc.invalidateQueries({ queryKey: ['balance-check'] })
      qc.refetchQueries({ queryKey: ['movements-pending'] })
      setShowNewMovement(false)
      setNewMovement({ bankAccountId: '', date: new Date().toISOString().slice(0, 10), description: '', amount: '', direction: 'income' })
      toast.success('Movimento criado.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const uploadStatementMutation = useMutation({
    mutationFn: async ({ file, bank, bankAccountId, force }: { file: File; bank: string; bankAccountId: string; force?: boolean }) => {
      const token = localStorage.getItem('access_token')
      const form = new FormData()
      form.append('file', file)
      form.append('bankAccountId', bankAccountId)
      form.append('bank', bank)
      const url = `${API_BASE}/treasury/${selectedClientId}/movements/upload${force ? '?force=true' : ''}`
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }))
        if (res.status === 409 && err.code === 'ACCOUNT_HAS_IMPORTS') {
          const e = Object.assign(new Error(err.error ?? 'Conta com extrato existente'), { code: 'ACCOUNT_HAS_IMPORTS', existingCount: err.existingCount as number, uploadArgs: { file, bank, bankAccountId } })
          throw e
        }
        throw new Error(err.error ?? 'Erro ao importar')
      }
      return res.json()
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['movements'] })
      qc.invalidateQueries({ queryKey: ['bank-accounts'] })
      qc.invalidateQueries({ queryKey: ['balance-check'] })
      qc.refetchQueries({ queryKey: ['movements-pending'] })
      setImportResult(data)
      setReplaceConfirm(null)
      toast.success(`${data.imported} movimento(s) importado(s).`)
    },
    onError: (e: unknown) => {
      const err = e as Error & { code?: string; existingCount?: number; uploadArgs?: { file: File; bank: string; bankAccountId: string } }
      if (err.code === 'ACCOUNT_HAS_IMPORTS' && err.uploadArgs) {
        setReplaceConfirm({ ...err.uploadArgs, existingCount: err.existingCount ?? 0 })
      } else {
        toast.error(err.message)
      }
    },
  })

  const previewMutation = useMutation({
    mutationFn: async ({ file, bank, bankAccountId }: { file: File; bank: string; bankAccountId: string }) => {
      const token = localStorage.getItem('access_token')
      const form = new FormData()
      form.append('file', file)
      form.append('bank', bank)
      form.append('bankAccountId', bankAccountId)
      const res = await fetch(`${API_BASE}/treasury/${selectedClientId}/movements/upload/preview`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }))
        throw new Error(err.error ?? 'Erro ao validar ficheiro')
      }
      return res.json() as Promise<{ parsed: number; issues: Array<{ row: number; field: string; message: string }> }>
    },
    onSuccess: (data, variables) => {
      if (data.issues.length === 0) {
        uploadStatementMutation.mutate(variables)
      } else {
        setPreviewWarning({ issues: data.issues, uploadArgs: variables })
      }
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const selectedAccountData = accounts.find((a) => a.id === selectedAccount)
  const totalBalance = selectedAccountData ? selectedAccountData.currentBalance : accounts.reduce((s, a) => s + a.currentBalance, 0)
  const confirmDeleteAccount = accounts.find((a) => a.id === confirmDeleteId)

  const hasFilters = !!(search || dateFrom || dateTo || direction || statusFilter || categoryFilter)

  function clearFilters() {
    setSearch(''); setDateFrom(''); setDateTo(''); setDirection(''); setStatusFilter(''); setCategoryFilter(''); setPage(1)
  }

  function toggleMovementExpand(id: string) {
    setExpandedMovementIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSort(field: typeof sortBy) {
    if (sortBy === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
    setPage(1)
  }

  function SortIcon({ field }: { field: typeof sortBy }) {
    if (sortBy !== field) return <ArrowUpDown className="inline w-3 h-3 ml-1 text-gray-300" />
    return sortDir === 'desc'
      ? <ArrowDown className="inline w-3 h-3 ml-1 text-primary-500" />
      : <ArrowUp className="inline w-3 h-3 ml-1 text-primary-500" />
  }

  async function exportCsv() {
    const token = localStorage.getItem('access_token')
    const p = new URLSearchParams()
    if (selectedAccount) p.set('bankAccountId', selectedAccount)
    if (search) p.set('search', search)
    if (dateFrom) p.set('dateFrom', dateFrom)
    if (dateTo) p.set('dateTo', dateTo)
    if (direction) p.set('direction', direction)
    if (statusFilter) p.set('status', statusFilter)
    if (categoryFilter) p.set('categoryId', categoryFilter)
    const res = await fetch(`${API_BASE}/treasury/${selectedClientId}/movements/export.csv?${p}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'movimentos.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">Bancos & Movimentos</h1>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => {
            setImportFile(null)
            setImportPdfFile(null)
            setImportResult(null)
            setReplaceConfirm(null)
            setPreviewWarning(null)
            setImportBank('CGD')
            setImportAccountId('')
            previewMutation.reset()
            uploadStatementMutation.reset()
            if (fileInputRef.current) fileInputRef.current.value = ''
            if (pdfFileInputRef.current) pdfFileInputRef.current.value = ''
            setShowImport(true)
          }} className="btn-secondary flex items-center gap-2"><Upload className="w-4 h-4" />Importar movimentos de conta</button>
          <button onClick={() => { setNewMovement(m => ({ ...m, bankAccountId: selectedAccount || accounts[0]?.id || '', date: new Date().toISOString().slice(0, 10) })); setShowNewMovement(true) }} className="btn-secondary flex items-center gap-2"><PenLine className="w-4 h-4" />Novo Movimento</button>
          <button onClick={() => { resetNewAccountForm(); createAccount.reset(); setShowNewAccount(true) }} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" />Nova Conta</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title={selectedAccountData ? 'Saldo da Conta' : 'Saldo total da(s) Conta(s)'}
          value={formatCurrency(totalBalance)}
          valueColor="auto"
          rawValue={totalBalance}
          subtitle={selectedAccountData ? selectedAccountData.name : `${accounts.length} conta${accounts.length !== 1 ? 's' : ''}`}
        />
        <KpiCard
          title="Entradas"
          value={formatCurrency(summary?.totalIncome ?? 0)}
          valueColor="green"
          subtitle={`${summary?.countIncome ?? 0} movimentos`}
        />
        <KpiCard
          title="Saídas"
          value={formatCurrency(summary?.totalExpense ?? 0)}
          valueColor="red"
          subtitle={`${summary?.countExpense ?? 0} movimentos`}
        />
        <KpiCard
          title="Resultado do período"
          value={formatCurrency((summary?.totalIncome ?? 0) - (summary?.totalExpense ?? 0))}
          valueColor="auto"
          rawValue={(summary?.totalIncome ?? 0) - (summary?.totalExpense ?? 0)}
          subtitle={hasFilters ? 'Filtros aplicados' : 'Todos os movimentos'}
        />
      </div>

      {/* Bank cards carousel */}
      <div className="relative">
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => carouselRef.current?.scrollBy({ left: -304, behavior: 'smooth' })}
            className="absolute -left-4 top-1/2 -translate-y-1/2 z-10 w-8 h-8 bg-white border border-gray-200 rounded-full shadow-md flex items-center justify-center hover:bg-gray-50 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
        )}
        <div className="overflow-hidden">
          <div
            ref={carouselRef}
            onScroll={checkScroll}
            className="flex gap-4 overflow-x-auto pb-4 -mb-4 snap-x snap-mandatory"
          >
            {accounts.map((acc) => {
              const accGapCount = balanceCheckAll.find((r) => r.accountId === acc.id)?.gaps.length ?? 0
              return (
                <div
                  key={acc.id}
                  onClick={() => { setSelectedAccount(selectedAccount === acc.id ? '' : acc.id); setPage(1) }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && (setSelectedAccount(selectedAccount === acc.id ? '' : acc.id), setPage(1))}
                  className={`snap-start flex-none w-72 card pt-4 px-4 pb-0 text-left transition-all cursor-pointer flex flex-col group ${selectedAccount === acc.id ? 'border-primary-400 bg-primary-50' : 'hover:border-gray-300'}`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <BankAvatar bankName={acc.bankName} />
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 text-sm truncate">{acc.name}</div>
                      <div className="text-xs text-gray-400">{acc.bankName} •••• {acc.ibanLast4}</div>
                    </div>
                  </div>
                  <div className={`text-xl font-bold ${acc.currentBalance >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{formatCurrency(acc.currentBalance)}</div>
                  {acc.lowBalanceWarning && (
                    <div className="flex items-center gap-1 mt-2 text-xs text-amber-700 bg-white border border-amber-200 rounded px-2 py-1">
                      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                      Saldo abaixo do mínimo ({formatCurrency(acc.minBalance ?? 0)})
                    </div>
                  )}
                  {accGapCount > 0 && (
                    <div className="flex items-center gap-1 mt-2 text-xs text-red-700 bg-white border border-red-200 rounded px-2 py-1">
                      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                      {accGapCount} inconsistência{accGapCount !== 1 ? 's' : ''} detetada{accGapCount !== 1 ? 's' : ''}
                    </div>
                  )}
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setEditAccountId(acc.id); setEditAccountForm({ name: acc.name, openingBalance: acc.openingBalance != null ? String(acc.openingBalance) : '0', minBalance: acc.minBalance != null ? String(acc.minBalance) : '' }) }}
                      className="p-1.5 text-gray-400 hover:text-orange-500 hover:bg-orange-50 rounded-lg transition-all"
                      title="Editar conta"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setHistoryAccountId(acc.id) }}
                      className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-all"
                      title="Histórico da conta"
                    >
                      <History className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(acc.id) }}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      title="Remover conta"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        {canScrollRight && (
          <button
            type="button"
            onClick={() => carouselRef.current?.scrollBy({ left: 304, behavior: 'smooth' })}
            className="absolute -right-4 top-1/2 -translate-y-1/2 z-10 w-8 h-8 bg-white border border-gray-200 rounded-full shadow-md flex items-center justify-center hover:bg-gray-50 transition-colors"
          >
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        )}
      </div>

      {/* Movements table */}
      {accounts.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <Building2 className="w-10 h-10 text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">Sem contas bancárias</p>
          <p className="text-sm text-gray-400 mt-1">Adicione uma conta para começar a registar movimentos.</p>
        </div>
      ) : (
        <div className="card">
          {currentAccountGaps.length > 0 && (
            <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 rounded-t-xl">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800">
                    {currentAccountGaps.length} inconsistência{currentAccountGaps.length !== 1 ? 's' : ''} de saldo detetada{currentAccountGaps.length !== 1 ? 's' : ''}
                  </p>
                  <p className="text-xs text-amber-700 mt-0.5">Existem provavelmente movimentos em falta neste extrato. As linhas assinaladas indicam onde os valores divergem.</p>
                </div>
              </div>
            </div>
          )}
          {/* Filter toolbar */}
          <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                className="input pl-8 text-sm py-1.5 w-52"
                placeholder="Pesquisar descrição..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              />
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="date"
                className="input text-sm py-1.5 w-36"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
              />
              <span className="text-gray-400 text-xs">–</span>
              <input
                type="date"
                className="input text-sm py-1.5 w-36"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
              />
            </div>

            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
              {(['', 'income', 'expense'] as const).map((d, i) => (
                <button
                  key={d}
                  onClick={() => { setDirection(d); setPage(1) }}
                  className={`px-3 py-1.5 transition-colors ${direction === d ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'}${i > 0 ? ' border-l border-gray-200' : ''}`}
                >
                  {d === '' ? 'Todos' : d === 'income' ? 'Entradas' : 'Saídas'}
                </button>
              ))}
            </div>

            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
              {([
                { v: '' as const, label: 'Todos', statusKey: '' },
                { v: 'UNCLASSIFIED' as const, label: 'Não classif.', statusKey: 'UNCLASSIFIED' },
                { v: 'CLASSIFIED' as const, label: 'Classificado', statusKey: 'CLASSIFIED' },
                { v: 'RECONCILED' as const, label: 'Reconciliado', statusKey: 'RECONCILED' },
              ]).map(({ v, label, statusKey }, i) => {
                const count = statusKey ? summary?.byStatus[statusKey] : undefined
                return (
                  <button
                    key={v}
                    onClick={() => { setStatusFilter(v); setPage(1) }}
                    className={`px-3 py-1.5 transition-colors flex items-center gap-1 ${statusFilter === v ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'}${i > 0 ? ' border-l border-gray-200' : ''}`}
                  >
                    {label}
                    {count != null && count > 0 && (
                      <span className={`text-xs rounded-full px-1.5 py-0.5 leading-none font-bold ${statusFilter === v ? 'bg-white/20 text-white' : statusKey === 'UNCLASSIFIED' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            <select
              className="input w-auto text-xs py-1.5"
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(1) }}
            >
              <option value="">Todas as cat.</option>
              {['REVENUE', 'EXPENSE'].map((type) => {
                const cats = categories.filter((c) => c.type === type && !c.isArchived)
                if (!cats.length) return null
                return (
                  <optgroup key={type} label={type === 'REVENUE' ? 'Receita' : 'Despesa'}>
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                )
              })}
            </select>

            {hasFilters && (
              <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 px-2 py-1.5 hover:bg-gray-50 rounded-lg transition-colors">
                <X className="w-3.5 h-3.5" /> Limpar
              </button>
            )}

            <span className="text-sm text-gray-400 ml-auto">{movements?.total ?? 0} movimentos</span>
            <button
              onClick={() => { if (confirm('Remover movimentos duplicados? Esta ação não pode ser desfeita.')) deduplicateMutation.mutate() }}
              title="Remover duplicados"
              disabled={deduplicateMutation.isPending}
              className="text-gray-400 hover:text-amber-600 p-1.5 hover:bg-amber-50 rounded-lg transition-colors"
            >
              <FilterX className="w-4 h-4" />
            </button>
            <button onClick={exportCsv} title="Exportar CSV" className="text-gray-400 hover:text-gray-600 p-1.5 hover:bg-gray-50 rounded-lg transition-colors">
              <Download className="w-4 h-4" />
            </button>
          </div>

          <div ref={hScroll} className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px] lg:min-w-0">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                  <th
                    onClick={() => toggleSort('date')}
                    className="text-left px-5 py-3 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap"
                  >
                    Data <SortIcon field="date" />
                  </th>
                  {!selectedAccount && (
                    <th className="text-left px-5 py-3 whitespace-nowrap text-xs text-gray-500 uppercase">Conta</th>
                  )}
                  <th
                    onClick={() => toggleSort('description')}
                    className="text-left px-5 py-3 cursor-pointer hover:text-gray-700 select-none"
                  >
                    Descrição <SortIcon field="description" />
                  </th>
                  <th className="text-left px-3 py-3 whitespace-nowrap">Categoria</th>
                  <th
                    onClick={() => toggleSort('amount')}
                    className="text-right px-1 py-3 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap"
                  >
                    Valor <SortIcon field="amount" />
                  </th>
                  <th
                    onClick={() => toggleSort('balanceAfter')}
                    className="text-right px-5 py-3 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap"
                  >
                    Saldo <SortIcon field="balanceAfter" />
                  </th>
                  <th className="w-8 px-2 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {movements?.items.map((m) => {
                  const gap = gapMap.get(m.id)
                  const isExpandable = !!m.reconciliation
                  const isMovExpanded = expandedMovementIds.has(m.id)
                  const colSpan = selectedAccount ? 6 : 7
                  return (
                    <Fragment key={m.id}>
                      {gap && (
                        <tr className="bg-amber-50 border-y border-amber-200">
                          <td colSpan={colSpan} className="px-5 py-2">
                            <div className="flex items-center gap-2 text-xs text-amber-700">
                              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                              <span>
                                Saldo real: <strong>{formatCurrency(gap.actualBalance)}</strong>
                                {' '}· Saldo calculado: <strong>{formatCurrency(gap.expectedBalance)}</strong>
                                {' '}· Diferença: <strong className={gap.gap > 0 ? 'text-green-700' : 'text-red-700'}>{gap.gap > 0 ? '+' : ''}{formatCurrency(gap.gap)}</strong>
                                {' '}— possível(is) movimento(s) em falta antes desta linha
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                      <tr className={`hover:bg-gray-50 group ${gap ? 'bg-amber-50/40' : ''}`}>
                        <td className="px-5 py-3 text-gray-500 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {isExpandable ? (
                              <button
                                type="button"
                                onClick={() => toggleMovementExpand(m.id)}
                                className="text-gray-300 hover:text-primary-500 flex-shrink-0 transition-colors"
                                title={isMovExpanded ? 'Ocultar documentos reconciliados' : 'Ver documentos reconciliados'}
                              >
                                {isMovExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              </button>
                            ) : (
                              <span className="w-3.5 h-3.5 flex-shrink-0" />
                            )}
                            {formatDate(m.date)}
                          </div>
                        </td>
                        {!selectedAccount && (
                          <td className="px-5 py-3 whitespace-nowrap">
                            {m.bankAccount && (
                              <div className="flex items-center gap-2">
                                <BankAvatar bankName={m.bankAccount.bankName} />
                                <span className="text-xs text-gray-500 truncate max-w-[8rem]">{m.bankAccount.name}</span>
                              </div>
                            )}
                          </td>
                        )}
                        <td className="px-5 py-3 text-gray-900 max-w-xs">
                          <span className="truncate block">{m.description}</span>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            {m.source === 'MANUAL' && <span className="text-xs text-gray-400">manual</span>}
                            {(() => {
                              const rec = m.reconciliation
                              // Totalmente reconciliado: sem badge (a indicação é para os NÃO reconciliados).
                              if (rec?.state === 'RECONCILED') return null
                              if (rec?.state === 'PARTIAL') {
                                return (
                                  <span
                                    className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700"
                                    title={rec.isDryRun ? 'Parcialmente reconciliado em modo simulação (dry-run)' : 'Parcialmente reconciliado'}
                                  >
                                    <AlertTriangle className="w-3 h-3" /> Parcial{rec.isDryRun ? ' (simulação)' : ''}
                                  </span>
                                )
                              }
                              return (
                                <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                                  <Circle className="w-3 h-3" /> Não reconciliado
                                </span>
                              )
                            })()}
                          </div>
                        </td>
                        <td className="px-3 py-3 relative">
                          {m.status === 'RECONCILED' ? (
                            <span className="text-xs text-gray-400 flex items-center gap-1">
                              {m.category && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: m.category.color }} />}
                              {m.category?.name ?? '—'}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setClassifyMovementId(classifyMovementId === m.id ? null : m.id)}
                              className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border transition-colors ${m.category
                                ? 'border-transparent hover:border-gray-200 hover:bg-gray-50'
                                : 'border-dashed border-gray-300 text-gray-400 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50'
                                }`}
                              title={m.category ? 'Alterar categoria' : 'Classificar movimento'}
                            >
                              {m.category
                                ? <><span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: m.category.color }} />{m.category.name}</>
                                : <><Tag className="w-3 h-3" />N/C</>
                              }
                            </button>
                          )}
                          {classifyMovementId === m.id && (() => {
                            const allowedType = Number(m.amount) >= 0 ? 'REVENUE' : 'EXPENSE'
                            const cats = categories.filter((c) => c.type === allowedType && !c.isArchived)
                            return (
                              <div onMouseDown={(e) => e.stopPropagation()} className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-xl shadow-lg py-1 w-52 max-h-64 overflow-y-auto">
                                {m.category && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => classify.mutate({ id: m.id, categoryId: null })}
                                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 text-left"
                                    >
                                      <X className="w-3.5 h-3.5 flex-shrink-0" />
                                      Remover categoria
                                    </button>
                                    <div className="border-t border-gray-100 my-1" />
                                  </>
                                )}
                                <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase">
                                  {allowedType === 'REVENUE' ? 'Receita' : 'Despesa'}
                                </div>
                                {cats.length === 0 && (
                                  <div className="px-3 py-2 text-xs text-gray-400">Sem categorias disponíveis</div>
                                )}
                                {cats.map((c) => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => classify.mutate({ id: m.id, categoryId: c.id })}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 text-left"
                                  >
                                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                                    {c.name}
                                  </button>
                                ))}
                              </div>
                            )
                          })()}
                        </td>
                        <td className={`px-1 py-3 text-right font-semibold whitespace-nowrap ${Number(m.amount) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {Number(m.amount) >= 0 ? '+' : ''}{formatCurrency(Number(m.amount))}
                        </td>
                        <td className="px-5 py-3 text-right text-gray-500 whitespace-nowrap">
                          {m.balanceAfter != null ? formatCurrency(Number(m.balanceAfter)) : '—'}
                        </td>
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={() => { setEditDescId(m.id); setEditDesc(m.description) }}
                              className="p-1 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded transition-all"
                              title="Editar descrição"
                            >
                              <PenLine className="w-3.5 h-3.5" />
                            </button>
                            {m.source === 'MANUAL' && (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteMovementId(m.id)}
                                className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-all"
                                title="Remover movimento"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpandable && isMovExpanded && (
                        <MovementReconciliationsSubRows
                          clientId={selectedClientId!}
                          movementId={m.id}
                          movementAmount={m.amount}
                          colSpan={colSpan}
                        />
                      )}
                    </Fragment>
                  )
                })}
                {movements?.items.length === 0 && (
                  <tr>
                    <td colSpan={selectedAccount ? 6 : 7} className="px-5 py-10 text-center text-sm text-gray-400">
                      {hasFilters ? 'Nenhum movimento corresponde aos filtros.' : 'Sem movimentos.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {movements && movements.total > movements.limit && (
              <div className="flex justify-between items-center px-5 py-3 border-t border-gray-100">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary text-xs py-1">‹ Anterior</button>
                <span className="text-xs text-gray-500">
                  {(page - 1) * movements.limit + 1}–{Math.min(page * movements.limit, movements.total)} de {movements.total}
                </span>
                <button onClick={() => setPage(p => p + 1)} disabled={page * movements.limit >= movements.total} className="btn-secondary text-xs py-1">Seguinte ›</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit movement description modal */}
      <Modal open={!!editDescId} onClose={() => setEditDescId(null)} title="Editar Descrição">
        <div className="space-y-4">
          <div>
            <label className="label">Descrição</label>
            <input
              className="input"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && editDescId && editDesc.trim()) updateDescription.mutate({ id: editDescId, description: editDesc }) }}
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setEditDescId(null)} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={() => { if (editDescId) updateDescription.mutate({ id: editDescId, description: editDesc }) }}
              className="btn-primary flex-1"
              disabled={updateDescription.isPending || !editDesc.trim()}
            >
              {updateDescription.isPending ? 'A guardar...' : 'Guardar'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete movement confirmation modal */}
      <Modal open={!!confirmDeleteMovementId} onClose={() => { setConfirmDeleteMovementId(null); deleteMovement.reset() }} title="Remover movimento">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Tem a certeza que pretende remover este movimento manual? Esta ação não pode ser desfeita.</p>
          {deleteMovement.isError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{(deleteMovement.error as Error).message}</p>
          )}
          <div className="flex gap-3 pt-2">
            <button onClick={() => { setConfirmDeleteMovementId(null); deleteMovement.reset() }} className="btn-secondary flex-1">Cancelar</button>
            <button
              type="button"
              onClick={() => { if (confirmDeleteMovementId) deleteMovement.mutate(confirmDeleteMovementId) }}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
              disabled={deleteMovement.isPending}
            >
              {deleteMovement.isPending ? 'A remover...' : 'Remover'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit account modal */}
      <Modal open={!!editAccountId} onClose={() => setEditAccountId(null)} title="Editar Conta Bancária">
        <div className="space-y-4">
          <div>
            <label className="label">Nome</label>
            <input className="input" value={editAccountForm.name} onChange={(e) => setEditAccountForm({ ...editAccountForm, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Saldo inicial (€)</label>
            <input
              type="number"
              step="0.01"
              className="input w-40"
              value={editAccountForm.openingBalance}
              onChange={(e) => setEditAccountForm({ ...editAccountForm, openingBalance: e.target.value })}
              placeholder="0.00"
            />
            <p className="text-xs text-gray-400 mt-1">Saldo de abertura da conta — ponto de partida do cash flow.</p>
          </div>
          <div>
            <label className="label">Saldo mínimo (€)</label>
            <input
              type="number"
              step="0.01"
              className="input w-40"
              value={editAccountForm.minBalance}
              onChange={(e) => setEditAccountForm({ ...editAccountForm, minBalance: e.target.value })}
              placeholder="Sem mínimo"
            />
            <p className="text-xs text-gray-400 mt-1">Deixe vazio para desativar o alerta de saldo baixo.</p>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setEditAccountId(null)} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={() => {
                if (editAccountId) updateAccount.mutate({
                  id: editAccountId,
                  data: {
                    name: editAccountForm.name,
                    openingBalance: editAccountForm.openingBalance !== '' ? parseFloat(editAccountForm.openingBalance) : 0,
                    minBalance: editAccountForm.minBalance !== '' ? parseFloat(editAccountForm.minBalance) : null,
                  },
                })
              }}
              className="btn-primary flex-1"
              disabled={updateAccount.isPending || !editAccountForm.name}
            >
              {updateAccount.isPending ? 'A guardar...' : 'Guardar'}
            </button>
          </div>
        </div>
      </Modal>

      {/* New account modal */}
      {(() => {
        const ibanSanitized = sanitizeIban(newAccount.iban)
        const ibanValidation = validateIban(ibanSanitized)
        const ibanInvalid = ibanTouched && ibanSanitized.length > 0 && !ibanValidation.isValid
        const ibanChecksumWarning = ibanTouched && ibanSanitized.length === 25 && ibanValidation.isValid && !ibanValidation.controlDigitsValid
        const bankValid = PORTUGUESE_BANKS.includes(newAccount.bankName)
        const canSubmit = !createAccount.isPending && !!newAccount.name && bankValid && (ibanSanitized.length === 0 || ibanValidation.isValid)
        const ibanFeedback = (() => {
          if (ibanSanitized.length === 0) return 'Opcional. Se preenchido, deve ser IBAN PT (25 caracteres) e válido por MOD-97.'
          if (!ibanTouched) {
            return ibanValidation.expectedLength
              ? `${ibanValidation.actualLength} / ${ibanValidation.expectedLength} caracteres`
              : `${ibanValidation.actualLength} caracteres`
          }
          if (!ibanInvalid) {
            if (ibanChecksumWarning) {
              return 'Formato válido, mas os dígitos de controlo não passam MOD-97. Pode continuar, mas confirma o IBAN.'
            }
            return `IBAN válido (${ibanValidation.countryCode})`
          }
          if (ibanValidation.reason === 'invalid-country') return 'Código de país inválido (2 primeiras posições).'
          if (ibanValidation.reason === 'not-portuguese') return 'Contas bancárias portuguesas devem começar por PT.'
          if (ibanValidation.reason === 'invalid-length') return `Comprimento inválido para ${ibanValidation.countryCode}: esperado ${ibanValidation.expectedLength}.`
          if (ibanValidation.reason === 'invalid-characters') return 'IBAN contém caracteres inválidos.'
          return 'IBAN inválido.'
        })()
        const resetModal = () => { setShowNewAccount(false); resetNewAccountForm(); createAccount.reset() }
        return (
          <Modal open={showNewAccount} onClose={resetModal} title="Nova Conta Bancária">
            <div className="space-y-4">
              <div>
                <label className="label">Nome</label>
                <input className="input" value={newAccount.name} onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })} placeholder="Ex: Conta Principal CGD" />
              </div>

              <div ref={bankDropdownRef} className="relative">
                <label className="label">Banco</label>
                <input
                  className={`input ${bankSearch && !bankValid ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''}`}
                  value={bankSearch}
                  onChange={(e) => { setBankSearch(e.target.value); setNewAccount({ ...newAccount, bankName: '' }); setShowBankDropdown(true) }}
                  onFocus={() => setShowBankDropdown(true)}
                  onBlur={() => { if (!bankValid) { setBankSearch(''); setNewAccount({ ...newAccount, bankName: '' }) } }}
                  placeholder="Selecionar banco..."
                  autoComplete="off"
                />
                {showBankDropdown && (
                  <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredBanks.length > 0 ? filteredBanks.map((bank) => (
                      <button
                        key={bank}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setBankSearch(bank); setNewAccount({ ...newAccount, bankName: bank }); setShowBankDropdown(false) }}
                      >
                        {bank}
                      </button>
                    )) : (
                      <p className="px-3 py-2 text-sm text-gray-400">Sem resultados</p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="label">IBAN</label>
                <input
                  className={`input font-mono tracking-wider ${ibanInvalid ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''}`}
                  value={newAccount.iban}
                  onChange={(e) => setNewAccount({ ...newAccount, iban: formatIbanInput(e.target.value) })}
                  onBlur={() => setIbanTouched(true)}
                  placeholder="PT50 0000 0000 0000 0000 0000 0"
                  maxLength={31}
                  spellCheck={false}
                />
                <p className={`text-xs mt-1 ${ibanInvalid ? 'text-red-500' : ibanChecksumWarning ? 'text-amber-600' : 'text-gray-400'}`}>
                  {ibanFeedback}
                </p>
              </div>

              <div>
                <label className="label">Saldo inicial (€)</label>
                <input
                  type="number"
                  step="0.01"
                  className="input w-40"
                  value={newAccount.openingBalance}
                  onChange={(e) => setNewAccount({ ...newAccount, openingBalance: e.target.value })}
                  placeholder="0.00"
                />
                <p className="text-xs text-gray-400 mt-1">Saldo de abertura da conta — ponto de partida do cash flow.</p>
              </div>

              <div>
                <label className="label">Saldo mínimo (€)</label>
                <input
                  type="number"
                  step="0.01"
                  className="input w-40"
                  value={newAccount.minBalance}
                  onChange={(e) => setNewAccount({ ...newAccount, minBalance: e.target.value })}
                  placeholder="Sem mínimo"
                />
                <p className="text-xs text-gray-400 mt-1">Deixe vazio para desativar o alerta de saldo baixo.</p>
              </div>

              {createAccount.isError && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                  {(createAccount.error as Error).message}
                </p>
              )}
              <div className="flex gap-3 pt-2">
                <button onClick={resetModal} className="btn-secondary flex-1">Cancelar</button>
                <button onClick={() => createAccount.mutate(newAccount)} className="btn-primary flex-1" disabled={!canSubmit}>
                  {createAccount.isPending ? 'A guardar...' : 'Criar conta'}
                </button>
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* Delete confirmation modal */}
      <Modal open={!!confirmDeleteId} onClose={() => { setConfirmDeleteId(null); deleteAccount.reset() }} title="Remover conta bancária">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Tem a certeza que pretende remover a conta <span className="font-semibold text-gray-900">{confirmDeleteAccount?.name}</span>?
            Esta ação irá arquivar a conta e não poderá ser desfeita.
          </p>
          {deleteAccount.isError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {(deleteAccount.error as Error).message}
            </p>
          )}
          <div className="flex gap-3 pt-2">
            <button onClick={() => { setConfirmDeleteId(null); deleteAccount.reset() }} className="btn-secondary flex-1">Cancelar</button>
            <button
              type="button"
              onClick={() => { if (confirmDeleteId) deleteAccount.mutate(confirmDeleteId) }}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
              disabled={deleteAccount.isPending}
            >
              {deleteAccount.isPending ? 'A remover...' : 'Remover conta'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Account history modal */}
      {(() => {
        const acc = accounts.find((a) => a.id === historyAccountId)
        const isLoading = importsLoading || accountHistoryLoading

        const TIMELINE_LABELS: Record<string, { label: string; color: string }> = {
          'account.create': { label: 'Conta criada', color: 'bg-green-100 text-green-700' },
          'account.update': { label: 'Conta atualizada', color: 'bg-blue-100 text-blue-700' },
          'account.deduplicate': { label: 'Deduplicação executada', color: 'bg-purple-100 text-purple-700' },
          'import.complete': { label: 'Extrato importado', color: 'bg-primary-100 text-primary-700' },
          'import.revert': { label: 'Importação revertida', color: 'bg-amber-100 text-amber-700' },
          'movement.create': { label: 'Movimento manual criado', color: 'bg-green-100 text-green-700' },
          'movement.delete': { label: 'Movimento eliminado', color: 'bg-red-100 text-red-700' },
          'movement.edit': { label: 'Descrição editada', color: 'bg-gray-100 text-gray-600' },
          'reconciliation.confirm': { label: 'Reconciliação confirmada', color: 'bg-teal-100 text-teal-700' },
          'reconciliation.reverse': { label: 'Reconciliação revertida', color: 'bg-amber-100 text-amber-700' },
          'movement.restore': { label: 'Movimento restaurado', color: 'bg-green-100 text-green-700' },
          'statement.delete': { label: 'Extrato eliminado', color: 'bg-red-100 text-red-700' },
        }

        return (
          <Modal open={!!historyAccountId} onClose={() => { setHistoryAccountId(null); setRevertConfirmId(null) }} title={`Histórico — ${acc?.name ?? ''}`} size="lg">
            <div className="space-y-4">
              {isLoading ? (
                <div className="flex items-center justify-center py-12 text-gray-400">
                  <RefreshCw className="w-5 h-5 animate-spin mr-2" /> A carregar...
                </div>
              ) : (
                <div className="max-h-[55vh] overflow-y-auto pr-1">
                  {accountHistory?.timeline.length === 0 ? (
                    <div className="text-center py-10 text-gray-400 text-sm">Sem eventos registados.</div>
                  ) : (
                    <div className="relative">
                      <div className="absolute left-3 top-0 bottom-0 w-px bg-gray-100" />
                      {accountHistory?.timeline.map((ev) => {
                        const meta = TIMELINE_LABELS[ev.type] ?? { label: ev.type, color: 'bg-gray-100 text-gray-500' }
                        const p = ev.payload
                        const imp = ev.type === 'import.complete' ? importHistory.find((i) => i.id === ev.entityId) : null
                        const recon = (ev.type === 'reconciliation.confirm' || ev.type === 'reconciliation.reverse')
                          ? accountHistory?.reconciliations.find((r) => r.id === ev.entityId)
                          : null
                        const isReverted = imp ? imp.activeMovements === 0 : false
                        const isReverting = revertImportMutation.isPending && revertConfirmId === ev.entityId
                        const confirmingThis = revertConfirmId === ev.entityId && !revertImportMutation.isPending
                        return (
                          <div key={ev.id} className="relative flex gap-3 pb-4 pl-8">
                            <div className="absolute left-0 w-6 h-6 rounded-full bg-white border-2 border-gray-200 flex items-center justify-center">
                              <div className="w-2 h-2 rounded-full bg-gray-300" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${meta.color}`}>{meta.label}</span>
                                {ev.user && <span className="text-xs text-gray-400">por {ev.user}</span>}
                                <span className="text-xs text-gray-300 ml-auto">{new Date(ev.date).toLocaleString('pt-PT')}</span>
                              </div>
                              {/* Payload details */}
                              <div className="mt-1 text-xs text-gray-500 space-y-0.5">
                                {ev.type === 'import.complete' && imp && (
                                  <div className="mt-1.5 space-y-1.5">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="space-y-0.5 min-w-0">
                                        {imp.originalFileName && (
                                          <div className="flex items-center gap-1.5 text-gray-600">
                                            <FileText className="w-3.5 h-3.5 flex-shrink-0 text-primary-400" />
                                            <span className="font-medium truncate">{imp.originalFileName}</span>
                                            {isReverted && <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded-full flex-shrink-0">Revertido</span>}
                                          </div>
                                        )}
                                        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                                          <span className="text-green-600">{imp.rowsImported} importados</span>
                                          {imp.rowsDuplicated > 0 && <span className="text-amber-500">{imp.rowsDuplicated} duplicados</span>}
                                          {imp.rowsFailed > 0 && <span className="text-red-500">{imp.rowsFailed} com erro</span>}
                                          {!isReverted && <span className="text-primary-600">{imp.activeMovements} ativos</span>}
                                        </div>
                                      </div>
                                      {!isReverted && !confirmingThis && (
                                        <button onClick={() => setRevertConfirmId(ev.entityId!)} disabled={isReverting}
                                          className="flex-shrink-0 flex items-center gap-1 text-xs px-2.5 py-1 border border-amber-300 text-amber-700 hover:bg-amber-50 rounded-lg transition-colors">
                                          <RotateCcw className="w-3 h-3" /> Reverter
                                        </button>
                                      )}
                                    </div>
                                    {confirmingThis && (
                                      <div className="flex items-center gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                                        <span className="flex-1 text-amber-700">Serão eliminados <strong>{imp.activeMovements}</strong> movimento(s).</span>
                                        <button onClick={() => setRevertConfirmId(null)} className="px-2 py-0.5 border border-gray-300 rounded hover:bg-gray-50">Cancelar</button>
                                        <button onClick={() => revertImportMutation.mutate(imp.id)} className="px-2 py-0.5 bg-red-600 hover:bg-red-700 text-white rounded transition-colors">Confirmar</button>
                                      </div>
                                    )}
                                    {isReverting && <div className="flex items-center gap-1.5 text-gray-400"><RefreshCw className="w-3 h-3 animate-spin" /> A reverter...</div>}
                                  </div>
                                )}
                                {ev.type === 'import.complete' && !imp && <span>{p.imported as number} importados · {p.duplicated as number} duplicados · {p.failed as number} erros</span>}
                                {ev.type === 'import.revert' && <span>{p.reverted as number} movimento(s) revertidos</span>}
                                {ev.type === 'movement.create' && <span>Valor: {formatCurrency(p.amount as number)} · Data: {formatDate(p.date as string)}</span>}
                                {ev.type === 'movement.delete' && <span>Valor: {formatCurrency(p.amount as number)} · Origem: {p.source as string}</span>}
                                {ev.type === 'movement.edit' && <><span className="line-through text-gray-400">{p.before as string}</span><span className="ml-1">→ {p.after as string}</span></>}
                                {ev.type === 'account.create' && <span>Saldo inicial: {formatCurrency(p.openingBalance as number)}</span>}
                                {ev.type === 'account.update' && <span>{Object.entries(p).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span>}
                                {ev.type === 'account.deduplicate' && <span>{p.removed as number} duplicado(s) removido(s)</span>}
                                {ev.type === 'reconciliation.confirm' && recon && (
                                  <div className="mt-0.5 space-y-0.5">
                                    <div className="flex flex-wrap gap-x-3">
                                      <span>{recon.direction === 'INCOME' ? 'Receita' : 'Despesa'}</span>
                                      <span>{recon.movementsCount} movimento(s)</span>
                                      <span className="font-medium text-gray-700">{formatCurrency(recon.totalAllocated)} alocados</span>
                                      {recon.isDryRun && <span className="text-yellow-600">Dry-run</span>}
                                    </div>
                                    {recon.reversedAt && <div className="text-amber-600">Revertida em {new Date(recon.reversedAt).toLocaleString('pt-PT')}{recon.reversedBy ? ` por ${recon.reversedBy}` : ''}</div>}
                                  </div>
                                )}
                                {ev.type === 'reconciliation.confirm' && !recon && <span>{p.movementsCount as number} movimento(s) · {p.allocationsCount as number} alocação(ões){(p.isDryRun as boolean) ? ' · Dry-run' : ''}</span>}
                                {ev.type === 'reconciliation.reverse' && Boolean(p.reason) && <span>Motivo: {String(p.reason)}</span>}
                                {ev.type === 'movement.restore' && <span>Valor: {formatCurrency(p.amount as number)}</span>}
                              </div>
                              {ev.type === 'movement.edit' && ev.entityId && (p.before as string) && (
                                <button
                                  onClick={() => revertDescriptionMutation.mutate({ movementId: ev.entityId!, description: p.before as string })}
                                  disabled={revertDescriptionMutation.isPending}
                                  className="mt-1.5 flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 hover:underline"
                                >
                                  <RotateCcw className="w-3 h-3" /> Reverter descrição
                                </button>
                              )}
                              {ev.type === 'movement.delete' && ev.entityId && (
                                <button
                                  onClick={() => restoreMovementMutation.mutate(ev.entityId!)}
                                  disabled={restoreMovementMutation.isPending}
                                  className="mt-1.5 flex items-center gap-1 text-xs text-green-600 hover:text-green-700 hover:underline"
                                >
                                  <RotateCcw className="w-3 h-3" /> Restaurar movimento
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              <button onClick={() => { setHistoryAccountId(null); setRevertConfirmId(null) }} className="btn-secondary w-full">Fechar</button>
            </div>
          </Modal>
        )
      })()}

      {/* New movement modal */}
      <Modal open={showNewMovement} onClose={() => { setShowNewMovement(false); createMovement.reset() }} title="Novo Movimento Manual">
        <div className="space-y-4">
          <div>
            <label className="label">Conta bancária</label>
            <select className="input" value={newMovement.bankAccountId} onChange={(e) => setNewMovement({ ...newMovement, bankAccountId: e.target.value })}>
              <option value="">Selecionar conta...</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.bankName}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Data</label>
              <input type="date" className="input" value={newMovement.date} onChange={(e) => setNewMovement({ ...newMovement, date: e.target.value })} />
            </div>
            <div>
              <label className="label">Tipo</label>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm font-medium h-[38px]">
                {(['income', 'expense'] as const).map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setNewMovement({ ...newMovement, direction: d })}
                    className={`flex-1 transition-colors ${newMovement.direction === d ? (d === 'income' ? 'bg-green-600 text-white' : 'bg-red-600 text-white') : 'text-gray-600 hover:bg-gray-50'}${i > 0 ? ' border-l border-gray-200' : ''}`}
                  >
                    {d === 'income' ? '＋ Entrada' : '－ Saída'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="label">Valor (€)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input"
              placeholder="0,00"
              value={newMovement.amount}
              onChange={(e) => setNewMovement({ ...newMovement, amount: e.target.value })}
            />
          </div>

          <div>
            <label className="label">Descrição</label>
            <input
              className="input"
              placeholder="Ex: Transferência recebida"
              value={newMovement.description}
              onChange={(e) => setNewMovement({ ...newMovement, description: e.target.value })}
            />
          </div>

          {createMovement.isError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {(createMovement.error as Error).message}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={() => { setShowNewMovement(false); createMovement.reset() }} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={() => {
                const amt = parseFloat(newMovement.amount)
                if (!amt || amt <= 0) return
                createMovement.mutate({
                  bankAccountId: newMovement.bankAccountId,
                  date: newMovement.date,
                  amount: newMovement.direction === 'income' ? amt : -amt,
                  description: newMovement.description,
                })
              }}
              className="btn-primary flex-1"
              disabled={createMovement.isPending || !newMovement.bankAccountId || !newMovement.date || !newMovement.description || !newMovement.amount}
            >
              {createMovement.isPending ? 'A guardar...' : 'Criar movimento'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Import modal */}
      <Modal open={showImport} onClose={() => { setShowImport(false); setImportFile(null); setImportPdfFile(null); setImportResult(null); setReplaceConfirm(null); setPreviewWarning(null); setImportBank('CGD'); setImportAccountId('') }} title="Importar Extrato Bancário" size="lg">
        {importResult ? (
          <div className="space-y-5">
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <p className="text-lg font-semibold text-gray-900">Importação concluída</p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-green-50 rounded-xl p-3">
                <div className="text-2xl font-bold text-green-700">{importResult.imported}</div>
                <div className="text-xs text-green-600 mt-1">Importados</div>
              </div>
              <div className="bg-yellow-50 rounded-xl p-3">
                <div className="text-2xl font-bold text-yellow-700">{importResult.duplicated}</div>
                <div className="text-xs text-yellow-600 mt-1">Duplicados</div>
              </div>
              <div className="bg-red-50 rounded-xl p-3">
                <div className="text-2xl font-bold text-red-700">{importResult.failed}</div>
                <div className="text-xs text-red-600 mt-1">Com erro</div>
              </div>
            </div>

            {/* Aviso de inconsistências de saldo detetadas pós-import — mesma deteção
                que a coluna "Gap" usa na visualização dos movimentos. */}
            {importResult.gaps && importResult.gaps.length > 0 && (
              <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-amber-800">
                    {importResult.gaps.length === 1
                      ? '1 inconsistência de saldo detetada'
                      : `${importResult.gaps.length} inconsistências de saldo detetadas`}
                  </p>
                  <p className="text-xs text-amber-700 mt-1">
                    O saldo após cada movimento foi comparado com o esperado. Verifique se faltam linhas no extrato.
                  </p>
                  <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                    {importResult.gaps.slice(0, 6).map((g, i) => (
                      <li key={i} className="text-xs text-amber-800 flex items-baseline gap-2">
                        <span className="text-amber-500 font-mono">{g.beforeDate}</span>
                        <span className="flex-1 truncate">{g.beforeDescription || '—'}</span>
                        <span className="font-semibold tabular-nums whitespace-nowrap">
                          {g.gap > 0 ? '+' : ''}{formatCurrency(g.gap)}
                        </span>
                      </li>
                    ))}
                    {importResult.gaps.length > 6 && (
                      <li className="text-xs text-amber-600 italic">
                        ... e mais {importResult.gaps.length - 6}. Detalhes em Bancos & Movimentos.
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            )}

            <button onClick={() => { setShowImport(false); setImportFile(null); setImportPdfFile(null); setImportResult(null); setImportBank('CGD'); setImportAccountId('') }} className="btn-primary w-full">Fechar</button>
          </div>
        ) : replaceConfirm ? (
          <div className="space-y-5">
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-800">Esta conta já tem movimentos importados</p>
                <p className="text-sm text-amber-700 mt-1">
                  Existem <strong>{replaceConfirm.existingCount}</strong> movimento(s) importado(s) nesta conta.
                  Ao substituir, todos os movimentos importados serão eliminados permanentemente e substituídos pelos do novo extrato.
                  Os movimentos manuais serão mantidos.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setReplaceConfirm(null)}
                className="btn-secondary flex-1"
                disabled={uploadStatementMutation.isPending}
              >
                Cancelar
              </button>
              <button
                onClick={() => uploadStatementMutation.mutate({ ...replaceConfirm, force: true })}
                className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors disabled:opacity-50"
                disabled={uploadStatementMutation.isPending}
              >
                {uploadStatementMutation.isPending ? 'A substituir...' : 'Substituir'}
              </button>
            </div>
          </div>
        ) : previewWarning ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-800">Foram detetadas inconsistências no ficheiro</p>
                <p className="text-sm text-amber-700 mt-1">Verifique os problemas abaixo antes de importar. Pode importar mesmo assim, mas os dados podem estar incorretos.</p>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {previewWarning.issues.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 text-sm px-3 py-2 bg-red-50 border border-red-100 rounded-lg">
                  <span className="font-semibold text-red-700 flex-shrink-0">Linha {issue.row}</span>
                  <span className="text-red-600 flex-shrink-0">{issue.field}:</span>
                  <span className="text-red-700">{issue.message}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setPreviewWarning(null)} className="btn-secondary flex-1" disabled={uploadStatementMutation.isPending}>
                Voltar
              </button>
              <button
                onClick={() => uploadStatementMutation.mutate(previewWarning.uploadArgs)}
                className="flex-1 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-medium transition-colors disabled:opacity-50"
                disabled={uploadStatementMutation.isPending}
              >
                {uploadStatementMutation.isPending ? 'A importar...' : 'Importar mesmo assim'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Banco</label>
                <select
                  className="input"
                  value={importBank}
                  onChange={(e) => {
                    const bank = e.target.value as SupportedBank
                    setImportBank(bank)
                    const bankName = BANK_CODE_TO_NAME[bank]
                    const first = accounts.find((a) => a.bankName === bankName)
                    setImportAccountId(first?.id ?? '')
                    if (!PDF_IMPORT_BANKS.has(bank)) setImportPdfFile(null)
                  }}
                >
                  {BANK_IMPORT_OPTIONS.map((b) => (
                    <option key={b.code} value={b.code} disabled={!b.supported}>
                      {b.name}{!b.supported ? ' (não suportado)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Conta de destino</label>
                {(() => {
                  const bankName = BANK_CODE_TO_NAME[importBank]
                  const filtered = bankName ? accounts.filter((a) => a.bankName === bankName) : accounts
                  if (filtered.length === 0) {
                    return <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Nenhuma conta de {bankName ?? importBank} encontrada.</p>
                  }
                  const value = importAccountId && filtered.find((a) => a.id === importAccountId) ? importAccountId : filtered[0].id
                  return (
                    <select className="input" value={value} onChange={(e) => setImportAccountId(e.target.value)}>
                      {filtered.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  )
                })()}
              </div>
            </div>

            <div>
              <label className="label">Ficheiro</label>
              <div className="grid grid-cols-2 gap-3">
                {/* CSV / Excel (inclui template) */}
                <div className="flex flex-col gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xls,.xlsx"
                    className="hidden"
                    onChange={(e) => { setImportFile(e.target.files?.[0] ?? null); setImportPdfFile(null) }}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={`w-full border-2 border-dashed rounded-xl p-5 flex flex-col items-center gap-2 transition-colors ${importFile ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    {importFile && /\.(xls|xlsx)$/i.test(importFile.name)
                      ? <FileSpreadsheet className="w-7 h-7 text-primary-500" />
                      : <FileUp className={`w-7 h-7 ${importFile ? 'text-primary-500' : 'text-gray-400'}`} />
                    }
                    <span className="text-xs font-medium text-gray-500">
                      {importFile
                        ? /\.csv$/i.test(importFile.name) ? 'CSV detetado' : 'Excel detetado'
                        : 'CSV / Excel'}
                    </span>
                    {importFile ? (
                      <span className="text-xs font-semibold text-primary-700 text-center break-all">{importFile.name}</span>
                    ) : (
                      <span className="text-xs text-gray-400 text-center">Clique para selecionar<br />.csv, .xls ou .xlsx</span>
                    )}
                  </button>
                  <a
                    href="/Template Extratos.xlsx"
                    download
                    className="flex items-center gap-1 text-xs text-primary-600 hover:underline self-start"
                  >
                    <Download className="w-7 h-7" /> Não tem um ficheiro de extrato? Clique aqui para descarregar o template e preencher
                  </a>
                </div>

                {/* PDF — bancos com parser suportado (Santander, BPI) */}
                <div>
                  {PDF_IMPORT_BANKS.has(importBank) ? (
                    <>
                      <input
                        ref={pdfFileInputRef}
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        onChange={(e) => { setImportPdfFile(e.target.files?.[0] ?? null); setImportFile(null) }}
                      />
                      <button
                        type="button"
                        onClick={() => pdfFileInputRef.current?.click()}
                        className={`w-full h-full border-2 border-dashed rounded-xl p-5 flex flex-col items-center gap-2 transition-colors ${importPdfFile ? 'border-rose-400 bg-rose-50' : 'border-gray-200 hover:border-gray-300'}`}
                      >
                        <FileText className={`w-7 h-7 ${importPdfFile ? 'text-rose-500' : 'text-gray-400'}`} />
                        <span className="text-xs font-medium text-gray-500">
                          {importPdfFile ? 'PDF detetado' : 'PDF'}
                        </span>
                        {importPdfFile ? (
                          <span className="text-xs font-semibold text-rose-700 text-center break-all">{importPdfFile.name}</span>
                        ) : (
                          <span className="text-xs text-gray-400 text-center">Clique para selecionar<br />extrato em PDF</span>
                        )}
                      </button>
                    </>
                  ) : (
                    <div className="w-full h-full border-2 border-dashed border-gray-100 rounded-xl p-5 flex flex-col items-center gap-2 bg-gray-50 cursor-not-allowed select-none">
                      <FileText className="w-7 h-7 text-gray-300" />
                      <span className="text-xs font-medium text-gray-300">PDF</span>
                      <span className="text-xs text-gray-400 text-center">Não disponível<br />para este banco</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {uploadStatementMutation.isError && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                {(uploadStatementMutation.error as Error).message}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button onClick={() => { setShowImport(false); setImportFile(null); setImportPdfFile(null); setImportAccountId('') }} className="btn-secondary flex-1">Cancelar</button>
              <button
                onClick={() => {
                  const file = importFile ?? importPdfFile
                  if (!file) return
                  const bank = importBank
                  const bankName = BANK_CODE_TO_NAME[importBank]
                  const filtered = bankName ? accounts.filter((a) => a.bankName === bankName) : accounts
                  const targetId = (importAccountId && filtered.find((a) => a.id === importAccountId))
                    ? importAccountId
                    : filtered[0]?.id
                  if (!targetId) return
                  previewMutation.mutate({ file, bank, bankAccountId: targetId })
                }}
                className="btn-primary flex-1"
                disabled={previewMutation.isPending || uploadStatementMutation.isPending || (!importFile && !importPdfFile) || (() => {
                  const bankName = BANK_CODE_TO_NAME[importBank]
                  const filtered = bankName ? accounts.filter((a) => a.bankName === bankName) : accounts
                  return filtered.length === 0
                })()}
              >
                {previewMutation.isPending ? 'A validar...' : uploadStatementMutation.isPending ? 'A importar...' : 'Importar'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
