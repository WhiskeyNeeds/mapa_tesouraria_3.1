import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate, statusLabel, statusVariant } from '@/lib/utils'
import Badge from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import {
  CheckSquare, Square, RefreshCw, AlertCircle, Search,
  ChevronDown, ChevronRight, Undo2, SlidersHorizontal, X,
  Link2, Zap,
} from 'lucide-react'

interface Movement {
  id: string; date: string; amount: number; description: string; status: string
  bankAccount?: { id: string; name: string }; category?: { name: string }
}
interface Document {
  id: string; reference: string; entityName: string; dueDate: string
  pendingAmount: number; totalAmount: number; status: string
  category: { name: string; color: string; launchToc: boolean }
  type: 'receivable' | 'payable'
}
interface Allocation {
  type: 'receivable' | 'payable'; id: string; amount: number
  reference: string; entityName: string; pendingAmount: number
}
interface RecHistoryItem {
  id: string; status: string; isDryRun: boolean; totalMovements: number; totalAllocated: number
  createdAt: string; direction: string; reversedAt?: string; reversedReason?: string
  createdBy: { name: string }
  movements: Array<{ amount: number; movement: { id: string; date: string; amount: number; description: string } }>
  receivables: Array<{ amountAllocated: number; receivable: { id: string; reference: string; entityName: string } }>
  payables: Array<{ amountAllocated: number; payable: { id: string; reference: string; entityName: string } }>
}

// ── Filter helpers ─────────────────────────────────────────────────────────────

