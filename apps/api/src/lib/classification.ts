// Utility partilhado para aplicar regras de classificação (TreasuryClassificationRule) a documentos.
// Usado por:
//   - bank-movements.service: matches sobre movimentos importados (mantém helper privado próprio
//     por compatibilidade com a forma como passa o `amount` com sinal).
//   - payables.service / receivables.service: matches sobre faturas, onde o `amount` é sempre
//     positivo e a direção é determinada pelo tipo (REVENUE/EXPENSE) do documento.

export interface RuleMatchContext {
  /** Sempre positivo; valor absoluto da fatura/movimento. */
  amount: number
  /** REVENUE para receivables/entradas, EXPENSE para payables/saídas. */
  type: 'REVENUE' | 'EXPENSE'
  description?: string | null
  counterpartName?: string | null
  counterpartIban?: string | null
}

export interface ClassificationRuleLite {
  direction: string | null
  amountMin: unknown
  amountMax: unknown
  matchField: string
  matchOp: string
  matchValue: string
  categoryId: string
}

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

/** Devolve a primeira regra que faz match, ou undefined. Espera-se que `rules` venha já ordenado por prioridade. */
export function matchClassificationRule<R extends ClassificationRuleLite>(
  rules: R[],
  ctx: RuleMatchContext,
): R | undefined {
  for (const rule of rules) {
    if (rule.direction && rule.direction !== ctx.type) continue
    if (rule.amountMin != null && ctx.amount < Number(rule.amountMin)) continue
    if (rule.amountMax != null && ctx.amount > Number(rule.amountMax)) continue

    const field = rule.matchField === 'description' ? normalize(ctx.description ?? '')
      : rule.matchField === 'counterpart' ? normalize(ctx.counterpartName ?? '')
      : normalize(ctx.counterpartIban ?? '')

    const value = normalize(rule.matchValue)
    let matches = false
    if (rule.matchOp === 'contains') matches = field.includes(value)
    else if (rule.matchOp === 'equals') matches = field === value
    else if (rule.matchOp === 'startsWith') matches = field.startsWith(value)
    else if (rule.matchOp === 'regex') {
      try { matches = new RegExp(rule.matchValue, 'i').test(field) } catch { matches = false }
    }

    if (matches) return rule
  }
  return undefined
}
