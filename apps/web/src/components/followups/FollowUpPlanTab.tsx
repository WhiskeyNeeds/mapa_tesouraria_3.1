import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/contexts/ToastContext'
import { Mail, NotebookPen, CheckCircle2, StickyNote, Paperclip } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface FollowupSettings {
  followupEnableEmail: boolean
  followupEnableCallTask: boolean
  followupEnableLogCall: boolean
  followupEnableNote: boolean
  followupEnablePdfUpload: boolean
}

interface Props { clientId: string }

const OPTIONS: { key: keyof FollowupSettings; label: string; description: string; icon: LucideIcon }[] = [
  { key: 'followupEnableEmail',      label: 'Enviar email',     description: 'Permite compor e enviar emails diretamente do painel.', icon: Mail },
  { key: 'followupEnableCallTask',   label: 'Criar tarefa',     description: 'Permite criar tarefas de seguimento atribuíveis a utilizadores.', icon: NotebookPen },
  { key: 'followupEnableLogCall',    label: 'Registar chamada', description: 'Permite registar chamadas efetuadas (com resultado, duração, notas).', icon: CheckCircle2 },
  { key: 'followupEnableNote',       label: 'Adicionar nota',   description: 'Permite adicionar notas livres associadas à fatura.', icon: StickyNote },
  { key: 'followupEnablePdfUpload',  label: 'Anexar PDFs',      description: 'Permite anexar manualmente ficheiros PDF à fatura.', icon: Paperclip },
]

const DEFAULT_STATE: FollowupSettings = {
  followupEnableEmail: true,
  followupEnableCallTask: true,
  followupEnableLogCall: true,
  followupEnableNote: true,
  followupEnablePdfUpload: true,
}

export default function FollowUpPlanTab({ clientId }: Props) {
  const qc = useQueryClient()
  const toast = useToast()
  const [state, setState] = useState<FollowupSettings>(DEFAULT_STATE)

  const { data: settings, isLoading } = useQuery<Partial<FollowupSettings>>({
    queryKey: ['settings', clientId],
    queryFn: () => api.get(`/treasury/${clientId}/settings`),
  })

  useEffect(() => {
    if (!settings) return
    setState({
      followupEnableEmail: settings.followupEnableEmail ?? true,
      followupEnableCallTask: settings.followupEnableCallTask ?? true,
      followupEnableLogCall: settings.followupEnableLogCall ?? true,
      followupEnableNote: settings.followupEnableNote ?? true,
      followupEnablePdfUpload: settings.followupEnablePdfUpload ?? true,
    })
  }, [settings])

  const saveMut = useMutation({
    mutationFn: (patch: Partial<FollowupSettings>) =>
      api.patch(`/treasury/${clientId}/settings`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', clientId] })
      qc.invalidateQueries({ queryKey: ['followup-settings', clientId] })
      toast.success('Plano atualizado')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function toggle(key: keyof FollowupSettings) {
    const next = { ...state, [key]: !state[key] }
    setState(next)
    saveMut.mutate({ [key]: next[key] })
  }

  if (isLoading) return <div className="text-sm text-gray-400">A carregar…</div>

  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-gray-500">
        Define que ações ficam disponíveis no separador <strong>Acompanhamentos</strong> de cada fatura.
        As alterações aplicam-se a todos os utilizadores desta empresa.
      </p>

      <div className="space-y-2">
        {OPTIONS.map(({ key, label, description, icon: Icon }) => {
          const enabled = state[key]
          return (
            <div
              key={key}
              className={`flex items-start justify-between gap-4 p-4 border rounded-lg transition-colors ${
                enabled ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-70'
              }`}
            >
              <div className="flex items-start gap-3 min-w-0">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${enabled ? 'bg-primary-50 text-primary-700' : 'bg-gray-100 text-gray-400'}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900">{label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{description}</div>
                </div>
              </div>
              <button
                onClick={() => toggle(key)}
                disabled={saveMut.isPending}
                className={`shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  enabled ? 'bg-primary-600' : 'bg-gray-300'
                } disabled:opacity-50`}
                aria-pressed={enabled}
              >
                <span className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
