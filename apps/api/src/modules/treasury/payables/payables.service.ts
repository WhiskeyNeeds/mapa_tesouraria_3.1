import type { PrismaClient, TreasuryDocStatus, TreasuryDocOrigin, TreasuryRecurrenceFrequency, Prisma } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'
import { computeNextDate } from '../recurrences/utils.js'
import { TreasuryRecurrencesService } from '../recurrences/recurrences.service.js'
import { TreasuryBudgetsService } from '../budgets/budgets.service.js'
import { TreasuryBudgetRulesService } from '../budget-rules/budget-rules.service.js'
import { audit, diffEntity } from '../../../lib/audit.js'
import { matchClassificationRule } from '../../../lib/classification.js'

export class TreasuryPayablesService {
  private recurrencesSvc: TreasuryRecurrencesService

  constructor(
    private prisma: PrismaClient,
    private budgetsSvc: TreasuryBudgetsService,
    private budgetRulesSvc: TreasuryBudgetRulesService,
  ) {
    this.recurrencesSvc = new TreasuryRecurrencesService(prisma)
  }

  async list(clientId: string, filters: {
    status?: TreasuryDocStatus | TreasuryDocStatus[]
    origin?: TreasuryDocOrigin
    categoryId?: string
    entityName?: string
    dueDateFrom?: string
    dueDateTo?: string
    docDateFrom?: string
    docDateTo?: string
    isRecurrent?: boolean
    overdue?: boolean
    tocSupplierId?: string
    sortBy?: 'dueDate' | 'totalAmount' | 'pendingAmount' | 'entityName'
    sortDir?: 'asc' | 'desc'
    page?: number
    limit?: number
  }) {
    // Materialise pending recurrence instances within the 180-day horizon so the list
    // surfaces the "Futuras" tab content without waiting on a dashboard view to trigger
    // the engine. Idempotent: returns immediately when there's nothing to generate.
    await this.recurrencesSvc.processForClient(clientId, 180)

    const { page = 1, limit = 50, status, origin, categoryId, entityName, dueDateFrom, dueDateTo, docDateFrom, docDateTo, isRecurrent, overdue, tocSupplierId, sortBy = 'dueDate', sortDir = 'asc' } = filters
    const effectiveStatusFilter = overdue
      ? { status: { in: ['OPEN', 'PARTIAL'] as TreasuryDocStatus[] } }
      : Array.isArray(status)
        ? status.length === 1 ? { status: status[0] } : { status: { in: status } }
        : status ? { status } : {}
    const where: Prisma.TreasuryPayableWhereInput = {
      clientId,
      deletedAt: null,
      NOT: { parentId: { not: null }, recurrenceId: null },
      ...effectiveStatusFilter,
      ...(origin ? { origin } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(tocSupplierId ? { tocSupplierId } : {}),
      ...(entityName ? { OR: [
        { entityName: { contains: entityName, mode: 'insensitive' } },
        { reference: { contains: entityName, mode: 'insensitive' } },
      ] } : {}),
      ...(dueDateFrom || dueDateTo || overdue ? {
        dueDate: {
          ...(overdue ? { lt: new Date() } : {}),
          ...(dueDateFrom ? { gte: new Date(dueDateFrom) } : {}),
          ...(dueDateTo ? { lt: new Date(new Date(dueDateTo).getTime() + 86400000) } : {}),
        },
      } : {}),
      ...(docDateFrom || docDateTo ? {
        documentDate: {
          ...(docDateFrom ? { gte: new Date(docDateFrom) } : {}),
          ...(docDateTo ? { lt: new Date(new Date(docDateTo).getTime() + 86400000) } : {}),
        },
      } : {}),
      ...(isRecurrent !== undefined ? { recurrenceId: isRecurrent ? { not: null } : null } : {}),
    }

    const [total, items] = await Promise.all([
      this.prisma.treasuryPayable.count({ where }),
      this.prisma.treasuryPayable.findMany({
        where,
        include: {
          category: { select: { id: true, name: true, color: true, launchToc: true } },
          children: { where: { deletedAt: null }, orderBy: { dueDate: 'asc' } },
        },
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ])

    return { total, page, limit, items }
  }

  async getById(clientId: string, id: string) {
    const item = await this.prisma.treasuryPayable.findFirst({
      where: { id, clientId, deletedAt: null },
      include: {
        category: true,
        recurrence: true,
        reconciliationLinks: { include: { reconciliation: true } },
        children: { where: { deletedAt: null }, orderBy: { dueDate: 'asc' } },
      },
    })
    if (!item) throw httpError(404, 'Payable not found')
    return item
  }

  async create(clientId: string, userId: string, data: {
    categoryId?: string
    entityName?: string
    entityNif?: string
    tocSupplierId?: string
    tocPurchasesDocId?: string
    reference?: string
    description?: string
    documentDate?: string
    dueDate: string
    totalAmount: number
    currency?: string
    recurrenceId?: string
    budgetId?: string
    recurrence?: { frequency: TreasuryRecurrenceFrequency; endDate?: string; occurrences?: number }
  }) {
    // Auto-categorização (categoria de movimentos): regras primeiro, histórico depois.
    // Só corre se o utilizador NÃO enviou categoryId explicitamente; um valor manual prevalece.
    if (!data.categoryId) {
      const rules = await this.prisma.treasuryClassificationRule.findMany({
        where: { clientId, isActive: true },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, direction: true, amountMin: true, amountMax: true, matchField: true, matchOp: true, matchValue: true, categoryId: true },
      })
      const matched = matchClassificationRule(rules, {
        amount: data.totalAmount,
        type: 'EXPENSE',
        description: data.description ?? data.reference ?? null,
        counterpartName: data.entityName ?? null,
      })
      if (matched) {
        data.categoryId = matched.categoryId
      } else if (data.entityName || data.tocSupplierId) {
        // Entity config tem prioridade sobre lookup histórico
        if (data.tocSupplierId) {
          const entityConfig = await this.prisma.treasuryEntityConfig.findUnique({
            where: {
              clientId_entityType_tocEntityId: {
                clientId,
                entityType: 'supplier',
                tocEntityId: String(data.tocSupplierId),
              },
            },
            select: { defaultCategoryId: true },
          })
          if (entityConfig?.defaultCategoryId) {
            data.categoryId = entityConfig.defaultCategoryId
          }
        }
        // Histórico: só corre se a config de entidade não forneceu categoria
        if (!data.categoryId) {
          const last = await this.prisma.treasuryPayable.findFirst({
            where: {
              clientId, deletedAt: null,
              categoryId: { not: null },
              OR: [
                ...(data.tocSupplierId ? [{ tocSupplierId: data.tocSupplierId }] : []),
                ...(data.entityName ? [{ entityName: data.entityName }] : []),
              ],
            },
            orderBy: { createdAt: 'desc' },
            select: { categoryId: true },
          })
          if (last?.categoryId) data.categoryId = last.categoryId
        }
      }
    }

    let category = null
    if (data.categoryId) {
      category = await this.prisma.treasuryCategory.findFirst({ where: { id: data.categoryId, clientId, deletedAt: null } })
      if (!category) throw httpError(404, 'Category not found')
    }

    // Auto-associação por regra de budget
    let resolvedBudgetId = data.budgetId
    let budgetAutoAssigned = false
    if (data.budgetId) {
      await this.budgetsSvc.assertCompatible(clientId, data.budgetId, 'EXPENSE')
    } else if (data.categoryId) {
      const suggestion = await this.budgetRulesSvc.suggest(
        clientId,
        data.categoryId,
        [data.entityName, data.description].filter(Boolean).join(' '),
      )
      if (suggestion) {
        resolvedBudgetId = suggestion.budgetId
        budgetAutoAssigned = true
      }
    }

    if (data.tocPurchasesDocId) {
      const existing = await this.prisma.treasuryPayable.findFirst({
        where: { clientId, tocPurchasesDocId: data.tocPurchasesDocId, deletedAt: null },
      })
      if (existing) throw httpError(409, `Documento ${data.reference ?? data.tocPurchasesDocId} já importado`)
    }

    let recurrenceId = data.recurrenceId

    if (data.recurrence) {
      const firstDueDate = new Date(data.dueDate)
      const rec = await this.prisma.treasuryRecurrence.create({
        data: {
          clientId,
          frequency: data.recurrence.frequency,
          startDate: firstDueDate,
          endDate: data.recurrence.endDate ? new Date(data.recurrence.endDate) : null,
          occurrences: data.recurrence.occurrences ?? null,
          // Start from the first occurrence date so processForClient generates the first child
          nextRunAt: firstDueDate,
        },
      })
      recurrenceId = rec.id
    }

    const created = await this.prisma.treasuryPayable.create({
      data: {
        clientId,
        createdById: userId,
        origin: category?.launchToc ? 'TOCONLINE' : 'LOCAL',
        totalAmount: data.totalAmount,
        // Template roots have pendingAmount=0; actual transactions are the children
        pendingAmount: data.recurrence ? 0 : data.totalAmount,
        documentDate: data.documentDate ? new Date(data.documentDate) : null,
        dueDate: new Date(data.dueDate),
        currency: data.currency ?? 'EUR',
        categoryId: data.categoryId,
        entityName: data.entityName ?? null,
        entityNif: data.entityNif,
        tocSupplierId: data.tocSupplierId,
        tocPurchasesDocId: data.tocPurchasesDocId,
        reference: data.reference ?? null,
        description: data.description,
        recurrenceId,
        ...(resolvedBudgetId ? { budgetId: resolvedBudgetId, budgetAutoAssigned } : {}),
      },
    })

    await audit(this.prisma, {
      clientId, userId,
      action: 'payable.create',
      entityType: 'Payable', entityId: created.id,
      payload: {
        source: data.tocPurchasesDocId ? 'TOCONLINE' : 'MANUAL',
        snapshot: {
          reference: created.reference,
          entityName: created.entityName,
          totalAmount: Number(created.totalAmount.toString()),
          dueDate: created.dueDate.toISOString(),
          categoryId: created.categoryId,
          recurrenceId: created.recurrenceId,
        },
      },
    })

    // When a new recurrence template was just created, kick off the engine immediately
    // so the user sees the future instances populated in the "Futuras" tab on next list.
    if (data.recurrence) {
      await this.recurrencesSvc.processForClient(clientId, 180)
    }

    return created
  }

  async update(clientId: string, userId: string, id: string, data: Partial<{
    entityName: string
    entityNif: string | null
    description: string
    reference: string
    documentDate: string
    dueDate: string
    categoryId: string
    budgetId: string | null
    budgetAutoAssigned: boolean
    totalAmount: number
    status: TreasuryDocStatus
    tocPurchasesDocId: string
    tocSupplierId: string | null
  }>) {
    const item = await this.getById(clientId, id)

    const updateData: Prisma.TreasuryPayableUpdateInput = {}
    if (data.entityName   !== undefined) updateData.entityName   = data.entityName
    if (data.entityNif    !== undefined) updateData.entityNif    = data.entityNif
    if (data.description  !== undefined) updateData.description  = data.description
    if (data.reference    !== undefined) updateData.reference    = data.reference
    if (data.dueDate)                    updateData.dueDate      = new Date(data.dueDate)
    if (data.documentDate)               updateData.documentDate = new Date(data.documentDate)
    if (data.status)                     updateData.status       = data.status
    if (data.tocSupplierId !== undefined) updateData.tocSupplierId = data.tocSupplierId

    if (data.tocPurchasesDocId !== undefined) {
      const clash = await this.prisma.treasuryPayable.findFirst({
        where: { clientId, tocPurchasesDocId: data.tocPurchasesDocId, deletedAt: null, NOT: { id } },
        select: { id: true },
      })
      if (clash) throw httpError(409, 'Este documento TOConline já está associado a outra conta a pagar')
      updateData.tocPurchasesDocId = data.tocPurchasesDocId

      // Auto-categorizar via entity config quando TOC doc é associado e o payable ainda não tem categoria
      if (!item.categoryId && !data.categoryId) {
        const supplierId = data.tocSupplierId ?? item.tocSupplierId
        if (supplierId) {
          const entityConfig = await this.prisma.treasuryEntityConfig.findUnique({
            where: {
              clientId_entityType_tocEntityId: {
                clientId,
                entityType: 'supplier',
                tocEntityId: String(supplierId),
              },
            },
            select: { defaultCategoryId: true },
          })
          if (entityConfig?.defaultCategoryId) {
            updateData.category = { connect: { id: entityConfig.defaultCategoryId } }
          }
        }
      }
    }

    if (data.categoryId) {
      const category = await this.prisma.treasuryCategory.findFirst({ where: { id: data.categoryId, clientId, deletedAt: null } })
      if (!category) throw httpError(404, 'Category not found')
      if (category.type !== 'EXPENSE') throw httpError(400, `Categoria '${category.name}' é de Receita; não pode ser associada a uma conta a pagar`)
      updateData.category = { connect: { id: data.categoryId } }
      updateData.origin = category.launchToc ? 'TOCONLINE' : 'LOCAL'
    }

    if (data.budgetId !== undefined) {
      if (data.budgetId === null) {
        updateData.budget = { disconnect: true }
        updateData.budgetAutoAssigned = false
      } else {
        await this.budgetsSvc.assertCompatible(clientId, data.budgetId, 'EXPENSE')
        updateData.budget = { connect: { id: data.budgetId } }
        updateData.budgetAutoAssigned = false
      }
    }
    if (data.budgetAutoAssigned !== undefined) {
      updateData.budgetAutoAssigned = data.budgetAutoAssigned
    }

    if (data.totalAmount !== undefined) {
      // Allow overriding amount when associating a TOC doc (tocPurchasesDocId also being set)
      if (item.status !== 'OPEN' && !data.tocPurchasesDocId) throw httpError(409, 'Só é possível alterar o valor de documentos em aberto sem pagamentos')
      updateData.totalAmount = data.totalAmount
      if (item.status === 'OPEN') updateData.pendingAmount = data.totalAmount
    }

    const updated = await this.prisma.treasuryPayable.update({ where: { id }, data: updateData })

    // Cascade para instâncias futuras geradas a partir desta programada.
    // Simétrico ao receivables: replica campos relevantes nos filhos com
    // dueDate >= hoje e status OPEN (sem pagamentos).
    if (item.recurrenceId && !item.parentId) {
      const childUpdate: Prisma.TreasuryPayableUpdateManyMutationInput = {}
      if (data.entityName !== undefined)       childUpdate.entityName = data.entityName
      if (data.description !== undefined)      childUpdate.description = data.description
      if (data.totalAmount !== undefined) {
        childUpdate.totalAmount = data.totalAmount
        childUpdate.pendingAmount = data.totalAmount
      }
      if (data.categoryId !== undefined)       childUpdate.categoryId = data.categoryId
      if (data.budgetCategoryId !== undefined) childUpdate.budgetCategoryId = data.budgetCategoryId
      if (data.budgetId !== undefined)         childUpdate.budgetId = data.budgetId

      if (Object.keys(childUpdate).length > 0) {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        await this.prisma.treasuryPayable.updateMany({
          where: {
            clientId,
            parentId: id,
            deletedAt: null,
            status: 'OPEN',
            dueDate: { gte: today },
          },
          data: childUpdate,
        })
      }
    }

    const changes = diffEntity(
      item as unknown as Record<string, unknown>,
      updated as unknown as Record<string, unknown>,
    )
    if (Object.keys(changes).length > 0) {
      await audit(this.prisma, {
        clientId, userId,
        action: 'payable.update',
        entityType: 'Payable', entityId: id,
        payload: { changes },
      })
    }

    return updated
  }

  private async syncParentStatus(clientId: string, parentId: string) {
    const children = await this.prisma.treasuryPayable.findMany({
      where: { parentId, deletedAt: null, recurrenceId: null },
      select: { status: true, paidAmount: true, pendingAmount: true, promisedPaymentDate: true, dueDate: true },
    })
    if (children.length === 0) return
    const paidAmount = children.reduce((s, c) => s + Number(c.paidAmount ?? 0), 0)
    const pendingAmount = children.reduce((s, c) => s + Number(c.pendingAmount ?? 0), 0)
    const allSettled = children.every((c) => c.status === 'SETTLED')
    const someSettledOrPartial = children.some((c) => c.status === 'SETTLED' || c.status === 'PARTIAL')
    const status: TreasuryDocStatus = allSettled ? 'SETTLED' : someSettledOrPartial ? 'PARTIAL' : 'OPEN'

    // Earliest pending parcela drives the parent's promisedPaymentDate.
    // SETTLED/VOID children are excluded (already paid or cancelled).
    const pendingDates = children
      .filter((c) => c.status !== 'SETTLED' && c.status !== 'VOID')
      .map((c) => c.promisedPaymentDate ?? c.dueDate)
      .filter((d): d is Date => d != null)
    const promisedPaymentDate = pendingDates.length > 0
      ? pendingDates.reduce((min, d) => d < min ? d : min, pendingDates[0])
      : null
    await this.prisma.treasuryPayable.update({ where: { id: parentId }, data: { status, paidAmount, pendingAmount, promisedPaymentDate } })
  }

  async settle(clientId: string, userId: string, id: string) {
    const item = await this.getById(clientId, id)
    if (item.status === 'SETTLED') throw httpError(409, 'Already settled')
    if (item.status === 'VOID') throw httpError(409, 'Cannot settle a voided payable')
    if (item.recurrenceId && item.parentId) {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
      if (item.dueDate > todayStart) throw httpError(409, 'Não é possível liquidar uma recorrência futura antes da sua data de vencimento')
    }

    const splitChildren = (item.children ?? []).filter((c) => !c.recurrenceId && c.status !== 'SETTLED' && c.status !== 'VOID')

    const result = await this.prisma.$transaction(async (tx) => {
      const parent = await tx.treasuryPayable.update({
        where: { id },
        data: { status: 'SETTLED', pendingAmount: 0, paidAmount: item.totalAmount, promisedPaymentDate: null },
      })
      // Cascade: settling a parent settles all its non-recurring open/partial children at once.
      if (splitChildren.length > 0) {
        await tx.$executeRaw`
          UPDATE "treasury_payables"
          SET "status" = 'SETTLED', "pendingAmount" = 0, "paidAmount" = "totalAmount", "updatedAt" = NOW()
          WHERE "parentId" = ${id}
            AND "recurrenceId" IS NULL
            AND "deletedAt" IS NULL
            AND "status" NOT IN ('SETTLED', 'VOID')
        `
      }
      await audit(tx, {
        clientId, userId,
        action: 'payable.settle',
        entityType: 'Payable', entityId: id,
        payload: { from: item.status, to: 'SETTLED', cascadedChildren: splitChildren.length },
      })
      return parent
    })

    if (item.parentId && !item.recurrenceId) await this.syncParentStatus(clientId, item.parentId)
    return result
  }

  async unsettle(clientId: string, userId: string, id: string) {
    const item = await this.getById(clientId, id)
    if (item.status !== 'SETTLED') throw httpError(409, 'Apenas documentos liquidados podem ser revertidos')

    const settledChildren = (item.children ?? []).filter((c) => !c.recurrenceId && c.status === 'SETTLED')

    const result = await this.prisma.$transaction(async (tx) => {
      const parent = await tx.treasuryPayable.update({
        where: { id },
        data: { status: 'OPEN', pendingAmount: item.totalAmount, paidAmount: 0 },
      })
      // Cascade: reverting the parent reverts every SETTLED non-recurring child.
      if (settledChildren.length > 0) {
        await tx.$executeRaw`
          UPDATE "treasury_payables"
          SET "status" = 'OPEN', "pendingAmount" = "totalAmount", "paidAmount" = 0, "updatedAt" = NOW()
          WHERE "parentId" = ${id}
            AND "recurrenceId" IS NULL
            AND "deletedAt" IS NULL
            AND "status" = 'SETTLED'
        `
      }
      await audit(tx, {
        clientId, userId,
        action: 'payable.unsettle',
        entityType: 'Payable', entityId: id,
        payload: { from: 'SETTLED', to: 'OPEN', cascadedChildren: settledChildren.length },
      })
      return parent
    })

    if (item.parentId && !item.recurrenceId) await this.syncParentStatus(clientId, item.parentId)
    return result
  }

  async partialPayment(clientId: string, userId: string, id: string, amount: number) {
    const item = await this.getById(clientId, id)
    if (item.status === 'SETTLED') throw httpError(409, 'Already settled')
    if (item.status === 'VOID') throw httpError(409, 'Cannot pay a voided payable')
    if (amount <= 0) throw httpError(400, 'Amount must be positive')
    const newPaid = Number(item.paidAmount ?? 0) + amount
    const newPending = Math.max(0, Number(item.totalAmount) - newPaid)
    const newStatus = newPending < 0.005 ? 'SETTLED' : 'PARTIAL'
    const result = await this.prisma.treasuryPayable.update({
      where: { id },
      data: { paidAmount: newPaid, pendingAmount: newPending, status: newStatus },
    })
    await audit(this.prisma, {
      clientId, userId,
      action: 'payable.partial_payment',
      entityType: 'Payable', entityId: id,
      payload: { amount, from: item.status, to: newStatus, newPaid, newPending },
    })
    if (item.parentId && !item.recurrenceId) await this.syncParentStatus(clientId, item.parentId)
    return result
  }

  async void(clientId: string, userId: string, id: string) {
    const item = await this.getById(clientId, id)
    if (item.status === 'SETTLED') throw httpError(409, 'Cannot void a settled payable')
    const result = await this.prisma.treasuryPayable.update({ where: { id }, data: { status: 'VOID' } })
    await audit(this.prisma, {
      clientId, userId,
      action: 'payable.void',
      entityType: 'Payable', entityId: id,
      payload: { from: item.status, to: 'VOID' },
    })
    return result
  }

  async delete(clientId: string, userId: string, id: string) {
    const item = await this.getById(clientId, id)
    // Cascade total when the deleted item is the recurrence root: soft-delete every
    // sibling instance (past and future) and deactivate the recurrence so nothing
    // else gets generated. Past instances live on solely through the audit log.
    if (item.recurrenceId && !item.parentId) {
      const now = new Date()
      return this.prisma.$transaction(async (tx) => {
        const affected = await tx.treasuryPayable.updateMany({
          where: { clientId, recurrenceId: item.recurrenceId!, deletedAt: null },
          data: { deletedAt: now },
        })
        await tx.treasuryRecurrence.update({
          where: { id: item.recurrenceId! },
          data: { isActive: false },
        })
        await audit(tx, {
          clientId, userId,
          action: 'payable.delete',
          entityType: 'Payable', entityId: id,
          payload: { recurrenceCascade: true, affectedCount: affected.count, recurrenceId: item.recurrenceId },
        })
        return tx.treasuryPayable.findUnique({ where: { id } })
      })
    }
    const result = await this.prisma.treasuryPayable.update({ where: { id }, data: { deletedAt: new Date() } })
    await audit(this.prisma, {
      clientId, userId,
      action: 'payable.delete',
      entityType: 'Payable', entityId: id,
      payload: { reference: item.reference, totalAmount: Number(item.totalAmount.toString()) },
    })
    return result
  }

  async setPromisedDate(clientId: string, userId: string, id: string, date: string | null) {
    const item = await this.getById(clientId, id)
    const newDate = date ? new Date(date) : null
    const result = await this.prisma.treasuryPayable.update({
      where: { id },
      data: { promisedPaymentDate: newDate },
    })
    await audit(this.prisma, {
      clientId, userId,
      action: 'payable.set_promised_date',
      entityType: 'Payable', entityId: id,
      payload: {
        from: item.promisedPaymentDate?.toISOString() ?? null,
        to: newDate?.toISOString() ?? null,
      },
    })
    return result
  }

  async split(clientId: string, userId: string, id: string, installments: Array<{ promisedPaymentDate: string; amount: number; description?: string }>) {
    const item = await this.getById(clientId, id)
    if (item.status !== 'OPEN') throw httpError(409, 'Só é possível dividir documentos em aberto')
    if (item.parentId) throw httpError(409, 'Não é possível dividir uma parcela')
    const splitChildren = (item.children ?? []).filter((c) => !c.recurrenceId)
    if (splitChildren.length > 0) throw httpError(409, 'Esta fatura já está dividida')
    const total = installments.reduce((s, i) => s + i.amount, 0)
    if (Math.abs(total - Number(item.totalAmount)) > 0.001) throw httpError(400, 'A soma das parcelas não corresponde ao valor original')

    // Fallback when reference is null/empty (e.g., user-created Outras without reference):
    // derive a unique base from the parent's id so child refs never collide across documents.
    const refBase = item.reference?.trim() || `OP-${id.slice(-6)}`

    // Pre-compute the earliest installment payment date — used as the parent's promisedPaymentDate
    // so the parent reflects when the next payment commitment is due.
    const paymentDates = installments.map((i) => new Date(i.promisedPaymentDate))
    const minPaymentDate = paymentDates.reduce((min, d) => d < min ? d : min, paymentDates[0])

    try {
      return await this.prisma.$transaction(async (tx) => {
        const children = []
        for (let i = 0; i < installments.length; i++) {
          const inst = installments[i]
          const child = await tx.treasuryPayable.create({
            data: {
              clientId,
              createdById: userId,
              origin: item.origin,
              categoryId: item.categoryId,
              entityName: item.entityName,
              entityNif: item.entityNif ?? undefined,
              tocSupplierId: item.tocSupplierId ?? undefined,
              tocPurchasesDocId: item.tocPurchasesDocId ?? undefined,
              reference: `${refBase}-${i + 1}`,
              description: inst.description ?? item.description ?? undefined,
              documentDate: item.documentDate,
              dueDate: item.dueDate,
              promisedPaymentDate: new Date(inst.promisedPaymentDate),
              currency: item.currency,
              totalAmount: inst.amount,
              pendingAmount: inst.amount,
              parentId: id,
            },
          })
          children.push(child)
        }
        await tx.treasuryPayable.update({
          where: { id },
          data: { promisedPaymentDate: minPaymentDate },
        })
        await audit(tx, {
          clientId, userId,
          action: 'payable.split',
          entityType: 'Payable', entityId: id,
          payload: {
            installments: installments.map((inst, i) => ({
              reference: `${refBase}-${i + 1}`,
              amount: inst.amount,
              promisedPaymentDate: inst.promisedPaymentDate,
            })),
            childIds: children.map((c) => c.id),
          },
        })
        return children
      })
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
        throw httpError(409, `Já existe um documento com referência derivada de "${refBase}". Edite a referência do documento original antes de o dividir.`)
      }
      throw err
    }
  }

  async unsplit(clientId: string, userId: string, id: string) {
    const item = await this.getById(clientId, id)
    const splitChildren = (item.children ?? []).filter((c) => !c.recurrenceId)
    if (splitChildren.length === 0) throw httpError(409, 'Este documento não tem parcelas para desfazer')
    const nonOpen = splitChildren.filter((c) => c.status !== 'OPEN')
    if (nonOpen.length > 0) throw httpError(409, 'Não é possível desfazer: algumas parcelas já foram pagas ou anuladas')
    await this.prisma.treasuryPayable.deleteMany({ where: { parentId: id } })
    const result = await this.prisma.treasuryPayable.update({
      where: { id },
      data: { status: 'OPEN', paidAmount: 0, pendingAmount: item.totalAmount },
    })
    await audit(this.prisma, {
      clientId, userId,
      action: 'payable.unsplit',
      entityType: 'Payable', entityId: id,
      payload: { removedChildIds: splitChildren.map((c) => c.id) },
    })
    return result
  }

  async deleteByTocSupplierId(clientId: string, tocSupplierId: string) {
    return this.prisma.treasuryPayable.updateMany({
      where: { clientId, tocSupplierId, deletedAt: null },
      data: { deletedAt: new Date() },
    })
  }

  /**
   * Aplica regras de classificação ativas + fallback de histórico de entidade
   * a todas as faturas a pagar sem categoria. Devolve contagem de classificadas
   * e ignoradas. Espelha o comportamento de bank-movements.applyRulesToExisting.
   */
  async applyRulesToExisting(clientId: string): Promise<{ classified: number; skipped: number }> {
    const [rules, unclassified] = await Promise.all([
      this.prisma.treasuryClassificationRule.findMany({
        where: { clientId, isActive: true },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, direction: true, amountMin: true, amountMax: true, matchField: true, matchOp: true, matchValue: true, categoryId: true },
      }),
      this.prisma.treasuryPayable.findMany({
        where: { clientId, deletedAt: null, categoryId: null },
        select: { id: true, totalAmount: true, description: true, reference: true, entityName: true, tocSupplierId: true, budgetCategoryId: true },
      }),
    ])

    if (unclassified.length === 0) return { classified: 0, skipped: 0 }

    let classified = 0
    const ruleHits = new Map<string, number>()

    for (const inv of unclassified) {
      let categoryId: string | undefined
      let budgetCategoryId: string | undefined = inv.budgetCategoryId ?? undefined

      const matched = matchClassificationRule(rules, {
        amount: Number(inv.totalAmount),
        type: 'EXPENSE',
        description: inv.description ?? inv.reference ?? null,
        counterpartName: inv.entityName ?? null,
      })

      if (matched) {
        categoryId = matched.categoryId
        ruleHits.set(matched.id, (ruleHits.get(matched.id) ?? 0) + 1)
      } else if (inv.entityName || inv.tocSupplierId) {
        const last = await this.prisma.treasuryPayable.findFirst({
          where: {
            clientId, deletedAt: null,
            categoryId: { not: null },
            id: { not: inv.id },
            OR: [
              ...(inv.tocSupplierId ? [{ tocSupplierId: inv.tocSupplierId }] : []),
              ...(inv.entityName ? [{ entityName: inv.entityName }] : []),
            ],
          },
          orderBy: { createdAt: 'desc' },
          select: { categoryId: true, budgetCategoryId: true },
        })
        if (last?.categoryId) categoryId = last.categoryId
        if (!budgetCategoryId && last?.budgetCategoryId) budgetCategoryId = last.budgetCategoryId
      }

      if (categoryId) {
        await this.prisma.treasuryPayable.update({
          where: { id: inv.id },
          data: {
            categoryId,
            ...(budgetCategoryId && budgetCategoryId !== inv.budgetCategoryId ? { budgetCategoryId } : {}),
          },
        })
        classified++
      }
    }

    await Promise.all(
      Array.from(ruleHits.entries()).map(([id, count]) =>
        this.prisma.treasuryClassificationRule.update({
          where: { id },
          data: { hits: { increment: count }, lastHitAt: new Date() },
        }),
      ),
    )

    return { classified, skipped: unclassified.length - classified }
  }

