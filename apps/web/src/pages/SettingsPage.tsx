import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useTheme } from '@/contexts/ThemeContext'
import Modal from '@/components/ui/Modal'
import { Plus, CheckCircle, AlertCircle, Clock, Unplug, ExternalLink, PlugZap, Copy, Check, Trash2, Pencil, Archive, RotateCcw, Sun, Moon } from 'lucide-react'
import { formatDatetime } from '@/lib/utils'
import BudgetRulesTab from '@/components/settings/BudgetRulesTab'
import DunningTracksTab from '@/components/settings/DunningTracksTab'

interface Category { id: string; name: string; type: string; color: string; isArchived: boolean; usageCount: number }
interface Settings {
  reconciliationDryRun: boolean; autoMatchEnabled: boolean; autoMatchThreshold: number
  syncIntervalMinutes: number; lowBalanceEnabled: boolean; importFileRetentionDays: number
}
interface ToconlineConfig {
  id?: string; clientId?: string; oauthUrl?: string; baseUrl?: string; tocClientId?: string
  tokenExpiresAt?: string | null; status?: 'UNCONFIGURED' | 'PENDING_AUTH' | 'ACTIVE' | 'ERROR'
  lastError?: string | null; createdAt?: string; updatedAt?: string; callbackUri: string
}

