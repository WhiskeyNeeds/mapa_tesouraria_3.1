import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate, statusLabel, statusVariant } from '@/lib/utils'
import Badge from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import { CheckSquare, Square, RefreshCw, AlertCircle, Search, ChevronDown, ChevronRight, Undo2 } from 'lucide-react'

interface Movement {
  id: string; date: string; amount: number; description: string; status: string
  bankAccount?: { name: string }; category?: { name: string }
}
interface Document {
  id: string; reference: string; entityName: string; dueDate: string; pendingAmount: number; totalAmount: number; status: string
  category: { name: string; color: string; launchToc: boolean }; type: 'receivable' | 'payable'
}
interface Allocation { type: 'receivable' | 'payable'; id: string; amount: number; reference: string; entityName: string; pendingAmount: number }

interface RecHistoryItem {
  id: string; status: string; isDryRun: boolean; totalMovements: number; totalAllocated: number
  createdAt: string; direction: string; reversedAt?: string; reversedReason?: string
  createdBy: { name: string }
  movements: Array<{ amount: number; movement: { id: string; date: string; amount: number; description: string } }>
  receivables: Array<{ amountAllocated: number; receivable: { id: string; reference: string; entityName: string } }>
  payables: Array<{ amountAllocated: number; payable: { id: string; reference: string; entityName: string } }>
}

