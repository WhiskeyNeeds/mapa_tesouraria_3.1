import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import Modal from '@/components/ui/Modal'
import { Plus, Pencil, Archive, RotateCcw, Trash2 } from 'lucide-react'

interface BudgetCategory {
  id: string
  name: string
  type: 'REVENUE' | 'EXPENSE'
  color: string | null
  icon: string | null
  isArchived: boolean
  usageCount: number
}

const emptyForm = { name: '', type: 'EXPENSE' as 'EXPENSE' | 'REVENUE', color: '#6b7280' }

export default function BudgetCategoriesTab({ showArchived }: { showArchived: boolean }) {
  const { selectedClientId } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()

  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<BudgetCategory | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [editForm, setEditForm] = useState({ name: '', color: '#6b7280' })

  const { data: items = [] } = useQuery<BudgetCategory[]>({
    queryKey: ['budget-categories', selectedClientId, showArchived],
    queryFn: () => api.get(`/treasury/${selectedClientId}/budget-categories${showArchived ? '?includeArchived=true' : ''}`),
    enabled: !!selectedClientId,
  })

  const createMut = useMutation({
    mutationFn: () => api.post(`/treasury/${selectedClientId}/budget-categories`, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-categories'] })
      setShowNew(false)
      setForm(emptyForm)
      toast.success('Categoria de budget criada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const updateMut = useMutation({
    mutationFn: () => api.patch(`/treasury/${selectedClientId}/budget-categories/${editing?.id}`, editForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-categories'] })
      setEditing(null)
      toast.success('Categoria atualizada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const archiveMut = useMutation({
    mutationFn: (id: string) => api.patch(`/treasury/${selectedClientId}/budget-categories/${id}`, { isArchived: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-categories'] })
      toast.success('Categoria arquivada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const restoreMut = useMutation({
    mutationFn: (id: string) => api.patch(`/treasury/${selectedClientId}/budget-categories/${id}`, { isArchived: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-categories'] })
      toast.success('Categoria restaurada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/treasury/${selectedClientId}/budget-categories/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budget-categories'] })
      toast.success('Categoria eliminada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  return (
    <>
      <div className="flex justify-end">
        <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Nova categoria de budget
        </button>
      </div>

      <div className="card divide-y divide-gray-50">
        {(['REVENUE', 'EXPENSE'] as const).map((type) => {
          const filtered = items.filter((c) => c.type === type && (showArchived ? true : !c.isArchived))
          return (
            <div key={type}>
              <div className="px-5 py-3 bg-gray-50">
                <span className="text-xs font-semibold text-gray-500 uppercase">
                  {type === 'REVENUE' ? 'Receita' : 'Despesa'}
                </span>
              </div>
              {filtered.length === 0 ? (
                <div className="px-5 py-4 text-xs text-gray-400 italic">Sem categorias.</div>
              ) : filtered.map((c) => (
                <div key={c.id} className={`flex items-center gap-4 px-5 py-3 group ${c.isArchived ? 'opacity-50' : ''}`}>
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.color ?? '#9CA3AF' }} />
                  <div className="flex-1">
                    <span className="text-sm font-medium text-gray-900">{c.name}</span>
                    {c.isArchived && <span className="ml-2 text-xs text-gray-400">arquivada</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    {c.usageCount > 0 && (
                      <span className="text-xs text-gray-400">{c.usageCount} fat.</span>
                    )}
                    {c.isArchived ? (
                      <button
                        onClick={() => restoreMut.mutate(c.id)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-green-600 rounded transition-all"
                        title="Restaurar"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={() => { setEditing(c); setEditForm({ name: c.name, color: c.color ?? '#6b7280' }) }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-primary-600 rounded transition-all"
                          title="Editar"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => { if (confirm(`Arquivar categoria de budget "${c.name}"?`)) archiveMut.mutate(c.id) }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-amber-600 rounded transition-all"
                          title="Arquivar"
                        >
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => { if (confirm(`Eliminar permanentemente "${c.name}"? Esta ação não pode ser desfeita.`)) deleteMut.mutate(c.id) }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-600 rounded transition-all"
                          title="Eliminar"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <Modal open={showNew} onClose={() => { setShowNew(false); setForm(emptyForm) }} title="Nova Categoria de Budget">
        <div className="space-y-4">
          <div><label className="label">Nome</label><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div>
            <label className="label">Tipo</label>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'EXPENSE' | 'REVENUE' })}>
              <option value="REVENUE">Receita</option>
              <option value="EXPENSE">Despesa</option>
            </select>
          </div>
          <div><label className="label">Cor</label><input type="color" className="h-9 w-20 rounded cursor-pointer border border-gray-300" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => { setShowNew(false); setForm(emptyForm) }} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={() => createMut.mutate()} className="btn-primary flex-1" disabled={createMut.isPending || !form.name.trim()}>
              {createMut.isPending ? 'A guardar...' : 'Criar'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Editar Categoria de Budget">
        <div className="space-y-4">
          <div><label className="label">Nome</label><input className="input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
          <div className="flex items-center gap-4">
            <div>
              <label className="label">Cor</label>
              <input type="color" className="h-9 w-20 rounded cursor-pointer border border-gray-300" value={editForm.color} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })} />
            </div>
            <div className="w-4 h-4 rounded-full mt-5 flex-shrink-0" style={{ backgroundColor: editForm.color }} />
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setEditing(null)} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={() => updateMut.mutate()} className="btn-primary flex-1" disabled={updateMut.isPending || !editForm.name.trim()}>
              {updateMut.isPending ? 'A guardar...' : 'Guardar'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
