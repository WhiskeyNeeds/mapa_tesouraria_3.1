// apps/web/src/components/settings/BudgetRulesTab.tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import Modal from '@/components/ui/Modal'
import { Plus, Trash2 } from 'lucide-react'

interface Rule {
  id: string
  textPattern: string | null
  budget: { id: string; name: string; type: 'REVENUE' | 'EXPENSE' }
  category: { id: string; name: string; color: string | null }
}
interface Budget { id: string; name: string; type: 'REVENUE' | 'EXPENSE'; status: string }
interface Category { id: string; name: string; type: 'REVENUE' | 'EXPENSE'; color: string | null }

export default function BudgetRulesTab() {
  const { selectedClientId } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState({ budgetId: '', categoryId: '', textPattern: '' })

  const { data: rules = [] } = useQuery<Rule[]>({
    queryKey: ['budget-rules', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/budget-rules`),
    enabled: !!selectedClientId,
  })

  const { data: budgets = [] } = useQuery<Budget[]>({
    queryKey: ['budgets-active', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/budgets?status=ACTIVE`),
    enabled: !!selectedClientId && showNew,
  })

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/categories`),
    enabled: !!selectedClientId && showNew,
  })

  const selectedBudget = budgets.find((b) => b.id === form.budgetId)
  const availableCategories = categories.filter((c) => !selectedBudget || c.type === selectedBudget.type)

  const createMut = useMutation({
    mutationFn: () => api.post(`/treasury/${selectedClientId}/budget-rules`, {
      budgetId: form.budgetId,
      categoryId: form.categoryId,
      textPattern: form.textPattern || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-rules', selectedClientId] })
      setShowNew(false)
      setForm({ budgetId: '', categoryId: '', textPattern: '' })
      toast.success('Regra criada')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/treasury/${selectedClientId}/budget-rules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-rules', selectedClientId] })
      toast.success('Regra eliminada')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">Associação automática de transações a budgets por categoria e filtro de texto.</p>
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Nova regra
        </button>
      </div>

      <div className="card overflow-hidden">
        {rules.length === 0 ? (
          <div className="px-5 py-8 text-xs text-gray-400 italic text-center">
            Sem regras de budget. Cria uma regra para associar automaticamente transações a budgets.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
                <th className="text-left px-4 py-3">Budget</th>
                <th className="text-left px-4 py-3">Categoria</th>
                <th className="text-left px-4 py-3">Filtro de texto</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{rule.budget.name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded font-medium bg-blue-50 text-blue-700">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: rule.category.color ?? '#9CA3AF' }} />
                      {rule.category.name}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {rule.textPattern
                      ? <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">"{rule.textPattern}"</span>
                      : <span className="text-gray-400 text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { if (confirm('Eliminar esta regra?')) deleteMut.mutate(rule.id) }}
                      className="p-1 text-gray-400 hover:text-rose-600 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        💡 Regras com filtro de texto têm prioridade sobre regras só por categoria. Em empate, a regra mais recente prevalece.
      </p>

      <Modal open={showNew} onClose={() => setShowNew(false)} title="Nova Regra de Budget">
        <div className="space-y-4">
          <div>
            <label className="label">Budget *</label>
            <select
              className="input"
              value={form.budgetId}
              onChange={(e) => setForm({ ...form, budgetId: e.target.value, categoryId: '' })}
            >
              <option value="">Seleccionar budget...</option>
              {budgets.map((b) => (
                <option key={b.id} value={b.id}>{b.name} ({b.type === 'EXPENSE' ? 'Despesa' : 'Receita'})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Categoria *</label>
            <select
              className="input"
              value={form.categoryId}
              onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              disabled={!form.budgetId}
            >
              <option value="">Seleccionar categoria...</option>
              {availableCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {form.budgetId && availableCategories.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">Sem categorias do tipo compatível com este budget.</p>
            )}
          </div>
          <div>
            <label className="label">Filtro de texto (opcional)</label>
            <input
              className="input"
              placeholder='ex: "Meo", "NOS", "EDP"'
              value={form.textPattern}
              onChange={(e) => setForm({ ...form, textPattern: e.target.value })}
            />
            <p className="text-xs text-gray-400 mt-1">Verificado na descrição e no nome da contraparte (case-insensitive).</p>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setShowNew(false)} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={() => createMut.mutate()}
              disabled={!form.budgetId || !form.categoryId || createMut.isPending}
              className="btn-primary flex-1"
            >
              Criar regra
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
