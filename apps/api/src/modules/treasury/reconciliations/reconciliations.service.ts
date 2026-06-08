import type { PrismaClient, TreasuryCategoryType } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'
import { ToconlineService } from '../../toconline/toconline.service.js'
import { resolveDocAmountsFromDb } from '../../../lib/toc-overlay.js'

export interface ReconciliationItem {
  movementIds: string[]
  allocations: Array<{
    type: 'receivable' | 'payable'
    id: string
    amount: number
  }>
  isDryRun?: boolean
}

export class TreasuryReconciliationsService {
  private tocSvc: ToconlineService

  constructor(private prisma: PrismaClient) {
    this.tocSvc = new ToconlineService(prisma)
  }

  async list(clientId: string, filters: { page?: number; limit?: number; status?: string }) {
    const { page = 1, limit = 20, status } = filters
    const where = {
      clientId,
      ...(status ? { status: status as never } : {}),
      movements: { some: { movement: { deletedAt: null } } },
    }

    const [total, items] = await Promise.all([
      this.prisma.treasuryReconciliation.count({ where }),
      this.prisma.treasuryReconciliation.findMany({
        where,
        include: {
          movements: { include: { movement: { select: { id: true, date: true, amount: true, description: true, bankAccount: { select: { id: true, name: true } } } } } },
          receivables: { include: { receivable: { select: { id: true, reference: true, entityName: true, pendingAmount: true } } } },
          payables: { include: { payable: { select: { id: true, reference: true, entityName: true, pendingAmount: true } } } },
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    return { total, page, limit, items }
  }

  async getById(clientId: string, id: string) {
    const item = await this.prisma.treasuryReconciliation.findFirst({
      where: { id, clientId },
      include: {
        movements: { include: { movement: true } },
        receivables: { include: { receivable: { include: { category: true } } } },
        payables: { include: { payable: { include: { category: true } } } },
        createdBy: { select: { id: true, name: true } },
        reversedBy: { select: { id: true, name: true } },
      },
    })
    if (!item) throw httpError(404, 'Reconciliation not found')
    return item
  }

  async preview(clientId: string, data: ReconciliationItem) {
    const movements = await this.prisma.treasuryBankMovement.findMany({
      where: { id: { in: data.movementIds }, clientId, deletedAt: null },
    })
    if (movements.length !== data.movementIds.length) throw httpError(404, 'One or more movements not found')

    const hasPositive = movements.some((m) => Number(m.amount) > 0)
    const hasNegative = movements.some((m) => Number(m.amount) < 0)
    if (hasPositive && hasNegative) throw httpError(400, 'Não é possível misturar movimentos de entrada e saída na mesma reconciliação')

    const totalMovements = movements.reduce((sum, m) => {
      const fullAmt = Number(m.amount)
      const reconciled = Math.max(0, Number(m.reconciledAmount ?? 0))
      const remaining = Math.abs(fullAmt) - reconciled
      return sum + (fullAmt >= 0 ? remaining : -remaining)
    }, 0)
    const direction: TreasuryCategoryType = totalMovements >= 0 ? 'REVENUE' : 'EXPENSE'

    // Validate allocations
    let totalAllocated = 0
    const allocDetails = []
    for (const alloc of data.allocations) {
      const doc = alloc.type === 'receivable'
        ? await this.prisma.treasuryReceivable.findFirst({ where: { id: alloc.id, clientId, deletedAt: null }, include: { category: true } })
        : await this.prisma.treasuryPayable.findFirst({ where: { id: alloc.id, clientId, deletedAt: null }, include: { category: true } })

      if (!doc) throw httpError(404, `Document ${alloc.id} not found`)
      if (alloc.amount <= 0) throw httpError(400, `Allocation amount must be positive`)
      // O pending fiável vem do overlay TOC: para docs ligados ao TOConline os
      // campos de valor locais estão a null (vivem no espelho toc*Document), por
      // isso ler doc.pendingAmount cru dava sempre null → 0 e bloqueava tudo.
      const { pending, reference } = await resolveDocAmountsFromDb(this.prisma, clientId, alloc.type, doc)
      if (alloc.amount > pending + 0.01) throw httpError(400, `Allocation ${alloc.amount} exceeds pending ${pending} for ${reference}`)

      totalAllocated += alloc.amount
      // launchToc forçado a false: a app deixou de lançar recibos/pagamentos no
      // TOC pelo frontend (intencional). O caminho fica como dead-code para uma
      // futura reativação por integração.
      allocDetails.push({ ...alloc, doc, launchToc: false })
    }

    if (totalAllocated > Math.abs(totalMovements) + 0.01) {
      throw httpError(400, `Allocated (${totalAllocated.toFixed(2)}) exceeds movements total (${Math.abs(totalMovements).toFixed(2)})`)
    }

    const tocActions = allocDetails.filter((a) => a.launchToc).map((a) => ({
      type: a.type,
      reference: (a.doc as { reference: string }).reference,
      amount: a.amount,
    }))

    return { direction, totalMovements: Math.abs(totalMovements), totalAllocated, tocActions, isDryRun: data.isDryRun ?? true }
  }

  private async isDryRunForClient(clientId: string, explicitValue?: boolean): Promise<boolean> {
    if (explicitValue !== undefined) return explicitValue
    const settings = await this.prisma.treasurySettings.findUnique({ where: { clientId } })
    return settings?.reconciliationDryRun ?? true
  }

  async confirm(clientId: string, userId: string, data: ReconciliationItem) {
    const isDryRun = await this.isDryRunForClient(clientId, data.isDryRun)
    const preview = await this.preview(clientId, { ...data, isDryRun })

    return this.prisma.$transaction(async (tx) => {
      const recon = await tx.treasuryReconciliation.create({
        data: {
          clientId,
          createdById: userId,
          direction: preview.direction,
          isDryRun,
          status: 'CONFIRMED',
          totalMovements: preview.totalMovements,
          totalAllocated: preview.totalAllocated,
        },
      })

      // Link movements — allocate proportionally when totalAllocated < totalMovements
      for (const movId of data.movementIds) {
        const mov = await tx.treasuryBankMovement.findUnique({ where: { id: movId } })
        if (!mov) continue

        const movFullAmt = Math.abs(Number(mov.amount))
        const movRemaining = movFullAmt - Math.max(0, Number(mov.reconciledAmount ?? 0))
        const movAllocated = Math.abs(preview.totalMovements) > 0
          ? Math.round(preview.totalAllocated * (movRemaining / Math.abs(preview.totalMovements)) * 100) / 100
          : movRemaining

        await tx.treasuryReconciliationMovement.create({
          data: { reconciliationId: recon.id, movementId: movId, amount: movAllocated },
        })
        // O estado local é sempre atualizado, mesmo em dry-run. dry-run significa
        // apenas "não escrever no TOConline" — a reconciliação é registada localmente,
        // por isso o movimento deixa de surgir como disponível e o reverse() (que
        // também atualiza o estado sem verificar dry-run) fica coerente.
        const newReconciledAmount = Number(mov.reconciledAmount) + movAllocated
        await tx.treasuryBankMovement.update({
          where: { id: movId },
          data: {
            reconciledAmount: newReconciledAmount,
            status: newReconciledAmount >= movFullAmt - 0.01 ? 'RECONCILED' : 'PARTIAL',
          },
        })
      }

      // Link and process allocations
      let tocReceipts = 0
      let tocPayments = 0
      let tocFirstError: string | undefined

      for (const alloc of data.allocations) {
        // Forçado a false: ver comentário em preview() acima.
        const launchToc = false

        if (alloc.type === 'receivable') {
          let tocReceiptId: string | undefined
          let tocError: string | undefined

          if (launchToc && !isDryRun) {
            try {
              const result = await this.tocSvc.createSalesReceipt(clientId, {
                sales_document_id: (await tx.treasuryReceivable.findUnique({ where: { id: alloc.id } }))?.tocSalesDocId,
                value: alloc.amount,
              }) as { id?: number }
              tocReceiptId = String(result?.id)
              tocReceipts++
            } catch (err) {
              tocError = err instanceof Error ? err.message : 'TOConline error'
              if (!tocFirstError) tocFirstError = tocError
            }
          }

          await tx.treasuryReconciliationReceivable.create({
            data: { reconciliationId: recon.id, receivableId: alloc.id, amountAllocated: alloc.amount, tocReceiptId, tocError },
          })

          // Atualização local sempre aplicada (ver nota no bloco dos movimentos).
          const rec = await tx.treasuryReceivable.findUnique({ where: { id: alloc.id } })
          if (rec) {
            // total/received reais via overlay TOC — em docs ligados os campos
            // locais estão a null, pelo que somar sobre eles marcaria SETTLED
            // indevidamente numa reconciliação parcial.
            const { total, settled } = await resolveDocAmountsFromDb(this.prisma, clientId, 'receivable', rec)
            const newReceived = settled + alloc.amount
            const newPending = Math.max(0, total - newReceived)
            await tx.treasuryReceivable.update({
              where: { id: alloc.id },
              data: {
                receivedAmount: newReceived,
                pendingAmount: newPending,
                status: newPending <= 0.01 ? 'SETTLED' : 'PARTIAL',
                settledAt: newPending <= 0.01 ? new Date() : null,
              },
            })
          }
        } else {
          let tocPaymentId: string | undefined
          let tocError: string | undefined

          if (launchToc && !isDryRun) {
            try {
              const result = await this.tocSvc.createPurchasePayment(clientId, {
                purchases_document_id: (await tx.treasuryPayable.findUnique({ where: { id: alloc.id } }))?.tocPurchasesDocId,
                value: alloc.amount,
              }) as { id?: number }
              tocPaymentId = String(result?.id)
              tocPayments++
            } catch (err) {
              tocError = err instanceof Error ? err.message : 'TOConline error'
              if (!tocFirstError) tocFirstError = tocError
            }
          }

          await tx.treasuryReconciliationPayable.create({
            data: { reconciliationId: recon.id, payableId: alloc.id, amountAllocated: alloc.amount, tocPaymentId, tocError },
          })

          // Atualização local sempre aplicada (ver nota no bloco dos movimentos).
          const pay = await tx.treasuryPayable.findUnique({ where: { id: alloc.id } })
          if (pay) {
            // total/paid reais via overlay TOC (ver nota no bloco dos receivables).
            const { total, settled } = await resolveDocAmountsFromDb(this.prisma, clientId, 'payable', pay)
            const newPaid = settled + alloc.amount
            const newPending = Math.max(0, total - newPaid)
            await tx.treasuryPayable.update({
              where: { id: alloc.id },
              data: {
                paidAmount: newPaid,
                pendingAmount: newPending,
                status: newPending <= 0.01 ? 'SETTLED' : 'PARTIAL',
              },
            })
          }
        }
      }

      await tx.treasuryReconciliation.update({
        where: { id: recon.id },
        data: { tocReceiptsCreated: tocReceipts, tocPaymentsCreated: tocPayments, tocFirstError },
      })

      // Audit log
      await tx.treasuryAuditLog.create({
        data: {
          clientId,
          userId,
          action: 'reconciliation.confirm',
          entityType: 'Reconciliation',
          entityId: recon.id,
          payload: { isDryRun, movementsCount: data.movementIds.length, allocationsCount: data.allocations.length },
        },
      })

      return tx.treasuryReconciliation.findUnique({ where: { id: recon.id } })
    })
  }

  async reverse(clientId: string, reconciliationId: string, userId: string, reason?: string) {
    const recon = await this.getById(clientId, reconciliationId)
    if (recon.status !== 'CONFIRMED') throw httpError(409, 'Only confirmed reconciliations can be reversed')

    return this.prisma.$transaction(async (tx) => {
      // Reverse movements
      for (const link of recon.movements) {
        const mov = await tx.treasuryBankMovement.findUnique({ where: { id: link.movementId } })
        if (!mov) continue
        const newReconciledAmount = Math.max(0, Number(mov.reconciledAmount) - Math.abs(Number(link.amount)))
        await tx.treasuryBankMovement.update({
          where: { id: link.movementId },
          data: {
            reconciledAmount: newReconciledAmount,
            status: newReconciledAmount <= 0.01 ? 'CLASSIFIED' : 'PARTIAL',
          },
        })
      }

      // Reverse receivables
      for (const link of recon.receivables) {
        const rec = await tx.treasuryReceivable.findUnique({ where: { id: link.receivableId } })
        if (rec) {
          // total/received reais via overlay TOC: em docs ligados o totalAmount
          // local é null, pelo que `total - received` gravava pending negativo.
          const { total, settled } = await resolveDocAmountsFromDb(this.prisma, clientId, 'receivable', rec)
          const newReceived = Math.max(0, settled - Number(link.amountAllocated))
          await tx.treasuryReceivable.update({
            where: { id: link.receivableId },
            data: {
              receivedAmount: newReceived,
              pendingAmount: Math.max(0, total - newReceived),
              status: newReceived <= 0 ? 'OPEN' : 'PARTIAL',
              settledAt: null,
            },
          })
        }
      }

      // Reverse payables
      for (const link of recon.payables) {
        const pay = await tx.treasuryPayable.findUnique({ where: { id: link.payableId } })
        if (pay) {
          // total/paid reais via overlay TOC (ver nota no bloco dos receivables).
          const { total, settled } = await resolveDocAmountsFromDb(this.prisma, clientId, 'payable', pay)
          const newPaid = Math.max(0, settled - Number(link.amountAllocated))
          await tx.treasuryPayable.update({
            where: { id: link.payableId },
            data: {
              paidAmount: newPaid,
              pendingAmount: Math.max(0, total - newPaid),
              status: newPaid <= 0 ? 'OPEN' : 'PARTIAL',
            },
          })
        }
      }

      await tx.treasuryReconciliation.update({
        where: { id: reconciliationId },
        data: { status: 'REVERSED', reversedAt: new Date(), reversedById: userId, reversedReason: reason },
      })

      await tx.treasuryAuditLog.create({
        data: { clientId, userId, action: 'reconciliation.reverse', entityType: 'Reconciliation', entityId: reconciliationId, payload: { reason } },
      })
    })
  }
}
