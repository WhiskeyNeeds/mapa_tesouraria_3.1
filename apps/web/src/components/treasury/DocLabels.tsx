import { Scissors, AlertTriangle, Wallet, Phone, AlertCircle } from 'lucide-react'

interface DocLabelsProps {
  /** Número de parcelas da divisão (0 = não dividido). */
  splitCount: number
  /** TOC + estado "Pago" em Contas a Receber — aguarda recibo no TOConline. */
  awaitingReceipt?: boolean
  /** Marcada como "Pronta para Pagar" — também consta de Futuros Pagamentos. */
  readyToPay?: boolean
  /** Tem tarefa de contacto pendente — mostra ícone de telefone "Contatar Cliente". */
  needsContact?: boolean
  /** dueAt (ISO) da ação pendente mais urgente; mostra "!" âmbar (hoje ≤ prazo) ou vermelho (passou). null = sem ícone. */
  pendingActionDueAt?: string | null
}

/**
 * Slot de etiquetas dos documentos, mostrado à esquerda da referência (a seguir
 * ao checkbox). Agrega o badge da divisão (tesoura), o aviso "Aguarda Recibo", a
 * marca "Pronta para Pagar" e o ícone "Contatar Cliente". Não renderiza nada
 * quando não há etiquetas.
 */
/** Compara só a data (ignora horas): âmbar se o prazo é hoje ou no futuro,
 *  vermelho se já passou. */
function pendingActionTone(iso: string): { color: string; title: string } {
  const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
  const today = startOfDay(new Date())
  const due = startOfDay(new Date(iso))
  if (due.getTime() >= today.getTime()) {
    return { color: 'text-amber-500', title: `Ação pendente — prazo ${due.toLocaleDateString('pt-PT')}` }
  }
  return { color: 'text-red-600', title: 'Ação pendente — atrasada' }
}

export function DocLabels({ splitCount, awaitingReceipt, readyToPay, needsContact, pendingActionDueAt }: DocLabelsProps) {
  if (splitCount <= 0 && !awaitingReceipt && !readyToPay && !needsContact && !pendingActionDueAt) return null
  return (
    <span className="inline-flex items-center gap-1">
      {splitCount > 0 && (
        <span
          title={`Dividida em ${splitCount} parcelas`}
          className="inline-flex items-center gap-0.5 text-purple-700 text-[11px] font-semibold whitespace-nowrap"
        >
          <Scissors className="w-3.5 h-3.5" />
          {splitCount}
        </span>
      )}
      {readyToPay && (
        <span title="Pronta para Pagar — em Futuros Pagamentos">
          <Wallet className="w-3.5 h-3.5 text-teal-600" />
        </span>
      )}
      {needsContact && (
        <span title="Contatar Cliente">
          <Phone className="w-3.5 h-3.5 text-amber-500" />
        </span>
      )}
      {pendingActionDueAt && (() => {
        const tone = pendingActionTone(pendingActionDueAt)
        return (
          <span title={tone.title}>
            <AlertCircle className={`w-3.5 h-3.5 ${tone.color}`} />
          </span>
        )
      })()}
      {awaitingReceipt && (
        <span title="Aguarda Recibo">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
        </span>
      )}
    </span>
  )
}
