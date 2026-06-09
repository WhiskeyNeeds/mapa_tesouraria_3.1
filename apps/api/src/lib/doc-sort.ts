/** Ordenação partilhada das listas de receivables/payables.
 *
 *  A coluna "Pagamento" mostra a data efetiva `promisedPaymentDate ?? dueDate`
 *  (a data prometida é uma anotação manual, quase sempre null, com fallback ao
 *  vencimento). A ordenação tem de usar a MESMA data efetiva, senão as linhas
 *  sem data prometida ficam todas com chave null e a coluna parece não ordenar. */

export interface SortableDoc {
  id?: string
  reference?: string | null
  promisedPaymentDate?: Date | null
  dueDate?: Date | null
  [key: string]: unknown
}

/** Valor de ordenação de um documento para um dado campo. */
export function docSortValue(item: SortableDoc, sortBy: string): unknown {
  if (sortBy === 'promisedPaymentDate') return item.promisedPaymentDate ?? item.dueDate ?? null
  return item[sortBy]
}

/** Compara dois valores: datas por timestamp; null/undefined sempre no fim (asc)
 *  / no início (desc), mantendo o comportamento histórico. */
function compareValues(rawA: unknown, rawB: unknown, sortDir: 'asc' | 'desc'): number {
  const va = rawA instanceof Date ? rawA.getTime() : rawA
  const vb = rawB instanceof Date ? rawB.getTime() : rawB
  if (va == null && vb == null) return 0
  if (va == null) return sortDir === 'asc' ? 1 : -1
  if (vb == null) return sortDir === 'asc' ? -1 : 1
  if (va < vb) return sortDir === 'asc' ? -1 : 1
  if (va > vb) return sortDir === 'asc' ? 1 : -1
  return 0
}

/** Comparador estável e determinístico para `Array.prototype.sort`.
 *
 *  Em empate na chave principal, desempata por data de vencimento, depois nº de
 *  documento e, por fim, id — tudo na mesma direção do sort. Garante que duas
 *  faturas com a mesma data de pagamento efetiva (ex.: uma com data prometida e
 *  outra cujo vencimento coincide) ficam sempre na mesma ordem, em vez de
 *  dependerem da ordem de chegada da base de dados. */
export function compareDocs(a: SortableDoc, b: SortableDoc, sortBy: string, sortDir: 'asc' | 'desc'): number {
  const primary = compareValues(docSortValue(a, sortBy), docSortValue(b, sortBy), sortDir)
  if (primary !== 0) return primary
  if (sortBy !== 'dueDate') {
    const byDue = compareValues(a.dueDate ?? null, b.dueDate ?? null, sortDir)
    if (byDue !== 0) return byDue
  }
  if (sortBy !== 'reference') {
    const byRef = compareValues(a.reference ?? null, b.reference ?? null, sortDir)
    if (byRef !== 0) return byRef
  }
  return compareValues(a.id ?? null, b.id ?? null, sortDir)
}
