import type { Prisma } from '@prisma/client'

/**
 * Desliga UM documento (receivable/payable) das reconciliações CONFIRMADAS em que
 * participa, sem reverter os outros documentos (reversão parcial). Liberta
 * proporcionalmente o valor alocado nos movimentos da reconciliação, reduz a
 * parcela de cada movimento e remove a ligação do documento. Se a reconciliação
 * ficar sem documentos, marca-a como REVERSED.
 *
 * Deve correr dentro de uma transação. Devolve o nº de reconciliações afetadas e
 * o valor total desreconciliado deste documento.
 */
export async function detachDocFromConfirmedReconciliations(
  tx: Prisma.TransactionClient,
  clientId: string,
  userId: string,
  direction: 'receivable' | 'payable',
  docId: string,
): Promise<{ reconciliations: number; amount: number }> {
  const links = direction === 'receivable'
    ? await tx.treasuryReconciliationReceivable.findMany({
        where: { receivableId: docId, reconciliation: { clientId, status: 'CONFIRMED' } },
        include: { reconciliation: { include: { movements: true, receivables: true, payables: true } } },
      })
    : await tx.treasuryReconciliationPayable.findMany({
        where: { payableId: docId, reconciliation: { clientId, status: 'CONFIRMED' } },
        include: { reconciliation: { include: { movements: true, receivables: true, payables: true } } },
      })

  let affected = 0
  let detachedAmount = 0
  for (const link of links) {
    const recon = link.reconciliation
    const docAmount = Number(link.amountAllocated)
    const totalAllocated = Number(recon.totalAllocated)
    const freedFraction = totalAllocated > 0 ? Math.min(1, docAmount / totalAllocated) : 1

    // Liberta proporcionalmente cada movimento e reduz a sua parcela na reconciliação.
    for (const movLink of recon.movements) {
      const reduction = Number(movLink.amount) * freedFraction
      const mov = await tx.treasuryBankMovement.findUnique({ where: { id: movLink.movementId } })
      if (mov) {
        const fullAmt = Math.abs(Number(mov.amount))
        const newReconciled = Math.max(0, Number(mov.reconciledAmount) - reduction)
        await tx.treasuryBankMovement.update({
          where: { id: movLink.movementId },
          data: {
            reconciledAmount: newReconciled,
            status: newReconciled <= 0.01 ? 'CLASSIFIED' : (newReconciled >= fullAmt - 0.01 ? 'RECONCILED' : 'PARTIAL'),
          },
        })
      }
      await tx.treasuryReconciliationMovement.update({
        where: { id: movLink.id },
        data: { amount: Math.max(0, Number(movLink.amount) - reduction) },
      })
    }

    // Remove a ligação deste documento.
    if (direction === 'receivable') {
      await tx.treasuryReconciliationReceivable.delete({ where: { id: link.id } })
    } else {
      await tx.treasuryReconciliationPayable.delete({ where: { id: link.id } })
    }

    // Sem documentos restantes → a reconciliação fica vazia: marca-a como revertida.
    const remainingDocs = recon.receivables.length + recon.payables.length - 1
    if (remainingDocs <= 0) {
      await tx.treasuryReconciliation.update({
        where: { id: recon.id },
        data: {
          status: 'REVERSED',
          reversedAt: new Date(),
          reversedById: userId,
          reversedReason: 'Documento desreconciliado ao anular o pagamento',
          totalAllocated: 0,
        },
      })
    } else {
      await tx.treasuryReconciliation.update({
        where: { id: recon.id },
        data: { totalAllocated: Math.max(0, totalAllocated - docAmount) },
      })
    }
    affected++
    detachedAmount += docAmount
  }
  return { reconciliations: affected, amount: detachedAmount }
}
