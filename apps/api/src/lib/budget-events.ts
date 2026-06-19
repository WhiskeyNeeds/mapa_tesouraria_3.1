import type { PrismaClient, Prisma } from '@prisma/client'
import { audit } from './audit.js'

interface TxnTransitionArgs {
  clientId: string
  userId: string | null
  docType: 'receivable' | 'payable'
  docId: string
  entityName: string | null
  amount: number
  beforeBudgetId: string | null
  beforeAuto: boolean
  afterBudgetId: string | null
  afterAuto: boolean
}

/**
 * Regista no audit log (entityType='Budget') a transição de associação de uma
 * fatura a um budget. Best-effort via audit(). Nomes de budget congelados no payload.
 */
export async function auditBudgetTxnTransition(
  prisma: PrismaClient | Prisma.TransactionClient,
  a: TxnTransitionArgs,
): Promise<void> {
  const base = { docId: a.docId, docType: a.docType, entityName: a.entityName, amount: a.amount }

  if (a.beforeBudgetId === a.afterBudgetId) {
    // Mesmo budget: só interessa a confirmação de uma auto-atribuição.
    if (a.afterBudgetId && a.beforeAuto && !a.afterAuto) {
      await audit(prisma, { clientId: a.clientId, userId: a.userId, action: 'budget.txn_confirm', entityType: 'Budget', entityId: a.afterBudgetId, payload: base })
    }
    return
  }

  // Resolve nomes dos budgets envolvidos (para congelar no payload).
  const ids = [a.beforeBudgetId, a.afterBudgetId].filter((x): x is string => !!x)
  const rows = ids.length ? await prisma.treasuryBudget.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : []
  const nameOf = (id: string | null) => (id ? rows.find((r) => r.id === id)?.name ?? null : null)

  if (!a.beforeBudgetId && a.afterBudgetId) {
    if (a.afterAuto) {
      await audit(prisma, { clientId: a.clientId, userId: null, action: 'budget.txn_auto_assign', entityType: 'Budget', entityId: a.afterBudgetId, payload: base })
    } else {
      await audit(prisma, { clientId: a.clientId, userId: a.userId, action: 'budget.txn_move_in', entityType: 'Budget', entityId: a.afterBudgetId, payload: base })
    }
    return
  }
  if (a.beforeBudgetId && !a.afterBudgetId) {
    await audit(prisma, { clientId: a.clientId, userId: a.userId, action: 'budget.txn_unassign', entityType: 'Budget', entityId: a.beforeBudgetId, payload: base })
    return
  }
  // X -> Y
  await audit(prisma, { clientId: a.clientId, userId: a.userId, action: 'budget.txn_move_out', entityType: 'Budget', entityId: a.beforeBudgetId!, payload: { ...base, toBudgetName: nameOf(a.afterBudgetId) } })
  await audit(prisma, { clientId: a.clientId, userId: a.userId, action: 'budget.txn_move_in', entityType: 'Budget', entityId: a.afterBudgetId!, payload: { ...base, fromBudgetName: nameOf(a.beforeBudgetId) } })
}
