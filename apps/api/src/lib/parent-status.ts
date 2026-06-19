import type { Prisma, PrismaClient, TreasuryDocStatus, TreasurySettlementSource } from '@prisma/client'

type Db = PrismaClient | Prisma.TransactionClient
type Kind = 'receivable' | 'payable'

type ChildLite = { status: TreasuryDocStatus; promisedPaymentDate: Date | null; dueDate: Date | null }

/** Deriva estado, origem de liquidação e próxima data prometida de uma mãe a
 *  partir das suas parcelas (filhos não-recorrentes, não anulados). */
function deriveParent(children: ChildLite[]): {
  status: TreasuryDocStatus
  settledVia: TreasurySettlementSource | null
  promisedPaymentDate: Date | null
} {
  const active = children.filter((c) => c.status !== 'VOID')
  const allSettled = active.length > 0 && active.every((c) => c.status === 'SETTLED')
  const allClosed = active.length > 0 && active.every((c) => c.status === 'SETTLED' || c.status === 'PAID')
  const someProgress = active.some((c) => c.status === 'SETTLED' || c.status === 'PAID' || c.status === 'PARTIAL')
  const status: TreasuryDocStatus = allSettled ? 'SETTLED' : allClosed ? 'PAID' : someProgress ? 'PARTIAL' : 'OPEN'
  // A mãe nunca é liquidada diretamente: quando fechada, a origem é sempre INSTALLMENTS.
  const settledVia: TreasurySettlementSource | null = (status === 'SETTLED' || status === 'PAID') ? 'INSTALLMENTS' : null

  const pendingDates = children
    .filter((c) => c.status !== 'PAID' && c.status !== 'SETTLED' && c.status !== 'VOID')
    .map((c) => c.promisedPaymentDate ?? c.dueDate)
    .filter((d): d is Date => d != null)
  const promisedPaymentDate = pendingDates.length > 0
    ? pendingDates.reduce((min, d) => (d < min ? d : min), pendingDates[0])
    : null

  return { status, settledVia, promisedPaymentDate }
}

/** Recalcula a mãe a partir das parcelas. Partilhado por receivables, payables
 *  e reconciliação. Só receivables têm `settledAt`. */
export async function syncParentDocStatus(db: Db, _clientId: string, kind: Kind, parentId: string): Promise<void> {
  if (kind === 'receivable') {
    const children = await db.treasuryReceivable.findMany({
      where: { parentId, deletedAt: null, recurrenceId: null },
      select: { status: true, receivedAmount: true, pendingAmount: true, promisedPaymentDate: true, dueDate: true },
    })
    if (children.length === 0) return
    const receivedAmount = children.reduce((s, c) => s + Number(c.receivedAmount ?? 0), 0)
    const pendingAmount = children.reduce((s, c) => s + Number(c.pendingAmount ?? 0), 0)
    const { status, settledVia, promisedPaymentDate } = deriveParent(children)
    const parent = await db.treasuryReceivable.findUnique({ where: { id: parentId }, select: { settledAt: true } })
    const settledAt = (status === 'SETTLED' || status === 'PAID') ? (parent?.settledAt ?? new Date()) : null
    await db.treasuryReceivable.update({
      where: { id: parentId },
      data: { status, receivedAmount, pendingAmount, promisedPaymentDate, settledAt, settledVia },
    })
    return
  }

  const children = await db.treasuryPayable.findMany({
    where: { parentId, deletedAt: null, recurrenceId: null },
    select: { status: true, paidAmount: true, pendingAmount: true, promisedPaymentDate: true, dueDate: true },
  })
  if (children.length === 0) return
  const paidAmount = children.reduce((s, c) => s + Number(c.paidAmount ?? 0), 0)
  const pendingAmount = children.reduce((s, c) => s + Number(c.pendingAmount ?? 0), 0)
  const { status, settledVia, promisedPaymentDate } = deriveParent(children)
  const parent = await db.treasuryPayable.findUnique({ where: { id: parentId }, select: { settledAt: true } })
  const settledAt = (status === 'SETTLED' || status === 'PAID') ? (parent?.settledAt ?? new Date()) : null
  await db.treasuryPayable.update({
    where: { id: parentId },
    data: { status, paidAmount, pendingAmount, promisedPaymentDate, settledAt, settledVia },
  })
}
