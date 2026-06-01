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
  reconciledAmount?: number
  bankAccount?: { id: string; name: string }; category?: { name: string }
}
interface TocRawDoc {
  id: number; document_no: string; document_type?: string
  date: string; due_date?: string
  gross_total: number; pending_total: number; status: number
  currency_iso_code?: string
  customer_business_name?: string; customer_tax_registration_number?: string; customer_id?: number
  supplier_business_name?: string; supplier_tax_registration_number?: string; supplier_id?: number
  [key: string]: unknown
}
interface Document {
  id: string; reference: string; entityName: string; dueDate: string
  documentDate?: string | null
  pendingAmount: number; totalAmount: number; status: string
  category?: { name: string; color: string } | null
  type: 'receivable' | 'payable'
  _src: 'local' | 'toc'
  _tocRaw?: TocRawDoc
  tocSalesDocId?: string | null
  tocPurchasesDocId?: string | null
}
interface Allocation {
  type: 'receivable' | 'payable'; id: string; amount: number
  reference: string; entityName: string; pendingAmount: number
  _src: 'local' | 'toc'
  _tocRaw?: TocRawDoc
}
interface RecHistoryItem {
  id: string; status: string; isDryRun: boolean; totalMovements: number; totalAllocated: number
  createdAt: string; direction: string; reversedAt?: string; reversedReason?: string
  createdBy: { name: string }
  movements: Array<{ amount: number; movement: { id: string; date: string; amount: number; description: string; bankAccount?: { id: string; name: string } | null } }>
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

