/**
 * Variáveis suportadas nos templates de email.
 *
 * Sintaxe: {{nome}} é substituído pelo valor; valores nulos viram string vazia
 * silenciosamente para evitar enviar emails com "{{vencimento}}" cru.
 */
export type FollowupVariables = {
  entidade: string
  numero: string
  valor: string
  vencimento: string
  pagamento_prometido: string
  dias_atraso: string
  iban: string
  referencia_mb: string
  entidade_mb: string
  data_hoje: string
}

const PT_DATE = new Intl.DateTimeFormat('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' })
const PT_MONEY = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' })

export function buildVariables(input: {
  entityName?: string | null
  reference?: string | null
  totalAmount: number | string
  dueDate: Date | string | null
  promisedPaymentDate?: Date | string | null
  iban?: string | null
  mbReference?: string | null
  mbEntity?: string | null
}): FollowupVariables {
  const due = input.dueDate ? new Date(input.dueDate) : null
  const promised = input.promisedPaymentDate ? new Date(input.promisedPaymentDate) : null
  const today = new Date()
  const daysOverdue = due ? Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000)) : 0
  const amountNum = typeof input.totalAmount === 'string' ? Number(input.totalAmount) : input.totalAmount

  return {
    entidade: input.entityName ?? '',
    numero: input.reference ?? '',
    valor: Number.isFinite(amountNum) ? PT_MONEY.format(amountNum) : '',
    vencimento: due ? PT_DATE.format(due) : '',
    pagamento_prometido: promised ? PT_DATE.format(promised) : '',
    dias_atraso: String(daysOverdue),
    iban: input.iban ?? '',
    referencia_mb: input.mbReference ?? '',
    entidade_mb: input.mbEntity ?? '',
    data_hoje: PT_DATE.format(today),
  }
}

export function interpolate(template: string, vars: FollowupVariables): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, key: string) => {
    const k = key.toLowerCase() as keyof FollowupVariables
    return vars[k] ?? ''
  })
}

export function variableHint(): { name: keyof FollowupVariables; label: string }[] {
  return [
    { name: 'entidade', label: 'Nome do cliente/fornecedor' },
    { name: 'numero', label: 'Número do documento' },
    { name: 'valor', label: 'Valor total formatado' },
    { name: 'vencimento', label: 'Data de vencimento' },
    { name: 'pagamento_prometido', label: 'Data prometida de pagamento' },
    { name: 'dias_atraso', label: 'Dias em atraso' },
    { name: 'iban', label: 'IBAN da conta bancária' },
    { name: 'referencia_mb', label: 'Referência Multibanco' },
    { name: 'entidade_mb', label: 'Entidade Multibanco' },
    { name: 'data_hoje', label: 'Data de hoje' },
  ]
}
