import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import Modal from '@/components/ui/Modal'
import { Plus, Tag } from 'lucide-react'

interface Category { id: string; name: string; type: string; launchToc: boolean; color: string; isArchived: boolean }
interface Settings {
  reconciliationDryRun: boolean; autoMatchEnabled: boolean; syncIntervalMinutes: number
  lowBalanceEnabled: boolean; importFileRetentionDays: number
}

export default function SettingsPage() {
  const { selectedClientId } = useAuth()
  const qc = useQueryClient()
  const [tab, setTab] = useState<'categories' | 'settings'>('categories')
  const [showNewCat, setShowNewCat] = useState(false)
  const [newCat, setNewCat] = useState({ name: '', type: 'EXPENSE', launchToc: false, color: '#6b7280' })

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/categories`),
    enabled: !!selectedClientId,
  })

  const { data: settings } = useQuery<Settings>({
    queryKey: ['settings', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/settings`),
    enabled: !!selectedClientId,
  })

  const [settingsForm, setSettingsForm] = useState<Partial<Settings>>({})
  useEffect(() => { if (settings) setSettingsForm(settings) }, [settings])

  const createCat = useMutation({
    mutationFn: () => api.post(`/treasury/${selectedClientId}/categories`, newCat),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['categories'] }); setShowNewCat(false); setNewCat({ name: '', type: 'EXPENSE', launchToc: false, color: '#6b7280' }) },
  })

  const updateSettings = useMutation({
    mutationFn: () => api.patch(`/treasury/${selectedClientId}/settings`, settingsForm),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })

  const tabs = [
    { id: 'categories', label: 'Categorias' },
    { id: 'settings', label: 'Configurações' },
  ] as const

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Definições</h1>

      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t.id ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'categories' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">Gerencie as categorias de tesouraria e o flag "Lança no TOConline".</p>
            <button onClick={() => setShowNewCat(true)} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" />Nova Categoria</button>
          </div>

          <div className="card divide-y divide-gray-50">
            {['REVENUE', 'EXPENSE'].map((type) => (
              <div key={type}>
                <div className="px-5 py-3 bg-gray-50">
                  <span className="text-xs font-semibold text-gray-500 uppercase">{type === 'REVENUE' ? 'Receita' : 'Despesa'}</span>
                </div>
                {categories.filter((c) => c.type === type && !c.isArchived).map((c) => (
                  <div key={c.id} className="flex items-center gap-4 px-5 py-3">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-900">{c.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Tag className="w-3.5 h-3.5 text-gray-400" />
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.launchToc ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                        {c.launchToc ? 'Lança TOConline' : 'Apenas local'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <Modal open={showNewCat} onClose={() => setShowNewCat(false)} title="Nova Categoria">
            <div className="space-y-4">
              <div><label className="label">Nome</label><input className="input" value={newCat.name} onChange={(e) => setNewCat({ ...newCat, name: e.target.value })} /></div>
              <div>
                <label className="label">Tipo</label>
                <select className="input" value={newCat.type} onChange={(e) => setNewCat({ ...newCat, type: e.target.value })}>
                  <option value="REVENUE">Receita</option>
                  <option value="EXPENSE">Despesa</option>
                </select>
              </div>
              <div><label className="label">Cor</label><input type="color" className="h-9 w-20 rounded cursor-pointer border border-gray-300" value={newCat.color} onChange={(e) => setNewCat({ ...newCat, color: e.target.value })} /></div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="launchToc" checked={newCat.launchToc} onChange={(e) => setNewCat({ ...newCat, launchToc: e.target.checked })} className="rounded" />
                <label htmlFor="launchToc" className="text-sm text-gray-700">Lança no TOConline</label>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowNewCat(false)} className="btn-secondary flex-1">Cancelar</button>
                <button onClick={() => createCat.mutate()} className="btn-primary flex-1" disabled={createCat.isPending || !newCat.name}>
                  {createCat.isPending ? 'A guardar...' : 'Criar'}
                </button>
              </div>
            </div>
          </Modal>
        </div>
      )}

      {tab === 'settings' && (
        <div className="card p-6 space-y-6 max-w-xl">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Reconciliação</h3>
            <div className="space-y-3">
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={settingsForm.reconciliationDryRun ?? true} onChange={(e) => setSettingsForm({ ...settingsForm, reconciliationDryRun: e.target.checked })} className="rounded" />
                <span className="text-sm text-gray-700">Modo dry-run (não escreve no TOConline)</span>
              </label>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Sincronização TOConline</h3>
            <div>
              <label className="label">Intervalo de sincronização (minutos)</label>
              <input type="number" className="input w-32" value={settingsForm.syncIntervalMinutes ?? 15} min={5} max={1440} onChange={(e) => setSettingsForm({ ...settingsForm, syncIntervalMinutes: parseInt(e.target.value) })} />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Retenção de ficheiros</h3>
            <div>
              <label className="label">Dias de retenção dos ficheiros importados</label>
              <input type="number" className="input w-32" value={settingsForm.importFileRetentionDays ?? 30} min={7} max={365} onChange={(e) => setSettingsForm({ ...settingsForm, importFileRetentionDays: parseInt(e.target.value) })} />
            </div>
          </div>

          <button onClick={() => updateSettings.mutate()} className="btn-primary" disabled={updateSettings.isPending}>
            {updateSettings.isPending ? 'A guardar...' : 'Guardar configurações'}
          </button>
          {updateSettings.isSuccess && <p className="text-sm text-green-600">Configurações guardadas.</p>}
        </div>
      )}
    </div>
  )
}
