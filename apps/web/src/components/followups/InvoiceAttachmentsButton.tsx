import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, API_BASE } from '@/lib/api'
import { useToast } from '@/contexts/ToastContext'
import { Paperclip, FileText, Trash2, Download, Loader2, UploadCloud } from 'lucide-react'
import type { FollowupDirection, InvoiceAttachment } from './types'

interface Props {
  clientId: string
  direction: FollowupDirection
  docId: string
  /** "LOCAL" mostra dica diferente quando lista vazia. Tudo o que não for LOCAL trata como TOConline. */
  origin?: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatShortDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' })
}

/**
 * Botão de anexos PDF junto ao valor da fatura. Abre um popover com a lista,
 * suporta drag-and-drop e click-to-upload. Usado no painel lateral de detalhes
 * de uma fatura.
 */
export default function InvoiceAttachmentsButton({ clientId, direction, docId, origin }: Props) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const idKey = direction === 'RECEIVABLE' ? 'receivableId' : 'payableId'

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const { data: attachments = [] } = useQuery<InvoiceAttachment[]>({
    queryKey: ['attachments', clientId, direction, docId],
    queryFn: () => api.get(`/treasury/${clientId}/invoice-attachments?${idKey}=${docId}`),
  })

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      form.append(idKey, docId)
      const res = await fetch(`${API_BASE}/treasury/${clientId}/invoice-attachments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
        body: form,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Falha no upload' }))
        throw new Error(err.error || 'Falha no upload')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attachments', clientId, direction, docId] })
      toast.success('PDF anexado')
    },
    onError: (err) => toast.error((err as Error).message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/treasury/${clientId}/invoice-attachments/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', clientId, direction, docId] }),
    onError: (err) => toast.error((err as Error).message),
  })

  function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    if (file.type !== 'application/pdf') {
      toast.error('Apenas ficheiros PDF são aceites')
      return
    }
    upload.mutate(file)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    handleFiles(e.target.files)
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }

  const hasAttachments = attachments.length > 0
  const isTocAware = origin && origin !== 'LOCAL'

  return (
    <div className="relative w-full" ref={ref}>
      {/* Botão de ação a toda a largura, alinhado com os restantes do painel. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={hasAttachments ? `${attachments.length} documento${attachments.length === 1 ? '' : 's'} anexo${attachments.length === 1 ? '' : 's'}` : 'Anexar Documento'}
        className={`w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-colors group ${open
          ? 'border-gray-300 bg-gray-100'
          : 'border-gray-200 hover:bg-gray-50 hover:border-gray-300'
          }`}
      >
        <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 group-hover:bg-gray-200 transition-colors">
          <Paperclip className="w-4 h-4 text-gray-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 text-sm">Anexar Documento</div>
          <div className="text-xs text-gray-500 truncate">
            {hasAttachments
              ? `${attachments.length} documento${attachments.length === 1 ? '' : 's'} anexo${attachments.length === 1 ? '' : 's'}`
              : 'PDF da fatura ou comprovativos'}
          </div>
        </div>
        {hasAttachments && (
          <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-full bg-gray-200 text-gray-700 text-xs font-semibold tabular-nums flex-shrink-0">
            {attachments.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 bottom-full mb-2 z-30 w-80 bg-white border border-gray-200 rounded-xl shadow-card-lg overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gradient-to-b from-gray-50/60 to-white">
            <div className="flex items-center gap-2">
              <Paperclip className="w-3.5 h-3.5 text-gray-400" />
              <span className="text-sm font-semibold text-gray-800">Anexos PDF</span>
              {hasAttachments && (
                <span className="text-xs text-gray-400 tabular-nums">· {attachments.length}</span>
              )}
            </div>
          </div>

          {/* Dropzone / botão upload — sempre presente, mas adapta-se ao estado */}
          <label
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`relative mx-3 mt-3 flex items-center justify-center gap-2 px-3 py-3 rounded-lg border-2 border-dashed cursor-pointer transition-all ${dragOver
              ? 'border-blue-400 bg-blue-50'
              : upload.isPending
                ? 'border-gray-200 bg-gray-50/80 cursor-wait'
                : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/40'
              }`}
          >
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={handleFileSelect}
              disabled={upload.isPending}
            />
            {upload.isPending ? (
              <>
                <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                <span className="text-xs text-gray-500">A carregar PDF...</span>
              </>
            ) : (
              <>
                <UploadCloud className={`w-4 h-4 ${dragOver ? 'text-blue-500' : 'text-gray-400'}`} />
                <span className={`text-xs font-medium ${dragOver ? 'text-blue-700' : 'text-gray-600'}`}>
                  {dragOver ? 'Largue para anexar' : 'Arraste ou clique para anexar PDF'}
                </span>
              </>
            )}
          </label>

          {/* Estado vazio (apenas hint) */}
          {!hasAttachments && (
            <div className="px-4 py-3 text-xs text-gray-400 italic text-center">
              {isTocAware
                ? 'O PDF do TOConline será incluído automaticamente.'
                : 'Sem PDFs anexos ainda.'}
            </div>
          )}

          {/* Lista de anexos */}
          {hasAttachments && (
            <ul className="px-2 py-2 max-h-64 overflow-y-auto">
              {attachments.map((a) => (
                <li key={a.id} className="group flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors">
                  <div className="w-8 h-9 flex items-center justify-center rounded-md bg-red-50 border border-red-100 flex-shrink-0">
                    <FileText className="w-4 h-4 text-red-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <a
                      href={`${API_BASE}/treasury/${clientId}/invoice-attachments/${a.id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-sm font-medium text-gray-800 hover:text-blue-700 truncate"
                    >
                      {a.filename}
                    </a>
                    <div className="text-xs text-gray-400 flex items-center gap-1.5">
                      <span className="tabular-nums">{formatSize(a.size)}</span>
                      <span>·</span>
                      <span>{formatShortDate(a.createdAt)}</span>
                      {a.uploadedBy?.name && (
                        <>
                          <span>·</span>
                          <span className="truncate">{a.uploadedBy.name}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <a
                      href={`${API_BASE}/treasury/${clientId}/invoice-attachments/${a.id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Abrir / descarregar"
                      className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                    <button
                      onClick={() => { if (confirm(`Remover "${a.filename}"?`)) remove.mutate(a.id) }}
                      title="Remover"
                      className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