export default function SettingsPage() {
  const { selectedClientId, isTocEnabled, setIsTocEnabled } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const qc = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState<'categories' | 'settings' | 'toconline' | 'dunning'>('settings')
  const [showNewCat, setShowNewCat] = useState(false)
  const [newCat, setNewCat] = useState({ name: '', type: 'EXPENSE', color: '#6b7280' })
  const [editCat, setEditCat] = useState<Category | null>(null)
  const [editCatForm, setEditCatForm] = useState({ name: '', color: '#6b7280' })
  const [showArchived, setShowArchived] = useState(false)
  const [categoriesSubTab, setCategoriesSubTab] = useState<'movements' | 'budgets'>('movements')

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories', selectedClientId, showArchived],
    queryFn: () => api.get(`/treasury/${selectedClientId}/categories${showArchived ? '?includeArchived=true' : ''}`),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      setShowNewCat(false)
      setNewCat({ name: '', type: 'EXPENSE', color: '#6b7280' })
      toast.success('Categoria criada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const updateCat = useMutation({
    mutationFn: () => api.patch(`/treasury/${selectedClientId}/categories/${editCat?.id}`, editCatForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['categories-all'] })
      setEditCat(null)
      toast.success('Categoria atualizada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const deleteCat = useMutation({
    mutationFn: (id: string) => api.delete(`/treasury/${selectedClientId}/categories/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['categories-all'] })
      toast.success('Categoria eliminada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const archiveCat = useMutation({
    mutationFn: (id: string) => api.patch(`/treasury/${selectedClientId}/categories/${id}`, { isArchived: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['categories-all'] })
      toast.success('Categoria arquivada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const restoreCat = useMutation({
    mutationFn: (id: string) => api.patch(`/treasury/${selectedClientId}/categories/${id}`, { isArchived: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['categories-all'] })
      toast.success('Categoria restaurada.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const updateSettings = useMutation({
    mutationFn: () => api.patch(`/treasury/${selectedClientId}/settings`, settingsForm),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })

  // TOConline
  const { data: tocConfig, isLoading: tocLoading } = useQuery<ToconlineConfig | null>({
    queryKey: ['toconline-config', selectedClientId],
    queryFn: () => api.get(`/toconline/config/${selectedClientId}`),
    enabled: !!selectedClientId,
    retry: false,
  })

  const [tocForm, setTocForm] = useState({ oauthUrl: '', baseUrl: '', tocClientId: '', tocClientSecret: '' })
  const [tocSuccess, setTocSuccess] = useState(false)
  const [copiedCallback, setCopiedCallback] = useState(false)
  const [tokenForm, setTokenForm] = useState({ accessToken: '', refreshToken: '', expiresIn: '' })

  useEffect(() => {
    if (tocConfig?.id) {
      setTocForm((f) => ({ ...f, oauthUrl: tocConfig.oauthUrl ?? '', baseUrl: tocConfig.baseUrl ?? '', tocClientId: tocConfig.tocClientId ?? '' }))
    }
  }, [tocConfig])

  // Detect OAuth callback success — via URL param (same tab) or postMessage (new tab/popup)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('toconline') === 'success') {
      setTab('toconline')
      setTocSuccess(true)
      qc.invalidateQueries({ queryKey: ['toconline-config'] })
      window.history.replaceState({}, '', window.location.pathname)
    }

    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return
      if (e.data?.type === 'toconline-auth-success') {
        setTab('toconline')
        setTocSuccess(true)
        qc.invalidateQueries({ queryKey: ['toconline-config'] })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [qc])

  const saveTocCreds = useMutation({
    mutationFn: () => {
      const payload: Record<string, string> = { oauthUrl: tocForm.oauthUrl, baseUrl: tocForm.baseUrl, tocClientId: tocForm.tocClientId }
      if (tocForm.tocClientSecret) payload.tocClientSecret = tocForm.tocClientSecret
      return api.put(`/toconline/config/${selectedClientId}`, payload)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['toconline-config'] }); setTocForm((f) => ({ ...f, tocClientSecret: '' })) },
  })

  const startTocAuth = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ url: string }>(`/toconline/config/${selectedClientId}/auth`)
      window.open(res.url, '_blank', 'noopener,noreferrer')
    },
  })

  const revokeToc = useMutation({
    mutationFn: () => api.delete(`/toconline/config/${selectedClientId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['toconline-config'] }); setTocSuccess(false) },
  })

  const setTokensManually = useMutation({
    mutationFn: () => api.put(`/toconline/config/${selectedClientId}/tokens`, {
      accessToken: tokenForm.accessToken,
      ...(tokenForm.refreshToken ? { refreshToken: tokenForm.refreshToken } : {}),
      ...(tokenForm.expiresIn ? { expiresIn: parseInt(tokenForm.expiresIn) } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['toconline-config'] })
      setTokenForm({ accessToken: '', refreshToken: '', expiresIn: '' })
      setTocSuccess(true)
    },
  })

  const tabs = [
    { id: 'settings', label: 'Configurações' },
    { id: 'categories', label: 'Categorias' },
    { id: 'dunning', label: 'Réguas de Cobrança' },
    { id: 'toconline', label: 'TOConline' },
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
          {/* Sub-separadores: Movimentos | Budgets */}
          <div className="flex items-center justify-between">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setCategoriesSubTab('movements')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${categoriesSubTab === 'movements' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Movimentos/Faturas
              </button>
              <button
                onClick={() => setCategoriesSubTab('budgets')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${categoriesSubTab === 'budgets' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                Budgets
              </button>
            </div>
            <button
              onClick={() => setShowArchived((v) => !v)}
              className={`text-xs font-medium px-2 py-1 rounded-lg border transition-colors ${showArchived ? 'bg-gray-100 border-gray-300 text-gray-700' : 'border-gray-200 text-gray-400 hover:text-gray-600'}`}
            >
              {showArchived ? 'Ocultar arquivadas' : 'Mostrar arquivadas'}
            </button>
          </div>

          {categoriesSubTab === 'budgets' ? (
            <BudgetRulesTab />
          ) : (
            <>
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">Categorias usadas para classificar movimentos bancários, faturas e contas.</p>
            <button onClick={() => setShowNewCat(true)} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" />Nova Categoria</button>
          </div>

          <div className="card divide-y divide-gray-50">
            {['REVENUE', 'EXPENSE'].map((type) => (
              <div key={type}>
                <div className="px-5 py-3 bg-gray-50">
                  <span className="text-xs font-semibold text-gray-500 uppercase">{type === 'REVENUE' ? 'Receita' : 'Despesa'}</span>
                </div>
                {categories.filter((c) => c.type === type && (showArchived ? true : !c.isArchived)).map((c) => (
                  <div key={c.id} className={`flex items-center gap-4 px-5 py-3 group ${c.isArchived ? 'opacity-50' : ''}`}>
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                    <div className="flex-1">
                      <span className="text-sm font-medium text-gray-900">{c.name}</span>
                      {c.isArchived && <span className="ml-2 text-xs text-gray-400">arquivada</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {c.usageCount > 0 && (
                        <span className="text-xs text-gray-400">{c.usageCount} mov.</span>
                      )}
                      {c.isArchived ? (
                        <button
                          onClick={() => restoreCat.mutate(c.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-green-600 rounded transition-all"
                          title="Restaurar"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => { setEditCat(c); setEditCatForm({ name: c.name, color: c.color }) }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-primary-600 rounded transition-all"
                            title="Editar"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => { if (confirm(`Arquivar categoria "${c.name}"?`)) archiveCat.mutate(c.id) }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-amber-600 rounded transition-all"
                            title="Arquivar"
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => { if (confirm(`Eliminar permanentemente "${c.name}"? Esta ação não pode ser desfeita.`)) deleteCat.mutate(c.id) }}
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
              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowNewCat(false)} className="btn-secondary flex-1">Cancelar</button>
                <button onClick={() => createCat.mutate()} className="btn-primary flex-1" disabled={createCat.isPending || !newCat.name}>
                  {createCat.isPending ? 'A guardar...' : 'Criar'}
                </button>
              </div>
            </div>
          </Modal>

          <Modal open={!!editCat} onClose={() => setEditCat(null)} title="Editar Categoria">
            <div className="space-y-4">
              <div><label className="label">Nome</label><input className="input" value={editCatForm.name} onChange={(e) => setEditCatForm({ ...editCatForm, name: e.target.value })} /></div>
              <div className="flex items-center gap-4">
                <div>
                  <label className="label">Cor</label>
                  <input type="color" className="h-9 w-20 rounded cursor-pointer border border-gray-300" value={editCatForm.color} onChange={(e) => setEditCatForm({ ...editCatForm, color: e.target.value })} />
                </div>
                <div className="w-4 h-4 rounded-full mt-5 flex-shrink-0" style={{ backgroundColor: editCatForm.color }} />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditCat(null)} className="btn-secondary flex-1">Cancelar</button>
                <button onClick={() => updateCat.mutate()} className="btn-primary flex-1" disabled={updateCat.isPending || !editCatForm.name}>
                  {updateCat.isPending ? 'A guardar...' : 'Guardar'}
                </button>
              </div>
            </div>
          </Modal>
            </>
          )}
        </div>
      )}

      {tab === 'dunning' && selectedClientId && (
        <DunningTracksTab clientId={selectedClientId} />
      )}

      {tab === 'toconline' && (
        <div className="space-y-6 max-w-xl">
          {/* TOConline enable toggle */}
          <div className="card px-5 py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-900">Integração TOConline</p>
              <p className="text-xs text-gray-500 mt-0.5">Desligar permite usar a aplicação sem credenciais TOConline ativas.</p>
            </div>
            <button
              onClick={() => setIsTocEnabled(!isTocEnabled)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isTocEnabled ? 'bg-primary-600' : 'bg-gray-200'}`}
              role="switch"
              aria-checked={isTocEnabled}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${isTocEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Status banner */}
          {tocSuccess && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 border border-green-200">
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
              <p className="text-sm text-green-700 font-medium">Ligação ao TOConline estabelecida com sucesso!</p>
            </div>
          )}

          {!tocLoading && tocConfig?.id && (() => {
            const status = tocConfig.status ?? 'UNCONFIGURED'
            const statusConfig = {
              UNCONFIGURED: { label: 'Não configurado', icon: <Clock className="w-4 h-4" />, cls: 'bg-gray-100 text-gray-600' },
              PENDING_AUTH:  { label: 'A aguardar autorização', icon: <Clock className="w-4 h-4" />, cls: 'bg-yellow-100 text-yellow-700' },
              ACTIVE:        { label: 'Ativo', icon: <CheckCircle className="w-4 h-4" />, cls: 'bg-green-100 text-green-700' },
              ERROR:         { label: 'Erro', icon: <AlertCircle className="w-4 h-4" />, cls: 'bg-red-100 text-red-700' },
            }[status]

            return (
              <div className="card p-5 space-y-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-900">Estado da ligação</h3>
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${statusConfig.cls}`}>
                    {statusConfig.icon}{statusConfig.label}
                  </span>
                </div>

                {status === 'ACTIVE' && tocConfig?.tokenExpiresAt && (
                  <p className="text-xs text-gray-500">Token expira em: <span className="font-medium text-gray-700">{formatDatetime(tocConfig.tokenExpiresAt)}</span></p>
                )}
                {status === 'ERROR' && tocConfig?.lastError && (
                  <div className="flex items-start gap-2 p-3 bg-red-50 rounded-lg border border-red-200">
                    <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-red-700">{tocConfig.lastError}</p>
                  </div>
                )}

                <div className="flex gap-3">
                  {(status === 'UNCONFIGURED' || status === 'PENDING_AUTH' || status === 'ERROR') && (
                    <button
                      onClick={() => startTocAuth.mutate()}
                      disabled={startTocAuth.isPending}
                      className="btn-primary flex items-center gap-2"
                    >
                      <ExternalLink className="w-4 h-4" />
                      {startTocAuth.isPending ? 'A abrir...' : 'Iniciar ligação OAuth'}
                    </button>
                  )}
                  {status === 'ACTIVE' && (
                    <button
                      onClick={() => startTocAuth.mutate()}
                      disabled={startTocAuth.isPending}
                      className="btn-secondary flex items-center gap-2"
                    >
                      <PlugZap className="w-4 h-4" />
                      {startTocAuth.isPending ? 'A abrir...' : 'Renovar autorização'}
                    </button>
                  )}
                  <button
                      onClick={() => { if (confirm('Tem a certeza que pretende remover a configuração TOConline?')) revokeToc.mutate() }}
                      disabled={revokeToc.isPending}
                      className="btn-secondary flex items-center gap-2 text-red-600 hover:text-red-700"
                    >
                      <Unplug className="w-4 h-4" />
                      {revokeToc.isPending ? 'A remover...' : 'Desligar'}
                    </button>
                </div>
              </div>
            )
          })()}

          {/* Credentials form */}
          <div className="card p-5 space-y-4">
            <h3 className="text-sm font-semibold text-gray-900">Credenciais TOConline</h3>
            <p className="text-xs text-gray-500">Introduza os dados da aplicação OAuth registada no portal TOConline. O segredo do cliente é guardado de forma encriptada.</p>

            <div>
              <label className="label">URL OAuth <span className="text-gray-400 font-normal">(ex: https://identity.toconline.pt)</span></label>
              <input className="input" placeholder="https://identity.toconline.pt" value={tocForm.oauthUrl} onChange={(e) => setTocForm({ ...tocForm, oauthUrl: e.target.value })} />
            </div>
            <div>
              <label className="label">URL da API <span className="text-gray-400 font-normal">(ex: https://api.toconline.pt)</span></label>
              <input className="input" placeholder="https://api.toconline.pt" value={tocForm.baseUrl} onChange={(e) => setTocForm({ ...tocForm, baseUrl: e.target.value })} />
            </div>
            <div>
              <label className="label">Client ID</label>
              <input className="input font-mono text-sm" placeholder="client_id da aplicação" value={tocForm.tocClientId} onChange={(e) => setTocForm({ ...tocForm, tocClientId: e.target.value })} />
            </div>
            <div>
              <label className="label">Client Secret {tocConfig?.id && <span className="text-gray-400 font-normal">(deixe em branco para manter o atual)</span>}</label>
              <input type="password" className="input font-mono text-sm" placeholder={tocConfig?.id ? '••••••••' : 'client_secret da aplicação'} value={tocForm.tocClientSecret} onChange={(e) => setTocForm({ ...tocForm, tocClientSecret: e.target.value })} />
            </div>

            <div className="flex items-center gap-4 pt-1">
              <button
                onClick={() => saveTocCreds.mutate()}
                disabled={saveTocCreds.isPending || !tocForm.oauthUrl || !tocForm.baseUrl || !tocForm.tocClientId || (!tocConfig?.id && !tocForm.tocClientSecret)}
                className="btn-primary"
              >
                {saveTocCreds.isPending ? 'A guardar...' : 'Guardar credenciais'}
              </button>
              {saveTocCreds.isSuccess && <p className="text-sm text-green-600">Credenciais guardadas.</p>}
              {saveTocCreds.isError && <p className="text-sm text-red-600">{(saveTocCreds.error as Error).message}</p>}
            </div>
          </div>

          {/* Manual token injection */}
          {tocConfig?.id && (
            <div className="card p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Inserir tokens manualmente</h3>
                <p className="text-xs text-gray-500 mt-1">Use o Postman para obter os tokens OAuth e insira-os aqui. O access token é obrigatório.</p>
              </div>
              <div>
                <label className="label">Access Token</label>
                <textarea className="input font-mono text-xs resize-none" rows={3} placeholder="eyJ..." value={tokenForm.accessToken} onChange={(e) => setTokenForm({ ...tokenForm, accessToken: e.target.value })} />
              </div>
              <div>
                <label className="label">Refresh Token <span className="text-gray-400 font-normal">(opcional)</span></label>
                <textarea className="input font-mono text-xs resize-none" rows={2} placeholder="eyJ..." value={tokenForm.refreshToken} onChange={(e) => setTokenForm({ ...tokenForm, refreshToken: e.target.value })} />
              </div>
              <div>
                <label className="label">Validade em segundos <span className="text-gray-400 font-normal">(opcional, ex: 3600)</span></label>
                <input type="number" className="input w-36" placeholder="3600" value={tokenForm.expiresIn} onChange={(e) => setTokenForm({ ...tokenForm, expiresIn: e.target.value })} />
              </div>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => setTokensManually.mutate()}
                  disabled={setTokensManually.isPending || !tokenForm.accessToken}
                  className="btn-primary"
                >
                  {setTokensManually.isPending ? 'A guardar...' : 'Ativar com estes tokens'}
                </button>
                {setTokensManually.isError && <p className="text-sm text-red-600">{(setTokensManually.error as Error).message}</p>}
              </div>
            </div>
          )}

          {/* Callback URI — always visible once API responds */}
          {tocConfig?.callbackUri && (
            <div className="card p-5 space-y-2">
              <h3 className="text-sm font-semibold text-gray-900">Redirect URI (callback)</h3>
              <p className="text-xs text-gray-500">Registe este endereço na sua aplicação OAuth no portal TOConline.</p>
              <div className="flex items-center gap-2 mt-1">
                <code className="flex-1 text-xs font-mono bg-gray-50 border border-gray-200 rounded px-3 py-2 text-gray-800 break-all select-all">
                  {tocConfig.callbackUri}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(tocConfig.callbackUri)
                    setCopiedCallback(true)
                    setTimeout(() => setCopiedCallback(false), 2000)
                  }}
                  className="btn-secondary p-2 flex-shrink-0"
                  title="Copiar"
                >
                  {copiedCallback ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {!tocConfig?.id && !tocLoading && (
            <p className="text-xs text-gray-400">Guarde primeiro as credenciais para poder iniciar a ligação OAuth.</p>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <div className="card p-6 space-y-6 max-w-xl">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Aparência</h3>
            <div className="flex items-center justify-between gap-4">
              <div>
                <span className="text-sm text-gray-700">Tema</span>
                <p className="text-xs text-gray-400">Alternar entre tema claro e tema escuro</p>
              </div>
              <button
                type="button"
                onClick={toggleTheme}
                role="switch"
                aria-checked={theme === 'dark'}
                className={`relative inline-flex h-7 w-14 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none ${theme === 'dark' ? 'bg-primary-600' : 'bg-gray-200'}`}
              >
                <span className={`pointer-events-none inline-flex h-6 w-6 transform items-center justify-center rounded-full bg-white shadow transition-transform duration-200 ${theme === 'dark' ? 'translate-x-7' : 'translate-x-0.5'}`}>
                  {theme === 'dark' ? <Moon className="w-3.5 h-3.5 text-primary-600" /> : <Sun className="w-3.5 h-3.5 text-amber-500" />}
                </span>
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Alertas</h3>
            <div className="space-y-3">
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={settingsForm.lowBalanceEnabled ?? true} onChange={(e) => setSettingsForm({ ...settingsForm, lowBalanceEnabled: e.target.checked })} className="rounded" />
                <div>
                  <span className="text-sm text-gray-700">Alerta de saldo mínimo</span>
                  <p className="text-xs text-gray-400">Mostra um aviso quando o saldo de uma conta desce abaixo do mínimo configurado</p>
                </div>
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
            <div className="space-y-3">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={(settingsForm.importFileRetentionDays ?? 30) > 0}
                  onChange={(e) => setSettingsForm({ ...settingsForm, importFileRetentionDays: e.target.checked ? 30 : 0 })}
                  className="rounded"
                />
                <div>
                  <span className="text-sm text-gray-700">Eliminar ficheiros importados antigos</span>
                  <p className="text-xs text-gray-400">
                    {(settingsForm.importFileRetentionDays ?? 30) > 0
                      ? 'Os ficheiros importados são removidos automaticamente após o período definido'
                      : 'Manter sempre — os ficheiros importados nunca são removidos'}
                  </p>
                </div>
              </label>
              {(settingsForm.importFileRetentionDays ?? 30) > 0 && (
                <div className="ml-7">
                  <label className="label">Período de retenção</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range" min={7} max={365} step={1}
                      value={settingsForm.importFileRetentionDays ?? 30}
                      onChange={(e) => setSettingsForm({ ...settingsForm, importFileRetentionDays: parseInt(e.target.value) })}
                      className="w-56"
                    />
                    <span className="text-sm font-medium text-gray-700 whitespace-nowrap">
                      {settingsForm.importFileRetentionDays ?? 30} dias
                    </span>
                  </div>
                </div>
              )}
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
