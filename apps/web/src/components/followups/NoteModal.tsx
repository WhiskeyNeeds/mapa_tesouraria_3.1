import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/contexts/ToastContext'
import Modal from '@/components/ui/Modal'
import { StickyNote } from 'lucide-react'
import type { FollowupDoc, FollowupDirection } from './types'

interface Props {
  clientId: string
  doc: FollowupDoc
  direction: FollowupDirection
  onClose: () => void
  onSaved: () => void
}

export default function NoteModal({ clientId, doc, direction, onClose, onSaved }: Props) {
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  const saveMut = useMutation({
    mutationFn: () => api.post(`/treasury/${clientId}/followups/note`, {
      direction,
      [direction === 'RECEIVABLE' ? 'receivableId' : 'payableId']: doc.id,
      title: title || undefined,
      description,
    }),
    onSuccess: () => {
      toast.success('Nota guardada')
      onSaved()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <Modal open onClose={onClose} title="Adicionar nota" size="md">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-700 mb-1 block">Título (opcional)</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-700 mb-1 block">Conteúdo</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm resize-y"
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-100">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">Cancelar</button>
        <button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending || !description.trim()}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          <StickyNote className="w-4 h-4" />
          {saveMut.isPending ? 'A guardar…' : 'Guardar'}
        </button>
      </div>
    </Modal>
  )
}
