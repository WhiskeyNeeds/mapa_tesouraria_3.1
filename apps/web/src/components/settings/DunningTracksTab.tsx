import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/contexts/ToastContext'
import Modal from '@/components/ui/Modal'
import { Plus, Pencil, Trash2, Play, ChevronRight, ArrowLeft, Star, CheckCircle2, AlertTriangle, MinusCircle, Mail } from 'lucide-react'
import DunningRulesTab from './DunningRulesTab'

interface DunningTrack {
  id: string
  name: string
  isActive: boolean
  isDefault: boolean
  sortOrder: number
  _count: { rules: number; assignments: number }
}

interface ExecutionSummary {
  totalSent: number
  totalSkipped: number
  errors: Array<{ ruleId: string; message: string }>
  rules: Array<{
    ruleId: string
    ruleName: string
    trackId: string
    trackName: string
    offsetDays: number
    templateName: string | null
    reason?: 'NO_TEMPLATE' | 'PAYABLE_NOT_SUPPORTED'
    eligibleCount: number
    sentCount: number
    skippedCount: number
    sent: Array<{
      receivableId: string
      reference: string | null
      entityName: string | null
      totalAmount: string
      promisedPaymentDate: string | null
    }>
  }>
}

function formatOffset(days: number): string {
  if (days === 0) return 'No dia do pagamento'
  if (days < 0) return `${Math.abs(days)} dia${Math.abs(days) === 1 ? '' : 's'} antes do pagamento`
  return `${days} dia${days === 1 ? '' : 's'} após o pagamento`
}

interface Props { clientId: string }

const emptyTrack = { name: '', isDefault: false, isActive: true }

