import { Scissors, AlertTriangle, Wallet } from 'lucide-react'

interface DocLabelsProps {
  /** Número de parcelas da divisão (0 = não dividido). */
  splitCount: number
  /** TOC + estado "Pago" em Contas a Receber — aguarda recibo no TOConline. */
  awaitingReceipt?: boolean
  /** Marcada como "Pronta para Pagar" — também consta de Futuros Pagamentos. */
  readyToPay?: boolean
}

/**
 * Slot de etiquetas dos documentos, mostrado à esquerda da referência (a seguir
 * ao checkbox). Agrega o badge da divisão (tesoura), o aviso "Aguarda Recibo" e
 * a marca "Pronta para Pagar". Não renderiza nada quando não há etiquetas.
 */
export function DocLabels({ splitCount, awaitingReceipt, readyToPay }: DocLabelsProps) {
  if (splitCount <= 0 && !awaitingReceipt && !readyToPay) return null
  return (
    <span className="inline-flex items-center gap-1">
      {splitCount > 0 && (
        <span
          title={`Dividida em ${splitCount} parcelas`}
          className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 text-[11px] font-semibold whitespace-nowrap"
        >
          <Scissors className="w-3 h-3" />
          {splitCount}
        </span>
      )}
      {readyToPay && (
        <span
          title="Pronta para Pagar — em Futuros Pagamentos"
          className="inline-flex items-center px-1 py-0.5 rounded bg-teal-100 text-teal-700"
        >
          <Wallet className="w-3 h-3" />
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
