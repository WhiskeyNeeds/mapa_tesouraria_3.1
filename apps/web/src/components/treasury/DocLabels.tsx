import { Scissors, AlertTriangle } from 'lucide-react'

interface DocLabelsProps {
  /** Número de parcelas da divisão (0 = não dividido). */
  splitCount: number
  /** TOC + estado "Pago" em Contas a Receber — aguarda recibo no TOConline. */
  awaitingReceipt?: boolean
}

/**
 * Slot de etiquetas dos documentos, mostrado à esquerda da referência (a seguir
 * ao checkbox). Agrega o badge da divisão (tesoura) e o aviso "Aguarda Recibo".
 * Não renderiza nada quando não há etiquetas a mostrar.
 */
export function DocLabels({ splitCount, awaitingReceipt }: DocLabelsProps) {
  if (splitCount <= 0 && !awaitingReceipt) return null
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
      {awaitingReceipt && (
        <span title="Aguarda Recibo">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
        </span>
      )}
    </span>
  )
}
