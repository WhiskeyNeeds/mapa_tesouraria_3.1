import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/contexts/ToastContext'
import Modal from '@/components/ui/Modal'
import { CheckCircle2 } from 'lucide-react'
import type { FollowupDoc, FollowupDirection } from './types'

type Outcome = 'CONTACTED' | 'NO_ANSWER' | 'COMMITTED_PAYMENT' | 'DISPUTE' | 'OTHER'

interface Props {
  clientId: string
  doc: FollowupDoc
  direction: FollowupDirection
  sourceTaskId?: string
  onClose: () => void
  onLogged: () => void
}

const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: 'CONTACTED', label: 'Contactado' },
  { value: 'NO_ANSWER', label: 'Não atendeu' },
  { value: 'COMMITTED_PAYMENT', label: 'Comprometeu pagamento' },
  { value: 'DISPUTE', label: 'Disputa / litígio' },
  { value: 'OTHER', label: 'Outro' },
]

export default function LogCallModal({ clientId, doc, direction, sourceTaskId, onClose, onLogged }: Props) {
  const toast = useToast()
  const [title, setTitle] = useState(`Chamada — ${doc.entityName || ''} (${doc.reference})`)
  const [description, setDescription] = useState('')
  const [phone, setPhone] = useState('')
  const [outcome, setOutcome] = useState<Outcome>('CONTACTED')
  const [durationMinutes, setDurationMinutes] = useState<string>('')

  const logMut = useMutation({
    mutationFn: () => api.post(`/treasury/${clientId}/followups/log-call`, {
      direction,
      [direction === 'RECEIVABLE' ? 'receivableId' : 'payableId']: doc.id,
      title,
      description: description || undefined,
      phone: phone || undefined,
      outcome,
      durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
      sourceTaskId,
    }),
    onSuccess: () => {
      toast.success('Chamada registada')
      onLogged()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <Modal open onClose={onClose} title="Registar chamada efetuada" size="md">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-700 mb-1 block">Título</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Telefone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Duração (min)</label>
            <input
              type="number"
              min="0"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700 mb-1 block">Resultado</label>
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as Outcome)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          >
            {OUTCOMES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700 mb-1 block">Notas</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="O que foi conversado, próximos passos…"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-y"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-100">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">Cancelar</button>
        <button
          onClick={() => logMut.mutate()}
          disabled={logMut.isPending || !title.trim()}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
        >
          <CheckCircle2 className="w-4 h-4" />
          {logMut.isPending ? 'A registar…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  )
}
