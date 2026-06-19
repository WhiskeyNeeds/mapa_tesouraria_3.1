/**
 * Para um conjunto de tarefas pendentes (cada uma ligada a um documento via
 * `docId` e com um prazo `dueAt`), devolve um mapa `docId → dueAt mais antigo`
 * (em ISO string). Tarefas sem `docId` ou sem `dueAt` são ignoradas.
 *
 * As ISO strings têm formato fixo, por isso a comparação lexicográfica (`<`)
 * coincide com a ordem cronológica — o mais "antigo" é o menor.
 */
export function earliestPendingDueAt(
  tasks: Array<{ docId: string | null; dueAt: Date | null }>,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const t of tasks) {
    if (!t.docId || !t.dueAt) continue
    const iso = t.dueAt.toISOString()
    const current = map.get(t.docId)
    if (!current || iso < current) map.set(t.docId, iso)
  }
  return map
}
