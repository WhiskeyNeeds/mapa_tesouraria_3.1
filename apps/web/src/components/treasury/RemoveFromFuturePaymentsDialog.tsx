// apps/web/src/components/treasury/RemoveFromFuturePaymentsDialog.tsx
import { useState } from 'react'
import { Calendar, CornerUpLeft } from 'lucide-react'
import Modal from '@/components/ui/Modal'

interface Props {
  /** promisedPaymentDate atual (ISO) para pré-preencher o seletor; se vazio usa a dueDate. */
  currentPromisedDate: string | null | undefined
  /** Data de vencimento de origem (ISO) — fallback do seletor e alvo de "manter a original". */
  dueDate: string
  /** Mutação em curso (desativa as ações). */
  pending: boolean
  /**
   * Confirma a escolha e desmarca: uma data ISO (yyyy-mm-dd) define o
   * promisedPaymentDate (com `reason` obrigatório, que gera nota + tarefa); `null`
   * repõe a data de vencimento original (sem motivo). Em ambos os casos a fatura
   * sai de Futuros Pagamentos.
   */
  onConfirm: (promisedPaymentDate: string | null, reason?: string) => void
  onCancel: () => void
  /** Guarda de dia útil partilhada pelo painel (rejeita fins de semana). */
  pickWorkday: (next: string, fallback: string) => string
}

/** Pop-up mostrado ao desmarcar "Pronta para Pagar": pergunta se quer definir
 *  uma data de pagamento ou manter a data de vencimento original. */
export default function RemoveFromFuturePaymentsDialog({
  currentPromisedDate,
  dueDate,
  pending,
  onConfirm,
  onCancel,
  pickWorkday,
}: Props) {
  const [mode, setMode] = useState<'choose' | 'date'>('choose')
  const [date, setDate] = useState((currentPromisedDate ?? dueDate ?? '').slice(0, 10))
  const [reason, setReason] = useState('')

  return (
    <Modal open onClose={onCancel} title="Remover de Futuros Pagamentos" size="sm">
      {mode === 'choose' ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Quer definir uma data de pagamento ou manter a data de vencimento original?
          </p>
          <div className="flex flex-col gap-2.5">
            <button
              type="button"
              disabled={pending}
              onClick={() => setMode('date')}
              className="w-full flex items-center gap-3 p-3 rounded-xl border border-teal-300 bg-white text-left hover:bg-teal-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <div className="w-9 h-9 rounded-lg bg-teal-100 flex items-center justify-center flex-shrink-0">
                <Calendar className="w-4 h-4 text-teal-700" />
              </div>
              <div>
                <div className="font-medium text-gray-900 text-sm">Definir data de pagamento</div>
                <div className="text-xs text-gray-500">Escolher uma nova data de pagamento</div>
              </div>
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => onConfirm(null)}
              className="w-full flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-white text-left hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                <CornerUpLeft className="w-4 h-4 text-gray-500" />
              </div>
              <div>
                <div className="font-medium text-gray-900 text-sm">Manter a data de vencimento original</div>
                <div className="text-xs text-gray-500">Repõe a data de vencimento da fatura</div>
              </div>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Data de pagamento</label>
            <input
              type="date"
              className="input"
              value={date}
              onChange={(e) => setDate(pickWorkday(e.target.value, date))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Motivo da alteração <span className="text-red-500">*</span>
            </label>
            <textarea
              className="input min-h-[72px] resize-y"
              placeholder="Porque é que a data de pagamento foi alterada?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <p className="mt-1 text-xs text-gray-500">
              Fica registado em Acompanhamentos e cria uma tarefa para contactar o fornecedor.
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              disabled={pending}
              onClick={() => setMode('choose')}
              className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Voltar
            </button>
            <button
              type="button"
              disabled={pending || !date || !reason.trim()}
              onClick={() => onConfirm(date, reason.trim())}
              className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Confirmar
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