export default function DunningTracksTab({ clientId }: Props) {
  const qc = useQueryClient()
  const toast = useToast()

  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null)
  const [showNewTrack, setShowNewTrack] = useState(false)
  const [editingTrack, setEditingTrack] = useState<DunningTrack | null>(null)
  const [trackForm, setTrackForm] = useState(emptyTrack)
  const [executionSummary, setExecutionSummary] = useState<ExecutionSummary | null>(null)
  // Réguas selecionadas para o próximo "Executar agora". Vazio = botão desativado.
  const [selectedForRun, setSelectedForRun] = useState<Set<string>>(new Set())

  const { data: tracks = [] } = useQuery<DunningTrack[]>({
    queryKey: ['dunning-tracks', clientId],
    queryFn: () => api.get(`/treasury/${clientId}/dunning-tracks`),
  })

  const createTrack = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.post(`/treasury/${clientId}/dunning-tracks`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dunning-tracks', clientId] })
      toast.success('Régua criada')
      closeTrackModal()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateTrack = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api.patch(`/treasury/${clientId}/dunning-tracks/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dunning-tracks', clientId] })
      toast.success('Régua atualizada')
      closeTrackModal()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteTrack = useMutation({
    mutationFn: (id: string) => api.delete(`/treasury/${clientId}/dunning-tracks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dunning-tracks', clientId] })
      toast.success('Régua eliminada')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleTrack = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/treasury/${clientId}/dunning-tracks/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dunning-tracks', clientId] }),
    onError: (e: Error) => toast.error(e.message),
  })

  const executeEngine = useMutation({
    mutationFn: (trackIds: string[]) =>
      api.post<ExecutionSummary>(`/treasury/${clientId}/dunning-rules/execute`, { trackIds }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['dunning-rules', clientId] })
      qc.invalidateQueries({ queryKey: ['dunning-tracks', clientId] })
      setExecutionSummary(data)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function toggleSelectForRun(id: string) {
    setSelectedForRun((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAllForRun(allIds: string[]) {
    setSelectedForRun((s) => (s.size === allIds.length ? new Set() : new Set(allIds)))
  }

  function openNewTrack() {
    setEditingTrack(null)
    setTrackForm(emptyTrack)
    setShowNewTrack(true)
  }
  function openEditTrack(t: DunningTrack) {
    setEditingTrack(t)
    setTrackForm({ name: t.name, isDefault: t.isDefault, isActive: t.isActive })
  }
  function closeTrackModal() {
    setShowNewTrack(false)
    setEditingTrack(null)
    setTrackForm(emptyTrack)
  }
  function submitTrack() {
    const payload = { name: trackForm.name.trim(), isDefault: trackForm.isDefault, isActive: trackForm.isActive }
    if (editingTrack) updateTrack.mutate({ id: editingTrack.id, payload })
    else createTrack.mutate(payload)
  }

  // ── Detalhe da régua ─────────────────────────────────────────────────
  if (selectedTrackId) {
    const t = tracks.find((x) => x.id === selectedTrackId)
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setSelectedTrackId(null)} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800">
            <ArrowLeft className="w-4 h-4" />
            Réguas
          </button>
          <span className="text-gray-300">/</span>
          <span className="text-sm font-semibold text-gray-900">{t?.name ?? 'Régua'}</span>
          {t?.isDefault && (
            <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded">
              <Star className="w-3 h-3 inline mr-0.5" />Default
            </span>
          )}
        </div>
        <DunningRulesTab clientId={clientId} trackId={selectedTrackId} />
      </div>
    )
  }

  // ── Lista de réguas ──────────────────────────────────────────────────
  const sortedTracks = [...tracks].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-sm text-gray-600">
            <strong>Réguas de cobrança</strong> agrupam 1 ou mais regras. Cada cliente TOC pode ser atribuído a uma régua;
            quando não está atribuído explicitamente, é usada a régua marcada como <em>default</em>.
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Verificação automática diária. Cada regra dentro da régua define quando enviar (offset de dias relativos
            à data prometida de pagamento) e que tom usar.
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => executeEngine.mutate(Array.from(selectedForRun))}
            disabled={executeEngine.isPending || selectedForRun.size === 0}
            className="btn-secondary flex items-center gap-2"
            title={
              selectedForRun.size === 0
                ? 'Seleciona pelo menos uma régua para executar'
                : `Executar ${selectedForRun.size} régua(s) selecionada(s)`
            }
          >
            <Play className="w-4 h-4" />
            {executeEngine.isPending
              ? 'A executar...'
              : `Executar agora${selectedForRun.size > 0 ? ` (${selectedForRun.size})` : ''}`}
          </button>
          <button onClick={openNewTrack} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Nova Régua
          </button>
        </div>
      </div>

      {sortedTracks.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-gray-200 rounded-xl">
          <p className="text-sm text-gray-500">Sem réguas de cobrança definidas.</p>
          <p className="text-xs text-gray-400 mt-1">Cria a primeira régua e adiciona regras dentro dela.</p>
        </div>
      ) : (
        <div className="card divide-y divide-gray-50">
          {(() => {
            const activeIds = sortedTracks.filter((t) => t.isActive).map((t) => t.id)
            const allSelected = activeIds.length > 0 && activeIds.every((id) => selectedForRun.has(id))
            const someSelected = activeIds.some((id) => selectedForRun.has(id))
            return (
              <div className="flex items-center gap-3 px-5 py-2 bg-gray-50/60 text-xs text-gray-500">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = !allSelected && someSelected }}
                  onChange={() => toggleAllForRun(activeIds)}
                  disabled={activeIds.length === 0}
                  title="Selecionar todas as réguas ativas"
                />
                <span>
                  {selectedForRun.size === 0
                    ? 'Seleciona réguas para correr o motor manualmente'
                    : `${selectedForRun.size} régua(s) selecionada(s)`}
                </span>
              </div>
            )
          })()}
          {sortedTracks.map((t) => (
            <div key={t.id} className={`flex items-center gap-4 px-5 py-3.5 ${!t.isActive ? 'opacity-60' : ''}`}>
              <input
                type="checkbox"
                className="rounded flex-shrink-0"
                checked={selectedForRun.has(t.id)}
                onChange={() => toggleSelectForRun(t.id)}
                disabled={!t.isActive}
                title={t.isActive ? 'Incluir na próxima execução manual' : 'Régua inativa'}
                onClick={(e) => e.stopPropagation()}
              />
              <button onClick={() => setSelectedTrackId(t.id)} className="flex-1 flex items-center gap-3 min-w-0 text-left">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{t.name}</span>
                    {t.isDefault && (
                      <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded">
                        <Star className="w-3 h-3 inline mr-0.5" />Default
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {t._count.rules} regra{t._count.rules === 1 ? '' : 's'} · {t._count.assignments} cliente{t._count.assignments === 1 ? '' : 's'} atribuído{t._count.assignments === 1 ? '' : 's'}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300" />
              </button>
              <button
                onClick={() => toggleTrack.mutate({ id: t.id, isActive: !t.isActive })}
                className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${t.isActive ? 'bg-primary-600' : 'bg-gray-300'}`}
                title={t.isActive ? 'Desativar' : 'Ativar'}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${t.isActive ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
              <button onClick={() => openEditTrack(t)} className="p-1.5 text-gray-400 hover:text-primary-600 rounded" title="Editar">
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  if (t.isDefault) { toast.error('Marca outra régua como default antes de eliminar.'); return }
                  if (confirm(`Eliminar régua "${t.name}"? Todas as suas regras serão também removidas.`)) deleteTrack.mutate(t.id)
                }}
                className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                title="Eliminar"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Modal: criar/editar régua */}
      <Modal
        open={showNewTrack || editingTrack !== null}
        onClose={closeTrackModal}
        title={editingTrack ? 'Editar Régua' : 'Nova Régua de Cobrança'}
      >
        <div className="space-y-4">
          <div>
            <label className="label">Nome <span className="text-red-500">*</span></label>
            <input
              className="input"
              value={trackForm.name}
              onChange={(e) => setTrackForm({ ...trackForm, name: e.target.value })}
              placeholder="Ex: Régua Padrão, VIP, Agressiva"
            />
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={trackForm.isDefault}
              onChange={(e) => setTrackForm({ ...trackForm, isDefault: e.target.checked })}
              className="rounded mt-0.5"
            />
            <span className="text-sm text-gray-700">
              <strong>Régua default</strong>
              <div className="text-xs text-gray-500 mt-0.5">
                Usada para clientes TOC sem atribuição explícita. Apenas uma régua pode ser default.
              </div>
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={trackForm.isActive}
              onChange={(e) => setTrackForm({ ...trackForm, isActive: e.target.checked })}
              className="rounded"
            />
            <span className="text-sm text-gray-700">Régua ativa</span>
          </label>

          <div className="flex gap-3 pt-2">
            <button onClick={closeTrackModal} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={submitTrack}
              disabled={createTrack.isPending || updateTrack.isPending || !trackForm.name.trim()}
              className="btn-primary flex-1"
            >
              {editingTrack ? 'Guardar' : 'Criar'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: resumo da execução */}
      <Modal
        open={executionSummary !== null}
        onClose={() => setExecutionSummary(null)}
        title="Resumo da execução"
        size="lg"
      >
        {executionSummary && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2.5">
                <div className="text-xs text-emerald-700 font-medium">Emails enviados</div>
                <div className="text-2xl font-semibold text-emerald-700 tabular-nums">{executionSummary.totalSent}</div>
              </div>
              <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5">
                <div className="text-xs text-gray-500 font-medium">Já tratados</div>
                <div className="text-2xl font-semibold text-gray-700 tabular-nums">{executionSummary.totalSkipped}</div>
              </div>
              <div className="rounded-lg border border-rose-100 bg-rose-50/60 px-3 py-2.5">
                <div className="text-xs text-rose-700 font-medium">Erros</div>
                <div className="text-2xl font-semibold text-rose-700 tabular-nums">{executionSummary.errors.length}</div>
              </div>
            </div>

            {executionSummary.rules.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">Sem regras ativas para correr.</p>
            ) : (
              <div className="space-y-3 max-h-[55vh] overflow-y-auto -mx-1 px-1">
                {executionSummary.rules.map((r) => (
                  <div key={r.ruleId} className="border border-gray-100 rounded-lg">
                    <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50/60 border-b border-gray-100">
                      <div className={`w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 ${
                        r.sentCount > 0 ? 'bg-emerald-100 text-emerald-700'
                          : r.reason ? 'bg-amber-100 text-amber-700'
                            : 'bg-gray-100 text-gray-500'
                      }`}>
                        {r.sentCount > 0 ? <CheckCircle2 className="w-4 h-4" />
                          : r.reason ? <AlertTriangle className="w-4 h-4" />
                            : <MinusCircle className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-gray-900">{r.ruleName}</div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {r.trackName} · {formatOffset(r.offsetDays)}
                          {r.templateName && <span> · {r.templateName}</span>}
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 flex-shrink-0">
                        {r.reason === 'NO_TEMPLATE' && <span className="text-amber-700">Sem template</span>}
                        {r.reason === 'PAYABLE_NOT_SUPPORTED' && <span className="text-amber-700">Payable (não suportado)</span>}
                        {!r.reason && (
                          <span>
                            <strong className="text-gray-700">{r.sentCount}</strong> enviado{r.sentCount === 1 ? '' : 's'}
                            {r.skippedCount > 0 && <span> · {r.skippedCount} já tratado{r.skippedCount === 1 ? '' : 's'}</span>}
                          </span>
                        )}
                      </div>
                    </div>
                    {r.sent.length > 0 && (
                      <ul className="divide-y divide-gray-50">
                        {r.sent.map((s) => (
                          <li key={s.receivableId} className="flex items-start gap-3 px-4 py-2 text-xs">
                            <Mail className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-800 truncate">{s.entityName ?? '—'}</div>
                              <div className="text-gray-500 mt-0.5">
                                Fatura {s.reference ?? '—'} · {Number(s.totalAmount).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' })}
                                {s.promisedPaymentDate && (
                                  <span> · pagamento {new Date(s.promisedPaymentDate).toLocaleDateString('pt-PT')}</span>
                                )}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    {!r.reason && r.sent.length === 0 && r.eligibleCount === 0 && (
                      <div className="px-4 py-2 text-xs text-gray-400 italic">
                        Sem faturas elegíveis nesta data.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {executionSummary.errors.length > 0 && (
              <div className="border border-rose-100 rounded-lg p-3 bg-rose-50/50">
                <div className="text-xs font-semibold text-rose-700 mb-1.5">Erros</div>
                <ul className="space-y-1 text-xs text-rose-700">
                  {executionSummary.errors.map((e, i) => (
                    <li key={i}>· {e.message}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button onClick={() => setExecutionSummary(null)} className="btn-primary">Fechar</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
