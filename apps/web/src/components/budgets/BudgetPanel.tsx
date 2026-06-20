// apps/web/src/components/budgets/BudgetPanel.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import { X, Pencil, Trash2, CheckCircle, MoveRight, XCircle, Plus } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import DocDetailPanel from '@/components/treasury/DocDetailPanel'

interface BudgetProgress { paidAmount: number; expectedAmount: number; availableAmount: number; totalAllocated: number; overrunAmount: number }
interface Rule { id: string; textPattern: string | null; budget: { id: string; name: string }; category: { id: string; name: string; color: string | null } }
interface Doc {
  id: string
  entityName: string | null
  entityNif: string | null
  reference: string | null
  description: string | null
  documentDate: string | null
  dueDate: string
  promisedPaymentDate: string | null
  totalAmount: number
  paidAmount?: number
  receivedAmount?: number
  pendingAmount: number
  status: string
  origin: string
  budgetAutoAssigned: boolean
  category?: { id: string; name: string; color: string | null } | null
}
interface BudgetDetail {
  id: string; name: string; type: 'REVENUE' | 'EXPENSE'; status: string
  startDate: string; endDate: string; totalAmount: number; color: string | null
  progress: BudgetProgress; rules: Rule[]; documents: Doc[]
}
interface Category { id: string; name: string; type: 'REVENUE' | 'EXPENSE'; color: string | null }
interface Budget { id: string; name: string }

interface BudgetEvent { id: string; action: string; createdAt: string; actor: { id: string; name: string } | null; payload: Record<string, unknown> | null }
interface BudgetEventsPage { events: BudgetEvent[]; nextCursor: string | null }

function fmtAmount(v: unknown): string {
  const n = Number(v ?? 0)
  return formatCurrency(Number.isFinite(n) ? n : 0)
}

function formatBudgetEvent(action: string, payload: Record<string, unknown> | null): string {
  const p = payload ?? {}
  const ent = (p.entityName as string) ?? '—'
  const amt = fmtAmount(p.amount)
  switch (action) {
    case 'budget.create': return 'Budget criado'
    case 'budget.delete': return 'Budget eliminado'
    case 'budget.update': {
      const changes = (p.changes ?? {}) as Record<string, { from: unknown; to: unknown }>
      if (changes.status) {
        return changes.status.to === 'ARCHIVED' ? 'Budget arquivado' : 'Budget reativado'
      }
      const labels: Record<string, string> = { name: 'Nome', totalAmount: 'Valor', startDate: 'Início', endDate: 'Fim', color: 'Cor', description: 'Descrição' }
      const parts = Object.keys(changes).map((k) => labels[k] ?? k)
      return parts.length ? `Editado: ${parts.join(', ')}` : 'Budget editado'
    }
    case 'budget.rule_add': return `Regra adicionada: «${(p.categoryName as string) ?? '—'}»${p.textPattern ? ` (${p.textPattern})` : ''}`
    case 'budget.rule_remove': return `Regra removida: «${(p.categoryName as string) ?? '—'}»`
    case 'budget.txn_auto_assign': return `Fatura de ${ent} (${amt}) atribuída automaticamente`
    case 'budget.txn_confirm': return `Fatura de ${ent} (${amt}) confirmada`
    case 'budget.txn_move_in': return p.fromBudgetName ? `Fatura de ${ent} (${amt}) movida de «${p.fromBudgetName}»` : `Fatura de ${ent} (${amt}) adicionada`
    case 'budget.txn_move_out': return `Fatura de ${ent} (${amt}) movida para «${(p.toBudgetName as string) ?? '—'}»`
    case 'budget.txn_unassign': return `Fatura de ${ent} (${amt}) removida do budget`
    default: return action
  }
}

const STATUS_LABEL: Record<string, string> = { OPEN: 'Aberto', PARTIAL: 'Parcial', PAID: 'Pago', VOID: 'Anulado' }
const STATUS_COLOR: Record<string, string> = {
  OPEN: 'bg-amber-50 text-amber-700',
  PARTIAL: 'bg-blue-50 text-blue-700',
  PAID: 'bg-emerald-50 text-emerald-700',
  VOID: 'bg-gray-100 text-gray-500',
}

