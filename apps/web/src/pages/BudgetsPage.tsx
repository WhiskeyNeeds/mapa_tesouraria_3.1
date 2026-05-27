import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import Modal from '@/components/ui/Modal'
import BudgetPanel from '@/components/budgets/BudgetPanel'
import { Plus, Wallet, TrendingUp, Pencil, Trash2, Archive, ArchiveRestore, AlertTriangle } from 'lucide-react'

interface BudgetProgress {
  paidAmount: number
  expectedAmount: number
  availableAmount: number
  totalAllocated: number
  overrunAmount: number
}

interface Budget {
  id: string
  name: string
  description: string | null
  type: 'REVENUE' | 'EXPENSE'
  status: 'ACTIVE' | 'ARCHIVED'
  totalAmount: number
  currency: string
  startDate: string
  endDate: string
  color: string | null
  icon: string | null
  progress: BudgetProgress
  pendingReviewCount: number
}

const emptyForm = {
  name: '',
  description: '',
  type: 'EXPENSE' as 'REVENUE' | 'EXPENSE',
  totalAmount: '',
  startDate: '',
  endDate: '',
  color: '#3B82F6',
}

export default function BudgetsPage() {
  const { selectedClientId } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()

  const [tab, setTab] = useState<'ALL' | 'REVENUE' | 'EXPENSE'>('ALL')
  const [showArchived, setShowArchived] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(null)

  const { data: budgets = [], isLoading } = useQuery<Budget[]>({
    queryKey: ['budgets', selectedClientId, showArchived],
    queryFn: () => api.get(`/treasury/${selectedClientId}/budgets${showArchived ? '?status=ARCHIVED' : '?status=ACTIVE'}`),
    enabled: !!selectedClientId,
  })

  const filtered = useMemo(() => {
    if (tab === 'ALL') return budgets
    return budgets.filter((b) => b.type === tab)
  }, [budgets, tab])

  const createBudget = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post(`/treasury/${selectedClientId}/budgets`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets', selectedClientId] })
      toast.success('Budget criado')
      setShowNew(false)
      setForm(emptyForm)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const updateBudget = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api.patch(`/treasury/${selectedClientId}/budgets/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets', selectedClientId] })
      toast.success('Budget atualizado')
      setEditId(null)
      setForm(emptyForm)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteBudget = useMutation({
    mutationFn: (id: string) => api.delete(`/treasury/${selectedClientId}/budgets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets', selectedClientId] })
      toast.success('Budget eliminado')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const toggleArchive = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'ARCHIVED' }) =>
      api.patch(`/treasury/${selectedClientId}/budgets/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets', selectedClientId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function startEdit(b: Budget) {
    setEditId(b.id)
    setForm({
      name: b.name,
      description: b.description ?? '',
      type: b.type,
      totalAmount: String(b.totalAmount),
      startDate: b.startDate.slice(0, 10),
      endDate: b.endDate.slice(0, 10),
      color: b.color ?? '#3B82F6',
    })
  }

  function submitForm() {
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      type: form.type,
      totalAmount: parseFloat(form.totalAmount) || 0,
      startDate: form.startDate,
      endDate: form.endDate,
      color: form.color,
    }
    if (editId) {
      const { type: _t, ...editPayload } = payload
      updateBudget.mutate({ id: editId, payload: editPayload })
    } else {
      createBudget.mutate(payload)
    }
  }

  const totalsByType = useMemo(() => {
    const acc = { REVENUE: { total: 0, paid: 0, expected: 0 }, EXPENSE: { total: 0, paid: 0, expected: 0 } }
    for (const b of budgets) {
      acc[b.type].total += b.totalAmount
      acc[b.type].paid += b.progress.paidAmount
      acc[b.type].expected += b.progress.expectedAmount
    }
    return acc
  }, [budgets])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Budgets</h1>
          <p className="text-sm text-gray-500 mt-1">Controla o progresso de gastos e receitas alocadas.</p>
        </div>
        <button onClick={() => { setForm(emptyForm); setEditId(null); setShowNew(true) }} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Novo Budget
        </button>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SummaryCard
          label="Despesas planeadas"
          icon={<Wallet className="w-4 h-4 text-rose-500" />}
          total={totalsByType.EXPENSE.total}
          paid={totalsByType.EXPENSE.paid}
          expected={totalsByType.EXPENSE.expected}
          tone="expense"
        />
        <SummaryCard
          label="Receitas planeadas"
          icon={<TrendingUp className="w-4 h-4 text-emerald-500" />}
          total={totalsByType.REVENUE.total}
          paid={totalsByType.REVENUE.paid}
          expected={totalsByType.REVENUE.expected}
          tone="revenue"
        />
      </div>

      {/* Filtros */}
      <div className="flex items-center justify-between border-b border-gray-200">
        <div className="flex gap-1">
          {[
            { v: 'ALL', label: 'Todos' },
            { v: 'EXPENSE', label: 'Despesas' },
            { v: 'REVENUE', label: 'Receitas' },
          ].map((t) => (
            <button
              key={t.v}
              onClick={() => setTab(t.v as 'ALL' | 'REVENUE' | 'EXPENSE')}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.v ? 'border-primary-500 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer pb-2">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="rounded" />
          Mostrar arquivados
        </label>
      </div>

      {/* Lista + Painel */}
      <div className="flex gap-0">
        <div className={`flex-1 min-w-0 space-y-3 ${selectedBudgetId ? 'pr-4' : ''}`}>
          {isLoading ? (
            <div className="text-center py-12 text-gray-500">A carregar...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-xl">
              <p className="text-gray-500 text-sm">Sem budgets para mostrar.</p>
            </div>
          ) : (
            filtered.map((b) => (
              <BudgetCard
                key={b.id}
                budget={b}
                selected={selectedBudgetId === b.id}
                onClick={() => setSelectedBudgetId(b.id === selectedBudgetId ? null : b.id)}
                onEdit={() => { startEdit(b); setSelectedBudgetId(null) }}
                onDelete={() => {
                  if (confirm(`Eliminar budget "${b.name}"?`)) {
                    deleteBudget.mutate(b.id)
                    setSelectedBudgetId(null)
                  }
                }}
                onToggleArchive={() => toggleArchive.mutate({ id: b.id, status: b.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE' })}
              />
            ))
          )}
        </div>

        {selectedBudgetId && (
          <BudgetPanel
            budgetId={selectedBudgetId}
            onClose={() => setSelectedBudgetId(null)}
            onEdit={() => {
              const b = filtered.find((x) => x.id === selectedBudgetId)
              if (b) startEdit(b)
            }}
            onDelete={() => {
              const b = filtered.find((x) => x.id === selectedBudgetId)
              if (b && confirm(`Eliminar budget "${b.name}"?`)) {
                deleteBudget.mutate(b.id)
                setSelectedBudgetId(null)
              }
            }}
          />
        )}
      </div>

      {/* Modal Criar/Editar */}
      <Modal
        open={showNew || editId !== null}
        onClose={() => { setShowNew(false); setEditId(null); setForm(emptyForm) }}
        title={editId ? 'Editar Budget' : 'Novo Budget'}
        size="md"
      >
        <div className="space-y-4">
          <div>
            <label className="label">Nome <span className="text-red-500">*</span></label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Marketing Q1 2026" />
          </div>

          {!editId && (
            <div>
              <label className="label">Tipo <span className="text-red-500">*</span></label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setForm({ ...form, type: 'EXPENSE' })}
                  className={`p-3 border rounded-lg text-sm font-medium transition-colors ${
                    form.type === 'EXPENSE' ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Despesa (gastos)
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, type: 'REVENUE' })}
                  className={`p-3 border rounded-lg text-sm font-medium transition-colors ${
                    form.type === 'REVENUE' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Receita (objetivo)
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Valor total (€) <span className="text-red-500">*</span></label>
              <input type="number" step="0.01" className="input" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} placeholder="0.00" />
            </div>
            <div>
              <label className="label">Cor</label>
              <input type="color" className="input h-10 p-1" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Data início <span className="text-red-500">*</span></label>
              <input type="date" className="input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div>
              <label className="label">Data fim <span className="text-red-500">*</span></label>
              <input type="date" className="input" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
          </div>

          <div>
            <label className="label">Descrição</label>
            <textarea className="input min-h-[60px]" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Detalhes opcionais..." />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={() => { setShowNew(false); setEditId(null); setForm(emptyForm) }} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={submitForm}
              disabled={
                createBudget.isPending || updateBudget.isPending ||
                !form.name.trim() || !form.totalAmount || !form.startDate || !form.endDate
              }
              className="btn-primary flex-1"
            >
              {editId ? 'Guardar' : 'Criar'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function SummaryCard({ label, icon, total, paid, expected, tone }: {
  label: string
  icon: React.ReactNode
  total: number
  paid: number
  expected: number
  tone: 'expense' | 'revenue'
}) {
  const allocated = paid + expected
  const pct = total > 0 ? Math.min(100, (allocated / total) * 100) : 0
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="text-sm font-medium text-gray-600">{label}</span>
      </div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-2xl font-semibold text-gray-900">{formatCurrency(total)}</span>
        <span className="text-xs text-gray-500">{pct.toFixed(0)}% alocado</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${tone === 'expense' ? 'bg-rose-400' : 'bg-emerald-400'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function BudgetCard({ budget, selected, onClick, onEdit, onDelete, onToggleArchive }: {
  budget: Budget
  selected: boolean
  onClick: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleArchive: () => void
}) {
  const { progress, totalAmount } = budget
  const paidPct = totalAmount > 0 ? (progress.paidAmount / totalAmount) * 100 : 0
  const expectedPct = totalAmount > 0 ? (progress.expectedAmount / totalAmount) * 100 : 0
  const overrun = progress.availableAmount < 0
  const color = budget.color || (budget.type === 'EXPENSE' ? '#3B82F6' : '#10B981')

  // Saturação do tom: a parte "paid" usa a cor cheia, "expected" um tom mais claro (alpha)
  const paidColor = color
  const expectedColor = `${color}55`

  return (
    <div
      className={`bg-white border rounded-xl p-5 cursor-pointer transition-all ${
        selected ? 'border-primary-400 ring-1 ring-primary-300' : overrun ? 'border-rose-300 bg-rose-50/30' : 'border-gray-200 hover:border-gray-300'
      }`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${color}1A` }}
          >
            <Wallet className="w-4.5 h-4.5" style={{ color }} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold text-gray-900 truncate">{budget.name}</h3>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                budget.type === 'EXPENSE' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'
              }`}>
                {budget.type === 'EXPENSE' ? 'Despesa' : 'Receita'}
              </span>
              {budget.status === 'ARCHIVED' && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">Arquivado</span>
              )}
              {overrun && (
                <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-rose-100 text-rose-700">
                  <AlertTriangle className="w-3 h-3" />
                  + {formatCurrency(progress.overrunAmount)}
                </span>
              )}
              {budget.pendingReviewCount > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
                  {budget.pendingReviewCount} para rever
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {formatDate(budget.startDate)} → {formatDate(budget.endDate)}
            </p>
            {budget.description && (
              <p className="text-xs text-gray-500 mt-1.5 line-clamp-2">{budget.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-start gap-3 flex-shrink-0">
          <div className="text-right">
            <p className="text-xs text-gray-500">Budget</p>
            <p className="text-lg font-semibold text-gray-900">{formatCurrency(totalAmount)}</p>
          </div>
          <div className="flex items-center gap-0.5">
            <button onClick={(e) => { e.stopPropagation(); onEdit() }} className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100" title="Editar">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onToggleArchive() }} className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100" title={budget.status === 'ACTIVE' ? 'Arquivar' : 'Reativar'}>
              {budget.status === 'ACTIVE' ? <Archive className="w-3.5 h-3.5" /> : <ArchiveRestore className="w-3.5 h-3.5" />}
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete() }} className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-rose-600 hover:bg-rose-50" title="Eliminar">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Progress bar com dois segmentos */}
      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden flex mb-3">
        <div style={{ width: `${Math.min(100, paidPct)}%`, backgroundColor: paidColor }} className="h-full transition-all" />
        <div style={{ width: `${Math.max(0, Math.min(100 - paidPct, expectedPct))}%`, backgroundColor: expectedColor }} className="h-full transition-all" />
      </div>

      {/* Legenda */}
      <div className="grid grid-cols-3 gap-4 text-sm">
        <Legend
          dotColor={paidColor}
          label={budget.type === 'EXPENSE' ? 'Pago' : 'Recebido'}
          value={formatCurrency(progress.paidAmount)}
        />
        <Legend
          dotColor={expectedColor}
          label="Previsto"
          value={formatCurrency(progress.expectedAmount)}
          align="center"
        />
        <Legend
          dotColor="#E5E7EB"
          label={overrun ? 'Excedido' : 'Disponível'}
          value={formatCurrency(Math.abs(progress.availableAmount))}
          align="right"
          valueClassName={overrun ? 'text-rose-600' : undefined}
        />
      </div>
    </div>
  )
}

function Legend({ dotColor, label, value, align = 'left', valueClassName }: {
  dotColor: string
  label: string
  value: string
  align?: 'left' | 'center' | 'right'
  valueClassName?: string
}) {
  const alignment = align === 'center' ? 'items-center text-center' : align === 'right' ? 'items-end text-right' : 'items-start'
  return (
    <div className={`flex flex-col ${alignment}`}>
      <div className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: dotColor }} />
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <span className={`mt-0.5 text-sm font-medium text-gray-900 ${valueClassName ?? ''}`}>{value}</span>
    </div>
  )
}