  // staleTime 0 + refetchOnMount 'always': as listas de pendentes refazem fetch
  // sempre que a página de reconciliação é mostrada, garantindo que uma fatura
  // marcada como paga/liquidada noutro sítio nunca aparece aqui sem refresh manual.
  const { data: movementsData, refetch: refetchMovements } = useQuery({
    queryKey: ['movements-pending', selectedClientId],
    queryFn: () => api.get<{ items: Movement[] }>(`/treasury/${selectedClientId}/movements?status=UNCLASSIFIED,CLASSIFIED,PARTIAL&limit=500&sortBy=date&sortDir=desc`),
    enabled: !!selectedClientId,
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const { data: receivablesData } = useQuery({
    queryKey: ['receivables-pending', selectedClientId],
    queryFn: () => api.get<{ items: Document[]; total: number }>(`/treasury/${selectedClientId}/receivables?status=OPEN,PARTIAL,SETTLED&limit=500&sortBy=dueDate&sortDir=asc`),
    enabled: !!selectedClientId,
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const { data: payablesData } = useQuery({
    queryKey: ['payables-pending', selectedClientId],
    queryFn: () => api.get<{ items: Document[]; total: number }>(`/treasury/${selectedClientId}/payables?status=OPEN,PARTIAL,SETTLED&limit=500&sortBy=dueDate&sortDir=asc`),
    enabled: !!selectedClientId,
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const { data: tocSalesData } = useQuery({
    queryKey: ['toc-sales', selectedClientId],
    queryFn: () => api.get<TocRawDoc[]>(`/toconline/${selectedClientId}/sales`),
    enabled: !!selectedClientId,
    retry: false,
    throwOnError: false,
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const { data: tocPurchasesData } = useQuery({
    queryKey: ['toc-purchases', selectedClientId],
    queryFn: () => api.get<TocRawDoc[]>(`/toconline/${selectedClientId}/purchases`),
    enabled: !!selectedClientId,
    retry: false,
    throwOnError: false,
    staleTime: 0,
    refetchOnMount: 'always',
  })
  const { data: historyData } = useQuery({
    queryKey: ['reconciliations', selectedClientId, historyLimit],
    queryFn: () => api.get<{ items: RecHistoryItem[]; total: number }>(`/treasury/${selectedClientId}/reconciliations?limit=${historyLimit}`),
    enabled: !!selectedClientId,
  })

  // ── Raw lists ────────────────────────────────────────────────────────────────
  const allMovements = movementsData?.items ?? []

  // IDs already imported into local DB (to avoid showing them twice)
  const importedSalesIds = useMemo(() => new Set(
    (receivablesData?.items ?? []).map((r) => r.tocSalesDocId).filter(Boolean) as string[]
  ), [receivablesData])
  const importedPurchaseIds = useMemo(() => new Set(
    (payablesData?.items ?? []).map((p) => p.tocPurchasesDocId).filter(Boolean) as string[]
  ), [payablesData])

  // TOConline-only docs not yet imported
  const tocSalesOnly = useMemo(() => {
    const SALES_TYPES = new Set(['ft', 'fs', 'fr'])
    return (tocSalesData ?? []).filter((d) => {
      if (importedSalesIds.has(String(d.id))) return false
      const s = Number(d.status)
      if (s === 0 || s === 3 || s === 4) return false
      if (Number(d.pending_total) < 0.01) return false
      return SALES_TYPES.has((d.document_type ?? '').toLowerCase())
    })
  }, [tocSalesData, importedSalesIds])

  const tocPurchasesOnly = useMemo(() => {
    const PURCHASE_TYPES = new Set(['fc', 'dsp', 'ndf'])
    return (tocPurchasesData ?? []).filter((d) => {
      if (importedPurchaseIds.has(String(d.id))) return false
      const s = Number(d.status)
      if (s === 0 || s === 3 || s === 4) return false
      if (Number(d.pending_total) < 0.01) return false
      return PURCHASE_TYPES.has((d.document_type ?? '').toLowerCase())
    })
  }, [tocPurchasesData, importedPurchaseIds])

  const allDocs: Document[] = useMemo(() => {
    // Documentos com data de emissão futura (ex.: recorrências/forecast ainda não
    // emitidos) não são reconciliáveis — não devem surgir em Documentos Pendentes.
    // Documentos sem data de emissão mantêm-se visíveis.
    const todayStr = new Date().toISOString().slice(0, 10)
    const notFuture = (documentDate?: string | null) => !documentDate || documentDate.slice(0, 10) <= todayStr
    return [
      ...(receivablesData?.items ?? []).filter((r) => r.status !== 'SETTLED').map((r) => ({ ...r, type: 'receivable' as const, _src: 'local' as const })),
      ...(payablesData?.items ?? []).filter((p) => p.status !== 'SETTLED').map((p) => ({ ...p, type: 'payable' as const, _src: 'local' as const })),
      ...tocSalesOnly.map((d): Document => ({
        id: `toc-${d.id}`,
        reference: d.document_no,
        entityName: d.customer_business_name ?? '—',
        dueDate: d.due_date ?? d.date,
        documentDate: d.date,
        pendingAmount: d.pending_total,
        totalAmount: d.gross_total,
        status: [1, 5].includes(Number(d.status)) ? 'OPEN' : 'PARTIAL',
        type: 'receivable',
        _src: 'toc',
        _tocRaw: d,
      })),
      ...tocPurchasesOnly.map((d): Document => ({
        id: `toc-${d.id}`,
        reference: d.document_no,
        entityName: d.supplier_business_name ?? '—',
        dueDate: d.due_date ?? d.date,
        documentDate: d.date,
        pendingAmount: d.pending_total,
        totalAmount: d.gross_total,
        status: [1, 5].includes(Number(d.status)) ? 'OPEN' : 'PARTIAL',
        type: 'payable',
        _src: 'toc',
        _tocRaw: d,
      })),
    ].filter((d) => notFuture(d.documentDate))
  }, [receivablesData, payablesData, tocSalesOnly, tocPurchasesOnly])

  const docsTruncated = (receivablesData?.total ?? 0) > (receivablesData?.items?.length ?? 0)
    || (payablesData?.total ?? 0) > (payablesData?.items?.length ?? 0)

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
  const totalMovements = selectedMovements.reduce((s, m) => {
    const remaining = Math.abs(Number(m.amount)) - Math.max(0, Number(m.reconciledAmount ?? 0))
    return s + remaining
  }, 0)
  const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0)
  // surplus > 0 when movement is only partially used (e.g. 50€ movement, 28.60€ invoice)
  const movementSurplus = Math.max(0, totalMovements - totalAllocated)
  // over-allocation is always invalid; movement surplus is allowed (movement becomes PARTIAL)
  const canConfirm = selectedMovements.length > 0 && selectedDocs.length > 0
    && totalAllocated > 0 && totalAllocated <= totalMovements + 0.01 && totalMovements > 0

  // Quick match: exact 1:1, movement fully used, invoice fully covered
  const isQuickMatch = selectedMovements.length === 1 && selectedDocs.length === 1 && canConfirm
    && allocations.length === 1 && Math.abs(allocations[0].amount - allocations[0].pendingAmount) < 0.01
    && movementSurplus < 0.01

  // Partial match: movement fully used but invoice only partially covered
  const isPartialMatch = selectedMovements.length === 1 && selectedDocs.length === 1 && canConfirm
    && allocations.length === 1 && allocations[0].amount < allocations[0].pendingAmount - 0.01
    && movementSurplus < 0.01

  // Remaining invoice balance after allocations
  const totalPendingAfter = allocations.reduce((s, a) => s + Math.max(0, a.pendingAmount - a.amount), 0)

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
      setSelectedMovements((prev) => {
        const next = [...prev, m]
        // Recompute allocation amounts with the updated totalMovements
        const newTotMov = next.reduce((s, mv) =>
          s + Math.abs(Number(mv.amount)) - Math.max(0, Number(mv.reconciledAmount ?? 0)), 0)
        setAllocations((prevAllocs) => {
          let spent = 0
          return prevAllocs.map((a) => {
            const available = Math.max(0, newTotMov - spent)
            const newAmount = Math.min(a.pendingAmount, available)
            spent += newAmount
            return { ...a, amount: newAmount }
          })
        })
        return next
      })
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
        _src: d._src, _tocRaw: d._tocRaw,
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
    mutationFn: async () => {
      // For TOConline-only allocations, auto-import first to get a local DB id
      const resolvedAllocations = await Promise.all(
        allocations.map(async (a) => {
          if (a._src !== 'toc' || !a._tocRaw) return { type: a.type, id: a.id, amount: a.amount }
          const raw = a._tocRaw
          const isRec = a.type === 'receivable'
          const endpoint = `/treasury/${selectedClientId}/${isRec ? 'receivables' : 'payables'}`
          const body = isRec ? {
            entityName: raw.customer_business_name,
            entityNif: raw.customer_tax_registration_number ?? undefined,
            tocCustomerId: raw.customer_id ? String(raw.customer_id) : undefined,
            tocSalesDocId: String(raw.id),
            reference: raw.document_no,
            documentDate: raw.date,
            dueDate: raw.due_date ?? raw.date,
            totalAmount: raw.pending_total,
            currency: raw.currency_iso_code ?? 'EUR',
          } : {
            entityName: raw.supplier_business_name,
            entityNif: raw.supplier_tax_registration_number ?? undefined,
            tocSupplierId: raw.supplier_id ? String(raw.supplier_id) : undefined,
            tocPurchasesDocId: String(raw.id),
            reference: raw.document_no,
            documentDate: raw.date,
            dueDate: raw.due_date ?? raw.date,
            totalAmount: raw.pending_total,
            currency: raw.currency_iso_code ?? 'EUR',
          }
          const imported = await api.post<{ id: string }>(endpoint, body)
          return { type: a.type, id: (imported as { id: string }).id, amount: a.amount }
        })
      )
      return api.post(`/treasury/${selectedClientId}/reconciliations/confirm`, {
        movementIds: selectedMovements.map((m) => m.id),
        allocations: resolvedAllocations,
        isDryRun,
      })
    },
    onSuccess: () => {
      // Remoção otimista — refletir a ação imediatamente, sem esperar pelo refetch:
      // documentos totalmente liquidados e movimentos totalmente usados saem já
      // de "Documentos Pendentes" / "Movimentos". O invalidate a seguir confirma
      // com os dados do servidor (e ajusta os parciais).
      const fullySettled = allocations.filter((a) => a.amount >= a.pendingAmount - 0.01)
      const localDocIds = new Set(fullySettled.filter((a) => a._src !== 'toc').map((a) => a.id))
      const tocDocIds = new Set(
        fullySettled.filter((a) => a._src === 'toc' && a._tocRaw).map((a) => Number(a._tocRaw!.id)),
      )
      if (localDocIds.size) {
        for (const k of ['receivables-pending', 'payables-pending']) {
          qc.setQueryData<{ items: Document[]; total: number }>([k, selectedClientId], (old) =>
            old ? { ...old, items: old.items.filter((d) => !localDocIds.has(d.id)) } : old)
        }
      }
      if (tocDocIds.size) {
        for (const k of ['toc-sales', 'toc-purchases']) {
          qc.setQueryData<TocRawDoc[]>([k, selectedClientId], (old) =>
            old ? old.filter((d) => !tocDocIds.has(Number(d.id))) : old)
        }
      }
      // Movimentos: só saem se ficaram totalmente reconciliados (sem sobra).
      if (movementSurplus < 0.01) {
        const movIds = new Set(selectedMovements.map((m) => m.id))
        qc.setQueryData<{ items: Movement[] }>(['movements-pending', selectedClientId], (old) =>
          old ? { ...old, items: old.items.filter((m) => !movIds.has(m.id)) } : old)
      }

      qc.refetchQueries({ queryKey: ['reconciliations'] })
      ;['movements-pending', 'receivables-pending', 'payables-pending',
        'movements', 'receivables', 'payables', 'toc-sales', 'toc-purchases']
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
      clearAll(); setShowModal(false)
      toast.success(isDryRun ? 'Simulação concluída (dry-run).' : 'Reconciliação concluída com sucesso.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  // Quick match — confirm immediately without modal
  function quickMatch() { confirmMutation.mutate() }

  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`/treasury/${selectedClientId}/reconciliations/${id}/reverse`, { reason }),
    onSuccess: () => {
      qc.refetchQueries({ queryKey: ['reconciliations'] })
      ;['movements-pending', 'movements', 'receivables-pending', 'receivables',
        'payables-pending', 'payables', 'toc-sales', 'toc-purchases']
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
    const isBlocked = !selected && currentDirection !== null &&
      ((isCredit && currentDirection === 'EXPENSE') || (!isCredit && currentDirection === 'REVENUE'))
    const isPartial = m.status === 'PARTIAL'
    const fullAmt = Math.abs(Number(m.amount))
    const reconciledAmt = Math.max(0, Number(m.reconciledAmount ?? 0))
    const remainingAmt = fullAmt - reconciledAmt
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
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-900 truncate">{m.description}</span>
            {isPartial && <Badge variant="yellow">parc. reconciliado</Badge>}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs text-gray-400">{formatDate(m.date)}</span>
            {m.bankAccount && <><span className="text-gray-200">·</span><span className="text-xs text-gray-400 truncate">{m.bankAccount.name}</span></>}
          </div>
          {isPartial && (
            <div className="text-[11px] text-amber-700 mt-0.5">
              reconciliado {formatCurrency(reconciledAmt)} · disponível {formatCurrency(remainingAmt)}
            </div>
          )}
        </div>
        <div className="text-right whitespace-nowrap flex-shrink-0">
          <div className={`text-sm font-semibold ${amtCls}`}>
            {isCredit ? '+' : '−'}{formatCurrency(isPartial ? remainingAmt : fullAmt)}
          </div>
          {isPartial && (
            <div className="text-[11px] text-amber-600 font-medium">de {formatCurrency(fullAmt)}</div>
          )}
        </div>
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
        {d.category
          ? <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.category.color }} />
          : <div className="w-2 h-2 rounded-full flex-shrink-0 bg-gray-200" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-900">{d.reference}</span>
            {d.status === 'PARTIAL' && <Badge variant="yellow">parc. liquidado</Badge>}
            {d._src === 'toc' && (
              <span className="inline-flex items-center text-[10px] font-semibold text-blue-600 bg-blue-50 border border-blue-100 px-1.5 py-0.5 rounded-full">TOC</span>
            )}
            {isSuggested && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded-full">
                <Zap className="w-2.5 h-2.5" /> sugerido
              </span>
            )}
          </div>
          <div className="text-xs text-gray-400 mt-0.5 truncate">{d.entityName}{d.category ? ` · ${d.category.name}` : ''}</div>
          {d.status === 'PARTIAL' && (
            <div className="text-[11px] text-amber-700 mt-0.5">
              pago {formatCurrency(Number(d.totalAmount) - Number(d.pendingAmount))} · restante {formatCurrency(Number(d.pendingAmount))} de {formatCurrency(Number(d.totalAmount))}
            </div>
          )}
        </div>
        <div className="text-right whitespace-nowrap flex-shrink-0">
          <div className={`text-sm font-semibold ${amtCls}`}>{formatCurrency(Number(d.pendingAmount))}</div>
          {d.status === 'PARTIAL' && (
            <div className="text-[11px] text-amber-600 font-medium">de {formatCurrency(Number(d.totalAmount))}</div>
          )}
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
            {docsTruncated && (
              <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-700 flex items-center gap-1.5">
                <AlertCircle className="w-3 h-3 flex-shrink-0" />
                Existem mais documentos do que os mostrados. Use filtros para os localizar.
              </div>
            )}
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
                  ? 'Sem documentos pendentes (a receber ou a pagar) em aberto.'
                  : 'Nenhum resultado para os filtros aplicados'}
              </div>
            )}
          </div>

          {/* Footer with selection info */}
          {selectedDocs.length > 0 && (
            <div className="px-4 py-2.5 border-t border-gray-100 bg-primary-50/50 flex items-center justify-between text-xs">
              <span className="text-primary-700 font-medium">{selectedDocs.length} selecionado(s) · {formatCurrency(selectedDocs.reduce((s, d) => s + Number(d.pendingAmount), 0))}</span>
              {totalAllocated > totalMovements + 0.01
                ? <span className="text-red-600 font-medium">Excede: {formatCurrency(totalAllocated - totalMovements)}</span>
                : totalAllocated > 0 && movementSurplus > 0.01
                ? <span className="text-amber-600 font-medium">Restará {formatCurrency(movementSurplus)} no movimento</span>
                : totalAllocated > 0 && <span className="text-emerald-600 font-medium">✓ Balanceado</span>}
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
                {totalAllocated > totalMovements + 0.01
                  ? <span className="text-red-600 font-medium text-xs">Excede: {formatCurrency(totalAllocated - totalMovements)}</span>
                  : totalAllocated > 0 && movementSurplus > 0.01
                  ? <span className="text-amber-600 font-medium text-xs">Restará {formatCurrency(movementSurplus)} no movimento</span>
                  : totalAllocated > 0 && <span className="text-emerald-600 font-medium text-xs">✓ Balanceado</span>}
              </div>
              {totalPendingAfter > 0.01 && totalAllocated > 0 && (
                <div className="flex items-center gap-1 text-[11px] text-amber-700 font-medium mt-0.5">
                  <AlertCircle className="w-3 h-3 flex-shrink-0" />
                  Ficará {formatCurrency(totalPendingAfter)} por liquidar {allocations.length === 1 ? 'neste documento' : 'nos documentos selecionados'}
                </div>
              )}
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

              {/* Partial match — 1:1 but movement doesn't fully cover the invoice */}
              {isPartialMatch && (
                <button
                  onClick={() => { setPreviewData(null); setShowModal(true) }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-700 text-white transition-colors shadow-btn"
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  Liquidar parcialmente
                </button>
              )}

              {/* Full reconciliation modal */}
              {selectedDocs.length > 0 && !isPartialMatch && (
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
            const uniqueAccounts = Array.from(
              new Map(rec.movements.flatMap((l) => l.movement.bankAccount ? [[l.movement.bankAccount.id, l.movement.bankAccount.name]] : [])).entries()
            ).map(([, name]) => name)
            return (
              <div key={rec.id}>
                <div
                  className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                >
                  <span className="text-gray-300 flex-shrink-0">
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={statusVariant(rec.status)}>{statusLabel(rec.status)}</Badge>
                      {rec.isDryRun && <Badge variant="yellow">Dry-run</Badge>}
                      <span className={`text-xs font-medium ${rec.direction === 'REVENUE' ? 'text-emerald-700' : 'text-red-700'}`}>
                        {rec.direction === 'REVENUE' ? '↓ Entrada' : '↑ Saída'}
                      </span>
                      <span className="text-gray-400 text-xs">{rec.movements.length} mov. · {rec.receivables.length + rec.payables.length} doc.</span>
                      {uniqueAccounts.length > 0 && (
                        <span className="text-[11px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full font-medium">
                          {uniqueAccounts.join(', ')}
                        </span>
                      )}
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
                        onClick={(e) => { e.stopPropagation(); setReverseId(rec.id); setReverseReason('') }}
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
                            <div className="truncate mr-2 min-w-0">
                              <span className="text-gray-600">{link.movement.description}</span>
                              {link.movement.bankAccount && (
                                <span className="ml-1.5 text-[11px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full font-medium">{link.movement.bankAccount.name}</span>
                              )}
                            </div>
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
                    {a.amount < a.pendingAmount - 0.01 && (
                      <div className="flex items-center gap-1 mt-1.5 text-[11px] text-amber-700">
                        <AlertCircle className="w-3 h-3 flex-shrink-0" />
                        Restará <strong>{formatCurrency(a.pendingAmount - a.amount)}</strong> por liquidar nesta fatura
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Balance bar */}
          <div className={`rounded-xl px-4 py-3 text-sm font-medium flex items-center justify-between ${
            totalAllocated > totalMovements + 0.01
              ? 'bg-red-50 text-red-800 border border-red-200'
              : movementSurplus > 0.01
              ? 'bg-amber-50 text-amber-800 border border-amber-200'
              : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
          }`}>
            <span>Alocado: <strong>{formatCurrency(totalAllocated)}</strong> · Movimentos: <strong>{formatCurrency(totalMovements)}</strong></span>
            <span>
              {totalAllocated > totalMovements + 0.01
                ? `Excede: ${formatCurrency(totalAllocated - totalMovements)}`
                : totalAllocated > 0 && movementSurplus > 0.01
                ? `Restará ${formatCurrency(movementSurplus)} no movimento`
                : '✓ Balanceado'}
            </span>
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
            <button onClick={() => confirmMutation.mutate()} className="btn-primary flex-1" disabled={!canConfirm || confirmMutation.isPending}>
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