export default function BudgetPanel({
  budgetId,
  onClose,
  onEdit,
  onDelete,
}: {
  budgetId: string
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { selectedClientId } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<'transactions' | 'rules' | 'review' | 'history'>('transactions')
  const [newRule, setNewRule] = useState({ categoryId: '', textPattern: '' })
  const [showNewRule, setShowNewRule] = useState(false)
  const [movingDocId, setMovingDocId] = useState<string | null>(null)
  const [moveTargetBudgetId, setMoveTargetBudgetId] = useState('')
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)

  const { data: budget, isLoading } = useQuery<BudgetDetail>({
    queryKey: ['budget-detail', selectedClientId, budgetId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/budgets/${budgetId}`),
    enabled: !!selectedClientId && !!budgetId,
  })

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/categories`),
    enabled: !!selectedClientId && activeTab === 'rules',
  })

  const { data: allBudgets = [] } = useQuery<Budget[]>({
    queryKey: ['budgets-active', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/budgets?status=ACTIVE`),
    enabled: !!selectedClientId && movingDocId !== null,
  })

  const { data: eventsPage, isLoading: eventsLoading } = useQuery<BudgetEventsPage>({
    queryKey: ['budget-events', selectedClientId, budgetId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/budgets/${budgetId}/events?limit=100`),
    enabled: !!selectedClientId && !!budgetId && activeTab === 'history',
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['budget-detail', selectedClientId, budgetId] })
    qc.invalidateQueries({ queryKey: ['budgets', selectedClientId] })
  }

  function patchDoc(docId: string, payload: Record<string, unknown>) {
    const seg = budget!.type === 'REVENUE' ? 'receivables' : 'payables'
    return api.patch(`/treasury/${selectedClientId}/${seg}/${docId}`, payload)
  }

  // --- mutations: rules ---
  const createRule = useMutation({
    mutationFn: () => api.post(`/treasury/${selectedClientId}/budget-rules`, {
      budgetId,
      categoryId: newRule.categoryId,
      textPattern: newRule.textPattern || undefined,
    }),
    onSuccess: () => { invalidate(); setShowNewRule(false); setNewRule({ categoryId: '', textPattern: '' }); toast.success('Regra criada') },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteRule = useMutation({
    mutationFn: (ruleId: string) => api.delete(`/treasury/${selectedClientId}/budget-rules/${ruleId}`),
    onSuccess: () => { invalidate(); toast.success('Regra eliminada') },
    onError: (e: Error) => toast.error(e.message),
  })

  // --- mutations: review tab ---
  const confirmDoc = useMutation({
    mutationFn: (docId: string) => patchDoc(docId, { budgetAutoAssigned: false }),
    onSuccess: () => { invalidate(); toast.success('Transação confirmada') },
    onError: (e: Error) => toast.error(e.message),
  })

  const removeDoc = useMutation({
    mutationFn: (docId: string) => patchDoc(docId, { budgetId: null, budgetAutoAssigned: false }),
    onSuccess: () => { invalidate(); toast.success('Associação removida') },
    onError: (e: Error) => toast.error(e.message),
  })

  const moveDoc = useMutation({
    mutationFn: ({ docId, targetBudgetId }: { docId: string; targetBudgetId: string }) =>
      patchDoc(docId, { budgetId: targetBudgetId, budgetAutoAssigned: false }),
    onSuccess: () => { invalidate(); setMovingDocId(null); toast.success('Transação movida') },
    onError: (e: Error) => toast.error(e.message),
  })

  const confirmAll = useMutation({
    mutationFn: async () => {
      const pending = (budget?.documents ?? []).filter((d) => d.budgetAutoAssigned)
      await Promise.all(pending.map((d) => patchDoc(d.id, { budgetAutoAssigned: false })))
    },
    onSuccess: () => { invalidate(); toast.success('Todas confirmadas') },
    onError: (e: Error) => toast.error(e.message),
  })


  if (isLoading || !budget) {
    return (
      <div className="w-[400px] border-l border-gray-200 bg-white flex items-center justify-center">
        <span className="text-sm text-gray-400">A carregar...</span>
      </div>
    )
  }

  const pendingDocs = budget.documents.filter((d) => d.budgetAutoAssigned)
  const pendingCount = pendingDocs.length
  const color = budget.color ?? (budget.type === 'EXPENSE' ? '#3B82F6' : '#10B981')
  const { progress } = budget
  const paidPct = budget.totalAmount > 0 ? (progress.paidAmount / budget.totalAmount) * 100 : 0
  const expectedPct = budget.totalAmount > 0 ? (progress.expectedAmount / budget.totalAmount) * 100 : 0
  const overrun = progress.availableAmount < 0
  const availableCategories = categories.filter((c) => c.type === budget.type)


  return (
    <div className="lg:w-80 xl:w-96 flex-shrink-0 border-l border-gray-200 bg-white flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="font-semibold text-gray-900">{budget.name}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{formatDate(budget.startDate)} → {formatDate(budget.endDate)}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
            <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded" title="Eliminar"><Trash2 className="w-3.5 h-3.5" /></button>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded ml-1"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Budget: {formatCurrency(budget.totalAmount)}</span>
          {overrun && <span className="text-rose-600 font-medium">Excedido {formatCurrency(progress.overrunAmount)}</span>}
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden flex">
          <div style={{ width: `${Math.min(100, paidPct)}%`, backgroundColor: color }} className="h-full" />
          <div style={{ width: `${Math.max(0, Math.min(100 - paidPct, expectedPct))}%`, backgroundColor: `${color}55` }} className="h-full" />
        </div>
        <div className="flex justify-between text-xs text-gray-500 mt-1.5">
          <span>Pago {formatCurrency(progress.paidAmount)}</span>
          <span>Previsto {formatCurrency(progress.expectedAmount)}</span>
          <span className={overrun ? 'text-rose-600' : ''}>{overrun ? 'Excedido' : 'Disponível'} {formatCurrency(Math.abs(progress.availableAmount))}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 flex-shrink-0">
        {([
          { key: 'transactions', label: 'Transações' },
          { key: 'rules', label: 'Regras' },
          { key: 'review', label: `Para rever${pendingCount > 0 ? ` (${pendingCount})` : ''}` },
          { key: 'history', label: 'Histórico' },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t.key
                ? 'border-primary-600 text-primary-700'
                : `border-transparent ${t.key === 'review' && pendingCount > 0 ? 'text-amber-600' : 'text-gray-500 hover:text-gray-700'}`
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Conteúdo das tabs */}
      <div className="flex-1 overflow-y-auto p-4">

        {/* Tab: Transações */}
        {activeTab === 'transactions' && (
          <div className="space-y-2">
            {budget.documents.length === 0 ? (
              <p className="text-xs text-gray-400 italic text-center py-8">Sem transações associadas a este budget.</p>
            ) : budget.documents.map((doc) => (
              <button
                key={doc.id}
                onClick={() => setSelectedDocId(doc.id)}
                className="w-full text-left border border-gray-200 rounded-lg p-3 hover:bg-gray-50 hover:border-gray-300 transition-colors cursor-pointer"
              >
                <div className="flex justify-between items-start">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{doc.entityName ?? '—'}</p>
                    {doc.category && (
                      <p className="text-xs text-gray-500 mt-0.5">{doc.category.name}</p>
                    )}
                    <p className="text-xs text-gray-400">{formatDate(doc.dueDate)}</p>
                  </div>
                  <div className="text-right flex-shrink-0 ml-2">
                    <p className="text-sm font-semibold text-gray-900">{formatCurrency(doc.totalAmount)}</p>
                    <span className={`inline-block mt-0.5 text-xs px-1.5 py-0.5 rounded ${STATUS_COLOR[doc.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_LABEL[doc.status] ?? doc.status}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Tab: Regras */}
        {activeTab === 'rules' && (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 mb-3">Transações que correspondam a estas regras são sugeridas/atribuídas a este budget.</p>

            {budget.rules.length === 0 && !showNewRule && (
              <p className="text-xs text-gray-400 italic text-center py-4">Sem regras. Adiciona uma abaixo.</p>
            )}

            {budget.rules.map((rule) => (
              <div key={rule.id} className="flex items-center gap-2 border border-gray-200 rounded-lg p-2.5">
                <div className="flex-1 flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-medium bg-blue-50 text-blue-700">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: rule.category.color ?? '#9CA3AF' }} />
                    {rule.category.name}
                  </span>
                  {rule.textPattern && (
                    <>
                      <span className="text-gray-400 text-xs">+</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700 font-mono">"{rule.textPattern}"</span>
                    </>
                  )}
                </div>
                <button
                  onClick={() => { if (confirm('Eliminar esta regra?')) deleteRule.mutate(rule.id) }}
                  className="p-1 text-gray-400 hover:text-rose-600 rounded"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {showNewRule && (
              <div className="border border-dashed border-gray-300 rounded-lg p-3 space-y-2">
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">Categoria *</label>
                  <select
                    className="input text-sm"
                    value={newRule.categoryId}
                    onChange={(e) => setNewRule({ ...newRule, categoryId: e.target.value })}
                  >
                    <option value="">Seleccionar categoria...</option>
                    {availableCategories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">Filtro de texto (opcional)</label>
                  <input
                    className="input text-sm"
                    placeholder='ex: "Meo", "EDP"'
                    value={newRule.textPattern}
                    onChange={(e) => setNewRule({ ...newRule, textPattern: e.target.value })}
                  />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowNewRule(false)} className="btn-secondary flex-1 text-xs py-1.5">Cancelar</button>
                  <button
                    onClick={() => createRule.mutate()}
                    disabled={!newRule.categoryId || createRule.isPending}
                    className="btn-primary flex-1 text-xs py-1.5"
                  >
                    Guardar
                  </button>
                </div>
              </div>
            )}

            {!showNewRule && (
              <button
                onClick={() => setShowNewRule(true)}
                className="w-full flex items-center justify-center gap-1.5 text-xs text-primary-600 border border-dashed border-primary-300 rounded-lg py-2 hover:bg-primary-50 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Nova regra
              </button>
            )}
          </div>
        )}

        {/* Tab: Para rever */}
        {activeTab === 'review' && (
          <div className="space-y-2">
            {pendingCount === 0 ? (
              <p className="text-xs text-gray-400 italic text-center py-8">Sem transações para rever.</p>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-3">Atribuídas automaticamente pelo TOConline. Confirma ou redireciona.</p>
                {pendingDocs.map((doc) => (
                  <div key={doc.id} className="border border-amber-200 bg-amber-50 rounded-lg p-3">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{doc.entityName ?? '—'}</p>
                        <p className="text-xs text-gray-500">{formatDate(doc.dueDate)}</p>
                      </div>
                      <p className="text-sm font-semibold text-rose-700">{formatCurrency(doc.totalAmount)}</p>
                    </div>
                    {movingDocId === doc.id ? (
                      <div className="flex gap-1.5">
                        <select
                          className="input text-xs flex-1 py-1"
                          value={moveTargetBudgetId}
                          onChange={(e) => setMoveTargetBudgetId(e.target.value)}
                        >
                          <option value="">Escolher budget...</option>
                          {allBudgets.filter((b) => b.id !== budgetId).map((b) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => moveDoc.mutate({ docId: doc.id, targetBudgetId: moveTargetBudgetId })}
                          disabled={!moveTargetBudgetId || moveDoc.isPending}
                          className="btn-primary text-xs px-2 py-1"
                        >
                          Mover
                        </button>
                        <button onClick={() => setMovingDocId(null)} className="btn-secondary text-xs px-2 py-1">✕</button>
                      </div>
                    ) : (
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => confirmDoc.mutate(doc.id)}
                          className="flex-1 flex items-center justify-center gap-1 text-xs bg-emerald-600 text-white rounded py-1.5 hover:bg-emerald-700"
                        >
                          <CheckCircle className="w-3 h-3" /> Confirmar
                        </button>
                        <button
                          onClick={() => { setMovingDocId(doc.id); setMoveTargetBudgetId('') }}
                          className="flex-1 flex items-center justify-center gap-1 text-xs border border-gray-300 text-gray-700 rounded py-1.5 hover:bg-gray-50"
                        >
                          <MoveRight className="w-3 h-3" /> Mover
                        </button>
                        <button
                          onClick={() => removeDoc.mutate(doc.id)}
                          className="px-2 flex items-center justify-center text-xs border border-red-200 text-rose-600 rounded py-1.5 hover:bg-rose-50"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => confirmAll.mutate()}
                  disabled={confirmAll.isPending}
                  className="w-full text-xs border border-gray-200 text-gray-700 rounded-lg py-2 hover:bg-gray-50 mt-2"
                >
                  ✓ Confirmar todas ({pendingCount})
                </button>
              </>
            )}
          </div>
        )}

        {/* Tab: Histórico */}
        {activeTab === 'history' && (
          <div className="space-y-3">
            {eventsLoading ? (
              <p className="text-xs text-gray-400 italic text-center py-8">A carregar…</p>
            ) : (eventsPage?.events.length ?? 0) === 0 ? (
              <p className="text-xs text-gray-400 italic text-center py-8">Sem histórico para este budget.</p>
            ) : (
              <ol className="relative border-l border-gray-200 ml-1.5 space-y-4">
                {eventsPage!.events.map((ev) => (
                  <li key={ev.id} className="ml-4">
                    <span className="absolute -left-1.5 w-3 h-3 rounded-full bg-gray-300 border-2 border-white" />
                    <p className="text-sm text-gray-800">{formatBudgetEvent(ev.action, ev.payload)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(ev.createdAt).toLocaleString('pt-PT')} · {ev.actor ? `por ${ev.actor.name}` : 'Sistema'}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

      </div>

      {/* Modal de detalhe da transação */}
      <Modal
        open={selectedDocId !== null}
        onClose={() => setSelectedDocId(null)}
        title=""
        size="lg"
        hideHeader
        noPadding
      >
        {selectedDocId && (
          <DocDetailPanel
            docId={selectedDocId}
            docType={budget.type === 'EXPENSE' ? 'payable' : 'receivable'}
            variant="modal"
            onClose={() => setSelectedDocId(null)}
            onMutated={invalidate}
          />
        )}
      </Modal>
    </div>
  )
}
