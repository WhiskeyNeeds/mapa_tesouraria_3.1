/**
 * Conversão de actions/diffs do audit log para texto legível em PT.
 * Mantém-se separado dos componentes para tipos serem reutilizáveis.
 */

export type AuditAction =
  | 'receivable.create' | 'receivable.update' | 'receivable.delete'
  | 'receivable.settle' | 'receivable.unsettle' | 'receivable.partial_payment'
  | 'receivable.void' | 'receivable.set_promised_date'
  | 'receivable.split' | 'receivable.unsplit'
  | 'payable.create' | 'payable.update' | 'payable.delete'
  | 'payable.settle' | 'payable.unsettle' | 'payable.partial_payment'
  | 'payable.void' | 'payable.set_promised_date'
  | 'payable.split' | 'payable.unsplit'
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
  promisedPaymentDate: 'Data prometida',
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Em aberto',
  PARTIAL: 'Parcial',
  SETTLED: 'Pago',
  VOID: 'Anulada',
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
      const fields = Object.keys(changes).map(fieldLabel)
      if (fields.length === 0) return 'Editada'
      if (fields.length === 1) return `${fields[0]} alterada`
      if (fields.length <= 3) return `Alterado: ${fields.join(', ')}`
      return `${fields.length} campos alterados`
    }
    case 'receivable.delete':
    case 'payable.delete':
      return p.recurrenceCascade ? 'Recorrência removida (com instâncias)' : 'Apagada'
    case 'receivable.settle':
    case 'payable.settle':
      return p.cascadedChildren ? `Pago (+${p.cascadedChildren} parcelas)` : 'Pago'
    case 'receivable.unsettle':
    case 'payable.unsettle':
      return 'Pagamento revertido'
    case 'receivable.partial_payment':
      return `Pagamento recebido: ${MONEY.format(Number(p.amount ?? 0))}`
    case 'payable.partial_payment':
      return `Pagamento efetuado: ${MONEY.format(Number(p.amount ?? 0))}`
    case 'receivable.void':
    case 'payable.void':
      return 'Anulada'
    case 'receivable.set_promised_date':
    case 'payable.set_promised_date': {
      const to = p.to ? new Date(String(p.to)).toLocaleDateString('pt-PT') : null
      return to ? `Data prometida: ${to}` : 'Data prometida removida'
    }
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