function FilterBadge({ count }: { count: number }) {
  if (!count) return null
  return (
    <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary-600 text-white text-[9px] font-bold leading-none">
      {count}
    </span>
  )
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-400 w-20 flex-shrink-0">{label}</span>
      {children}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ReconciliationPage() {
  const { selectedClientId } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()

  // ── Selection state ─────────────────────────────────────────────────────────
  const [selectedMovements, setSelectedMovements] = useState<Movement[]>([])
  const [selectedDocs, setSelectedDocs] = useState<Document[]>([])
  const [allocations, setAllocations] = useState<Allocation[]>([])

  // ── UI state ────────────────────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false)
  const [isDryRun, setIsDryRun] = useState(true)
  const [previewData, setPreviewData] = useState<{ direction: string; totalMovements: number; totalAllocated: number; tocActions: unknown[] } | null>(null)

  // ── Movement filters ────────────────────────────────────────────────────────
  const [movSearch, setMovSearch] = useState('')
  const [movFiltersOpen, setMovFiltersOpen] = useState(false)
  const [movDateFrom, setMovDateFrom] = useState('')
  const [movDateTo, setMovDateTo] = useState('')
  const [movBankId, setMovBankId] = useState('')
  const [movSign, setMovSign] = useState<'all' | 'credit' | 'debit'>('all')
  const [movAmountMin, setMovAmountMin] = useState('')
  const [movAmountMax, setMovAmountMax] = useState('')

  // ── Document filters ────────────────────────────────────────────────────────
  const [docSearch, setDocSearch] = useState('')
  const [docFiltersOpen, setDocFiltersOpen] = useState(false)
  const [docType, setDocType] = useState<'all' | 'receivable' | 'payable'>('all')
  const [docDateFrom, setDocDateFrom] = useState('')
  const [docDateTo, setDocDateTo] = useState('')
  const [docAmountMin, setDocAmountMin] = useState('')
  const [docAmountMax, setDocAmountMax] = useState('')

  // ── History ─────────────────────────────────────────────────────────────────
  const [historyLimit, setHistoryLimit] = useState(10)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [reverseId, setReverseId] = useState<string | null>(null)
  const [reverseReason, setReverseReason] = useState('')

  // ── Direction lock ──────────────────────────────────────────────────────────
  const currentDirection = useMemo<'REVENUE' | 'EXPENSE' | null>(() => {
    if (selectedMovements.length === 0) return null
    return Number(selectedMovements[0].amount) >= 0 ? 'REVENUE' : 'EXPENSE'
  }, [selectedMovements])

  useEffect(() => {
    if (!currentDirection) return
    const compatType = currentDirection === 'REVENUE' ? 'receivable' : 'payable'
    setSelectedDocs((prev) => prev.filter((d) => d.type === compatType))
    setAllocations((prev) => prev.filter((a) => a.type === compatType))
  }, [currentDirection])

  // ── Queries ─────────────────────────────────────────────────────────────────
  const { data: settings } = useQuery({
    queryKey: ['settings', selectedClientId],
    queryFn: () => api.get<{ reconciliationDryRun: boolean }>(`/treasury/${selectedClientId}/settings`),
    enabled: !!selectedClientId,
  })
  useEffect(() => {
    if (settings?.reconciliationDryRun !== undefined) setIsDryRun(settings.reconciliationDryRun)
  }, [settings?.reconciliationDryRun])

  const { data: movementsData, refetch: refetchMovements } = useQuery({
    queryKey: ['movements-pending', selectedClientId],
    queryFn: () => api.get<{ items: Movement[] }>(`/treasury/${selectedClientId}/movements?limit=500&sortBy=date&sortDir=desc`),
    enabled: !!selectedClientId,
  })
  const { data: receivablesData } = useQuery({
    queryKey: ['receivables-pending', selectedClientId],
    queryFn: () => api.get<{ items: Document[] }>(`/treasury/${selectedClientId}/receivables?status=OPEN,PARTIAL&limit=200`),
    enabled: !!selectedClientId,
  })
  const { data: payablesData } = useQuery({
    queryKey: ['payables-pending', selectedClientId],
    queryFn: () => api.get<{ items: Document[] }>(`/treasury/${selectedClientId}/payables?status=OPEN,PARTIAL&limit=200`),
    enabled: !!selectedClientId,
  })
  const { data: historyData } = useQuery({
    queryKey: ['reconciliations', selectedClientId, historyLimit],
    queryFn: () => api.get<{ items: RecHistoryItem[]; total: number }>(`/treasury/${selectedClientId}/reconciliations?limit=${historyLimit}`),
    enabled: !!selectedClientId,
  })

  // ── Raw lists ────────────────────────────────────────────────────────────────
  const allMovements = movementsData?.items ?? []
  const allDocs: Document[] = useMemo(() => [
    ...(receivablesData?.items ?? []).map((r) => ({ ...r, type: 'receivable' as const })),
    ...(payablesData?.items ?? []).map((p) => ({ ...p, type: 'payable' as const })),
  ], [receivablesData, payablesData])

  // ── Unique bank accounts for filter dropdown ──────────────────────────────
  const bankAccounts = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of allMovements) {
      if (m.bankAccount) map.set(m.bankAccount.id, m.bankAccount.name)
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [allMovements])

  // ── Filter counts (for badge) ─────────────────────────────────────────────
  const movFilterCount = [movDateFrom, movDateTo, movBankId, movAmountMin, movAmountMax].filter(Boolean).length
    + (movSign !== 'all' ? 1 : 0)
  const docFilterCount = [docDateFrom, docDateTo, docAmountMin, docAmountMax].filter(Boolean).length
    + (docType !== 'all' ? 1 : 0)

  // ── Filtered movements ────────────────────────────────────────────────────
  const pendingMovements = useMemo(() => {
    let list = allMovements
    if (movSearch) list = list.filter((m) => m.description.toLowerCase().includes(movSearch.toLowerCase()))
    if (movBankId) list = list.filter((m) => m.bankAccount?.id === movBankId)
    if (movSign === 'credit') list = list.filter((m) => Number(m.amount) >= 0)
    if (movSign === 'debit')  list = list.filter((m) => Number(m.amount) < 0)
    if (movDateFrom) list = list.filter((m) => m.date >= movDateFrom)
    if (movDateTo)   list = list.filter((m) => m.date <= movDateTo)
    if (movAmountMin) list = list.filter((m) => Math.abs(Number(m.amount)) >= parseFloat(movAmountMin))
    if (movAmountMax) list = list.filter((m) => Math.abs(Number(m.amount)) <= parseFloat(movAmountMax))
    return list
  }, [allMovements, movSearch, movBankId, movSign, movDateFrom, movDateTo, movAmountMin, movAmountMax])

  // ── Filtered documents ────────────────────────────────────────────────────
  const pendingDocs = useMemo(() => {
    let list = allDocs
    if (docType !== 'all') list = list.filter((d) => d.type === docType)
    if (docSearch) list = list.filter((d) =>
      d.entityName.toLowerCase().includes(docSearch.toLowerCase()) ||
      d.reference.toLowerCase().includes(docSearch.toLowerCase())
    )
    if (docDateFrom) list = list.filter((d) => d.dueDate >= docDateFrom)
    if (docDateTo)   list = list.filter((d) => d.dueDate <= docDateTo)
    if (docAmountMin) list = list.filter((d) => Number(d.pendingAmount) >= parseFloat(docAmountMin))
    if (docAmountMax) list = list.filter((d) => Number(d.pendingAmount) <= parseFloat(docAmountMax))
    return list
  }, [allDocs, docType, docSearch, docDateFrom, docDateTo, docAmountMin, docAmountMax])

  const pendingReceivables  = useMemo(() => pendingDocs.filter((d) => d.type === 'receivable'),     [pendingDocs])
  const pendingPayables     = useMemo(() => pendingDocs.filter((d) => d.type === 'payable'),        [pendingDocs])

  // ── Totals ────────────────────────────────────────────────────────────────
  const totalMovements = selectedMovements.reduce((s, m) => s + Math.abs(Number(m.amount)), 0)
  const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0)
  const diff = Math.abs(totalMovements - totalAllocated)
  const canConfirm = selectedMovements.length > 0 && selectedDocs.length > 0 && diff < 0.01 && totalMovements > 0

  // Quick match: 1 movement, 1 doc, amounts match exactly
  const isQuickMatch = selectedMovements.length === 1 && selectedDocs.length === 1 && canConfirm

  // ── Handlers ──────────────────────────────────────────────────────────────
  function toggleMovement(m: Movement) {
    if (selectedMovements.find((x) => x.id === m.id)) {
      const next = selectedMovements.filter((x) => x.id !== m.id)
      setSelectedMovements(next)
      if (next.length === 0) { setSelectedDocs([]); setAllocations([]) }
    } else {
      if (currentDirection !== null) {
        const mDir = Number(m.amount) >= 0 ? 'REVENUE' : 'EXPENSE'
        if (mDir !== currentDirection) return
      }
      setSelectedMovements((prev) => [...prev, m])
    }
  }

  function toggleDoc(d: Document) {
    if (currentDirection === 'REVENUE' && d.type === 'payable') return
    if (currentDirection === 'EXPENSE' && d.type === 'receivable') return
    if (selectedDocs.find((x) => x.id === d.id)) {
      setSelectedDocs((prev) => prev.filter((x) => x.id !== d.id))
      setAllocations((prev) => prev.filter((a) => a.id !== d.id))
    } else {
      setSelectedDocs((prev) => [...prev, d])
      const remaining = totalMovements - totalAllocated
      const amount = Math.min(Number(d.pendingAmount), remaining > 0 ? remaining : 0)
      setAllocations((prev) => [...prev, {
        type: d.type, id: d.id, amount,
        reference: d.reference, entityName: d.entityName, pendingAmount: Number(d.pendingAmount),
      }])
    }
  }

  function clearAll() { setSelectedMovements([]); setSelectedDocs([]); setAllocations([]) }

  function clearMovFilters() { setMovSearch(''); setMovBankId(''); setMovSign('all'); setMovDateFrom(''); setMovDateTo(''); setMovAmountMin(''); setMovAmountMax('') }
  function clearDocFilters() { setDocSearch(''); setDocType('all'); setDocDateFrom(''); setDocDateTo(''); setDocAmountMin(''); setDocAmountMax('') }

  // ── Mutations ─────────────────────────────────────────────────────────────
  const preview = useMutation({
    mutationFn: () => api.post(`/treasury/${selectedClientId}/reconciliations/preview`, {
      movementIds: selectedMovements.map((m) => m.id),
      allocations: allocations.map((a) => ({ type: a.type, id: a.id, amount: a.amount })),
      isDryRun,
    }),
    onSuccess: (data) => setPreviewData(data as typeof previewData),
    onError: (e) => toast.error((e as Error).message),
  })

  const confirmMutation = useMutation({
    mutationFn: (payload?: { movementIds: string[]; allocations: { type: string; id: string; amount: number }[]; isDryRun: boolean }) =>
      api.post(`/treasury/${selectedClientId}/reconciliations/confirm`, payload ?? {
        movementIds: selectedMovements.map((m) => m.id),
        allocations: allocations.map((a) => ({ type: a.type, id: a.id, amount: a.amount })),
        isDryRun,
      }),
    onSuccess: () => {
      ['movements-pending', 'receivables-pending', 'payables-pending', 'reconciliations', 'movements', 'receivables', 'payables']
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      clearAll(); setShowModal(false)
      toast.success(isDryRun ? 'Simulação concluída (dry-run).' : 'Reconciliação concluída com sucesso.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  // Quick match — confirm immediately without modal
  function quickMatch() {
    confirmMutation.mutate({
      movementIds: selectedMovements.map((m) => m.id),
      allocations: allocations.map((a) => ({ type: a.type, id: a.id, amount: a.amount })),
      isDryRun,
    })
  }

  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`/treasury/${selectedClientId}/reconciliations/${id}/reverse`, { reason }),
    onSuccess: () => {
      ['reconciliations', 'movements-pending', 'movements', 'receivables-pending', 'receivables', 'payables-pending', 'payables']
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      setReverseId(null); setReverseReason('')
      toast.success('Reconciliação revertida.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const hasSelection = selectedMovements.length > 0 || selectedDocs.length > 0

  // ── Movement row ──────────────────────────────────────────────────────────
  function MovRow({ m }: { m: Movement }) {
    const selected = !!selectedMovements.find((x) => x.id === m.id)
    const isCredit = Number(m.amount) >= 0
    const amtCls = isCredit ? 'text-emerald-700' : 'text-red-700'
    const isReconciled = m.status === 'RECONCILED'
    const isBlocked = isReconciled || (currentDirection !== null && !selected &&
      ((isCredit && currentDirection === 'EXPENSE') || (!isCredit && currentDirection === 'REVENUE')))
    return (
      <button
        onClick={() => toggleMovement(m)}
        disabled={isBlocked}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-100
          ${selected ? 'bg-primary-50 border-l-2 border-primary-500' : isBlocked ? 'opacity-40 cursor-not-allowed bg-gray-50' : 'hover:bg-slate-50 border-l-2 border-transparent'}`}
      >
        {selected
          ? <CheckSquare className="w-4 h-4 text-primary-600 flex-shrink-0" />
          : <Square className={`w-4 h-4 flex-shrink-0 ${isBlocked ? 'text-gray-200' : 'text-gray-300'}`} />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-900 truncate">{m.description}</span>
            {isReconciled && (
              <span className="inline-flex items-center text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">reconciliado</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs text-gray-400">{formatDate(m.date)}</span>
            {m.bankAccount && <><span className="text-gray-200">·</span><span className="text-xs text-gray-400 truncate">{m.bankAccount.name}</span></>}
          </div>
        </div>
        <span className={`text-sm font-semibold whitespace-nowrap ${amtCls}`}>
          {isCredit ? '+' : '−'}{formatCurrency(Math.abs(Number(m.amount)))}
        </span>
      </button>
    )
  }

  // ── Document row ──────────────────────────────────────────────────────────
  function DocRow({ d }: { d: Document }) {
    const selected = !!selectedDocs.find((x) => x.id === d.id)
    const isBlocked = !selected && currentDirection !== null &&
      ((d.type === 'receivable' && currentDirection === 'EXPENSE') || (d.type === 'payable' && currentDirection === 'REVENUE'))
    const amt = totalMovements - totalAllocated
    const isSuggested = !selected && !isBlocked && selectedMovements.length > 0 &&
      Math.abs(Number(d.pendingAmount) - (selectedMovements.length === 1 ? totalMovements : amt)) < 0.01
    const amtCls = d.type === 'receivable' ? 'text-emerald-700' : 'text-red-700'
    return (
      <button
        onClick={() => toggleDoc(d)}
        disabled={isBlocked}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors duration-100
          ${selected ? 'bg-primary-50 border-l-2 border-primary-500' : isBlocked ? 'opacity-30 cursor-not-allowed bg-gray-50' : isSuggested ? 'bg-amber-50/60 hover:bg-amber-50 border-l-2 border-amber-300' : 'hover:bg-slate-50 border-l-2 border-transparent'}`}
      >
        {selected
          ? <CheckSquare className="w-4 h-4 text-primary-600 flex-shrink-0" />
          : <Square className={`w-4 h-4 flex-shrink-0 ${isBlocked ? 'text-gray-200' : isSuggested ? 'text-amber-400' : 'text-gray-300'}`} />}
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.category.color }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-900">{d.reference}</span>
            {d.status === 'PARTIAL' && <Badge variant="yellow">parc. liquidado</Badge>}
            {isSuggested && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">
                <Zap className="w-2.5 h-2.5" /> sugerido
              </span>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-0.5 truncate">{d.entityName} · {d.category.name}</div>
        </div>
        <div className="text-right whitespace-nowrap flex-shrink-0">
          <div className={`text-sm font-semibold ${amtCls}`}>{formatCurrency(Number(d.pendingAmount))}</div>
          <div className="text-xs text-gray-400">{formatDate(d.dueDate)}</div>
        </div>
      </button>
    )
  }

  // ── Section headers ───────────────────────────────────────────────────────
  function SectionHeader({ label, count, sign }: { label: string; count: number; sign: 'credit' | 'debit' }) {
    const isBlocked = currentDirection !== null &&
      ((sign === 'credit' && currentDirection === 'EXPENSE') || (sign === 'debit' && currentDirection === 'REVENUE'))
    const cls = sign === 'credit' ? 'bg-emerald-50/80 text-emerald-800' : 'bg-red-50/80 text-red-800'
    if (!count) return null
    return (
      <div className={`px-4 py-1.5 flex items-center justify-between border-b border-gray-100 ${isBlocked ? 'bg-gray-100/80 opacity-50' : cls}`}>
        <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
        <span className="text-[10px] font-medium opacity-70">{count}</span>
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-28">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="section-title">Reconciliação</h1>
          <p className="section-subtitle mt-0.5">Associe movimentos bancários a documentos de compra e venda</p>
        </div>
        <button onClick={() => refetchMovements()} className="btn-ghost flex items-center gap-1.5 text-xs">
          <RefreshCw className="w-3.5 h-3.5" /> Atualizar
        </button>
      </div>

      {/* Two-column selection */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* ── Movements ────────────────────────────────────────────────────── */}
        <div className="card flex flex-col">
          {/* Card header */}
          <div className="px-4 py-3.5 border-b border-gray-100 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-gray-900 text-sm">Movimentos Bancários</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{pendingMovements.length} de {allMovements.length}</span>
                <button
                  onClick={() => setMovFiltersOpen((v) => !v)}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors ${movFiltersOpen || movFilterCount > 0 ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                >
                  <SlidersHorizontal className="w-3 h-3" />
                  Filtros
                  <FilterBadge count={movFilterCount} />
                </button>
                {selectedMovements.length > 0 && (
                  <button onClick={() => { setSelectedMovements([]); setSelectedDocs([]); setAllocations([]) }} className="text-xs text-gray-400 hover:text-gray-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
              <input
                className="input pl-7 text-xs py-1.5 w-full"
                placeholder="Pesquisar descrição..."
                value={movSearch}
                onChange={(e) => setMovSearch(e.target.value)}
              />
              {movSearch && (
                <button onClick={() => setMovSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Filter panel */}
            {movFiltersOpen && (
              <div className="space-y-2 pt-1 pb-0.5 border-t border-gray-100 mt-1">
                <FilterRow label="Tipo">
                  <div className="flex gap-1">
                    {(['all', 'credit', 'debit'] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setMovSign(v)}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${movSign === v ? 'bg-primary-600 text-white border-primary-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                      >
                        {v === 'all' ? 'Todos' : v === 'credit' ? 'Entradas' : 'Saídas'}
                      </button>
                    ))}
                  </div>
                </FilterRow>
                {bankAccounts.length > 1 && (
                  <FilterRow label="Conta">
                    <select
                      className="input text-xs py-1 flex-1"
                      value={movBankId}
                      onChange={(e) => setMovBankId(e.target.value)}
                    >
                      <option value="">Todas as contas</option>
                      {bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </FilterRow>
                )}
                <FilterRow label="Data">
                  <input type="date" className="input text-xs py-1 flex-1" value={movDateFrom} onChange={(e) => setMovDateFrom(e.target.value)} />
                  <span className="text-gray-300 text-xs">–</span>
                  <input type="date" className="input text-xs py-1 flex-1" value={movDateTo} onChange={(e) => setMovDateTo(e.target.value)} />
                </FilterRow>
                <FilterRow label="Montante">
                  <input type="number" min="0" step="0.01" className="input text-xs py-1 flex-1" placeholder="Mín." value={movAmountMin} onChange={(e) => setMovAmountMin(e.target.value)} />
                  <span className="text-gray-300 text-xs">–</span>
                  <input type="number" min="0" step="0.01" className="input text-xs py-1 flex-1" placeholder="Máx." value={movAmountMax} onChange={(e) => setMovAmountMax(e.target.value)} />
                </FilterRow>
                {movFilterCount > 0 && (
                  <button onClick={clearMovFilters} className="text-[11px] text-primary-600 hover:text-primary-700 font-medium">
                    Limpar filtros
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Movement list */}
          <div className="flex-1 overflow-y-auto" style={{ maxHeight: '420px' }}>
            {pendingMovements.map((m) => <MovRow key={m.id} m={m} />)}
            {pendingMovements.length === 0 && (
              <div className="px-4 py-10 text-center text-gray-400 text-sm">
                {allMovements.length === 0
                  ? 'Sem movimentos bancários'
                  : 'Nenhum resultado para os filtros aplicados'}
              </div>
            )}
          </div>

          {/* Footer with selection info */}
          {selectedMovements.length > 0 && (
            <div className="px-4 py-2.5 border-t border-gray-100 bg-primary-50/50 flex items-center justify-between text-xs">
              <span className="text-primary-700 font-medium">{selectedMovements.length} selecionado(s) · {formatCurrency(totalMovements)}</span>
              <span className="text-primary-500 text-[11px]">→ selecione documentos</span>
            </div>
          )}
        </div>

        {/* ── Documents ─────────────────────────────────────────────────────── */}
        <div className="card flex flex-col">
          {/* Card header */}
          <div className="px-4 py-3.5 border-b border-gray-100 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-gray-900 text-sm">Documentos Pendentes</h2>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{pendingDocs.length} de {allDocs.length}</span>
                <button
                  onClick={() => setDocFiltersOpen((v) => !v)}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors ${docFiltersOpen || docFilterCount > 0 ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                >
                  <SlidersHorizontal className="w-3 h-3" />
                  Filtros
                  <FilterBadge count={docFilterCount} />
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
              <input
                className="input pl-7 text-xs py-1.5 w-full"
                placeholder="Pesquisar entidade, referência..."
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
              />
              {docSearch && (
                <button onClick={() => setDocSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Filter panel */}
            {docFiltersOpen && (
              <div className="space-y-2 pt-1 pb-0.5 border-t border-gray-100 mt-1">
                <FilterRow label="Tipo">
                  <div className="flex gap-1">
                    {(['all', 'receivable', 'payable'] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setDocType(v)}
                        className={`px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${docType === v ? 'bg-primary-600 text-white border-primary-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                      >
                        {v === 'all' ? 'Todos' : v === 'receivable' ? 'A Receber' : 'A Pagar'}
                      </button>
                    ))}
                  </div>
                </FilterRow>
                <FilterRow label="Vencimento">
                  <input type="date" className="input text-xs py-1 flex-1" value={docDateFrom} onChange={(e) => setDocDateFrom(e.target.value)} />
                  <span className="text-gray-300 text-xs">–</span>
                  <input type="date" className="input text-xs py-1 flex-1" value={docDateTo} onChange={(e) => setDocDateTo(e.target.value)} />
                </FilterRow>
                <FilterRow label="Pendente">
                  <input type="number" min="0" step="0.01" className="input text-xs py-1 flex-1" placeholder="Mín." value={docAmountMin} onChange={(e) => setDocAmountMin(e.target.value)} />
                  <span className="text-gray-300 text-xs">–</span>
                  <input type="number" min="0" step="0.01" className="input text-xs py-1 flex-1" placeholder="Máx." value={docAmountMax} onChange={(e) => setDocAmountMax(e.target.value)} />
                </FilterRow>
                {docFilterCount > 0 && (
                  <button onClick={clearDocFilters} className="text-[11px] text-primary-600 hover:text-primary-700 font-medium">
                    Limpar filtros
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Document list */}
          <div className="flex-1 overflow-y-auto" style={{ maxHeight: '420px' }}>
            {pendingReceivables.length > 0 && (
              <>
                <SectionHeader label="↓ Contas a Receber" count={pendingReceivables.length} sign="credit" />
                {pendingReceivables.map((d) => <DocRow key={d.id} d={d} />)}
              </>
            )}
            {pendingPayables.length > 0 && (
              <>
                <SectionHeader label="↑ Contas a Pagar" count={pendingPayables.length} sign="debit" />
                {pendingPayables.map((d) => <DocRow key={d.id} d={d} />)}
              </>
            )}
            {pendingDocs.length === 0 && (
              <div className="px-4 py-10 text-center text-gray-400 text-sm">
                {allDocs.length === 0
                  ? 'Sem documentos pendentes'
                  : 'Nenhum resultado para os filtros aplicados'}
              </div>
            )}
          </div>

          {/* Footer with selection info */}
          {selectedDocs.length > 0 && (
            <div className="px-4 py-2.5 border-t border-gray-100 bg-primary-50/50 flex items-center justify-between text-xs">
              <span className="text-primary-700 font-medium">{selectedDocs.length} selecionado(s) · {formatCurrency(totalAllocated)}</span>
              {diff > 0.01
                ? <span className="text-red-600 font-medium">Diferença: {formatCurrency(diff)}</span>
                : <span className="text-emerald-600 font-medium">✓ Balanceado</span>}
            </div>
          )}
        </div>
      </div>

      {/* ── Floating action bar ─────────────────────────────────────────────── */}
      {hasSelection && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-3xl px-4">
          <div className="bg-white border border-gray-200 rounded-2xl shadow-modal px-5 py-4 flex items-center gap-4">
            {/* Stats */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 text-sm flex-wrap">
                <span className="text-gray-500">
                  <span className="font-semibold text-gray-900">{selectedMovements.length}</span> mov.
                </span>
                {selectedMovements.length > 0 && selectedDocs.length > 0 && (
                  <Link2 className="w-3.5 h-3.5 text-primary-400" />
                )}
                <span className="text-gray-500">
                  <span className="font-semibold text-gray-900">{selectedDocs.length}</span> doc.
                </span>
                <span className="text-gray-300 hidden sm:block">|</span>
                <span className="text-gray-500 hidden sm:block">
                  Mov.: <span className="font-semibold text-gray-900">{formatCurrency(totalMovements)}</span>
                </span>
                {diff > 0.01
                  ? <span className="text-red-600 font-medium text-xs">Diferença: {formatCurrency(diff)}</span>
                  : selectedDocs.length > 0 && <span className="text-emerald-600 font-medium text-xs">✓ Balanceado</span>}
              </div>
              {isDryRun && (
                <div className="text-[10px] text-amber-600 font-medium mt-0.5">Modo dry-run activo</div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={clearAll} className="btn-ghost text-xs py-1.5">
                <X className="w-3.5 h-3.5" />
              </button>

              {/* Quick Match — direct confirm for perfect 1:1 */}
              {isQuickMatch && (
                <button
                  onClick={quickMatch}
                  disabled={confirmMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white transition-colors shadow-btn"
                >
                  <Zap className="w-3.5 h-3.5" />
                  {confirmMutation.isPending ? 'A confirmar...' : 'Match direto'}
                </button>
              )}

              {/* Full reconciliation modal */}
              {selectedDocs.length > 0 && (
                <button
                  onClick={() => { setPreviewData(null); setShowModal(true) }}
                  className="btn-primary text-sm py-2"
                  disabled={selectedMovements.length === 0}
                >
                  Reconciliar seleção
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── History ───────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="px-4 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 text-sm">Histórico de Reconciliações</h2>
          <span className="text-xs text-gray-400">{historyData?.total ?? 0} total</span>
        </div>
        <div className="divide-y divide-gray-50">
          {(historyData?.items ?? []).map((rec) => {
            const isExpanded = expandedId === rec.id
            return (
              <div key={rec.id}>
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors">
                  <button onClick={() => setExpandedId(isExpanded ? null : rec.id)} className="text-gray-300 hover:text-gray-500 flex-shrink-0">
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={statusVariant(rec.status)}>{statusLabel(rec.status)}</Badge>
                      {rec.isDryRun && <Badge variant="yellow">Dry-run</Badge>}
                      <span className={`text-xs font-medium ${rec.direction === 'REVENUE' ? 'text-emerald-700' : 'text-red-700'}`}>
                        {rec.direction === 'REVENUE' ? '↓ Entrada' : '↑ Saída'}
                      </span>
                      <span className="text-gray-400 text-xs">{rec.movements.length} mov. · {rec.receivables.length + rec.payables.length} doc.</span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {formatDate(rec.createdAt)} · {rec.createdBy?.name}
                      {rec.reversedAt && (
                        <span className="ml-2 text-amber-600">
                          Revertida {formatDate(rec.reversedAt)}{rec.reversedReason ? ` — ${rec.reversedReason}` : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="text-sm font-semibold text-gray-900">{formatCurrency(rec.totalAllocated)}</div>
                    {rec.status === 'CONFIRMED' && (
                      <button
                        onClick={() => { setReverseId(rec.id); setReverseReason('') }}
                        title="Reverter reconciliação"
                        className="p-1.5 text-gray-300 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                      >
                        <Undo2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="px-10 pb-4 grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50/50 border-t border-gray-100">
                    <div>
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 mt-3">Movimentos associados</h4>
                      <div className="space-y-1.5">
                        {rec.movements.map((link) => (
                          <div key={link.movement.id} className="flex justify-between text-xs bg-white rounded-lg px-3 py-2 border border-gray-100">
                            <span className="truncate mr-2 text-gray-600">{link.movement.description}</span>
                            <span className={`font-semibold whitespace-nowrap ${Number(link.movement.amount) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                              {Number(link.movement.amount) >= 0 ? '+' : '−'}{formatCurrency(Math.abs(Number(link.movement.amount)))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 mt-3">Documentos liquidados</h4>
                      <div className="space-y-1.5">
                        {rec.receivables.map((link) => (
                          <div key={link.receivable.id} className="flex justify-between text-xs bg-white rounded-lg px-3 py-2 border border-gray-100">
                            <span className="truncate mr-2">
                              <span className="text-emerald-700 font-bold mr-1 text-[10px]">CR</span>
                              {link.receivable.reference} · {link.receivable.entityName}
                            </span>
                            <span className="font-semibold text-emerald-700 whitespace-nowrap">{formatCurrency(Number(link.amountAllocated))}</span>
                          </div>
                        ))}
                        {rec.payables.map((link) => (
                          <div key={link.payable.id} className="flex justify-between text-xs bg-white rounded-lg px-3 py-2 border border-gray-100">
                            <span className="truncate mr-2">
                              <span className="text-red-700 font-bold mr-1 text-[10px]">CP</span>
                              {link.payable.reference} · {link.payable.entityName}
                            </span>
                            <span className="font-semibold text-red-700 whitespace-nowrap">{formatCurrency(Number(link.amountAllocated))}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {(historyData?.items ?? []).length === 0 && (
            <div className="px-4 py-10 text-center text-gray-400 text-sm">Sem reconciliações registadas</div>
          )}
        </div>
        {historyData && historyData.total > historyLimit && (
          <div className="px-4 py-3 border-t border-gray-100">
            <button onClick={() => setHistoryLimit((l) => l + 10)} className="text-xs text-primary-600 hover:text-primary-700 font-medium">
              Ver mais ({historyData.total - historyLimit} restantes)
            </button>
          </div>
        )}
      </div>

      {/* ── Confirmation modal ─────────────────────────────────────────────── */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Confirmar Reconciliação" size="xl">
        <div className="space-y-4">
          {isDryRun && (
            <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Modo dry-run — nenhum recibo/pagamento será criado no TOConline</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2.5">Movimentos ({selectedMovements.length})</h3>
              <div className="space-y-1.5">
                {selectedMovements.map((m) => (
                  <div key={m.id} className="flex justify-between text-sm bg-slate-50 rounded-lg px-3 py-2.5 border border-gray-100">
                    <span className="text-gray-700 truncate mr-2 text-xs">{m.description}</span>
                    <span className={`font-semibold whitespace-nowrap text-xs ${Number(m.amount) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {Number(m.amount) >= 0 ? '+' : '−'}{formatCurrency(Math.abs(Number(m.amount)))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2.5">Documentos — Valor a dar baixa</h3>
              <div className="space-y-2">
                {allocations.map((a, i) => (
                  <div key={a.id} className="bg-slate-50 rounded-lg px-3 py-2.5 border border-gray-100">
                    <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                      <span className="flex items-center gap-1">
                        <span className={`font-bold ${a.type === 'receivable' ? 'text-emerald-700' : 'text-red-700'}`}>
                          {a.type === 'receivable' ? 'CR' : 'CP'}
                        </span>
                        <span className="truncate">{a.reference} · {a.entityName}</span>
                      </span>
                      <span className="text-gray-400 flex-shrink-0 ml-2">máx. {formatCurrency(a.pendingAmount)}</span>
                    </div>
                    <input
                      type="number"
                      className="input text-sm py-1.5"
                      value={a.amount}
                      max={a.pendingAmount}
                      step="0.01"
                      onChange={(e) => {
                        const v = parseFloat(e.target.value) || 0
                        setAllocations((prev) => prev.map((x, j) => j === i ? { ...x, amount: Math.min(v, x.pendingAmount) } : x))
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Balance bar */}
          <div className={`rounded-xl px-4 py-3 text-sm font-medium flex items-center justify-between ${diff < 0.01 ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            <span>Alocado: <strong>{formatCurrency(totalAllocated)}</strong> · Movimentos: <strong>{formatCurrency(totalMovements)}</strong></span>
            <span>{diff < 0.01 ? '✓ Balanceado' : `Diferença: ${formatCurrency(diff)}`}</span>
          </div>

          {previewData && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
              {(previewData.tocActions as Array<{ type: string }>).length > 0
                ? `Serão criados: ${(previewData.tocActions as Array<{ type: string }>).filter((a) => a.type === 'receivable').length} recibo(s) + ${(previewData.tocActions as Array<{ type: string }>).filter((a) => a.type === 'payable').length} pagamento(s) no TOConline`
                : 'Operação apenas local (sem chamadas ao TOConline)'}
            </div>
          )}

          <div className="flex items-center gap-2 py-1">
            <input type="checkbox" id="dryrun" checked={isDryRun} onChange={(e) => setIsDryRun(e.target.checked)} className="rounded border-gray-300" />
            <label htmlFor="dryrun" className="text-sm text-gray-700 select-none cursor-pointer">Modo dry-run (não escreve no TOConline)</label>
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancelar</button>
            {!previewData && (
              <button onClick={() => preview.mutate()} className="btn-secondary flex-1" disabled={preview.isPending}>
                {preview.isPending ? 'A analisar...' : 'Pré-visualizar'}
              </button>
            )}
            <button onClick={() => confirmMutation.mutate(undefined)} className="btn-primary flex-1" disabled={!canConfirm || confirmMutation.isPending}>
              {confirmMutation.isPending ? 'A confirmar...' : 'Confirmar'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Reverse modal ──────────────────────────────────────────────────── */}
      <Modal open={!!reverseId} onClose={() => { setReverseId(null); setReverseReason('') }} title="Reverter Reconciliação">
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              Esta ação irá reverter todos os estados dos movimentos e documentos associados. Os registos no TOConline
              (recibos/pagamentos) <strong>não serão eliminados</strong> — terá de os remover manualmente se necessário.
            </span>
          </div>
          <div>
            <label className="label">Motivo (opcional)</label>
            <input
              className="input"
              placeholder="ex: Erro na seleção de documento"
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={() => { setReverseId(null); setReverseReason('') }} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={() => reverseId && reverse.mutate({ id: reverseId, reason: reverseReason || undefined })}
              className="flex-1 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium shadow-btn transition-all"
              disabled={reverse.isPending}
            >
              {reverse.isPending ? 'A reverter...' : 'Confirmar reversão'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
