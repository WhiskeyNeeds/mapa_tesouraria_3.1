// apps/web/src/components/treasury/DocDetailPanel.tsx
//
// Painel de detalhe de um payable ou receivable — replica o painel lateral
// da PayablesPage / ReceivablesPage para ser usado em contextos de modal.
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import {
  formatCurrency, formatDate,
  isWeekend, shiftToWorkday,
  statusLabel, statusVariant,
} from '@/lib/utils'
import { CreditCard, Clock, Scissors, CheckCircle, ChevronLeft, X, Wallet } from 'lucide-react'
import Badge from '@/components/ui/Badge'
import FollowupsPanel from '@/components/followups/FollowupsPanel'
import RemoveFromFuturePaymentsDialog from '@/components/treasury/RemoveFromFuturePaymentsDialog'

interface DocCategory { id: string; name: string; color: string | null }
interface DocChild {
  id: string; reference: string | null; status: string
  totalAmount: number; promisedPaymentDate: string | null; dueDate: string
  recurrenceId?: string | null
}
interface Doc {
  id: string
  entityName: string | null
  reference: string | null
  description: string | null
  documentDate: string | null
  dueDate: string
  promisedPaymentDate: string | null
  totalAmount: number
  paidAmount?: number | null
  receivedAmount?: number | null
  pendingAmount: number
  status: string
  origin: string
  readyToPay?: boolean
  recurrenceId?: string | null
  parentId?: string | null
  tocPurchasesDocId?: string | null
  tocSalesDocId?: string | null
  category?: DocCategory | null
  children?: DocChild[]
}

type DocType = 'payable' | 'receivable'
type Tab = 'details' | 'parcelas' | 'followups'
type Section = 'promised' | 'split' | null

interface Props {
  docId: string
  docType: DocType
  /** chamado quando a acção elimina ou fecha o painel */
  onClose: () => void
  /** chamado após qualquer mutação com sucesso para actualizar listas externas */
  onMutated?: () => void
}

