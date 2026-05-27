/**
 * Utilities para divisão de faturas em parcelas garantindo soma exata.
 *
 * O problema: ao converter entre € e %, ou ao formatar com toFixed(2), os
 * arredondamentos podem fazer a soma das parcelas divergir do total da fatura
 * (ex.: 1000€ em 3 parcelas a 33.33% dá 999.90€, não 1000€).
 *
 * A solução: trabalhar em inteiros (cêntimos para EUR, milésimos de % para PCT)
 * e absorver o resto da divisão na última parcela. A última parcela carrega a
 * diferença para que a soma fique sempre exata.
 */

/** Divide um total em N partes inteiras; distribui o resto pelos primeiros índices. */
export function distributeIntoIntegers(total: number, n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(total / n)
  const rem = total - base * n
  return Array.from({ length: n }, (_, i) => (i < rem ? base + 1 : base))
}

/** Divide um total em € em N parcelas com soma exata (em cêntimos). Devolve valores em €. */
export function distributeAmount(totalEUR: number, n: number): number[] {
  const totalCents = Math.round(totalEUR * 100)
  return distributeIntoIntegers(totalCents, n).map((c) => c / 100)
}

/** Divide 100% em N parcelas com soma exata (em milésimos de %). Devolve % com 3 casas. */
export function distributePct(n: number): number[] {
  return distributeIntoIntegers(100000, n).map((m) => m / 1000)
}

/**
 * Ajusta a última parcela para garantir que a soma de `amounts` é exatamente `total`.
 * Útil depois de o utilizador ter editado manualmente alguns valores.
 *
 * Se algum valor for inválido (NaN), é tratado como 0.
 */
export function closeAmountsTo(amounts: number[], total: number): number[] {
  if (amounts.length === 0) return amounts
  const totalCents = Math.round(total * 100)
  const cents = amounts.map((a) => Math.round((Number.isFinite(a) ? a : 0) * 100))
  const sum = cents.reduce((s, c) => s + c, 0)
  const diff = totalCents - sum
  const adjusted = [...cents]
  adjusted[adjusted.length - 1] = adjusted[adjusted.length - 1] + diff
  return adjusted.map((c) => c / 100)
}

/** Variante para percentagens: ajusta a última parcela para que a soma seja 100. */
export function closePctsTo100(pcts: number[]): number[] {
  if (pcts.length === 0) return pcts
  const millis = pcts.map((p) => Math.round((Number.isFinite(p) ? p : 0) * 1000))
  const sum = millis.reduce((s, m) => s + m, 0)
  const diff = 100000 - sum
  const adjusted = [...millis]
  adjusted[adjusted.length - 1] = adjusted[adjusted.length - 1] + diff
  return adjusted.map((m) => m / 1000)
}

/**
 * Converte um array de valores em € para %, preservando a soma exata.
 * Trabalha em cêntimos para evitar acumulação de erros de vírgula flutuante.
 */
export function convertEurToPct(amounts: number[], totalEUR: number): number[] {
  if (totalEUR <= 0 || amounts.length === 0) return amounts.map(() => 0)
  const totalCents = Math.round(totalEUR * 100)
  const cents = amounts.map((a) => Math.round((Number.isFinite(a) ? a : 0) * 100))
  // pct em milésimos: (cents / totalCents) * 100000
  const millis = cents.map((c) => Math.round((c * 100000) / totalCents))
  // ajusta o último para somar 100000 exato
  const sum = millis.reduce((s, m) => s + m, 0)
  millis[millis.length - 1] += 100000 - sum
  return millis.map((m) => m / 1000)
}

/**
 * Converte um array de % para € em relação a totalEUR, preservando soma exata.
 * Trabalha em milésimos e cêntimos para evitar perdas.
 */
export function convertPctToEur(pcts: number[], totalEUR: number): number[] {
  if (pcts.length === 0) return []
  const totalCents = Math.round(totalEUR * 100)
  const millis = pcts.map((p) => Math.round((Number.isFinite(p) ? p : 0) * 1000))
  // Garante que os pesos somam exatamente 100000 antes de redistribuir
  const sumMillis = millis.reduce((s, m) => s + m, 0)
  if (sumMillis !== 100000 && sumMillis > 0) {
    millis[millis.length - 1] += 100000 - sumMillis
  }
  const cents = millis.map((m) => Math.floor((m * totalCents) / 100000))
  const sumCents = cents.reduce((s, c) => s + c, 0)
  cents[cents.length - 1] += totalCents - sumCents
  return cents.map((c) => c / 100)
}

/** Formata um número como string com casas decimais fixas (€ → 2 casas, % → 3 casas). */
export function formatInstallmentValue(value: number, mode: 'EUR' | 'PCT'): string {
  if (!Number.isFinite(value)) return mode === 'EUR' ? '0.00' : '0.000'
  return mode === 'EUR' ? value.toFixed(2) : value.toFixed(3)
}