export default function ReconciliationPage() {
  const { selectedClientId } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()

  // Selection state
  const [selectedMovements, setSelectedMovements] = useState<Movement[]>([])
  const [selectedDocs, setSelectedDocs] = useState<Document[]>([])
  const [allocations, setAllocations] = useState<Allocation[]>([])

  // UI state
  const [showModal, setShowModal] = useState(false)
  const [isDryRun, setIsDryRun] = useState(true)
  const [previewData, setPreviewData] = useState<{ direction: string; totalMovements: number; totalAllocated: number; tocActions: unknown[] } | null>(null)
  const [movSearch, setMovSearch] = useState('')
  const [docSearch, setDocSearch] = useState('')

  // History state
  const [historyLimit, setHistoryLimit] = useState(10)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Reverse state
  const [reverseId, setReverseId] = useState<string | null>(null)
  const [reverseReason, setReverseReason] = useState('')

  // ── Direction locking ────────────────────────────────────────────────────────

  const currentDirection = useMemo<'REVENUE' | 'EXPENSE' | null>(() => {
    if (selectedMovements.length === 0) return null
    return Number(selectedMovements[0].amount) >= 0 ? 'REVENUE' : 'EXPENSE'
  }, [selectedMovements])

  // When direction changes, drop docs that don't match
  useEffect(() => {
    if (!currentDirection) return
    const compatType = currentDirection === 'REVENUE' ? 'receivable' : 'payable'
    setSelectedDocs((prev) => prev.filter((d) => d.type === compatType))
    setAllocations((prev) => prev.filter((a) => a.type === compatType))
  }, [currentDirection])

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: settings } = useQuery({
    queryKey: ['settings', selectedClientId],
    queryFn: () => api.get<{ reconciliationDryRun: boolean }>(`/treasury/${selectedClientId}/settings`),
    enabled: !!selectedClientId,
  })

  useEffect(() => {
    if (settings?.reconciliationDryRun !== undefined) setIsDryRun(settings.reconciliationDryRun)
  }, [settings?.reconciliationDryRun])

  const { data: movementsData } = useQuery({
    queryKey: ['movements-pending', selectedClientId],
    queryFn: () => api.get<{ items: Movement[] }>(`/treasury/${selectedClientId}/movements?status=CLASSIFIED&limit=100`),
    enabled: !!selectedClientId,
  })

  const { data: receivablesData } = useQuery({
    queryKey: ['receivables-pending', selectedClientId],
    queryFn: () => api.get<{ items: Document[] }>(`/treasury/${selectedClientId}/receivables?status=OPEN,PARTIAL&limit=100`),
    enabled: !!selectedClientId,
  })

  const { data: payablesData } = useQuery({
    queryKey: ['payables-pending', selectedClientId],
    queryFn: () => api.get<{ items: Document[] }>(`/treasury/${selectedClientId}/payables?status=OPEN,PARTIAL&limit=100`),
    enabled: !!selectedClientId,
  })

  const { data: historyData } = useQuery({
    queryKey: ['reconciliations', selectedClientId, historyLimit],
    queryFn: () => api.get<{ items: RecHistoryItem[]; total: number }>(`/treasury/${selectedClientId}/reconciliations?limit=${historyLimit}`),
    enabled: !!selectedClientId,
  })

  // ── Derived lists ────────────────────────────────────────────────────────────

  const allPendingMovements = movementsData?.items ?? []
  const allPendingDocs: Document[] = useMemo(() => [
    ...(receivablesData?.items ?? []).map((r) => ({ ...r, type: 'receivable' as const })),
    ...(payablesData?.items ?? []).map((p) => ({ ...p, type: 'payable' as const })),
  ], [receivablesData, payablesData])

  const pendingMovements = useMemo(() =>
    movSearch ? allPendingMovements.filter((m) => m.description.toLowerCase().includes(movSearch.toLowerCase())) : allPendingMovements,
    [allPendingMovements, movSearch]
  )

  const pendingDocs: Document[] = useMemo(() => {
    const searched = docSearch
      ? allPendingDocs.filter((d) => d.entityName.toLowerCase().includes(docSearch.toLowerCase()) || d.reference.toLowerCase().includes(docSearch.toLowerCase()))
      : allPendingDocs
    if (!currentDirection) return searched
    return searched.filter((d) => currentDirection === 'REVENUE' ? d.type === 'receivable' : d.type === 'payable')
  }, [allPendingDocs, docSearch, currentDirection])

  // ── Totals ───────────────────────────────────────────────────────────────────

  const totalMovements = selectedMovements.reduce((s, m) => s + Math.abs(Number(m.amount)), 0)
  const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0)
  const diff = Math.abs(totalMovements - totalAllocated)
  const canConfirm = selectedMovements.length > 0 && selectedDocs.length > 0 && diff < 0.01 && totalMovements > 0

  // ── Selection handlers ───────────────────────────────────────────────────────

  function toggleMovement(m: Movement) {
    if (selectedMovements.find((x) => x.id === m.id)) {
      const next = selectedMovements.filter((x) => x.id !== m.id)
      setSelectedMovements(next)
      if (next.length === 0) { setSelectedDocs([]); setAllocations([]) }
    } else {
      if (currentDirection !== null) {
        const mDir = Number(m.amount) >= 0 ? 'REVENUE' : 'EXPENSE'
        if (mDir !== currentDirection) return // blocked
      }
      setSelectedMovements((prev) => [...prev, m])
    }
  }

  function toggleDoc(d: Document) {
    if (selectedDocs.find((x) => x.id === d.id)) {
      setSelectedDocs((prev) => prev.filter((x) => x.id !== d.id))
      setAllocations((prev) => prev.filter((a) => a.id !== d.id))
    } else {
      setSelectedDocs((prev) => [...prev, d])
      const remaining = totalMovements - totalAllocated
      const amount = Math.min(Number(d.pendingAmount), remaining > 0 ? remaining : 0)
      setAllocations((prev) => [...prev, { type: d.type, id: d.id, amount, reference: d.reference, entityName: d.entityName, pendingAmount: Number(d.pendingAmount) }])
    }
  }

  function selectAllMovements() {
    if (selectedMovements.length > 0) {
      setSelectedMovements([]); setSelectedDocs([]); setAllocations([])
    } else {
      // Only select same-sign movements (use first in list to decide, default positive)
      const firstSign = pendingMovements.length > 0 ? (Number(pendingMovements[0].amount) >= 0 ? 1 : -1) : 1
      setSelectedMovements(pendingMovements.filter((m) => (Number(m.amount) >= 0 ? 1 : -1) === firstSign))
    }
  }

  function selectAllDocs() {
    if (selectedDocs.length === pendingDocs.length) {
      setSelectedDocs([]); setAllocations([])
    } else {
      setSelectedDocs(pendingDocs)
      let remaining = totalMovements
      setAllocations(pendingDocs.map((d) => {
        const amount = Math.min(Number(d.pendingAmount), remaining > 0 ? remaining : 0)
        remaining = Math.max(0, remaining - amount)
        return { type: d.type, id: d.id, amount, reference: d.reference, entityName: d.entityName, pendingAmount: Number(d.pendingAmount) }
      }))
    }
  }

  function openModal() { setPreviewData(null); setShowModal(true) }

  // ── Mutations ────────────────────────────────────────────────────────────────

  const preview = useMutation({
    mutationFn: () => api.post(`/treasury/${selectedClientId}/reconciliations/preview`, {
      movementIds: selectedMovements.map((m) => m.id),
      allocations: allocations.map((a) => ({ type: a.type, id: a.id, amount: a.amount })),
      isDryRun,
    }),
    onSuccess: (data) => setPreviewData(data as typeof previewData),
    onError: (e) => toast.error((e as Error).message),
  })

  const confirm = useMutation({
    mutationFn: () => api.post(`/treasury/${selectedClientId}/reconciliations/confirm`, {
      movementIds: selectedMovements.map((m) => m.id),
      allocations: allocations.map((a) => ({ type: a.type, id: a.id, amount: a.amount })),
      isDryRun,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movements-pending'] })
      qc.invalidateQueries({ queryKey: ['receivables-pending'] })
      qc.invalidateQueries({ queryKey: ['payables-pending'] })
      qc.invalidateQueries({ queryKey: ['reconciliations'] })
      qc.invalidateQueries({ queryKey: ['movements'] })
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['payables'] })
      setSelectedMovements([]); setSelectedDocs([]); setAllocations([])
      setShowModal(false)
      toast.success(isDryRun ? 'Simulação concluída (dry-run).' : 'Reconciliação concluída com sucesso.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const reverse = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`/treasury/${selectedClientId}/reconciliations/${id}/reverse`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reconciliations'] })
      qc.invalidateQueries({ queryKey: ['movements-pending'] })
      qc.invalidateQueries({ queryKey: ['movements'] })
      qc.invalidateQueries({ queryKey: ['receivables-pending'] })
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['payables-pending'] })
      qc.invalidateQueries({ queryKey: ['payables'] })
      setReverseId(null); setReverseReason('')
      toast.success('Reconciliação revertida.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const hasSelection = selectedMovements.length > 0 || selectedDocs.length > 0

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const directionLabel = currentDirection === 'REVENUE' ? '↓ Entradas' : currentDirection === 'EXPENSE' ? '↑ Saídas' : null
  const directionColor = currentDirection === 'REVENUE' ? 'text-green-700 bg-green-50 border-green-200' : currentDirection === 'EXPENSE' ? 'text-red-700 bg-red-50 border-red-200' : ''

  const docsHeading = currentDirection === 'REVENUE'
    ? 'Contas a Receber (CR)'
    : currentDirection === 'EXPENSE'
    ? 'Contas a Pagar (CP)'
    : 'Documentos Pendentes (CR + CP)'

  return (
    <div className="space-y-6 pb-28">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Reconciliação</h1>
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <RefreshCw className="w-4 h-4" />
          <span>Selecione movimentos e documentos para reconciliar</span>
        </div>
      </div>

      {/* Two-column selection */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Movements */}
        <div className="card">
          <div className="px-5 py-4 border-b border-gray-100 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="font-semibold text-gray-900 text-sm">Movimentos Bancários Pendentes</h2>
                {directionLabel && (
                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${directionColor}`}>
                    {directionLabel}
                  </span>
                )}
              </div>
              {pendingMovements.length > 0 && (
                <button onClick={selectAllMovements} className="text-xs text-primary-600 hover:text-primary-700 font-medium">
                  {selectedMovements.length > 0 ? 'Limpar' : 'Selecionar todos'}
                </button>
              )}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
              <input className="input pl-7 text-xs py-1 w-full" placeholder="Pesquisar descrição..." value={movSearch} onChange={(e) => setMovSearch(e.target.value)} />
            </div>
          </div>
          <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
            {pendingMovements.map((m) => {
              const selected = !!selectedMovements.find((x) => x.id === m.id)
              const mDir = Number(m.amount) >= 0 ? 'REVENUE' : 'EXPENSE'
              const blocked = currentDirection !== null && !selected && mDir !== currentDirection
              return (
                <button
                  key={m.id}
                  onClick={() => toggleMovement(m)}
                  disabled={blocked}
                  title={blocked ? `Apenas ${currentDirection === 'REVENUE' ? 'entradas' : 'saídas'} nesta reconciliação` : undefined}
                  className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors
                    ${selected ? 'bg-primary-50' : blocked ? 'opacity-35 cursor-not-allowed bg-gray-50' : 'hover:bg-gray-50'}`}
                >
                  {selected
                    ? <CheckSquare className="w-4 h-4 text-primary-600 flex-shrink-0" />
                    : <Square className={`w-4 h-4 flex-shrink-0 ${blocked ? 'text-gray-200' : 'text-gray-300'}`} />}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-900 truncate">{m.description}</div>
                    <div className="text-xs text-gray-400">{formatDate(m.date)} · {m.bankAccount?.name}</div>
                  </div>
                  <span className={`text-sm font-semibold whitespace-nowrap ${Number(m.amount) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {Number(m.amount) >= 0 ? '+' : ''}{formatCurrency(Math.abs(Number(m.amount)))}
                  </span>
                </button>
              )
            })}
            {pendingMovements.length === 0 && <div className="px-5 py-8 text-center text-gray-400 text-sm">Sem movimentos pendentes</div>}
          </div>
        </div>

        {/* Documents */}
        <div className="card">
          <div className="px-5 py-4 border-b border-gray-100 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 text-sm">{docsHeading}</h2>
              {pendingDocs.length > 0 && (
                <button onClick={selectAllDocs} className="text-xs text-primary-600 hover:text-primary-700 font-medium">
                  {selectedDocs.length === pendingDocs.length ? 'Desselecionar todos' : 'Selecionar todos'}
                </button>
              )}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
              <input className="input pl-7 text-xs py-1 w-full" placeholder="Pesquisar cliente, fornecedor, referência..." value={docSearch} onChange={(e) => setDocSearch(e.target.value)} />
            </div>
          </div>
          <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
            {pendingDocs.map((d) => {
              const selected = !!selectedDocs.find((x) => x.id === d.id)
              const isSuggested = !selected && selectedMovements.length > 0 && Math.abs(Number(d.pendingAmount) - totalMovements) < 0.01
              return (
                <button
                  key={d.id}
                  onClick={() => toggleDoc(d)}
                  className={`w-full flex items-center gap-3 px-5 py-3 text-left transition-colors
                    ${selected ? 'bg-primary-50 hover:bg-primary-100' : isSuggested ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-gray-50'}`}
                >
                  {selected
                    ? <CheckSquare className="w-4 h-4 text-primary-600 flex-shrink-0" />
                    : <Square className={`w-4 h-4 flex-shrink-0 ${isSuggested ? 'text-amber-400' : 'text-gray-300'}`} />}
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.category.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-900 flex items-center gap-2">
                      {d.reference}
                      <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${d.type === 'receivable' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {d.type === 'receivable' ? 'CR' : 'CP'}
                      </span>
                      {d.status === 'PARTIAL' && <span className="text-xs text-amber-600">parcial</span>}
                      {isSuggested && <span className="text-xs text-amber-700 font-medium">← sugerido</span>}
                    </div>
                    <div className="text-xs text-gray-400">{d.entityName} · {d.category.name}</div>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <div className={`text-sm font-semibold ${d.type === 'receivable' ? 'text-green-700' : 'text-red-700'}`}>
                      {formatCurrency(Number(d.pendingAmount))}
                    </div>
                    <div className="text-xs text-gray-400">{formatDate(d.dueDate)}</div>
                  </div>
                </button>
              )
            })}
            {pendingDocs.length === 0 && (
              <div className="px-5 py-8 text-center text-gray-400 text-sm">
                {currentDirection
                  ? `Sem ${currentDirection === 'REVENUE' ? 'contas a receber' : 'contas a pagar'} pendentes`
                  : 'Sem documentos pendentes'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating action bar */}
      {hasSelection && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white border border-gray-200 rounded-xl shadow-lg px-6 py-4 flex items-center gap-6 z-40 max-w-3xl w-full mx-auto">
          <div className="text-sm text-gray-700 flex-1 min-w-0">
            <span className="font-semibold">{selectedMovements.length}</span> mov. ·{' '}
            <span className="font-semibold">{selectedDocs.length}</span> doc. ·{' '}
            Total: <span className="font-semibold">{formatCurrency(totalMovements)}</span> ·{' '}
            Alocado: <span className="font-semibold">{formatCurrency(totalAllocated)}</span>
            {diff > 0.01 && <span className="text-red-600 ml-2">· Falta: {formatCurrency(diff)}</span>}
          </div>
          <button onClick={openModal} className="btn-primary whitespace-nowrap" disabled={selectedMovements.length === 0 || selectedDocs.length === 0}>
            Reconciliar seleção
          </button>
          <button onClick={() => { setSelectedMovements([]); setSelectedDocs([]); setAllocations([]) }} className="btn-secondary">
            Limpar
          </button>
        </div>
      )}

      {/* History */}
      <div className="card">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-sm">Histórico de Reconciliações</h2>
        </div>
        <div className="divide-y divide-gray-50">
          {(historyData?.items ?? []).map((rec) => {
            const isExpanded = expandedId === rec.id
            return (
              <div key={rec.id}>
                <div className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                  {/* Expand toggle */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : rec.id)}
                    className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                  >
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900 flex items-center gap-2 flex-wrap">
                      <Badge variant={statusVariant(rec.status)}>{statusLabel(rec.status)}</Badge>
                      {rec.isDryRun && <Badge variant="yellow">Dry-run</Badge>}
                      <span className={`text-xs font-medium ${rec.direction === 'REVENUE' ? 'text-green-700' : 'text-red-700'}`}>
                        {rec.direction === 'REVENUE' ? '↓ Entrada' : '↑ Saída'}
                      </span>
                      <span className="text-gray-400 text-xs">
                        {rec.movements.length} mov. · {rec.receivables.length + rec.payables.length} doc.
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {formatDate(rec.createdAt)} · {rec.createdBy?.name}
                      {rec.reversedAt && <span className="ml-2 text-amber-600">Revertida {formatDate(rec.reversedAt)}{rec.reversedReason ? ` · ${rec.reversedReason}` : ''}</span>}
                    </div>
                  </div>

                  <div className="text-right flex-shrink-0 flex items-center gap-3">
                    <div className="text-sm font-semibold text-gray-900">{formatCurrency(rec.totalAllocated)}</div>
                    {rec.status === 'CONFIRMED' && (
                      <button
                        onClick={() => { setReverseId(rec.id); setReverseReason('') }}
                        title="Desfazer reconciliação"
                        className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors"
                      >
                        <Undo2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Inline expansion */}
                {isExpanded && (
                  <div className="px-12 pb-4 grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50/50 border-t border-gray-100">
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 mt-3">Movimentos</h4>
                      <div className="space-y-1">
                        {rec.movements.map((link) => (
                          <div key={link.movement.id} className="flex justify-between text-xs text-gray-700 bg-white rounded px-3 py-1.5 border border-gray-100">
                            <span className="truncate mr-2 text-gray-600">{link.movement.description}</span>
                            <span className={`font-medium whitespace-nowrap ${Number(link.movement.amount) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                              {formatCurrency(Math.abs(Number(link.movement.amount)))}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2 mt-3">Documentos liquidados</h4>
                      <div className="space-y-1">
                        {rec.receivables.map((link) => (
                          <div key={link.receivable.id} className="flex justify-between text-xs text-gray-700 bg-white rounded px-3 py-1.5 border border-gray-100">
                            <span className="truncate mr-2">
                              <span className="text-green-700 font-medium mr-1">CR</span>
                              {link.receivable.reference} · {link.receivable.entityName}
                            </span>
                            <span className="font-medium text-green-700 whitespace-nowrap">{formatCurrency(Number(link.amountAllocated))}</span>
                          </div>
                        ))}
                        {rec.payables.map((link) => (
                          <div key={link.payable.id} className="flex justify-between text-xs text-gray-700 bg-white rounded px-3 py-1.5 border border-gray-100">
                            <span className="truncate mr-2">
                              <span className="text-red-700 font-medium mr-1">CP</span>
                              {link.payable.reference} · {link.payable.entityName}
                            </span>
                            <span className="font-medium text-red-700 whitespace-nowrap">{formatCurrency(Number(link.amountAllocated))}</span>
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
            <div className="px-5 py-8 text-center text-gray-400 text-sm">Sem reconciliações ainda</div>
          )}
        </div>
        {historyData && historyData.total > historyLimit && (
          <div className="px-5 py-3 border-t border-gray-100">
            <button onClick={() => setHistoryLimit((l) => l + 10)} className="text-xs text-primary-600 hover:text-primary-700 font-medium">
              Ver mais ({historyData.total - historyLimit} restantes)
            </button>
          </div>
        )}
      </div>

      {/* Confirmation modal */}
      <Modal open={showModal} onClose={() => setShowModal(false)} title="Confirmar Reconciliação" size="xl">
        <div className="space-y-4">
          {isDryRun && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>Modo dry-run — nenhum recibo/pagamento será criado no TOConline</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Movimentos ({selectedMovements.length})</h3>
              <div className="space-y-2">
                {selectedMovements.map((m) => (
                  <div key={m.id} className="flex justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-gray-700 truncate mr-2">{m.description}</span>
                    <span className={`font-semibold whitespace-nowrap ${Number(m.amount) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {formatCurrency(Math.abs(Number(m.amount)))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Documentos — Valor a dar baixa</h3>
              <div className="space-y-2">
                {allocations.map((a, i) => (
                  <div key={a.id} className="bg-gray-50 rounded-lg px-3 py-2">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>{a.reference} · {a.entityName}</span>
                      <span>máx. {formatCurrency(a.pendingAmount)}</span>
                    </div>
                    <input
                      type="number"
                      className="input text-sm py-1"
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

          {/* Validation bar */}
          <div className={`rounded-lg px-4 py-2.5 text-sm font-medium ${diff < 0.01 ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
            Alocado: {formatCurrency(totalAllocated)} · Movimentos: {formatCurrency(totalMovements)} · {diff < 0.01 ? '✓ Balanceado' : `Falta: ${formatCurrency(diff)}`}
          </div>

          {previewData && (
            <div className="bg-blue-50 rounded-lg px-4 py-3 text-sm text-blue-800">
              {(previewData.tocActions as Array<{ type: string }>).length > 0
                ? `Serão criados: ${(previewData.tocActions as Array<{ type: string }>).filter((a) => a.type === 'receivable').length} recibo(s) + ${(previewData.tocActions as Array<{ type: string }>).filter((a) => a.type === 'payable').length} pagamento(s) no TOConline`
                : 'Operação apenas local (sem chamadas ao TOConline)'}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input type="checkbox" id="dryrun" checked={isDryRun} onChange={(e) => setIsDryRun(e.target.checked)} className="rounded" />
            <label htmlFor="dryrun" className="text-sm text-gray-700">Modo dry-run (não escreve no TOConline)</label>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setShowModal(false)} className="btn-secondary flex-1">Cancelar</button>
            {!previewData && (
              <button onClick={() => preview.mutate()} className="btn-secondary flex-1" disabled={preview.isPending}>
                {preview.isPending ? 'A analisar...' : 'Pré-visualizar'}
              </button>
            )}
            <button onClick={() => confirm.mutate()} className="btn-primary flex-1" disabled={!canConfirm || confirm.isPending}>
              {confirm.isPending ? 'A confirmar...' : 'Confirmar'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Reverse modal */}
      <Modal open={!!reverseId} onClose={() => { setReverseId(null); setReverseReason('') }} title="Desfazer Reconciliação">
        <div className="space-y-4">
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
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
          <div className="flex gap-3 pt-2">
            <button onClick={() => { setReverseId(null); setReverseReason('') }} className="btn-secondary flex-1">
              Cancelar
            </button>
            <button
              onClick={() => reverseId && reverse.mutate({ id: reverseId, reason: reverseReason || undefined })}
              className="btn-primary flex-1 bg-amber-600 hover:bg-amber-700 focus:ring-amber-500"
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
