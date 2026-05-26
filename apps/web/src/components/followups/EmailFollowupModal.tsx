import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useToast } from '@/contexts/ToastContext'
import Modal from '@/components/ui/Modal'
import { Send, Paperclip } from 'lucide-react'
import type { EmailTemplate, FollowupDoc, FollowupDirection, FollowupVariable, InvoiceAttachment } from './types'

interface Props {
  clientId: string
  doc: FollowupDoc
  direction: FollowupDirection
  onClose: () => void
  onSent: () => void
}

function isReceivable(direction: FollowupDirection) {
  return direction === 'RECEIVABLE'
}

export default function EmailFollowupModal({ clientId, doc, direction, onClose, onSent }: Props) {
  const toast = useToast()
  const idKey = isReceivable(direction) ? 'receivableId' : 'payableId'
  const tocId = isReceivable(direction) ? doc.tocSalesDocId : doc.tocPurchasesDocId

  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [templateId, setTemplateId] = useState<string>('')
  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [attachInvoicePdf, setAttachInvoicePdf] = useState(!!tocId)
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>([])

  const { data: templates = [] } = useQuery<EmailTemplate[]>({
    queryKey: ['email-templates', clientId, direction],
    queryFn: () => api.get(`/treasury/${clientId}/email-templates?scope=${direction}`),
  })

  const { data: variables = [] } = useQuery<FollowupVariable[]>({
    queryKey: ['followup-variables', clientId],
    queryFn: async () => {
      const res = await api.get<{ variables: FollowupVariable[] }>(`/treasury/${clientId}/followups/variables`)
      return res.variables
    },
  })

  const { data: attachments = [] } = useQuery<InvoiceAttachment[]>({
    queryKey: ['attachments', clientId, direction, doc.id],
    queryFn: () => api.get(`/treasury/${clientId}/invoice-attachments?${idKey}=${doc.id}`),
  })

  useEffect(() => {
    if (templates.length === 0 || templateId) return
    const def = templates.find((t) => t.isDefault) ?? templates[0]
    if (def) {
      setTemplateId(def.id)
      setSubject(def.subject)
      setBodyHtml(def.bodyHtml)
    }
  }, [templates, templateId])

  function applyTemplate(id: string) {
    setTemplateId(id)
    const t = templates.find((x) => x.id === id)
    if (t) {
      setSubject(t.subject)
      setBodyHtml(t.bodyHtml)
    }
  }

  const preview = useMemo(() => {
    const sampleVars: Record<string, string> = {
      entidade: doc.entityName || '—',
      numero: doc.reference || '—',
      valor: new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(doc.totalAmount),
      vencimento: doc.dueDate ? new Date(doc.dueDate).toLocaleDateString('pt-PT') : '—',
      dias_atraso: doc.dueDate
        ? String(Math.max(0, Math.floor((Date.now() - new Date(doc.dueDate).getTime()) / 86400000)))
        : '0',
      iban: '[IBAN configurado]',
      referencia_mb: '',
      entidade_mb: '',
      data_hoje: new Date().toLocaleDateString('pt-PT'),
    }
    const interp = (s: string) =>
      s.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => sampleVars[k.toLowerCase()] ?? '')
    return { subject: interp(subject), bodyHtml: interp(bodyHtml) }
  }, [subject, bodyHtml, doc])

  const sendMut = useMutation({
    mutationFn: () => api.post(`/treasury/${clientId}/followups/email`, {
      direction,
      [idKey]: doc.id,
      to: to.split(/[,;]/).map((x) => x.trim()).filter(Boolean),
      cc: cc.split(/[,;]/).map((x) => x.trim()).filter(Boolean),
      subject,
      bodyHtml,
      templateId: templateId || undefined,
      attachInvoicePdf,
      attachmentIds: selectedAttachments,
    }),
    onSuccess: () => {
      toast.success('Email enviado')
      onSent()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function insertVariable(name: string) {
    setBodyHtml((b) => b + `{{${name}}}`)
  }

  return (
    <Modal open onClose={onClose} title={`Enviar email — ${doc.reference || doc.entityName}`} size="xl">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          {templates.length > 0 && (
            <div>
              <label className="text-xs font-medium text-gray-700 mb-1 block">Template</label>
              <select
                value={templateId}
                onChange={(e) => applyTemplate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="">— Manual —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' (por defeito)' : ''}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Para</label>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="email@exemplo.pt, outro@exemplo.pt"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Cc (opcional)</label>
            <input
              type="text"
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Assunto</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-700 mb-1 block">Corpo (HTML)</label>
            <textarea
              value={bodyHtml}
              onChange={(e) => setBodyHtml(e.target.value)}
              rows={10}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono resize-y"
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {variables.map((v) => (
                <button
                  key={v.name}
                  type="button"
                  onClick={() => insertVariable(v.name)}
                  className="text-[11px] px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-gray-700"
                  title={v.label}
                >
                  {`{{${v.name}}}`}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-2 border-t border-gray-100">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={attachInvoicePdf}
                onChange={(e) => setAttachInvoicePdf(e.target.checked)}
                disabled={!tocId}
                className="rounded"
              />
              <Paperclip className="w-3.5 h-3.5 text-gray-500" />
              <span>Anexar PDF do TOConline</span>
              {!tocId && <span className="text-xs text-gray-400">(indisponível — doc local)</span>}
            </label>

            {attachments.length > 0 && (
              <div>
                <div className="text-xs font-medium text-gray-700 mb-1">PDFs manuais anexados</div>
                {attachments.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-xs py-0.5">
                    <input
                      type="checkbox"
                      checked={selectedAttachments.includes(a.id)}
                      onChange={(e) =>
                        setSelectedAttachments((prev) =>
                          e.target.checked ? [...prev, a.id] : prev.filter((id) => id !== a.id)
                        )
                      }
                      className="rounded"
                    />
                    <span>{a.filename}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="lg:border-l lg:pl-4 lg:border-gray-100">
          <div className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">Pré-visualização</div>
          <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
            <div className="text-xs text-gray-500 mb-1">Assunto</div>
            <div className="text-sm font-medium text-gray-900 mb-3">{preview.subject || <span className="text-gray-400 italic">(vazio)</span>}</div>
            <div className="text-xs text-gray-500 mb-1">Corpo</div>
            <div
              className="text-sm text-gray-800 prose prose-sm max-w-none bg-white p-3 rounded border border-gray-100"
              dangerouslySetInnerHTML={{ __html: preview.bodyHtml || '<em class="text-gray-400">(vazio)</em>' }}
            />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-100">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">
          Cancelar
        </button>
        <button
          onClick={() => sendMut.mutate()}
          disabled={sendMut.isPending || !to.trim() || !subject.trim()}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
          {sendMut.isPending ? 'A enviar…' : 'Enviar'}
        </button>
      </div>
    </Modal>
  )
}
