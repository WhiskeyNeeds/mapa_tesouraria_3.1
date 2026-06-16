import { Scissors, AlertTriangle, Wallet, Phone } from 'lucide-react'

interface DocLabelsProps {
  /** Número de parcelas da divisão (0 = não dividido). */
  splitCount: number
  /** TOC + estado "Pago" em Contas a Receber — aguarda recibo no TOConline. */
  awaitingReceipt?: boolean
  /** Marcada como "Pronta para Pagar" — também consta de Futuros Pagamentos. */
  readyToPay?: boolean
  /** Tem tarefa de contacto pendente — mostra ícone de telefone "Contatar Cliente". */
  needsContact?: boolean
}

/**
 * Slot de etiquetas dos documentos, mostrado à esquerda da referência (a seguir
 * ao checkbox). Agrega o badge da divisão (tesoura), o aviso "Aguarda Recibo", a
 * marca "Pronta para Pagar" e o ícone "Contatar Cliente". Não renderiza nada
 * quando não há etiquetas.
 */
export function DocLabels({ splitCount, awaitingReceipt, readyToPay, needsContact }: DocLabelsProps) {
  if (splitCount <= 0 && !awaitingReceipt && !readyToPay && !needsContact) return null
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
      {awaitingReceipt && (
        <span title="Aguarda Recibo">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
        </span>
      )}
    </span>
  )
}