  async getKpis(clientId: string) {
    const now = new Date()
    const [totalOpen, overdue, paidMonth] = await Promise.all([
      this.prisma.treasuryPayable.aggregate({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] } },
        _sum: { pendingAmount: true },
        _count: true,
      }),
      this.prisma.treasuryPayable.count({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now } },
      }),
      this.prisma.treasuryPayable.aggregate({
        where: { clientId, deletedAt: null, status: 'SETTLED', updatedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } },
        _sum: { totalAmount: true },
      }),
    ])

    const buckets = await Promise.all([30, 60, 90].map(async (days, i) => {
      const from = i === 0 ? new Date(0) : new Date(Date.now() - days * 86400000)
      const to = new Date(Date.now() - (i === 0 ? 0 : (i === 1 ? 31 : (i === 2 ? 61 : 91))) * 86400000)
      return this.prisma.treasuryPayable.count({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now, gte: from, lte: to } },
      })
    }))

    return {
      totalPending: Number(totalOpen._sum.pendingAmount ?? 0),
      countOpen: totalOpen._count,
      countOverdue: overdue,
      paidThisMonth: Number(paidMonth._sum.totalAmount ?? 0),
      aging: { '0-30': buckets[0], '31-60': buckets[1], '61-90': buckets[2] },
    }
  }
}
