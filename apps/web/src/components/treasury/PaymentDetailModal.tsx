import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/utils'
import { RefreshCw, X } from 'lucide-react'

export interface TocPayment {
  id: number | string
  document_no: string
  date: string
  gross_total: number
  net_total?: number
  _paid_for_doc?: number | null
  [key: string]: unknown
}

export interface PaymentLine {
  payable_id: number | string
  paid_value: number
  gross_total: number
  net_total?: number
  settlement_percentage?: number
  settlement_amount?: number
  retention_total?: number
  document_no?: string
  _doc_date?: string
  _doc_due_date?: string
  _doc_gross_total?: number
  _doc_pending_total?: number
  _doc_external_reference?: string
  [key: string]: unknown
}

export default function PaymentDetailModal({
  open,
  onClose,
  payment,
  clientId,
  entityName,
  linesEndpoint,
  onInvoiceClick,
  mode = 'payable',
}: {
  open: boolean
  onClose: () => void
  payment: TocPayment | null
  clientId: string
  entityName: string
  linesEndpoint: (clientId: string, paymentId: string | number) => string
  onInvoiceClick?: (payableId: string | number) => void
  mode?: 'payable' | 'receivable'
}): JSX.Element | null {
  const { data: lines = [], isLoading } = useQuery<PaymentLine[]>({
    queryKey: ['toc-payment-lines', clientId, String(payment?.id ?? ''), mode],
    queryFn: () => api.get<PaymentLine[]>(linesEndpoint(clientId, payment!.id)),
    enabled: open && !!payment,
  })

  if (!open || !payment) return null

  if (mode === 'receivable') {
    // Receipt variant: shows receipt-specific header and columns
    const taxPayable = Number(payment.gross_total ?? 0) - Number(payment.net_total ?? 0)
    const receiptSeries =
      (payment.receipt_series as string | undefined) ??
      payment.document_no?.match(/[A-Z]+\s+(\d+)\//)?.[1] ??
      ''

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />
        <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-5xl animate-scale-in overflow-hidden">
          <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-900 truncate pr-4">
              {payment.document_no} - {entityName}
            </h2>
            <button
              onClick={onClose}
              className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-start gap-6 px-6 py-4 border-b border-gray-100">
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-400 mb-0.5">Data de recebimento</div>
              <div className="text-sm font-medium text-gray-700">{formatDate(payment.date)}</div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-gray-400 mb-0.5">Série de Recibo</div>
              <div className="text-sm font-medium text-gray-700">{receiptSeries || '—'}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-400 mb-0.5">Total de Iva</div>
              <div className="text-xl font-bold text-gray-800">{formatCurrency(taxPayable)}</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-400 mb-0.5">Total recebido</div>
              <div className="text-xl font-bold text-gray-800">{formatCurrency(payment.gross_total)}</div>
            </div>
          </div>

          <div className="px-6 py-4 max-h-[calc(100vh-22rem)] overflow-y-auto">
            <h3 className="text-sm font-semibold text-slate-900 mb-3">
              Documento(s) liquidados ({isLoading ? '…' : lines.length})
            </h3>
            {isLoading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-gray-400 justify-center">
                <RefreshCw className="w-4 h-4 animate-spin" />A carregar documentos...
              </div>
            ) : lines.length === 0 ? (
              <div className="py-8 text-sm text-gray-400 text-center">Sem documentos associados</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-50 text-gray-600">
                      <th className="px-3 py-2 text-left font-medium text-xs">Documento</th>
                      <th className="px-3 py-2 text-right font-medium">Valor total</th>
                      <th className="px-3 py-2 text-right font-medium">Valor pendente</th>
                      <th className="px-3 py-2 text-right font-medium">Retenção no pag.</th>
                      <th className="px-3 py-2 text-right font-medium">Valor retido</th>
                      <th className="px-3 py-2 text-right font-medium">% desc. financ.</th>
                      <th className="px-3 py-2 text-right font-medium">Valor desconto</th>
                      <th className="px-3 py-2 text-right font-medium">Valor recebido</th>
                      <th className="px-3 py-2 text-right font-medium">IVA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, i) => {
                      const retentionPct = Number((line._doc_retention as number | undefined) ?? 0)
                      const retentionValue = Number(line.retention_total ?? 0)
                      const discountPct = Number(line.settlement_percentage ?? 0)
                      const discountValue = Number(line.settlement_amount ?? 0)
                      const receivedValue = Number((line.received_value as number | undefined) ?? line.paid_value ?? 0)
                      const lineTax = receivedValue - Number(line.net_total ?? 0)
                      const lineDocId = (line.receivable_id as string | number | undefined) ?? line.payable_id
                      const canNavigate = !!onInvoiceClick && lineDocId != null
                      return (
                        <tr
                          key={i}
                          className={`${i % 2 === 0 ? 'bg-slate-50/60' : 'bg-white'} ${canNavigate ? 'cursor-pointer hover:bg-primary-50' : ''}`}
                          onClick={canNavigate ? () => onInvoiceClick!(lineDocId as string | number) : undefined}
                        >
                          <td className="px-3 py-2 border-b border-gray-100">
                            <div className="font-medium text-gray-700">{line.document_no ?? String(lineDocId)}</div>
                            {line._doc_date && <div className="text-gray-400">{formatDate(line._doc_date as string)}</div>}
                          </td>
                          <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">
                            {line._doc_gross_total != null ? formatCurrency(line._doc_gross_total as number) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">
                            {line._doc_pending_total != null ? formatCurrency(line._doc_pending_total as number) : '—'}
                          </td>
                          <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">{retentionPct} %</td>
                          <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">{formatCurrency(retentionValue)}</td>
                          <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">{discountPct} %</td>
                          <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">{formatCurrency(discountValue)}</td>
                          <td className="px-3 py-2 text-right border-b border-gray-100 font-semibold text-gray-700">{formatCurrency(receivedValue)}</td>
                          <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">{lineTax ? formatCurrency(lineTax) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      </div>
    )
  }

  // Default: payable variant
  const series = payment.document_no?.match(/[A-Z]+\s+(\d+)\//)?.[1] ?? ''

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-5xl animate-scale-in overflow-hidden">
        <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900 truncate pr-4">
            {payment.document_no} - {entityName}
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-start gap-6 px-6 py-4 border-b border-gray-100">
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-400 mb-0.5">Data de pagamento</div>
            <div className="text-sm font-medium text-gray-700">{formatDate(payment.date)}</div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-gray-400 mb-0.5">Série de Pagamento</div>
            <div className="text-sm font-medium text-gray-700">{series || '—'}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400 mb-0.5">Total pago</div>
            <div className="text-xl font-bold text-gray-800">{formatCurrency(payment.gross_total)}</div>
          </div>
        </div>

        <div className="px-6 py-4 max-h-[calc(100vh-20rem)] overflow-y-auto">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">
            Documento(s) liquidados ({isLoading ? '…' : lines.length})
          </h3>
          {isLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-gray-400 justify-center">
              <RefreshCw className="w-4 h-4 animate-spin" />A carregar documentos...
            </div>
          ) : lines.length === 0 ? (
            <div className="py-8 text-sm text-gray-400 text-center">Sem documentos associados</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-gray-600">
                    <th className="px-3 py-2 text-left font-medium text-xs">Documento</th>
                    <th className="px-3 py-2 text-left font-medium">Vossa referência</th>
                    <th className="px-3 py-2 text-right font-medium">Valor total</th>
                    <th className="px-3 py-2 text-right font-medium">Valor pendente</th>
                    <th className="px-3 py-2 text-right font-medium">Valor retido</th>
                    <th className="px-3 py-2 text-right font-medium">% desc. financ.</th>
                    <th className="px-3 py-2 text-right font-medium">Valor desconto</th>
                    <th className="px-3 py-2 text-right font-medium">Valor pago</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => {
                    const retentionValue = Number(line.retention_total ?? 0)
                    const discountPct = Number(line.settlement_percentage ?? 0)
                    const discountValue = Number(line.settlement_amount ?? 0)
                    const canNavigate = !!onInvoiceClick && line.payable_id != null
                    return (
                      <tr
                        key={i}
                        className={`${i % 2 === 0 ? 'bg-slate-50/60' : 'bg-white'} ${canNavigate ? 'cursor-pointer hover:bg-primary-50' : ''}`}
                        onClick={canNavigate ? () => onInvoiceClick!(line.payable_id as string | number) : undefined}
                      >
                        <td className="px-3 py-2 border-b border-gray-100">
                          <div className="font-medium text-gray-700">{line.document_no ?? String(line.payable_id)}</div>
                          {line._doc_date && <div className="text-gray-400">{formatDate(line._doc_date as string)}</div>}
                        </td>
                        <td className="px-3 py-2 border-b border-gray-100 text-gray-500">
                          {line._doc_external_reference || '—'}
                        </td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">
                          {line._doc_gross_total != null ? formatCurrency(line._doc_gross_total as number) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">
                          {line._doc_pending_total != null ? formatCurrency(line._doc_pending_total as number) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">{formatCurrency(retentionValue)}</td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">{discountPct} %</td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 text-gray-600">{formatCurrency(discountValue)}</td>
                        <td className="px-3 py-2 text-right border-b border-gray-100 font-semibold text-gray-700">{formatCurrency(line.paid_value)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
