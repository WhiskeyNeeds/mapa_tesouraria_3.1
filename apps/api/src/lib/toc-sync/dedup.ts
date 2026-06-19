import type { PrismaClient } from '@prisma/client'

// Um "stub" é a representação local automática de um documento TOConline: ligado
// ao TOC mas SEM dados do utilizador (sem referência, valores, categoria, orçamento,
// comprovativo, recorrência ou filhos) e ainda em aberto. É fungível — pode ser
// removido para que um local com dados reais assuma a ligação ao mesmo documento TOC.

/**
 * Se um stub vazio já estiver ligado a este documento TOConline de VENDA, remove-o
 * (soft-delete) para o local atual poder assumir a ligação (unificar, sem duplicados).
 * Devolve `true` se a ligação pode prosseguir; `false` se já existe um local COM DADOS
 * ligado a este TOC (conflito real — não se liga).
 */
export async function clearBareTocSalesStub(prisma: PrismaClient, clientId: string, tocId: string): Promise<boolean> {
  const existing = await prisma.treasuryReceivable.findFirst({
    where: { clientId, tocSalesDocId: tocId, deletedAt: null },
    select: { id: true, reference: true, totalAmount: true, categoryId: true, budgetId: true, receiptReference: true, recurrenceId: true, status: true, _count: { select: { children: true } } },
  })
  if (!existing) return true
  const bare = existing.reference == null && existing.totalAmount == null && existing.categoryId == null
    && existing.budgetId == null && existing.receiptReference == null && existing.recurrenceId == null
    && (existing.status === 'OPEN' || existing.status === 'PARTIAL') && existing._count.children === 0
  if (!bare) return false
  await prisma.treasuryReceivable.update({ where: { id: existing.id }, data: { deletedAt: new Date() } })
  return true
}

/** Igual ao anterior, para documentos TOConline de COMPRA. */
export async function clearBareTocPurchaseStub(prisma: PrismaClient, clientId: string, tocId: string): Promise<boolean> {
  const existing = await prisma.treasuryPayable.findFirst({
    where: { clientId, tocPurchasesDocId: tocId, deletedAt: null },
    select: { id: true, reference: true, totalAmount: true, categoryId: true, budgetId: true, paymentReference: true, recurrenceId: true, status: true, _count: { select: { children: true } } },
  })
  if (!existing) return true
  const bare = existing.reference == null && existing.totalAmount == null && existing.categoryId == null
    && existing.budgetId == null && existing.paymentReference == null && existing.recurrenceId == null
    && (existing.status === 'OPEN' || existing.status === 'PARTIAL') && existing._count.children === 0
  if (!bare) return false
  await prisma.treasuryPayable.update({ where: { id: existing.id }, data: { deletedAt: new Date() } })
  return true
}
