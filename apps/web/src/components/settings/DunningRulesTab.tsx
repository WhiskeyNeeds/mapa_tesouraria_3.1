import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/contexts/ToastContext'
import Modal from '@/components/ui/Modal'
import { Plus, Pencil, Trash2, Clock, AlertTriangle, Mail, Play, CheckCircle2, MinusCircle, X, Save } from 'lucide-react'

interface EmailTemplate {
  id: string
  name: string
  scope: 'RECEIVABLE' | 'PAYABLE' | 'BOTH'
  subject: string
  bodyHtml: string
}

interface DunningRule {
  id: string
  name: string
  offsetDays: number
  direction: 'RECEIVABLE' | 'PAYABLE'
  emailTemplateId: string | null
  emailTemplate: { id: string; name: string; scope: string } | null
  minAmount: number | null
  maxAmount: number | null
  categoryId: string | null
  category: { id: string; name: string; color: string; type: string } | null
  isActive: boolean
  sortOrder: number
  lastExecutedAt: string | null
  totalExecutions: number
}

interface ExecutionSummary {
  totalSent: number
  totalSkipped: number
  errors: Array<{ ruleId: string; message: string }>
  rules: Array<{
    ruleId: string
    ruleName: string
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

interface Props { clientId: string }

const PRESETS = [-30, -14, -7, -3, 0, 3, 7, 14, 30, 60]

const emptyRule = {
  name: '',
  offsetDays: 0,
  isActive: true,
  emailTemplateId: '',
}

function formatOffset(days: number): string {
  if (days === 0) return 'No dia do pagamento'
  if (days < 0) return `${Math.abs(days)} dia${Math.abs(days) === 1 ? '' : 's'} antes do pagamento`
  return `${days} dia${days === 1 ? '' : 's'} após o pagamento`
}

// Mapeia o offsetDays para o tom default da regra.
function defaultToneNameFor(offsetDays: number): string {
  if (offsetDays < 0) return 'Tom amigável'
  if (offsetDays === 0) return 'Tom formal'
  return 'Tom firme'
}

function defaultTemplateIdFor(offsetDays: number, templates: EmailTemplate[]): string {
  const target = defaultToneNameFor(offsetDays)
  return templates.find((t) => t.name === target)?.id ?? ''
}

export default function DunningRulesTab({ clientId }: Props) {
  const qc = useQueryClient()
  const toast = useToast()

  const [showNewRule, setShowNewRule] = useState(false)
  const [editingRule, setEditingRule] = useState<DunningRule | null>(null)
  const [ruleForm, setRuleForm] = useState(emptyRule)
  const [templateManuallyPicked, setTemplateManuallyPicked] = useState(false)
  const [executionSummary, setExecutionSummary] = useState<ExecutionSummary | null>(null)
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [tplDraft, setTplDraft] = useState<{ subject: string; bodyHtml: string }>({ subject: '', bodyHtml: '' })

  const { data: rules = [] } = useQuery<DunningRule[]>({
    queryKey: ['dunning-rules', clientId],
    queryFn: () => api.get(`/treasury/${clientId}/dunning-rules`),
  })

  const { data: templates = [] } = useQuery<EmailTemplate[]>({
    queryKey: ['email-templates', clientId, 'RECEIVABLE'],
    queryFn: () => api.get(`/treasury/${clientId}/email-templates?scope=RECEIVABLE`),
  })

  // Quando offsetDays mudar e o utilizador ainda não tiver escolhido um template,
  // sugerimos automaticamente o tom default. Se já escolheu manualmente, respeitamos.
  useEffect(() => {
    if (templateManuallyPicked) return
    if (templates.length === 0) return
    const suggested = defaultTemplateIdFor(ruleForm.offsetDays, templates)
    if (suggested && suggested !== ruleForm.emailTemplateId) {
      setRuleForm((f) => ({ ...f, emailTemplateId: suggested }))
    }
  }, [ruleForm.offsetDays, templates, templateManuallyPicked, ruleForm.emailTemplateId])

  const createRule = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post(`/treasury/${clientId}/dunning-rules`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dunning-rules', clientId] })
      toast.success('Regra criada')
      closeModal()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateRule = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      api.patch(`/treasury/${clientId}/dunning-rules/${id}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dunning-rules', clientId] })
      toast.success('Regra atualizada')
      closeModal()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteRule = useMutation({
    mutationFn: (id: string) => api.delete(`/treasury/${clientId}/dunning-rules/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dunning-rules', clientId] })
      toast.success('Regra eliminada')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const toggleRule = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.patch(`/treasury/${clientId}/dunning-rules/${id}`, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dunning-rules', clientId] }),
    onError: (e: Error) => toast.error(e.message),
  })

  const executeEngine = useMutation({
    mutationFn: () => api.post<ExecutionSummary>(`/treasury/${clientId}/dunning-rules/execute`, {}),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['dunning-rules', clientId] })
      setExecutionSummary(data)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateTemplate = useMutation({
    mutationFn: ({ id, subject, bodyHtml }: { id: string; subject: string; bodyHtml: string }) =>
      api.patch(`/treasury/${clientId}/email-templates/${id}`, { subject, bodyHtml }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['email-templates', clientId, 'RECEIVABLE'] })
      toast.success('Template atualizado')
      setEditingTemplateId(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function closeModal() {
    setShowNewRule(false)
    setEditingRule(null)
    setRuleForm(emptyRule)
    setTemplateManuallyPicked(false)
    setEditingTemplateId(null)
  }

  function startEditTemplate(tpl: EmailTemplate) {
    setTplDraft({ subject: tpl.subject, bodyHtml: tpl.bodyHtml })
    setEditingTemplateId(tpl.id)
  }
  function cancelEditTemplate() {
    setEditingTemplateId(null)
    setTplDraft({ subject: '', bodyHtml: '' })
  }
  function saveTemplate() {
    if (!editingTemplateId) return
    updateTemplate.mutate({ id: editingTemplateId, subject: tplDraft.subject.trim(), bodyHtml: tplDraft.bodyHtml })
  }

  function openNewRule() {
    setEditingRule(null)
    setRuleForm(emptyRule)
    setTemplateManuallyPicked(false)
    setShowNewRule(true)
  }

  function openEditRule(r: DunningRule) {
    setEditingRule(r)
    setRuleForm({
      name: r.name,
      offsetDays: r.offsetDays,
      isActive: r.isActive,
      emailTemplateId: r.emailTemplateId ?? '',
    })
    // Em edição, qualquer alteração futura é da responsabilidade do utilizador.
    setTemplateManuallyPicked(true)
  }

  function submitRule() {
    const payload = {
      name: ruleForm.name.trim(),
      offsetDays: Number(ruleForm.offsetDays),
      emailTemplateId: ruleForm.emailTemplateId,
      isActive: ruleForm.isActive,
    }
    if (editingRule) updateRule.mutate({ id: editingRule.id, payload })
    else createRule.mutate(payload)
  }

  const sortedRules = [...rules].sort((a, b) => a.offsetDays - b.offsetDays)
  const canSubmit = !!ruleForm.name.trim() && !!ruleForm.emailTemplateId

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-sm text-gray-600">
            Define <strong>regras de cobrança automáticas</strong>: o sistema envia emails aos clientes
            antes ou depois da data prometida de pagamento.
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Verificação automática diária. Apenas faturas com data prometida de pagamento e em aberto/parciais
            são elegíveis. Cada regra usa um único template (tom amigável antes do pagamento, formal no dia, firme após).
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => executeEngine.mutate()}
            disabled={executeEngine.isPending || rules.length === 0}
            className="btn-secondary flex items-center gap-2"
            title="Corre o motor de cobrança agora, ignorando o cron diário"
          >
            <Play className="w-4 h-4" />
            {executeEngine.isPending ? 'A executar...' : 'Executar agora'}
          </button>
          <button onClick={openNewRule} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Nova Regra
          </button>
        </div>
      </div>

      {sortedRules.length === 0 ? (
        <div className="text-center py-10 border-2 border-dashed border-gray-200 rounded-xl">
          <Clock className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Sem regras de cobrança definidas.</p>
          <p className="text-xs text-gray-400 mt-1">Cria uma regra para começar a enviar lembretes automaticamente.</p>
        </div>
      ) : (
        <div className="card divide-y divide-gray-50">
          {sortedRules.map((r) => (
            <div key={r.id} className={`flex items-center gap-4 px-5 py-3.5 ${!r.isActive ? 'opacity-60' : ''}`}>
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                r.offsetDays < 0 ? 'bg-blue-50 text-blue-600'
                  : r.offsetDays === 0 ? 'bg-amber-50 text-amber-600'
                    : 'bg-rose-50 text-rose-600'
              }`}>
                {r.offsetDays > 0 ? <AlertTriangle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{r.name}</span>
                  <span className="text-xs text-gray-400">·</span>
                  <span className="text-xs text-gray-500">{formatOffset(r.offsetDays)}</span>
                </div>
                <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                  <Mail className="w-3 h-3 flex-shrink-0" />
                  {r.emailTemplate ? r.emailTemplate.name : <span className="italic text-amber-600">Sem template</span>}
                  {r.totalExecutions > 0 && (
                    <span className="ml-2 text-gray-400">· {r.totalExecutions} execução(ões)</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => toggleRule.mutate({ id: r.id, isActive: !r.isActive })}
                className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${r.isActive ? 'bg-primary-600' : 'bg-gray-300'}`}
                title={r.isActive ? 'Desativar' : 'Ativar'}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${r.isActive ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
              <button onClick={() => openEditRule(r)} className="p-1.5 text-gray-400 hover:text-primary-600 rounded" title="Editar">
                <Pencil className="w-4 h-4" />
              </button>
              <button
                onClick={() => { if (confirm(`Eliminar regra "${r.name}"?`)) deleteRule.mutate(r.id) }}
                className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                title="Eliminar"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={showNewRule || editingRule !== null}
        onClose={closeModal}
        title={editingRule ? 'Editar Regra' : 'Nova Regra de Cobrança'}
      >
        <div className="space-y-4">
          <div>
            <label className="label">Nome <span className="text-red-500">*</span></label>
            <input
              className="input"
              value={ruleForm.name}
              onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })}
              placeholder="Ex: Lembrete 7 dias antes"
            />
          </div>

          <div>
            <label className="label">Quando enviar <span className="text-red-500">*</span></label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="1"
                className="input w-24 text-center tabular-nums"
                value={ruleForm.offsetDays}
                onChange={(e) => setRuleForm({ ...ruleForm, offsetDays: parseInt(e.target.value) || 0 })}
              />
              <span className="text-sm text-gray-500">dias relativos à data prometida de pagamento</span>
            </div>
            <p className="text-xs text-gray-500 mt-1.5">{formatOffset(ruleForm.offsetDays)}</p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {PRESETS.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setRuleForm({ ...ruleForm, offsetDays: d })}
                  className={`text-xs px-2 py-1 rounded-md border transition-colors ${
                    ruleForm.offsetDays === d
                      ? 'border-primary-300 bg-primary-50 text-primary-700'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {d === 0 ? 'No dia' : d < 0 ? `${Math.abs(d)}d antes` : `+${d}d`}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Template de email <span className="text-red-500">*</span></label>
            {templates.length === 0 ? (
              <p className="text-xs text-amber-600 mt-1">Sem templates disponíveis. Corre a seed para criar os 3 templates default.</p>
            ) : (
              <div className="space-y-1.5">
                {templates.map((t) => {
                  const selected = ruleForm.emailTemplateId === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setTemplateManuallyPicked(true)
                        setRuleForm((f) => ({ ...f, emailTemplateId: t.id }))
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors ${
                        selected
                          ? 'border-primary-300 bg-primary-50 text-primary-700'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        readOnly
                        className="rounded pointer-events-none"
                      />
                      <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="text-sm">{t.name}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {!templateManuallyPicked && !editingRule && (
              <p className="text-xs text-gray-400 mt-1.5">
                Tom sugerido automaticamente a partir dos dias: <strong>{defaultToneNameFor(ruleForm.offsetDays)}</strong>.
              </p>
            )}

            {(() => {
              const tpl = templates.find((t) => t.id === ruleForm.emailTemplateId)
              if (!tpl) return null
              const isEditing = editingTemplateId === tpl.id
              return (
                <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden bg-white">
                  <div className="px-3 py-2 bg-gray-50/60 border-b border-gray-100 flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-xs font-medium text-gray-500">
                      {isEditing ? 'A editar template' : 'Pré-visualização'}
                    </span>
                    <span className="text-[11px] text-gray-400">· {tpl.name}</span>
                    <div className="ml-auto flex items-center gap-1">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={saveTemplate}
                            disabled={updateTemplate.isPending || !tplDraft.subject.trim()}
                            className="text-xs flex items-center gap-1 px-2 py-1 rounded-md bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                            title="Guardar template"
                          >
                            <Save className="w-3 h-3" />
                            Guardar
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditTemplate}
                            disabled={updateTemplate.isPending}
                            className="text-xs flex items-center gap-1 px-2 py-1 rounded-md text-gray-600 hover:bg-gray-100"
                            title="Cancelar"
                          >
                            <X className="w-3 h-3" />
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => startEditTemplate(tpl)}
                          className="text-xs flex items-center gap-1 px-2 py-1 rounded-md text-gray-600 hover:bg-gray-100"
                          title="Editar template"
                        >
                          <Pencil className="w-3 h-3" />
                          Editar
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="px-3 py-2.5 border-b border-gray-50">
                    <div className="text-xs text-gray-400 mb-0.5">Assunto</div>
                    {isEditing ? (
                      <input
                        className="input text-sm w-full"
                        value={tplDraft.subject}
                        onChange={(e) => setTplDraft((d) => ({ ...d, subject: e.target.value }))}
                        placeholder="Assunto do email"
                      />
                    ) : (
                      <div className="text-sm font-medium text-gray-800">{tpl.subject}</div>
                    )}
                  </div>

                  <div className="px-3 py-2.5">
                    <div className="text-xs text-gray-400 mb-1">Corpo</div>
                    {isEditing ? (
                      <textarea
                        className="input font-mono text-xs w-full min-h-[180px] resize-y"
                        value={tplDraft.bodyHtml}
                        onChange={(e) => setTplDraft((d) => ({ ...d, bodyHtml: e.target.value }))}
                        placeholder="<p>HTML do corpo do email...</p>"
                      />
                    ) : (
                      <div
                        className="text-sm text-gray-700 max-h-64 overflow-y-auto prose prose-sm max-w-none [&_p]:my-1.5 [&_strong]:font-semibold"
                        dangerouslySetInnerHTML={{ __html: tpl.bodyHtml }}
                      />
                    )}
                  </div>

                  <div className="px-3 py-2 bg-gray-50/60 border-t border-gray-100 text-[11px] text-gray-400">
                    {isEditing && (
                      <p className="text-amber-700 mb-1">
                        Atenção: a edição altera o template global e afeta todas as regras que o usem.
                      </p>
                    )}
                    Variáveis (<code className="bg-white px-1 rounded">{'{{entidade}}'}</code>,{' '}
                    <code className="bg-white px-1 rounded">{'{{numero}}'}</code>,{' '}
                    <code className="bg-white px-1 rounded">{'{{valor}}'}</code>,{' '}
                    <code className="bg-white px-1 rounded">{'{{pagamento_prometido}}'}</code>,{' '}
                    <code className="bg-white px-1 rounded">{'{{vencimento}}'}</code>) são interpoladas ao enviar.
                  </div>
                </div>
              )
            })()}
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={ruleForm.isActive}
              onChange={(e) => setRuleForm({ ...ruleForm, isActive: e.target.checked })}
              className="rounded"
            />
            <span className="text-sm text-gray-700">Regra ativa</span>
          </label>

          <div className="flex gap-3 pt-2">
            <button onClick={closeModal} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={submitRule}
              disabled={createRule.isPending || updateRule.isPending || !canSubmit}
              className="btn-primary flex-1"
            >
              {editingRule ? 'Guardar' : 'Criar'}
            </button>
          </div>
        </div>
      </Modal>

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
                          {formatOffset(r.offsetDays)}
                          {r.templateName && <span> · Template: {r.templateName}</span>}
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