export default function DocDetailPanel({ docId, docType, onClose, onMutated }: Props) {
  const { selectedClientId } = useAuth()
  const toast = useToast()
  const qc = useQueryClient()

  const seg = docType === 'payable' ? 'payables' : 'receivables'
  const label = docType === 'payable' ? 'Conta a Pagar' : 'Conta a Receber'
  const isExpense = docType === 'payable'

  const [currentId, setCurrentId] = useState(docId)
  const [tab, setTab] = useState<Tab>('details')
  const [section, setSection] = useState<Section>(null)
  const [promisedDate, setPromisedDate] = useState('')
  const [removeReadyOpen, setRemoveReadyOpen] = useState(false)
  const [splitCount, setSplitCount] = useState(2)
  const [splitInstallments, setSplitInstallments] = useState([
    { amount: '', paymentDate: '' },
    { amount: '', paymentDate: '' },
  ])
  const [splitValueMode, setSplitValueMode] = useState<'EUR' | 'PCT'>('EUR')

  const pickWorkday = (next: string, fallback: string): string => {
    if (next && isWeekend(next)) {
      toast.error('Apenas dias úteis são permitidos')
      return fallback
    }
    return next
  }

  const { data: doc, isLoading } = useQuery<Doc>({
    queryKey: ['doc-detail', selectedClientId, seg, currentId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/${seg}/${currentId}`),
    enabled: !!selectedClientId && !!currentId,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['doc-detail', selectedClientId, seg, currentId] })
    onMutated?.()
  }

  const payDoc = useMutation({
    mutationFn: () => api.post(`/treasury/${selectedClientId}/${seg}/${currentId}/pay`, {}),
    onSuccess: () => { invalidate(); toast.success('Marcado como pago') },
    onError: (e: Error) => toast.error(e.message),
  })

  const settleDoc = useMutation({
    mutationFn: () => api.post(`/treasury/${selectedClientId}/${seg}/${currentId}/settle`, {}),
    onSuccess: () => { invalidate(); toast.success('Marcado como liquidado') },
    onError: (e: Error) => toast.error(e.message),
  })

  const unsettleDoc = useMutation({
    mutationFn: () => api.post(`/treasury/${selectedClientId}/${seg}/${currentId}/unsettle`, {}),
    onSuccess: () => { invalidate(); toast.success('Pagamento revertido') },
    onError: (e: Error) => toast.error(e.message),
  })

  const setPromisedDateMut = useMutation({
    mutationFn: (date: string | null) =>
      api.patch(`/treasury/${selectedClientId}/${seg}/${currentId}/promised-date`, { date }),
    onSuccess: (_, date) => {
      invalidate()
      setSection(null)
      toast.success(date ? 'Data prometida definida' : 'Data prometida removida')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const setReadyToPayMut = useMutation({
    mutationFn: ({ ready, promisedPaymentDate, reason }: { ready: boolean; promisedPaymentDate?: string | null; reason?: string }) =>
      api.patch(`/treasury/${selectedClientId}/${seg}/${currentId}/ready-to-pay`, { ready, promisedPaymentDate, reason }),
    onSuccess: (_, { ready }) => {
      invalidate()
      setRemoveReadyOpen(false)
      toast.success(ready ? 'Adicionada a Futuros Pagamentos' : 'Removida de Futuros Pagamentos')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const splitDoc = useMutation({
    mutationFn: (installments: Array<{ amount: number; promisedPaymentDate: string }>) =>
      api.post(`/treasury/${selectedClientId}/${seg}/${currentId}/split`, { installments }),
    onSuccess: () => {
      invalidate()
      setSection(null)
      toast.success('Fatura dividida com sucesso')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const unsplitDoc = useMutation({
    mutationFn: () => api.post(`/treasury/${selectedClientId}/${seg}/${currentId}/unsplit`, {}),
    onSuccess: () => { invalidate(); toast.success('Divisão desfeita') },
    onError: (e: Error) => toast.error(e.message),
  })

  function openParent() {
    if (!doc?.parentId) return
    setCurrentId(doc.parentId)
    setTab('parcelas')
    setSection(null)
    setPromisedDate('')
    setSplitCount(2)
    setSplitValueMode('EUR')
  }

  function initSplit(d: Doc) {
    const n = splitCount
    const total = Number(d.totalAmount)
    const tCents = Math.round(total * 100)
    const bCents = Math.floor(tCents / n)
    const rCents = tCents - bCents * n
    setSplitInstallments(
      Array.from({ length: n }, (_, i) => {
        const dd = new Date(d.dueDate)
        dd.setMonth(dd.getMonth() + i)
        return {
          amount: ((i < rCents ? bCents + 1 : bCents) / 100).toFixed(2),
          paymentDate: shiftToWorkday(dd.toISOString().slice(0, 10)),
        }
      }),
    )
    setSplitValueMode('EUR')
  }

  if (isLoading || !doc) {
    return (
      <div className="flex items-center justify-center h-48">
        <span className="text-sm text-gray-400">A carregar...</span>
      </div>
    )
  }

  const children = doc.children ?? []
  const hasSplit = children.length > 0
  const allOpen = children.every((c) => c.status === 'OPEN')
  const isOpen = doc.status === 'OPEN' || doc.status === 'PARTIAL'
  const isPaid = doc.status === 'PAID' || doc.status === 'SETTLED'
  const paidAmount = isExpense ? Number(doc.paidAmount ?? 0) : Number(doc.receivedAmount ?? 0)

  const tabs = [
    { key: 'details' as Tab, label: 'Detalhes' },
    { key: 'parcelas' as Tab, label: 'Parcelas' },
    { key: 'followups' as Tab, label: 'Follow-ups' },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Cabeçalho */}
      <div className="p-5 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-1">
            {doc.parentId && !doc.recurrenceId && (
              <button
                onClick={openParent}
                className="p-1 text-gray-400 hover:text-gray-700 rounded transition-colors"
                title="Voltar à fatura mãe"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</div>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700 rounded transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="text-2xl font-bold text-gray-900">{formatCurrency(doc.totalAmount)}</div>
        <div className="text-sm font-medium text-primary-700 mt-0.5">{doc.entityName || '—'}</div>
        <div className="text-xs text-gray-500 mt-0.5">
          {doc.reference || '—'} · Venc. {formatDate(doc.dueDate)} · Pag. {formatDate(doc.promisedPaymentDate ?? doc.dueDate)}
        </div>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <Badge variant={statusVariant(doc.status)}>{statusLabel(doc.status)}</Badge>
          {doc.promisedPaymentDate && (
            <span className="text-xs text-blue-600 flex items-center gap-1">
              <Clock className="w-3 h-3" />{formatDate(doc.promisedPaymentDate)}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs flex-wrap">
          <span className="text-gray-500">
            Pendente: <span className="font-semibold text-gray-700">{formatCurrency(doc.pendingAmount)}</span>
          </span>
          {paidAmount > 0 && (
            <span className="text-emerald-600">
              {isExpense ? 'Pago' : 'Recebido'}: <span className="font-semibold">{formatCurrency(paidAmount)}</span>
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 bg-gray-50 flex-shrink-0">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Corpo */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">

        {/* ── Tab: Detalhes ── */}
        {tab === 'details' && (
          <>
            {/* Liquidado — banner */}
            {doc.status === 'SETTLED' && (
              <div className="flex items-center gap-3 p-3.5 bg-green-50 border border-green-200 rounded-xl">
                <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                  <CheckCircle className="w-4 h-4 text-green-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-green-900 text-sm">Liquidado</div>
                  <div className="text-xs text-green-600 mt-0.5">Registado nesta plataforma</div>
                </div>
                <button
                  onClick={() => unsettleDoc.mutate()}
                  disabled={unsettleDoc.isPending}
                  className="text-xs text-green-700 hover:text-red-700 border border-green-200 hover:border-red-200 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {unsettleDoc.isPending ? '...' : 'Anular'}
                </button>
              </div>
            )}

            {/* Pago — banner (aguarda liquidação) */}
            {doc.status === 'PAID' && (
              <div className="flex items-center gap-3 p-3.5 bg-teal-50 border border-teal-200 rounded-xl">
                <div className="w-9 h-9 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0">
                  <CreditCard className="w-4 h-4 text-teal-700" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-teal-900 text-sm">Pago</div>
                  <div className="text-xs text-teal-600 mt-0.5">Registado — aguarda liquidação</div>
                </div>
                <button
                  onClick={() => unsettleDoc.mutate()}
                  disabled={unsettleDoc.isPending}
                  className="text-xs text-teal-700 hover:text-red-700 border border-teal-200 hover:border-red-200 hover:bg-red-50 px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {unsettleDoc.isPending ? '...' : 'Anular'}
                </button>
              </div>
            )}

            {/* Marcar como pago */}
            {isOpen && (
              <button
                onClick={() => payDoc.mutate()}
                disabled={payDoc.isPending}
                className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-200 hover:bg-teal-50 hover:border-teal-200 text-left transition-colors group disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="w-9 h-9 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0 group-hover:bg-teal-200 transition-colors">
                  <CreditCard className="w-4 h-4 text-teal-700" />
                </div>
                <div>
                  <div className="font-medium text-gray-900 text-sm">
                    {isExpense ? 'Marcar como pago' : 'Marcar como recebido'}
                  </div>
                  <div className="text-xs text-gray-500">Registar pagamento total (sem liquidar)</div>
                </div>
              </button>
            )}

            {/* Marcar como liquidada — direto ou a partir de "Pago" */}
            {(isOpen || doc.status === 'PAID') && (
              <button
                onClick={() => settleDoc.mutate()}
                disabled={settleDoc.isPending}
                className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-200 hover:bg-green-50 hover:border-green-200 text-left transition-colors group disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <div className="w-9 h-9 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0 group-hover:bg-green-200 transition-colors">
                  <CheckCircle className="w-4 h-4 text-green-700" />
                </div>
                <div>
                  <div className="font-medium text-gray-900 text-sm">
                    {isExpense ? 'Marcar como liquidada' : 'Marcar como recebida'}
                  </div>
                  <div className="text-xs text-gray-500">Registar recibo / liquidação total</div>
                </div>
              </button>
            )}

            {/* Pronta para Pagar — toggle do separador Futuros Pagamentos (só payables, só em aberto) */}
            {isExpense && doc.status === 'OPEN' && (
              <>
                <button
                  onClick={() => doc.readyToPay ? setRemoveReadyOpen(true) : setReadyToPayMut.mutate({ ready: true })}
                  disabled={setReadyToPayMut.isPending}
                  className={`w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-colors group disabled:opacity-40 disabled:cursor-not-allowed ${doc.readyToPay
                    ? 'border-teal-300 bg-teal-50 hover:bg-teal-100'
                    : 'border-gray-200 hover:bg-teal-50 hover:border-teal-200'
                    }`}
                >
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${doc.readyToPay ? 'bg-teal-200' : 'bg-teal-100 group-hover:bg-teal-200'}`}>
                    <Wallet className="w-4 h-4 text-teal-700" />
                  </div>
                  <div>
                    <div className="font-medium text-gray-900 text-sm">
                      {doc.readyToPay ? 'Remover de Futuros Pagamentos' : 'Pronta para Pagar'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {doc.readyToPay ? 'Marcada — consta de Futuros Pagamentos' : 'Adicionar a Futuros Pagamentos'}
                    </div>
                  </div>
                </button>
                {doc.readyToPay && removeReadyOpen && (
                  <RemoveFromFuturePaymentsDialog
                    currentPromisedDate={doc.promisedPaymentDate}
                    dueDate={doc.dueDate}
                    pending={setReadyToPayMut.isPending}
                    onConfirm={(date, reason) => setReadyToPayMut.mutate({ ready: false, promisedPaymentDate: date, reason })}
                    onCancel={() => setRemoveReadyOpen(false)}
                    pickWorkday={pickWorkday}
                  />
                )}
              </>
            )}

            {/* Definir data pagamento — bloqueada em faturas pagas/liquidadas */}
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <button
                onClick={() => { if (!isPaid) setSection(section === 'promised' ? null : 'promised') }}
                disabled={isPaid}
                title={isPaid ? 'Fatura paga/liquidada — não é possível definir data de pagamento' : undefined}
                className={`w-full flex items-center gap-3 p-3.5 text-left transition-colors group ${isPaid ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-50'}`}
              >
                <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-200 transition-colors">
                  <Clock className="w-4 h-4 text-blue-700" />
                </div>
                <div className="flex-1">
                  <div className="font-medium text-gray-900 text-sm">Definir Data Pagamento</div>
                  {doc.promisedPaymentDate
                    ? <div className="text-xs text-blue-600">{formatDate(doc.promisedPaymentDate)}</div>
                    : <div className="text-xs text-gray-500">Sem data prometida</div>
                  }
                </div>
              </button>
              {section === 'promised' && !isPaid && (
                <div className="px-4 pb-4 pt-1 border-t border-gray-100 space-y-3">
                  <input
                    type="date"
                    className="input"
                    value={promisedDate}
                    onChange={(e) => setPromisedDate(pickWorkday(e.target.value, promisedDate))}
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPromisedDateMut.mutate(promisedDate || null)}
                      disabled={setPromisedDateMut.isPending}
                      className="btn-primary flex-1 text-sm py-1.5"
                    >
                      {setPromisedDateMut.isPending ? 'A guardar...' : 'Guardar'}
                    </button>
                    {doc.promisedPaymentDate && (
                      <button
                        onClick={() => setPromisedDateMut.mutate(null)}
                        disabled={setPromisedDateMut.isPending}
                        className="btn-secondary text-sm py-1.5 px-3"
                      >
                        Remover
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Dividir Fatura — bloqueada em faturas pagas/liquidadas */}
            {(isOpen || isPaid) && !doc.parentId && !hasSplit && (
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <button
                  onClick={() => {
                    if (isPaid) return
                    if (section !== 'split') initSplit(doc)
                    setSection(section === 'split' ? null : 'split')
                  }}
                  disabled={isPaid}
                  title={isPaid ? 'Fatura paga/liquidada — não é possível dividir' : undefined}
                  className="w-full flex items-center gap-3 p-3.5 hover:bg-purple-50 text-left transition-colors group disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center flex-shrink-0 group-hover:bg-purple-200 transition-colors">
                    <Scissors className="w-4 h-4 text-purple-700" />
                  </div>
                  <div>
                    <div className="font-medium text-gray-900 text-sm">Dividir Fatura</div>
                    <div className="text-xs text-gray-500">Criar parcelas a partir desta fatura</div>
                  </div>
                </button>
                {section === 'split' && !isPaid && (
                  <div className="px-4 pb-4 pt-3 border-t border-gray-100 space-y-3">
                    {/* Nº de parcelas */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500 font-medium">Nº de parcelas</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            const n = Math.max(2, splitCount - 1)
                            const total = Number(doc.totalAmount)
                            const tCents = Math.round(total * 100)
                            const bCents = Math.floor(tCents / n)
                            const rCents = tCents - bCents * n
                            setSplitCount(n)
                            setSplitInstallments(Array.from({ length: n }, (_, i) => {
                              const d = new Date(splitInstallments[i]?.paymentDate || doc.dueDate)
                              if (!splitInstallments[i]?.paymentDate) d.setMonth(d.getMonth() + i)
                              return {
                                amount: ((i < rCents ? bCents + 1 : bCents) / 100).toFixed(2),
                                paymentDate: shiftToWorkday(d.toISOString().slice(0, 10)),
                              }
                            }))
                          }}
                          className="w-6 h-6 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center justify-center text-sm font-bold"
                        >−</button>
                        <span className="w-8 text-center text-sm font-semibold text-gray-800">{splitCount}</span>
                        <button
                          onClick={() => {
                            const n = splitCount + 1
                            const total = Number(doc.totalAmount)
                            const tCents = Math.round(total * 100)
                            const bCents = Math.floor(tCents / n)
                            const rCents = tCents - bCents * n
                            setSplitCount(n)
                            setSplitInstallments(Array.from({ length: n }, (_, i) => {
                              const prevDate = splitInstallments[i - 1]?.paymentDate
                              const d = prevDate
                                ? (() => { const dd = new Date(prevDate); dd.setMonth(dd.getMonth() + 1); return dd })()
                                : (() => { const dd = new Date(doc.dueDate); dd.setMonth(dd.getMonth() + i); return dd })()
                              const existingDate = splitInstallments[i]?.paymentDate || shiftToWorkday(d.toISOString().slice(0, 10))
                              return {
                                amount: ((i < rCents ? bCents + 1 : bCents) / 100).toFixed(2),
                                paymentDate: existingDate,
                              }
                            }))
                          }}
                          className="w-6 h-6 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 flex items-center justify-center text-sm font-bold"
                        >+</button>
                      </div>
                    </div>

                    {/* Toggle €/% */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500 font-medium">Tipo de valor</span>
                      <div className="flex border border-gray-200 rounded-lg overflow-hidden text-xs">
                        <button
                          onClick={() => {
                            if (splitValueMode === 'PCT') {
                              const total = Number(doc.totalAmount)
                              setSplitInstallments(splitInstallments.map((x) => ({
                                ...x, amount: ((parseFloat(x.amount) || 0) * total / 100).toFixed(2),
                              })))
                              setSplitValueMode('EUR')
                            }
                          }}
                          className={`px-3 py-1 transition-colors ${splitValueMode === 'EUR' ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                        >€</button>
                        <button
                          onClick={() => {
                            if (splitValueMode === 'EUR') {
                              const total = Number(doc.totalAmount)
                              setSplitInstallments(splitInstallments.map((x) => ({
                                ...x, amount: (total > 0 ? ((parseFloat(x.amount) || 0) / total * 100) : 0).toFixed(2),
                              })))
                              setSplitValueMode('PCT')
                            }
                          }}
                          className={`px-3 py-1 transition-colors ${splitValueMode === 'PCT' ? 'bg-primary-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                        >%</button>
                      </div>
                    </div>

                    {/* Parcelas */}
                    <div className="flex gap-1.5 items-center text-[11px] text-gray-500 font-medium px-1">
                      <span className="w-4 flex-shrink-0" />
                      <span className="flex-1">Valor</span>
                      <span className="flex-1">Data de pagamento</span>
                      {splitInstallments.length > 2 && <span className="w-6" />}
                    </div>
                    {splitInstallments.map((inst, i) => (
                      <div key={i} className="flex gap-1.5 items-center">
                        <span className="text-xs text-gray-400 w-4 flex-shrink-0 text-right">{i + 1}.</span>
                        <div className="relative flex-1">
                          <input
                            type="number" step="0.01" min="0"
                            max={splitValueMode === 'PCT' ? '100' : undefined}
                            placeholder="0.00"
                            className="input text-sm py-1.5 pr-6 w-full"
                            value={inst.amount}
                            onChange={(e) => setSplitInstallments(splitInstallments.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                            {splitValueMode === 'EUR' ? '€' : '%'}
                          </span>
                        </div>
                        <input
                          type="date" className="input text-sm py-1.5 flex-1"
                          value={inst.paymentDate}
                          onChange={(e) => setSplitInstallments(splitInstallments.map((x, j) => j === i ? { ...x, paymentDate: pickWorkday(e.target.value, x.paymentDate) } : x))}
                        />
                        {splitInstallments.length > 2 && (
                          <button
                            onClick={() => { setSplitInstallments(splitInstallments.filter((_, j) => j !== i)); setSplitCount(splitCount - 1) }}
                            className="p-1 text-gray-300 hover:text-red-500"
                          ><X className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    ))}

                    {/* Validação */}
                    {(() => {
                      const total = Number(doc.totalAmount)
                      const sum = splitInstallments.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0)
                      if (splitValueMode === 'EUR') {
                        const diff = sum - total
                        if (diff > 0.001) return <p className="text-xs text-red-600 font-medium">Acima por {formatCurrency(diff)} — soma: {formatCurrency(sum)}</p>
                        if (diff < -0.001) return <p className="text-xs text-red-600 font-medium">Abaixo por {formatCurrency(Math.abs(diff))} — soma: {formatCurrency(sum)}</p>
                        return <p className="text-xs text-green-600 font-medium">✓ Soma correcta: {formatCurrency(sum)}</p>
                      }
                      const diff = sum - 100
                      if (diff > 0.001) return <p className="text-xs text-red-600 font-medium">Acima por {diff.toFixed(3)}%</p>
                      if (diff < -0.001) return <p className="text-xs text-red-600 font-medium">Abaixo por {Math.abs(diff).toFixed(3)}%</p>
                      return <p className="text-xs text-green-600 font-medium">✓ Total: 100%</p>
                    })()}

                    <button
                      onClick={() => {
                        const total = Number(doc.totalAmount)
                        const installments = splitInstallments.map((x) => ({
                          amount: splitValueMode === 'EUR' ? parseFloat(x.amount) : parseFloat(x.amount) / 100 * total,
                          promisedPaymentDate: x.paymentDate,
                        }))
                        splitDoc.mutate(installments)
                      }}
                      disabled={(() => {
                        if (splitDoc.isPending || splitInstallments.some((x) => !x.amount || !x.paymentDate)) return true
                        const total = Number(doc.totalAmount)
                        const sum = splitInstallments.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0)
                        return splitValueMode === 'EUR' ? Math.abs(sum - total) > 0.001 : Math.abs(sum - 100) > 0.001
                      })()}
                      className="btn-primary w-full text-sm py-1.5"
                    >
                      {splitDoc.isPending ? 'A dividir...' : `Confirmar divisão em ${splitInstallments.length} parcelas`}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Info adicional */}
            {(doc.description || doc.category) && (
              <div className="mt-2 pt-4 border-t border-gray-100 space-y-1.5 text-xs text-gray-500">
                {doc.description && <div><span className="font-medium text-gray-700">Descrição:</span> {doc.description}</div>}
                {doc.category && <div><span className="font-medium text-gray-700">Categoria:</span> {doc.category.name}</div>}
              </div>
            )}
          </>
        )}

        {/* ── Tab: Parcelas ── */}
        {tab === 'parcelas' && (
          <>
            {children.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400 text-sm text-center px-4">
                <Scissors className="w-8 h-8 mb-2 opacity-30" />
                Esta fatura não está dividida em parcelas
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">{children.length} parcelas</div>
                {children.map((child, i) => (
                  <button
                    key={child.id}
                    onClick={() => {
                      setCurrentId(child.id)
                      setTab('details')
                      setSection(null)
                      setPromisedDate(child.promisedPaymentDate?.slice(0, 10) ?? '')
                      setSplitCount(2)
                      setSplitValueMode('EUR')
                    }}
                    className="w-full text-left rounded-lg border border-gray-200 p-2.5 hover:bg-primary-50 hover:border-primary-200 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs text-gray-400">Parcela {i + 1}</span>
                      <Badge variant={statusVariant(child.status)}>{statusLabel(child.status)}</Badge>
                    </div>
                    <div className="font-semibold text-sm text-gray-900">{formatCurrency(child.totalAmount)}</div>
                    <div className="text-xs text-gray-500">{child.reference} · Pag. {formatDate(child.promisedPaymentDate ?? child.dueDate)}</div>
                  </button>
                ))}
                {!doc.recurrenceId && (
                  <button
                    onClick={() => unsplitDoc.mutate()}
                    disabled={unsplitDoc.isPending || !allOpen}
                    title={!allOpen ? 'Não é possível desfazer: algumas parcelas já foram pagas' : undefined}
                    className={`w-full text-xs px-3 py-1.5 rounded-lg transition-colors ${
                      allOpen
                        ? 'text-orange-700 hover:text-red-700 border border-orange-200 hover:border-red-300 hover:bg-red-50'
                        : 'text-gray-400 border border-gray-200 cursor-not-allowed'
                    }`}
                  >
                    {unsplitDoc.isPending ? 'A desfazer...' : 'Desfazer divisão'}
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* ── Tab: Follow-ups ── */}
        {tab === 'followups' && selectedClientId && (
          <FollowupsPanel
            clientId={selectedClientId}
            direction={isExpense ? 'PAYABLE' : 'RECEIVABLE'}
            doc={{
              id: doc.id,
              reference: doc.reference ?? '',
              entityName: doc.entityName ?? '',
              totalAmount: doc.totalAmount,
              dueDate: doc.dueDate,
              origin: doc.origin as 'TOC' | 'LOCAL',
              tocPurchasesDocId: doc.tocPurchasesDocId ?? null,
            }}
          />
        )}

      </div>
    </div>
  )
}
