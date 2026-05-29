import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import Modal from '@/components/ui/Modal'
import { Plus, CheckCircle, AlertCircle, Clock, Unplug, ExternalLink, PlugZap, Copy, Check, Trash2, Play, GripVertical, Pencil, Archive, RotateCcw } from 'lucide-react'
import { formatDatetime } from '@/lib/utils'
import FollowUpPlanTab from '@/components/followups/FollowUpPlanTab'
import BudgetRulesTab from '@/components/settings/BudgetRulesTab'
import DunningTracksTab from '@/components/settings/DunningTracksTab'
import BudgetCategoriesTab from '@/components/settings/BudgetCategoriesTab'

interface Category { id: string; name: string; type: string; launchToc: boolean; color: string; isArchived: boolean; usageCount: number }
interface Settings {
  reconciliationDryRun: boolean; autoMatchEnabled: boolean; autoMatchThreshold: number
  syncIntervalMinutes: number; lowBalanceEnabled: boolean; importFileRetentionDays: number
}
interface ClassificationRule {
  id: string; matchField: string; matchOp: string; matchValue: string
  amountMin: number | null; amountMax: number | null; direction: string | null
  categoryId: string; priority: number; isActive: boolean; hits: number; lastHitAt: string | null
  category: { id: string; name: string; color: string }
}

const MATCH_FIELDS = [
  { value: 'description', label: 'Descrição' },
  { value: 'counterpart', label: 'Contraparte' },
  { value: 'iban', label: 'IBAN contraparte' },
]
const MATCH_OPS = [
  { value: 'contains', label: 'contém' },
  { value: 'equals', label: 'é igual a' },
  { value: 'startsWith', label: 'começa por' },
  { value: 'regex', label: 'regex' },
]
interface ToconlineConfig {
  id?: string; clientId?: string; oauthUrl?: string; baseUrl?: string; tocClientId?: string
  tokenExpiresAt?: string | null; status?: 'UNCONFIGURED' | 'PENDING_AUTH' | 'ACTIVE' | 'ERROR'
  lastError?: string | null; createdAt?: string; updatedAt?: string; callbackUri: string
}

