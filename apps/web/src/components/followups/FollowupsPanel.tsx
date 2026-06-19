import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/contexts/ToastContext'
import {
  Mail, Phone, NotebookPen, StickyNote, Clock, CheckCircle2, AlertCircle, Bell,
  Plus, Trash2, PencilLine, FilePlus2, XCircle, CalendarClock,
  Split, Undo2, CreditCard,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { FollowupDoc, FollowupDirection, TimelineEvent } from './types'
import EmailFollowupModal from './EmailFollowupModal'
import CallTaskModal from './CallTaskModal'
import LogCallModal from './LogCallModal'
import NoteModal from './NoteModal'
import { auditTitle, fieldLabel, formatValue, type DiffPayload } from './auditLabels'

interface Props {
  clientId: string
  doc: FollowupDoc
  direction: FollowupDirection
}

type EventVisual = { icon: LucideIcon; label: string; color: string }

function eventVisual(ev: TimelineEvent): EventVisual {
  if (ev.source === 'followup') {
    switch (ev.kind) {
      case 'EMAIL_SENT': return { icon: Mail, label: 'Email enviado', color: 'bg-blue-50 text-blue-700 border-blue-200' }
      case 'CALL_TASK': return { icon: NotebookPen, label: 'Tarefa', color: 'bg-amber-50 text-amber-700 border-amber-200' }
      case 'CALL_LOGGED': return { icon: Phone, label: 'Chamada registada', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
      case 'NOTE': return { icon: StickyNote, label: 'Nota', color: 'bg-gray-50 text-gray-700 border-gray-200' }
      case 'AUTO_REMINDER': return { icon: Bell, label: 'Lembrete automático', color: 'bg-purple-50 text-purple-700 border-purple-200' }
      default: return { icon: Clock, label: ev.kind, color: 'bg-gray-50 text-gray-700 border-gray-200' }
    }
  }
  // audit event
  if (ev.kind.endsWith('.create')) return { icon: FilePlus2, label: 'Criação', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
  if (ev.kind.endsWith('.update')) return { icon: PencilLine, label: 'Edição', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' }
  if (ev.kind.endsWith('.delete')) return { icon: Trash2, label: 'Eliminada', color: 'bg-red-50 text-red-700 border-red-200' }
  if (ev.kind.endsWith('.pay')) return { icon: CreditCard, label: 'Pago', color: 'bg-teal-50 text-teal-700 border-teal-200' }
  if (ev.kind.endsWith('.settle')) return { icon: CheckCircle2, label: 'Liquidada', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
  if (ev.kind.endsWith('.unsettle')) return { icon: Undo2, label: 'Revertida para Em Aberto', color: 'bg-amber-50 text-amber-700 border-amber-200' }
  // 'partial_payment' removed from visuals — option not shown anymore
  if (ev.kind.endsWith('.void')) return { icon: XCircle, label: 'Anulada', color: 'bg-red-50 text-red-700 border-red-200' }
  if (ev.kind.endsWith('.set_promised_date')) return { icon: CalendarClock, label: 'Data prometida', color: 'bg-blue-50 text-blue-700 border-blue-200' }
  if (ev.kind.endsWith('.split')) return { icon: Split, label: 'Dividida', color: 'bg-purple-50 text-purple-700 border-purple-200' }
  if (ev.kind.endsWith('.unsplit')) return { icon: Undo2, label: 'Divisão desfeita', color: 'bg-gray-50 text-gray-700 border-gray-200' }
  if (ev.kind.endsWith('.reconcile_reverse')) return { icon: Undo2, label: 'Conciliação revertida', color: 'bg-amber-50 text-amber-700 border-amber-200' }
  if (ev.kind.endsWith('.reconcile')) return { icon: CreditCard, label: 'Conciliada', color: 'bg-teal-50 text-teal-700 border-teal-200' }
  if (ev.kind.endsWith('.set_ready_to_pay')) return { icon: CalendarClock, label: 'Pronta para pagar', color: 'bg-blue-50 text-blue-700 border-blue-200' }
  return { icon: Clock, label: ev.kind, color: 'bg-gray-50 text-gray-700 border-gray-200' }
}

function formatWhen(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Prazo relativo (em dias) de uma tarefa + tom semântico para a etiqueta.
 *  Compara só a data (ignora horas) para "hoje/amanhã" serem intuitivos. */
function dueRelative(iso: string): { label: string; tone: 'overdue' | 'today' | 'soon' | 'future' } {
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
  const today = startOfDay(new Date())
  const due = startOfDay(new Date(iso))
  const days = Math.round((due.getTime() - today.getTime()) / 86400000)
  if (days < 0) return { label: days === -1 ? 'atrasada 1 dia' : `atrasada ${-days} dias`, tone: 'overdue' }
  if (days === 0) return { label: 'hoje', tone: 'today' }
  if (days === 1) return { label: 'amanhã', tone: 'soon' }
  return { label: `daqui a ${days} dias`, tone: days <= 3 ? 'soon' : 'future' }
}

export default function FollowupsPanel({ clientId, doc, direction }: Props) {
  const queryClient = useQueryClient()
  const toast = useToast()

  const [showEmail, setShowEmail] = useState(false)
  const [showCallTask, setShowCallTask] = useState(false)
  const [showLogCall, setShowLogCall] = useState<{ taskId?: string } | null>(null)
  const [showNote, setShowNote] = useState(false)
  type Filter = 'ALL' | 'EMAIL' | 'TASK' | 'CALL' | 'NOTE' | 'CHANGES'
  type ActionPanel = 'EMAIL' | 'TASK' | 'CALL' | 'NOTE'
  const [filter, setFilter] = useState<Filter>('ALL')
  const [expandedAction, setExpandedAction] = useState<ActionPanel | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const idKey = direction === 'RECEIVABLE' ? 'receivableId' : 'payableId'
  const queryKey = ['activity', clientId, direction, doc.id]

  // Polling: refetch a cada 3s enquanto o componente está visível.
  // refetchIntervalInBackground: false → pausa quando o separador do browser
  // está em background (poupa rede/bateria). Combinado com a invalidação
  // imediata em mutações locais, dá a sensação de tempo real.
  const { data: events = [], isLoading } = useQuery<TimelineEvent[]>({
    queryKey,
    queryFn: () => api.get(`/treasury/${clientId}/activity?${idKey}=${doc.id}`),
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  })

  // Plano de follow-up: define que ações ficam visíveis no painel. Vem de
  // TreasurySettings; cai em "tudo ligado" antes da empresa configurar.
  const { data: planSettings } = useQuery<Partial<{
    followupEnableEmail: boolean
    followupEnableCallTask: boolean
    followupEnableLogCall: boolean
    followupEnableNote: boolean
    followupEnablePdfUpload: boolean
  }>>({
    queryKey: ['settings', clientId],
    queryFn: () => api.get(`/treasury/${clientId}/settings`),
  })
  const plan = {
    email: planSettings?.followupEnableEmail ?? true,
    callTask: planSettings?.followupEnableCallTask ?? true,
    logCall: planSettings?.followupEnableLogCall ?? true,
    note: planSettings?.followupEnableNote ?? true,
    pdfUpload: planSettings?.followupEnablePdfUpload ?? true,
  }
  const anyActionEnabled = plan.email || plan.callTask || plan.logCall || plan.note

  const completeTask = useMutation({
    mutationFn: (id: string) => api.patch(`/treasury/${clientId}/followups/${id}`, { status: 'DONE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      toast.success('Tarefa marcada como concluída')
    },
  })

  const deleteFollowup = useMutation({
    mutationFn: (id: string) => api.delete(`/treasury/${clientId}/followups/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      toast.success('Acompanhamento removido')
    },
  })

  const filtered = events.filter((ev) => {
    if (filter === 'ALL') return true
    if (filter === 'EMAIL') return ev.kind === 'EMAIL_SENT'
    if (filter === 'TASK') return ev.kind === 'CALL_TASK'
    if (filter === 'CALL') return ev.kind === 'CALL_LOGGED'
    if (filter === 'NOTE') return ev.kind === 'NOTE' || ev.kind === 'AUTO_REMINDER'
    if (filter === 'CHANGES') return ev.source === 'audit'
    return true
  })

  // Configuração de cada ação — usada pela grelha 2x2 e pelo painel inline.
  const actions: { key: ActionPanel; label: string; icon: LucideIcon; enabled: boolean; matches: (kind: string) => boolean; ctaLabel: string; ctaColor: string; onCreate: () => void; emptyHint: string }[] = [
    { key: 'EMAIL', label: 'Email', icon: Mail, enabled: plan.email, matches: (k) => k === 'EMAIL_SENT', ctaLabel: 'Novo email', ctaColor: 'bg-blue-600 hover:bg-blue-700', onCreate: () => setShowEmail(true), emptyHint: 'Ainda nenhum email enviado.' },
    { key: 'TASK', label: 'Tarefas', icon: NotebookPen, enabled: plan.callTask, matches: (k) => k === 'CALL_TASK', ctaLabel: 'Nova tarefa', ctaColor: 'bg-amber-600 hover:bg-amber-700', onCreate: () => setShowCallTask(true), emptyHint: 'Ainda nenhuma tarefa criada.' },
    { key: 'CALL', label: 'Chamadas', icon: Phone, enabled: plan.logCall, matches: (k) => k === 'CALL_LOGGED', ctaLabel: 'Registar chamada', ctaColor: 'bg-emerald-600 hover:bg-emerald-700', onCreate: () => setShowLogCall({}), emptyHint: 'Ainda nenhuma chamada registada.' },
    { key: 'NOTE', label: 'Notas', icon: StickyNote, enabled: plan.note, matches: (k) => k === 'NOTE' || k === 'AUTO_REMINDER', ctaLabel: 'Nova nota', ctaColor: 'bg-gray-700 hover:bg-gray-800', onCreate: () => setShowNote(true), emptyHint: 'Ainda nenhuma nota.' },
  ]
  const activeAction = actions.find((a) => a.key === expandedAction) ?? null
  const activeActionItems = activeAction
    ? events.filter((ev) => ev.source === 'followup' && activeAction.matches(ev.kind))
    : []

  // Próximas tarefas: CALL_TASK pendentes com prazo definido, ordenadas pela data
  // mais próxima primeiro (inclui atrasadas, as mais urgentes), limitadas a 4.
  const upcomingTasks = events
    .filter((ev) => ev.source === 'followup' && ev.kind === 'CALL_TASK' && ev.status === 'PENDING' && ev.dueAt)
    .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))
    .slice(0, 4)
  const dueToneCls: Record<string, string> = {
    overdue: 'bg-red-100 text-red-700',
    today: 'bg-amber-100 text-amber-700',
    soon: 'bg-amber-50 text-amber-600',
    future: 'bg-gray-100 text-gray-500',
  }

  return (
    <div className="space-y-4">
      {/* Ações */}
      {anyActionEnabled ? (
        <div className="grid grid-cols-2 gap-2">
          {actions.filter((a) => a.enabled).map((a) => {
            const open = expandedAction === a.key
            // Cor própria de cada ação, em vez de azul-primário para todas
            const activeCls =
              a.key === 'EMAIL' ? 'bg-blue-600 text-white border-blue-600 shadow-sm' :
                a.key === 'TASK' ? 'bg-amber-600 text-white border-amber-600 shadow-sm' :
                  a.key === 'CALL' ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm' :
                    'bg-gray-700 text-white border-gray-700 shadow-sm'
            const idleCls =
              a.key === 'EMAIL' ? 'bg-blue-50 text-blue-700 border-blue-200 hover:-translate-y-0.5 hover:shadow-card-md' :
                a.key === 'TASK' ? 'bg-amber-50 text-amber-700 border-amber-200 hover:-translate-y-0.5 hover:shadow-card-md' :
                  a.key === 'CALL' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:-translate-y-0.5 hover:shadow-card-md' :
                    'bg-gray-50 text-gray-700 border-gray-200 hover:-translate-y-0.5 hover:shadow-card-md'
            const chipCls = open ? 'bg-white/20 text-white' :
              a.key === 'EMAIL' ? 'bg-blue-100 text-blue-600' :
                a.key === 'TASK' ? 'bg-amber-100 text-amber-600' :
                  a.key === 'CALL' ? 'bg-emerald-100 text-emerald-600' :
                    'bg-gray-200 text-gray-600'
            return (
              <button
                key={a.key}
                onClick={() => setExpandedAction(open ? null : a.key)}
                className={`flex w-full items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border transition-all duration-200 ${open ? activeCls : idleCls}`}
              >
                <span className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${chipCls}`}>
                  <a.icon className="w-3.5 h-3.5" />
                </span>
                {a.label}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="text-xs text-gray-400 italic px-3 py-2 border border-dashed border-gray-200 rounded-lg">
          Todas as ações de acompanhamento estão desativadas. Activa-as em Definições → Follow up plan.
        </div>
      )}

      {/* Painel inline da ação selecionada */}
      {activeAction && (
        <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/50 space-y-3">
          {/* Cabeçalho + botão "+ Novo X" no topo — fica sempre visível,
              independentemente de quantos registos estão na lista abaixo. */}
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
              {activeAction.label} — {activeActionItems.length} {activeActionItems.length === 1 ? 'registo' : 'registos'}
            </div>
            <button onClick={() => setExpandedAction(null)} className="text-xs text-gray-400 hover:text-gray-700">Fechar</button>
          </div>

          <button
            onClick={activeAction.onCreate}
            className={`flex items-center justify-center gap-2 w-full px-3 py-2 text-white text-sm font-medium rounded-lg transition-colors ${activeAction.ctaColor}`}
          >
            <Plus className="w-4 h-4" />
            {activeAction.ctaLabel}
          </button>

          {activeActionItems.length === 0 ? (
            <div className="text-xs text-gray-400 italic px-1 py-2">{activeAction.emptyHint}</div>
          ) : (
            <ol className="space-y-2 relative max-h-72 overflow-y-auto">
              <div className="absolute left-[15px] top-2 bottom-2 w-px bg-gradient-to-b from-gray-200 via-gray-200 to-transparent" />
              {activeActionItems.map((ev) => (
                <TimelineItem
                  key={`inline-${ev.id}`}
                  ev={ev}
                  clientId={clientId}
                  direction={direction}
                  expanded={expandedId === ev.id}
                  onToggleExpand={() => setExpandedId(expandedId === ev.id ? null : ev.id)}
                  onComplete={() => completeTask.mutate(ev.id)}
                  onLogCall={(taskId) => setShowLogCall({ taskId })}
                  onDelete={() => {
                    if (!confirm('Remover este acompanhamento do histórico?')) return
                    deleteFollowup.mutate(ev.id)
                  }}
                />
              ))}
            </ol>
          )}
        </div>
      )}

      {/* Próximas tarefas — destaque das CALL_TASK pendentes com prazo, ordenadas
          pela data mais próxima. Atalho de "concluir"/"registar" em cada uma. */}
      {upcomingTasks.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 uppercase tracking-wider">
            <CalendarClock className="w-3.5 h-3.5" />
            Próximas tarefas
            <span className="ml-auto text-amber-600 font-normal normal-case">{upcomingTasks.length}</span>
          </div>
          <ul className="space-y-1.5">
            {upcomingTasks.map((ev) => {
              const rel = dueRelative(ev.dueAt!)
              return (
                <li key={`upcoming-${ev.id}`} className="flex items-center gap-2 rounded-lg bg-white border border-amber-100 px-2.5 py-1.5">
                  <NotebookPen className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-gray-900 truncate">{ev.title ?? 'Tarefa'}</div>
                    {ev.assignedTo && <div className="text-[10.5px] text-gray-400 truncate">atribuída a {ev.assignedTo.name}</div>}
                  </div>
                  <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap ${dueToneCls[rel.tone]}`} title={`prazo: ${formatWhen(ev.dueAt!)}`}>
                    {rel.label}
                  </span>
                  <button
                    onClick={() => setShowLogCall({ taskId: ev.id })}
                    className="text-[11px] text-emerald-600 hover:text-emerald-700 font-medium px-1.5 py-0.5 rounded hover:bg-emerald-50 flex-shrink-0"
                    title="Registar chamada efetuada"
                  >
                    Registar
                  </button>
                  <button
                    onClick={() => completeTask.mutate(ev.id)}
                    className="text-gray-400 hover:text-gray-700 p-0.5 rounded hover:bg-gray-100 flex-shrink-0"
                    title="Marcar concluída"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Filtros da linha temporal (todos os eventos) */}
      <div className="flex flex-wrap gap-1.5 text-xs">
        {([
          ['ALL', 'Tudo'],
          ['EMAIL', 'Email'],
          ['TASK', 'Tarefas'],
          ['CALL', 'Chamadas'],
          ['NOTE', 'Notas'],
          ['CHANGES', 'Alterações'],
        ] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-2.5 py-1 rounded-full border transition-colors ${filter === k ? 'bg-blue-600 text-white border-blue-600 font-medium shadow-sm' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300 hover:text-gray-700'}`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="border-t border-gray-100 pt-3">
        <div className="flex items-center gap-2 mb-3">
          <div className="text-xs font-semibold text-gray-700 uppercase tracking-wider">Linha temporal</div>
          {/* Pulso "ao vivo" — reflete o polling a cada 3s */}
          <span className="relative flex h-1.5 w-1.5" title="Atualiza em tempo real">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
          </span>
        </div>
        {isLoading ? (
          <div className="text-sm text-gray-400">A carregar…</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-gray-400 text-sm">
            <Clock className="w-8 h-8 mb-2 opacity-30" />
            Sem follow-ups registados
          </div>
        ) : (
          <ol className="space-y-3 relative">
            <div className="absolute left-[15px] top-2 bottom-2 w-px bg-gradient-to-b from-gray-200 via-gray-200 to-transparent" />
            {filtered.map((ev) => (
              <TimelineItem
                key={`${ev.source}-${ev.id}`}
                ev={ev}
                clientId={clientId}
                direction={direction}
                expanded={expandedId === ev.id}
                onToggleExpand={() => setExpandedId(expandedId === ev.id ? null : ev.id)}
                onComplete={() => completeTask.mutate(ev.id)}
                onLogCall={(taskId) => setShowLogCall({ taskId })}
                onDelete={() => {
                  if (!confirm('Remover este acompanhamento do histórico?')) return
                  deleteFollowup.mutate(ev.id)
                }}
              />
            ))}
          </ol>
        )}
      </div>

      {showEmail && (
        <EmailFollowupModal
          clientId={clientId}
          doc={doc}
          direction={direction}
          onClose={() => setShowEmail(false)}
          onSent={() => { queryClient.invalidateQueries({ queryKey }); setShowEmail(false) }}
        />
      )}
      {showCallTask && (
        <CallTaskModal
          clientId={clientId}
          doc={doc}
          direction={direction}
          onClose={() => setShowCallTask(false)}
          onCreated={() => { queryClient.invalidateQueries({ queryKey }); setShowCallTask(false) }}
        />
      )}
      {showLogCall && (
        <LogCallModal
          clientId={clientId}
          doc={doc}
          direction={direction}
          sourceTaskId={showLogCall.taskId}
          onClose={() => setShowLogCall(null)}
          onLogged={() => { queryClient.invalidateQueries({ queryKey }); setShowLogCall(null) }}
        />
      )}
      {showNote && (
        <NoteModal
          clientId={clientId}
          doc={doc}
          direction={direction}
          onClose={() => setShowNote(false)}
          onSaved={() => { queryClient.invalidateQueries({ queryKey }); setShowNote(false) }}
        />
      )}
    </div>
  )
}

interface TimelineItemProps {
  ev: TimelineEvent
  expanded: boolean
  onToggleExpand: () => void
  onComplete: () => void
  onLogCall: (taskId: string) => void
  onDelete: () => void
  clientId: string
  direction: FollowupDirection
}
function TimelineItem({ ev, expanded, onToggleExpand, onComplete, onLogCall, onDelete, clientId, direction }: TimelineItemProps) {
  const { icon: Icon, label, color } = eventVisual(ev)
  const isPending = ev.status === 'PENDING'
  const isFailed = ev.status === 'FAILED'
  const isFollowup = ev.source === 'followup'
  const plannedType = (ev.payload as Record<string, unknown> | null)?.plannedType

  const headline = isFollowup ? (ev.title ?? label) : auditTitle(ev.kind, ev.payload)

  return (
    <li className="relative pl-10 animate-fade-in">
      <span className={`absolute left-0 top-0 w-8 h-8 rounded-full border flex items-center justify-center ring-2 ring-white shadow-sm ${color}`}>
        <Icon className="w-4 h-4" />
      </span>
      <div
        className="bg-white border border-gray-100 rounded-lg p-3 shadow-sm cursor-pointer transition-all duration-200 hover:border-gray-200 hover:shadow-card-md"
        onClick={onToggleExpand}
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>{label}</span>
              {isPending && <span className="text-amber-600 font-medium flex items-center gap-1"><AlertCircle className="w-3 h-3" /> pendente</span>}
              {isFailed && <span className="text-red-600 font-medium">falhou</span>}
              {ev.importance === 'HIGH' && <span className="text-red-600 font-medium">⚑ alta prioridade</span>}
            </div>
            <div className="text-sm font-medium text-gray-900 truncate">{headline}</div>
          </div>
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {isPending && ev.kind === 'CALL_TASK' && plannedType !== 'TASK' && (
              <button
                onClick={() => onLogCall(ev.id)}
                className="text-xs text-emerald-600 hover:text-emerald-700 font-medium px-2 py-1 rounded hover:bg-emerald-50"
                title="Registar chamada efetuada"
              >
                Registar
              </button>
            )}
            {isPending && (
              <button onClick={onComplete} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100" title="Marcar concluído">
                <CheckCircle2 className="w-3.5 h-3.5" />
              </button>
            )}
            {isFollowup && (
              <button onClick={onDelete} className="text-xs text-gray-400 hover:text-red-500 px-1 py-1 rounded" title="Remover">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        {ev.description && (
          <div className="text-xs text-gray-600 whitespace-pre-wrap mb-1">{ev.description}</div>
        )}
        <div className="flex items-center justify-between text-[11px] text-gray-400">
          <span>{formatWhen(ev.createdAt)} · {ev.createdBy?.name ?? 'Sistema'}</span>
          {ev.dueAt && isPending && <span className="text-amber-600">prazo: {formatWhen(ev.dueAt)}</span>}
          {ev.assignedTo && <span>atribuído a {ev.assignedTo.name}</span>}
        </div>

        {expanded && <ExpandedDetails ev={ev} clientId={clientId} direction={direction} />}
      </div>
    </li>
  )
}

function ExpandedDetails({ ev, clientId, direction }: { ev: TimelineEvent; clientId: string; direction: 'RECEIVABLE' | 'PAYABLE' }) {
  if (!ev.payload) return null
  const p = ev.payload as Record<string, unknown>

  // Fetch categories and budgets to show names instead of ids
  const type = direction === 'RECEIVABLE' ? 'REVENUE' : 'EXPENSE'
  const { data: categories = [] } = useQuery<{ id: string; name: string }[]>({ queryKey: ['followups-categories', clientId, type], queryFn: () => api.get(`/treasury/${clientId}/categories?type=${type}`), enabled: !!clientId })
  const { data: budgets = [] } = useQuery<{ id: string; name: string }[]>({ queryKey: ['followups-budgets', clientId, type], queryFn: () => api.get(`/treasury/${clientId}/budgets?type=${type}&status=ACTIVE`), enabled: !!clientId })

  // Helper to render values more nicely
  const displayValue = (field: string, value: unknown) => {
    if (value === null || value === undefined) return '—'
    if (field === 'categoryId') return String(categories.find((c: any) => c.id === value)?.name ?? value)
    if (field === 'budgetId') return String(budgets.find((b: any) => b.id === value)?.name ?? value)
    if (typeof value === 'object') {
      const obj: any = value as any
      if (obj == null) return '—'
      if (obj.number) return `TOConline ${obj.number}`
      if (obj.id) return `TOConline ${obj.id}`
      if (obj.name) return String(obj.name)
      try { return JSON.stringify(obj) } catch { return String(obj) }
    }
    return formatValue(field, value)
  }

  // Diff (audit.update)
  if ((ev.kind.endsWith('.update')) && (p as DiffPayload).changes) {
    const changes = (p as DiffPayload).changes!
    const visible = Object.entries(changes).filter(([field]) => !field.startsWith('_'))
    if (visible.length === 0) return null

    // If it's a single change to categoryId or budgetId, show a short human sentence.
    if (visible.length === 1) {
      const [field, { from, to }] = visible[0]
      if (field === 'categoryId' || field === 'budgetId') {
        return (
          <div className="mt-2 pt-2 border-t border-gray-100 text-xs">
            <div className="text-sm text-gray-900 font-medium">{field === 'categoryId' ? 'Categoria alterada' : 'Budget alterado'}</div>
            <div className="text-xs text-gray-600">Mudou de <span className="font-medium text-gray-800">{displayValue(field, from)}</span> para <span className="font-medium text-gray-800">{displayValue(field, to)}</span></div>
          </div>
        )
      }
    }

    return (
      <div className="mt-2 pt-2 border-t border-gray-100 text-xs">
        <table className="w-full">
          <thead className="text-gray-400">
            <tr><th className="text-left font-medium pb-1">Campo</th><th className="text-left font-medium pb-1">Antes</th><th className="text-left font-medium pb-1">Depois</th></tr>
          </thead>
          <tbody>
            {visible.map(([field, { from, to }]) => (
              <tr key={field} className="border-t border-gray-50">
                <td className="py-1 font-medium text-gray-700">{fieldLabel(field)}</td>
                <td className="py-1 text-gray-500">{displayValue(field, from)}</td>
                <td className="py-1 text-gray-900">{displayValue(field, to)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // Email enviado — destinatários + preview + erro
  if (ev.kind === 'EMAIL_SENT') {
    const to = Array.isArray(p.to) ? (p.to as string[]).join(', ') : ''
    const cc = Array.isArray(p.cc) && (p.cc as string[]).length > 0 ? (p.cc as string[]).join(', ') : null
    const bodyPreview = typeof p.bodyPreview === 'string' ? p.bodyPreview : null
    const error = typeof p.error === 'string' ? p.error : null
    return (
      <div className="mt-2 pt-2 border-t border-gray-100 text-xs space-y-1">
        {to && <div><span className="text-gray-400">Para: </span><span className="text-gray-700">{to}</span></div>}
        {cc && <div><span className="text-gray-400">Cc: </span><span className="text-gray-700">{cc}</span></div>}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-2 text-red-700 mt-1">
            <div className="font-medium mb-0.5">Erro do servidor:</div>
            <div className="font-mono text-[10px] whitespace-pre-wrap break-all">{error}</div>
          </div>
        )}
        {bodyPreview && (
          <details className="mt-1">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700">Ver pré-visualização</summary>
            <div className="mt-1 p-2 bg-gray-50 rounded text-gray-600 max-h-40 overflow-y-auto" dangerouslySetInnerHTML={{ __html: bodyPreview }} />
          </details>
        )}
      </div>
    )
  }

  // Call logged — outcome + duração
  if (ev.kind === 'CALL_LOGGED') {
    const outcome = typeof p.outcome === 'string' ? p.outcome : null
    const duration = typeof p.durationMinutes === 'number' ? p.durationMinutes : null
    const phone = typeof p.phone === 'string' ? p.phone : null
    if (!outcome && !duration && !phone) return null
    return (
      <div className="mt-2 pt-2 border-t border-gray-100 text-xs space-y-0.5">
        {phone && <div><span className="text-gray-400">Telefone: </span><span className="text-gray-700">{phone}</span></div>}
        {duration !== null && <div><span className="text-gray-400">Duração: </span><span className="text-gray-700">{duration} min</span></div>}
        {outcome && <div><span className="text-gray-400">Resultado: </span><span className="text-gray-700">{outcome}</span></div>}
      </div>
    )
  }

  // Snapshot na criação
  if (ev.kind.endsWith('.create') && p.snapshot) {
    const s = p.snapshot as Record<string, unknown>
    return (
      <div className="mt-2 pt-2 border-t border-gray-100 text-xs space-y-0.5">
        {Object.entries(s).map(([k, v]) => (
          v != null && (
            <div key={k}>
              <span className="text-gray-400">{fieldLabel(k)}: </span>
              <span className="text-gray-700">{formatValue(k, v)}</span>
            </div>
          )
        ))}
      </div>
    )
  }

  return null
}
