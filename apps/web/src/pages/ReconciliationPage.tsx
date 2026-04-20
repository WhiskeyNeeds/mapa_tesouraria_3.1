import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate, statusLabel, statusVariant } from '@/lib/utils'
import Badge from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import { CheckSquare, Square, RefreshCw, AlertCircle } from 'lucide-react'

interface Movement {
  id: string; date: string; amount: number; description: string; status: string
  bankAccount?: { name: string }; category?: { name: string }
}
interface Document {
  id: string; reference: string; entityName: string; dueDate: string; pendingAmount: number; totalAmount: number; status: string
  category: { name: string; color: string; launchToc: boolean }; type: 'receivable' | 'payable'
}
interface Allocation { type: 'receivable' | 'payable'; id: string; amount: number; reference: string; entityName: string; pendingAmount: number }

export default function ReconciliationPage() {
  const { selectedClientId } = useAuth()
  const qc = useQueryClient()
  const [selectedMovements, setSelectedMovements] = useState<Movement[]>([])
  const [selectedDocs, setSelectedDocs] = useState<Document[]>([])
  const [showModal, setShowModal] = useState(false)
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [isDryRun, setIsDryRun] = useState(true)
  const [previewData, setPreviewData] = useState<{ direction: string; totalMovements: number; totalAllocated: number; tocActions: unknown[] } | null>(null)

  const { data: movementsData } = useQuery({
    queryKey: ['movements-pending', selectedClientId],
    queryFn: () => api.get<{ items: Movement[] }>(`/treasury/${selectedClientId}/movements?status=CLASSIFIED&limit=100`),
    enabled: !!selectedClientId,
  })

  const { data: receivablesData } = useQuery({
    queryKey: ['receivables-pending', selectedClientId],
    queryFn: () => api.get<{ items: Document[] }>(`/treasury/${selectedClientId}/receivables?status=OPEN&limit=100`),
    enabled: !!selectedClientId,
  })

  const { data: payablesData } = useQuery({
    queryKey: ['payables-pending', selectedClientId],
    queryFn: () => api.get<{ items: Document[] }>(`/treasury/${selectedClientId}/payables?status=OPEN&limit=100`),
    enabled: !!selectedClientId,
  })

  const { data: historyData } = useQuery({
    queryKey: ['reconciliations', selectedClientId],
    queryFn: () => api.get<{ items: unknown[] }>(`/treasury/${selectedClientId}/reconciliations?limit=10`),
    enabled: !!selectedClientId,
  })

  const pendingMovements = movementsData?.items ?? []
  const pendingDocs: Document[] = [
    ...(receivablesData?.items ?? []).map((r) => ({ ...r, type: 'receivable' as const })),
    ...(payablesData?.items ?? []).map((p) => ({ ...p, type: 'payable' as const })),
  ]

  const totalMovements = selectedMovements.reduce((s, m) => s + Math.abs(Number(m.amount)), 0)
  const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0)
  const diff = Math.abs(totalMovements - totalAllocated)
  const canConfirm = selectedMovements.length > 0 && selectedDocs.length > 0 && diff < 0.01

  function toggleMovement(m: Movement) {
    setSelectedMovements((prev) =>
      prev.find((x) => x.id === m.id) ? prev.filter((x) => x.id !== m.id) : [...prev, m]
    )
  }

  function toggleDoc(d: Document) {
    if (selectedDocs.find((x) => x.id === d.id)) {
      setSelectedDocs((prev) => prev.filter((x) => x.id !== d.id))
      setAllocations((prev) => prev.filter((a) => a.id !== d.id))
    } else {
      setSelectedDocs((prev) => [...prev, d])
      // Greedy allocation
      const remaining = totalMovements - totalAllocated
      const amount = Math.min(Number(d.pendingAmount), remaining)
      setAllocations((prev) => [...prev, { type: d.type, id: d.id, amount, reference: d.reference, entityName: d.entityName, pendingAmount: Number(d.pendingAmount) }])
    }
  }

  function openModal() {
    setPreviewData(null)
    setShowModal(true)
  }

  const preview = useMutation({
    mutationFn: () => api.post(`/treasury/${selectedClientId}/reconciliations/preview`, {
      movementIds: selectedMovements.map((m) => m.id),
      allocations: allocations.map((a) => ({ type: a.type, id: a.id, amount: a.amount })),
      isDryRun,
    }),
    onSuccess: (data) => setPreviewData(data as typeof previewData),
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
      setSelectedMovements([])
      setSelectedDocs([])
      setAllocations([])
      setShowModal(false)
    },
  })

  const hasSelection = selectedMovements.length > 0 || selectedDocs.length > 0

  return (
    <div className="space-y-6">
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
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 text-sm">Movimentos Bancários Pendentes</h2>
          </div>
          <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
            {pendingMovements.map((m) => {
              const selected = !!selectedMovements.find((x) => x.id === m.id)
              return (
                <button key={m.id} onClick={() => toggleMovement(m)} className={`w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-gray-50 transition-colors ${selected ? 'bg-primary-50' : ''}`}>
                  {selected ? <CheckSquare className="w-4 h-4 text-primary-600 flex-shrink-0" /> : <Square className="w-4 h-4 text-gray-300 flex-shrink-0" />}
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
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-900 text-sm">Documentos Pendentes (CR + CP)</h2>
          </div>
          <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
            {pendingDocs.map((d) => {
              const selected = !!selectedDocs.find((x) => x.id === d.id)
              return (
                <button key={d.id} onClick={() => toggleDoc(d)} className={`w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-gray-50 transition-colors ${selected ? 'bg-primary-50' : ''}`}>
                  {selected ? <CheckSquare className="w-4 h-4 text-primary-600 flex-shrink-0" /> : <Square className="w-4 h-4 text-gray-300 flex-shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-900 flex items-center gap-2">
                      {d.reference}
                      {!d.category.launchToc && <span className="text-xs text-gray-400">local</span>}
                    </div>
                    <div className="text-xs text-gray-400">{d.entityName} · {d.type === 'receivable' ? 'A Receber' : 'A Pagar'}</div>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <div className={`text-sm font-semibold ${d.type === 'receivable' ? 'text-green-700' : 'text-red-700'}`}>
                      {formatCurrency(Number(d.pendingAmount))}
                    </div>
                    <div className="text-xs text-gray-400">pendente</div>
                  </div>
                </button>
              )
            })}
            {pendingDocs.length === 0 && <div className="px-5 py-8 text-center text-gray-400 text-sm">Sem documentos pendentes</div>}
          </div>
        </div>
      </div>

      {/* Floating bar */}
      {hasSelection && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white border border-gray-200 rounded-xl shadow-lg px-6 py-4 flex items-center gap-6 z-40">
          <div className="text-sm text-gray-700">
            <span className="font-semibold">{selectedMovements.length}</span> movimentos ·{' '}
            <span className="font-semibold">{selectedDocs.length}</span> documentos ·{' '}
            Mov: <span className="font-semibold">{formatCurrency(totalMovements)}</span> ·{' '}
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
        <div className="px-5 py-4 border-b border-gray-100"><h2 className="font-semibold text-gray-900 text-sm">Histórico de Reconciliações</h2></div>
        <div className="divide-y divide-gray-50">
          {(historyData?.items ?? []).map((r: unknown) => {
            const rec = r as { id: string; status: string; isDryRun: boolean; totalMovements: number; totalAllocated: number; createdAt: string; createdBy: { name: string }; direction: string }
            return (
              <div key={rec.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <div className="text-sm text-gray-900 flex items-center gap-2">
                    <Badge variant={statusVariant(rec.status)}>{statusLabel(rec.status)}</Badge>
                    {rec.isDryRun && <Badge variant="yellow">Dry-run</Badge>}
                    <span className="text-gray-500">{rec.direction === 'REVENUE' ? '↓ Entrada' : '↑ Saída'}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{formatDate(rec.createdAt)} · {rec.createdBy?.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold text-gray-900">{formatCurrency(rec.totalAllocated)}</div>
                </div>
              </div>
            )
          })}
          {(historyData?.items ?? []).length === 0 && <div className="px-5 py-8 text-center text-gray-400 text-sm">Sem reconciliações ainda</div>}
        </div>
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
                    <span className={`font-semibold whitespace-nowrap ${Number(m.amount) >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatCurrency(Math.abs(Number(m.amount)))}</span>
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
              {(previewData.tocActions as Array<{ type: string; reference: string; amount: number }>).length > 0
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
    </div>
  )
}