export default function SettingsPage() {
  const { selectedClientId, isTocEnabled, setIsTocEnabled } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState<'categories' | 'rules' | 'settings' | 'toconline' | 'dunning'>('categories')
  const [showNewCat, setShowNewCat] = useState(false)
  const [newCat, setNewCat] = useState({ name: '', type: 'EXPENSE', launchToc: false, color: '#6b7280' })
  const [editCat, setEditCat] = useState<Category | null>(null)
  const [editCatForm, setEditCatForm] = useState({ name: '', color: '#6b7280', launchToc: false })
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

  // Classification rules
  const { data: rules = [] } = useQuery<ClassificationRule[]>({
    queryKey: ['classification-rules', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/classification-rules`),
    enabled: !!selectedClientId,
  })

  const emptyRule = { matchField: 'description', matchOp: 'contains', matchValue: '', amountMin: '', amountMax: '', direction: '', categoryId: '', priority: 50 }
  const [showNewRule, setShowNewRule] = useState(false)
  const [newRule, setNewRule] = useState(emptyRule)
  const [editRule, setEditRule] = useState<ClassificationRule | null>(null)
  const [editRuleForm, setEditRuleForm] = useState(emptyRule)
  const [applyResult, setApplyResult] = useState<{ classified: number; skipped: number } | null>(null)

  const createRule = useMutation({
    mutationFn: () => api.post(`/treasury/${selectedClientId}/classification-rules`, {
      matchField: newRule.matchField,
      matchOp: newRule.matchOp,
      matchValue: newRule.matchValue,
      categoryId: newRule.categoryId,
      priority: Number(newRule.priority),
      ...(newRule.direction ? { direction: newRule.direction } : {}),
      ...(newRule.amountMin !== '' ? { amountMin: Number(newRule.amountMin) } : {}),
      ...(newRule.amountMax !== '' ? { amountMax: Number(newRule.amountMax) } : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['classification-rules'] })
      setShowNewRule(false)
      setNewRule(emptyRule)
    },
  })

  const toggleRule = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/treasury/${selectedClientId}/classification-rules/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classification-rules'] }),
  })

  const updateRule = useMutation({
    mutationFn: (form: typeof emptyRule) => api.patch(`/treasury/${selectedClientId}/classification-rules/${editRule?.id}`, {
      matchField: form.matchField, matchOp: form.matchOp, matchValue: form.matchValue, categoryId: form.categoryId,
      priority: Number(form.priority),
      ...(form.direction ? { direction: form.direction } : { direction: null }),
      ...(form.amountMin !== '' ? { amountMin: Number(form.amountMin) } : { amountMin: null }),
      ...(form.amountMax !== '' ? { amountMax: Number(form.amountMax) } : { amountMax: null }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['classification-rules'] }); setEditRule(null) },
    onError: (e) => toast.error((e as Error).message),
  })

  const deleteRule = useMutation({
    mutationFn: (id: string) => api.delete(`/treasury/${selectedClientId}/classification-rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['classification-rules'] }),
  })

  const applyRules = useMutation({
    mutationFn: () => api.post<{ classified: number; skipped: number }>(`/treasury/${selectedClientId}/movements/apply-rules`, {}),
    onSuccess: (data) => {
      setApplyResult(data)
      qc.invalidateQueries({ queryKey: ['movements'] })
    },
  })

  // Aplica as mesmas regras a faturas (Receivables + Payables) sem categoria.
  // Combina os dois endpoints num só feedback para o utilizador.
  const [applyInvoicesResult, setApplyInvoicesResult] = useState<{ classified: number; skipped: number } | null>(null)
  const applyRulesToInvoices = useMutation({
    mutationFn: async () => {
      const [recv, pay] = await Promise.all([
        api.post<{ classified: number; skipped: number }>(`/treasury/${selectedClientId}/receivables/apply-rules`, {}),
        api.post<{ classified: number; skipped: number }>(`/treasury/${selectedClientId}/payables/apply-rules`, {}),
      ])
      return { classified: recv.classified + pay.classified, skipped: recv.skipped + pay.skipped }
    },
    onSuccess: (data) => {
      setApplyInvoicesResult(data)
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['payables'] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const createCat = useMutation({
    mutationFn: () => api.post(`/treasury/${selectedClientId}/categories`, newCat),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      setShowNewCat(false)
      setNewCat({ name: '', type: 'EXPENSE', launchToc: false, color: '#6b7280' })
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
    { id: 'categories', label: 'Categorias' },
    { id: 'rules', label: 'Regras de Classificação' },
    { id: 'dunning', label: 'Réguas de Cobrança' },
    { id: 'settings', label: 'Configurações' },
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
                Movimentos
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
                            onClick={() => { setEditCat(c); setEditCatForm({ name: c.name, color: c.color, launchToc: false }) }}
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

      {tab === 'rules' && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm text-gray-500 max-w-xl">
              As regras são aplicadas automaticamente na importação/criação de movimentos e na criação de faturas (Contas a Receber e a Pagar). Quando não há regra que corresponda, o sistema tenta usar a categoria da última operação da mesma entidade.
            </p>
            <div className="flex flex-wrap gap-2 flex-shrink-0">
              <button
                onClick={() => { setApplyResult(null); applyRules.mutate() }}
                disabled={applyRules.isPending}
                className="btn-secondary flex items-center gap-2"
              >
                <Play className="w-4 h-4" />
                {applyRules.isPending ? 'A aplicar...' : 'Aplicar a movimentos'}
              </button>
              <button
                onClick={() => { setApplyInvoicesResult(null); applyRulesToInvoices.mutate() }}
                disabled={applyRulesToInvoices.isPending}
                className="btn-secondary flex items-center gap-2"
              >
                <Play className="w-4 h-4" />
                {applyRulesToInvoices.isPending ? 'A aplicar...' : 'Aplicar a faturas'}
              </button>
              <button onClick={() => setShowNewRule(true)} className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" />Nova Regra
              </button>
            </div>
          </div>

          {applyResult && (
            <div className="flex items-center gap-2 text-sm px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-green-800">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              Classificados {applyResult.classified} movimento(s). {applyResult.skipped} ficaram sem correspondência.
            </div>
          )}

          {applyInvoicesResult && (
            <div className="flex items-center gap-2 text-sm px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-green-800">
              <CheckCircle className="w-4 h-4 flex-shrink-0" />
              Classificadas {applyInvoicesResult.classified} fatura(s). {applyInvoicesResult.skipped} ficaram sem correspondência.
            </div>
          )}

          <div className="card divide-y divide-gray-50">
            {rules.length === 0 && (
              <div className="px-5 py-10 text-center text-gray-400 text-sm">
                Sem regras definidas. Crie uma regra para classificar automaticamente os movimentos.
              </div>
            )}
            {rules.map((rule) => (
              <div key={rule.id} className={`flex items-center gap-4 px-5 py-3 ${!rule.isActive ? 'opacity-50' : ''}`}>
                <GripVertical className="w-4 h-4 text-gray-300 flex-shrink-0" />
                <div className="w-8 text-xs font-mono text-gray-400 text-center">{rule.priority}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-900">
                    <span className="font-medium">{MATCH_FIELDS.find(f => f.value === rule.matchField)?.label ?? rule.matchField}</span>
                    {' '}<span className="text-gray-500">{MATCH_OPS.find(o => o.value === rule.matchOp)?.label ?? rule.matchOp}</span>
                    {' '}<span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-xs">{rule.matchValue}</span>
                    {rule.direction && (
                      <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full font-medium ${rule.direction === 'REVENUE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {rule.direction === 'REVENUE' ? 'Entrada' : 'Saída'}
                      </span>
                    )}
                    {(rule.amountMin != null || rule.amountMax != null) && (
                      <span className="ml-2 text-xs text-gray-400">
                        {rule.amountMin != null && `≥ ${rule.amountMin}€`}
                        {rule.amountMin != null && rule.amountMax != null && ' '}
                        {rule.amountMax != null && `≤ ${rule.amountMax}€`}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: rule.category.color }} />
                    <span className="text-xs text-gray-500">{rule.category.name}</span>
                    {rule.hits > 0 && <span className="text-xs text-gray-400">· {rule.hits} uso(s)</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => { setEditRule(rule); setEditRuleForm({ matchField: rule.matchField, matchOp: rule.matchOp, matchValue: rule.matchValue, amountMin: rule.amountMin != null ? String(rule.amountMin) : '', amountMax: rule.amountMax != null ? String(rule.amountMax) : '', direction: rule.direction ?? '', categoryId: rule.categoryId, priority: rule.priority }) }}
                    className="p-1.5 text-gray-400 hover:text-primary-600 transition-colors rounded"
                    title="Editar"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => toggleRule.mutate({ id: rule.id, isActive: !rule.isActive })}
                    className={`text-xs px-2 py-1 rounded-full font-medium border transition-colors ${rule.isActive ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100' : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                  >
                    {rule.isActive ? 'Ativa' : 'Inativa'}
                  </button>
                  <button
                    onClick={() => { if (confirm('Eliminar esta regra?')) deleteRule.mutate(rule.id) }}
                    className="p-1.5 text-gray-400 hover:text-red-600 transition-colors rounded"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <Modal open={showNewRule} onClose={() => { setShowNewRule(false); setNewRule(emptyRule) }} title="Nova Regra de Classificação">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Campo</label>
                  <select className="input" value={newRule.matchField} onChange={(e) => setNewRule({ ...newRule, matchField: e.target.value })}>
                    {MATCH_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Operação</label>
                  <select className="input" value={newRule.matchOp} onChange={(e) => setNewRule({ ...newRule, matchOp: e.target.value })}>
                    {MATCH_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Valor a pesquisar</label>
                <input className="input font-mono text-sm" placeholder={newRule.matchOp === 'regex' ? '^TRF.*' : 'ex: PAGAMENTO TSU'} value={newRule.matchValue} onChange={(e) => setNewRule({ ...newRule, matchValue: e.target.value })} />
              </div>

              <div>
                <label className="label">Categoria de destino</label>
                <select className="input" value={newRule.categoryId} onChange={(e) => setNewRule({ ...newRule, categoryId: e.target.value })}>
                  <option value="">Selecionar...</option>
                  {['REVENUE', 'EXPENSE'].map((type) => (
                    <optgroup key={type} label={type === 'REVENUE' ? 'Receita' : 'Despesa'}>
                      {categories.filter(c => c.type === type && !c.isArchived).map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="label">Direção</label>
                  <select className="input" value={newRule.direction} onChange={(e) => setNewRule({ ...newRule, direction: e.target.value })}>
                    <option value="">Qualquer</option>
                    <option value="REVENUE">Entrada</option>
                    <option value="EXPENSE">Saída</option>
                  </select>
                </div>
                <div>
                  <label className="label">Valor mín. (€)</label>
                  <input type="number" className="input" placeholder="0" value={newRule.amountMin} onChange={(e) => setNewRule({ ...newRule, amountMin: e.target.value })} />
                </div>
                <div>
                  <label className="label">Valor máx. (€)</label>
                  <input type="number" className="input" placeholder="∞" value={newRule.amountMax} onChange={(e) => setNewRule({ ...newRule, amountMax: e.target.value })} />
                </div>
              </div>

              <div>
                <label className="label">Prioridade <span className="text-gray-400 font-normal">(menor = maior prioridade)</span></label>
                <input type="number" className="input w-24" min={1} max={999} value={newRule.priority} onChange={(e) => setNewRule({ ...newRule, priority: Number(e.target.value) })} />
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => { setShowNewRule(false); setNewRule(emptyRule) }} className="btn-secondary flex-1">Cancelar</button>
                <button
                  onClick={() => createRule.mutate()}
                  className="btn-primary flex-1"
                  disabled={createRule.isPending || !newRule.matchValue || !newRule.categoryId}
                >
                  {createRule.isPending ? 'A guardar...' : 'Criar Regra'}
                </button>
              </div>
              {createRule.isError && <p className="text-sm text-red-600">{(createRule.error as Error).message}</p>}
            </div>
          </Modal>

          <Modal open={!!editRule} onClose={() => setEditRule(null)} title="Editar Regra de Classificação">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Campo</label>
                  <select className="input" value={editRuleForm.matchField} onChange={(e) => setEditRuleForm({ ...editRuleForm, matchField: e.target.value })}>
                    {MATCH_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Operação</label>
                  <select className="input" value={editRuleForm.matchOp} onChange={(e) => setEditRuleForm({ ...editRuleForm, matchOp: e.target.value })}>
                    {MATCH_OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Valor a pesquisar</label>
                <input className="input font-mono text-sm" placeholder={editRuleForm.matchOp === 'regex' ? '^TRF.*' : 'ex: PAGAMENTO TSU'} value={editRuleForm.matchValue} onChange={(e) => setEditRuleForm({ ...editRuleForm, matchValue: e.target.value })} />
              </div>

              <div>
                <label className="label">Categoria de destino</label>
                <select className="input" value={editRuleForm.categoryId} onChange={(e) => setEditRuleForm({ ...editRuleForm, categoryId: e.target.value })}>
                  <option value="">Selecionar...</option>
                  {['REVENUE', 'EXPENSE'].map((type) => (
                    <optgroup key={type} label={type === 'REVENUE' ? 'Receita' : 'Despesa'}>
                      {categories.filter(c => c.type === type && !c.isArchived).map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <div>
                  <label className="label">Direção</label>
                  <select className="input" value={editRuleForm.direction} onChange={(e) => setEditRuleForm({ ...editRuleForm, direction: e.target.value })}>
                    <option value="">Qualquer</option>
                    <option value="REVENUE">Entrada</option>
                    <option value="EXPENSE">Saída</option>
                  </select>
                </div>
                <div>
                  <label className="label">Valor mín. (€)</label>
                  <input type="number" className="input" placeholder="0" value={editRuleForm.amountMin} onChange={(e) => setEditRuleForm({ ...editRuleForm, amountMin: e.target.value })} />
                </div>
                <div>
                  <label className="label">Valor máx. (€)</label>
                  <input type="number" className="input" placeholder="∞" value={editRuleForm.amountMax} onChange={(e) => setEditRuleForm({ ...editRuleForm, amountMax: e.target.value })} />
                </div>
              </div>

              <div>
                <label className="label">Prioridade <span className="text-gray-400 font-normal">(menor = maior prioridade)</span></label>
                <input type="number" className="input w-24" min={1} max={999} value={editRuleForm.priority} onChange={(e) => setEditRuleForm({ ...editRuleForm, priority: Number(e.target.value) })} />
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditRule(null)} className="btn-secondary flex-1">Cancelar</button>
                <button
                  onClick={() => updateRule.mutate(editRuleForm)}
                  className="btn-primary flex-1"
                  disabled={updateRule.isPending || !editRuleForm.matchValue || !editRuleForm.categoryId}
                >
                  {updateRule.isPending ? 'A guardar...' : 'Guardar alterações'}
                </button>
              </div>
              {updateRule.isError && <p className="text-sm text-red-600">{(updateRule.error as Error).message}</p>}
            </div>
          </Modal>
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
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Reconciliação</h3>
            <div className="space-y-3">
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={settingsForm.reconciliationDryRun ?? true} onChange={(e) => setSettingsForm({ ...settingsForm, reconciliationDryRun: e.target.checked })} className="rounded" />
                <div>
                  <span className="text-sm text-gray-700">Modo dry-run</span>
                  <p className="text-xs text-gray-400">Simula a reconciliação sem escrever no TOConline</p>
                </div>
              </label>
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={settingsForm.autoMatchEnabled ?? false} onChange={(e) => setSettingsForm({ ...settingsForm, autoMatchEnabled: e.target.checked })} className="rounded" />
                <div>
                  <span className="text-sm text-gray-700">Correspondência automática</span>
                  <p className="text-xs text-gray-400">Sugere automaticamente pares movimento ↔ documento na reconciliação</p>
                </div>
              </label>
              {settingsForm.autoMatchEnabled && (
                <div className="ml-7">
                  <label className="label">Limiar de confiança</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="range" min={0.5} max={1} step={0.05}
                      value={settingsForm.autoMatchThreshold ?? 0.95}
                      onChange={(e) => setSettingsForm({ ...settingsForm, autoMatchThreshold: parseFloat(e.target.value) })}
                      className="w-40"
                    />
                    <span className="text-sm font-medium text-gray-700">
                      {Math.round((settingsForm.autoMatchThreshold ?? 0.95) * 100)}%
                    </span>
                  </div>
                </div>
              )}
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
