import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/contexts/ToastContext'
import Modal from '@/components/ui/Modal'
import { NotebookPen } from 'lucide-react'
import type { FollowupDoc, FollowupDirection, FollowupImportance } from './types'

interface Props {
  clientId: string
  doc: FollowupDoc
  direction: FollowupDirection
  onClose: () => void
  onCreated: () => void
}

interface UserClientRow {
  user: { id: string; name: string; email: string; isActive: boolean }
}
interface ClientUser {
  id: string
  name: string
  email: string
}

export default function CallTaskModal({ clientId, doc, direction, onClose, onCreated }: Props) {
  const toast = useToast()
  const [title, setTitle] = useState(`Ligar a ${doc.entityName || 'cliente'} — ${doc.reference}`)
  const [description, setDescription] = useState('')
  const [phone, setPhone] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [assignedToId, setAssignedToId] = useState('')
  const [importance, setImportance] = useState<FollowupImportance>('NORMAL')

  const { data: users = [] } = useQuery<ClientUser[]>({
    queryKey: ['client-users', clientId],
    queryFn: async () => {
      const rows = await api.get<UserClientRow[]>(`/clients/${clientId}/users`)
      return rows.filter((r) => r.user.isActive).map((r) => ({ id: r.user.id, name: r.user.name, email: r.user.email }))
    },
    retry: false,
  })

  const createMut = useMutation({
    mutationFn: () => api.post(`/treasury/${clientId}/followups/call-task`, {
      direction,
      [direction === 'RECEIVABLE' ? 'receivableId' : 'payableId']: doc.id,
      title,
      description: description || undefined,
      phone: phone || undefined,
      dueAt: dueAt || undefined,
      assignedToId: assignedToId || undefined,
      importance,
    }),
    onSuccess: () => {
      toast.success('Tarefa de chamada criada')
      onCreated()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <Modal open onClose={onClose} title="Criar tarefa de chamada" size="md">
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
        <div>
          <label className="text-xs font-medium text-gray-700 mb-1 block">Telefone (opcional)</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+351 ..."
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Data limite</label>
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Importância</label>
            <select
              value={importance}
              onChange={(e) => setImportance(e.target.value as FollowupImportance)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            >
              <option value="LOW">Baixa</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">Alta</option>
            </select>
          </div>
        </div>
        {users.length > 0 && (
          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Atribuir a</label>
            <select
              value={assignedToId}
              onChange={(e) => setAssignedToId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            >
              <option value="">— Sem responsável —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-gray-700 mb-1 block">Notas internas</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-y"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-100">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">Cancelar</button>
        <button
          onClick={() => createMut.mutate()}
          disabled={createMut.isPending || !title.trim()}
          className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
        >
          <NotebookPen className="w-4 h-4" />
          {createMut.isPending ? 'A criar…' : 'Criar tarefa'}
        </button>
      </div>
    </Modal>
  )
}
