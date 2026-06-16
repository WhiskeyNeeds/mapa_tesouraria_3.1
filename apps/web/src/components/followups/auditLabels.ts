/**
 * Conversão de actions/diffs do audit log para texto legível em PT.
 * Mantém-se separado dos componentes para tipos serem reutilizáveis.
 */

export type AuditAction =
  | 'receivable.create' | 'receivable.update' | 'receivable.delete'
  | 'receivable.pay' | 'receivable.settle' | 'receivable.unsettle'
  | 'receivable.void' | 'receivable.set_promised_date'
  | 'receivable.split' | 'receivable.unsplit'
  | 'receivable.reconcile' | 'receivable.reconcile_reverse'
  | 'payable.create' | 'payable.update' | 'payable.delete'
  | 'payable.pay' | 'payable.settle' | 'payable.unsettle'
  | 'payable.void' | 'payable.set_promised_date' | 'payable.set_ready_to_pay'
  | 'payable.split' | 'payable.unsplit'
  | 'payable.reconcile' | 'payable.reconcile_reverse'
  | string

export type DiffPayload = { changes?: Record<string, { from: unknown; to: unknown }> }

const FIELD_LABELS: Record<string, string> = {
  entityName: 'Nome',
  reference: 'Referência',
  description: 'Descrição',
  documentDate: 'Data do documento',
  dueDate: 'Vencimento',
  totalAmount: 'Valor total',
  pendingAmount: 'Pendente',
  receivedAmount: 'Recebido',
  paidAmount: 'Pago',
  status: 'Estado',
  origin: 'Origem',
  categoryId: 'Categoria',
  budgetId: 'Budget',
  _tocOverlay: 'TOConline',
  promisedPaymentDate: 'Data prometida',
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Em aberto',
  PARTIAL: 'Parcial',
  PAID: 'Pago',
  SETTLED: 'Liquidada',
  VOID: 'Anulada',
}

// Origem da liquidação (payload.via): como o documento ficou pago/liquidado.
const SETTLEMENT_SOURCE_LABEL: Record<string, string> = {
  LOCAL: 'manualmente',
  INSTALLMENTS: 'pelas parcelas',
  RECONCILIATION: 'por reconciliação',
}

/** Sufixo " (liquidado …)" quando o payload identifica a origem da liquidação. */
function viaSuffix(via: unknown, prefix = 'liquidado'): string {
  const label = typeof via === 'string' ? SETTLEMENT_SOURCE_LABEL[via] : undefined
  return label ? ` (${prefix} ${label})` : ''
}

const MONEY = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' })

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}

export function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (field === 'status') return STATUS_LABELS[String(value)] ?? String(value)
  if (field.endsWith('Date') || field === 'dueDate' || field === 'documentDate' || field === 'promisedPaymentDate') {
    const d = new Date(String(value))
    if (!isNaN(d.getTime())) return d.toLocaleDateString('pt-PT')
  }
  if (typeof value === 'number') {
    if (field === 'totalAmount' || field === 'pendingAmount' || field === 'receivedAmount' || field === 'paidAmount') {
      return MONEY.format(value)
    }
  }
  return String(value)
}

/**
 * Texto curto para o "título" do evento de auditoria — o que aparece em
 * negrito na entrada da timeline.
 */
export function auditTitle(action: string, payload: unknown): string {
  const p = (payload as Record<string, unknown> | null) ?? {}
  switch (action) {
    case 'receivable.create':
    case 'payable.create':
      return p.source === 'TOCONLINE' ? 'Importada do TOConline' : 'Criada manualmente'
    case 'receivable.update':
    case 'payable.update': {
      const changes = (p as DiffPayload).changes ?? {}
      // Ignora campos internos/overlay (começam por underscore) no título curto.
      const fieldsToShow = Object.keys(changes).filter((f) => !f.startsWith('_')).map(fieldLabel)
      if (fieldsToShow.length === 0) return 'Editada'
      if (fieldsToShow.length === 1) return `${fieldsToShow[0]} alterada`
      if (fieldsToShow.length <= 3) return `Alterado: ${fieldsToShow.join(', ')}`
      return `${fieldsToShow.length} campos alterados`
    }
    case 'receivable.delete':
    case 'payable.delete':
      return p.recurrenceCascade ? 'Recorrência removida (com instâncias)' : 'Apagada'
    case 'receivable.settle':
    case 'payable.settle':
      return p.cascadedChildren ? `Liquidada (+${p.cascadedChildren} parcelas)` : `Liquidada${viaSuffix(p.via)}`
    case 'receivable.pay':
    case 'payable.pay':
      return p.cascadedChildren ? `Marcada como paga (+${p.cascadedChildren} parcelas)` : `Marcada como paga${viaSuffix(p.via)}`
    case 'receivable.unsettle':
    case 'payable.unsettle':
      return `Revertida para Em Aberto${viaSuffix(p.via, 'estava liquidado')}`
    // 'partial_payment' audit actions removed — handled server-side but not shown
    case 'receivable.void':
    case 'payable.void':
      return 'Anulada'
    case 'receivable.set_promised_date':
    case 'payable.set_promised_date': {
      const to = p.to ? new Date(String(p.to)).toLocaleDateString('pt-PT') : null
      return to ? `Data prometida: ${to}` : 'Data prometida removida'
    }
    case 'receivable.set_ready_to_pay':
    case 'payable.set_ready_to_pay':
      return p.to ? 'Marcada como Pronta para Pagar' : 'Removida de Futuros Pagamentos'
    case 'receivable.reconcile':
    case 'payable.reconcile': {
      const amt = MONEY.format(Number(p.amount ?? 0))
      return p.fullySettled ? `Conciliada e marcada como paga: ${amt}` : `Conciliação parcial: ${amt}`
    }
    case 'receivable.reconcile_reverse':
    case 'payable.reconcile_reverse':
      return `Conciliação revertida: ${MONEY.format(Number(p.amount ?? 0))}`
    case 'receivable.split':
    case 'payable.split': {
      const n = Array.isArray(p.installments) ? p.installments.length : 0
      return `Dividida em ${n} parcelas`
    }
    case 'receivable.unsplit':
    case 'payable.unsplit':
      return 'Divisão desfeita'
    default:
      return action
  }
}
