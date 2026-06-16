/**
 * Numeração interna de documentos criados localmente: `INT{ano}/{n}`, em que `n`
 * é incremental por ordem de criação dentro do mesmo cliente+ano+direção
 * (receivables e payables têm sequências independentes — cada tabela conta a sua).
 */

/** Prefixo da numeração interna para um dado ano (ex.: `INT 2026/`). */
export function internalReferencePrefix(year: number): string {
  return `INT ${year}/`
}

/**
 * Calcula a próxima referência interna a partir das referências já existentes
 * (do mesmo cliente+ano+tabela). Ignora referências que não sigam o padrão.
 */
export function computeNextInternalReference(existingRefs: (string | null | undefined)[], year: number): string {
  const prefix = internalReferencePrefix(year)
  let max = 0
  for (const ref of existingRefs) {
    if (!ref || !ref.startsWith(prefix)) continue
    const n = parseInt(ref.slice(prefix.length), 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${prefix}${max + 1}`
}
