import type { PrismaClient, TreasuryDocStatus, TreasuryDocOrigin, TreasuryRecurrenceFrequency, Prisma, TocSalesDocument } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'
import { computeNextDate } from '../recurrences/utils.js'
import { TreasuryRecurrencesService } from '../recurrences/recurrences.service.js'
import { TreasuryBudgetsService } from '../budgets/budgets.service.js'
import { TreasuryBudgetRulesService } from '../budget-rules/budget-rules.service.js'
import { audit, diffEntity } from '../../../lib/audit.js'
import { matchClassificationRule } from '../../../lib/classification.js'

interface ReceivableListItem {
  id: string
  reference: string | null
  entityName: string | null
  documentDate: Date | null
  dueDate: Date
  totalAmount: number | Prisma.Decimal
  pendingAmount: number | Prisma.Decimal
  receivedAmount: number | Prisma.Decimal
  status: TreasuryDocStatus
  origin: TreasuryDocOrigin
  tocSalesDocId: string | null
  tocCustomerId: string | null
  recurrenceId: string | null
  parentId: string | null
  category: { id: string; name: string; color: string | null; launchToc: boolean } | null
  children: unknown[]
  _src: 'local' | 'toc'
  _tocRaw: Prisma.JsonValue | null
  [key: string]: unknown
}

function mapTocSalesToReceivable(d: TocSalesDocument, now: Date): ReceivableListItem | null {
  const tocStatus = d.status ?? 0
  // 0=rascunho, 4=anulado — excluímos. 1=emitido, 2=parcial, 3=liquidado,
  // 5=vencido (emitido com due_date < hoje).
  if (tocStatus === 0 || tocStatus === 4) return null
  let mappedStatus: TreasuryDocStatus
  if (tocStatus === 3) mappedStatus = 'SETTLED'
  else if (tocStatus === 2) mappedStatus = 'PARTIAL'
  else mappedStatus = 'OPEN'
  const gross = Number(d.grossTotal ?? 0)
  const pending = Number(d.pendingTotal ?? gross)
  const received = Math.max(0, gross - pending)
  const dueDate = d.dueDate ? new Date(d.dueDate) : now
  const documentDate = d.date ? new Date(d.date) : null
  const raw = (d.raw ?? {}) as Record<string, unknown>
  return {
    id: `toc-${d.tocId}`,
    reference: (raw.document_no as string) ?? null,
    entityName: (raw.customer_business_name as string) ?? null,
    documentDate,
    dueDate,
    totalAmount: gross,
    pendingAmount: pending,
    receivedAmount: received,
    status: mappedStatus,
    origin: 'TOCONLINE',
    tocSalesDocId: String(d.tocId),
    tocCustomerId: d.customerId != null ? String(d.customerId) : null,
    recurrenceId: null,
    parentId: null,
    category: null,
    children: [],
    _src: 'toc',
    _tocRaw: d.raw,
  }
}

export class TreasuryReceivablesService {
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
    paymentDateFrom?: string
    paymentDateTo?: string
    isRecurrent?: boolean
    overdue?: boolean
    tocCustomerId?: string
    sortBy?: 'dueDate' | 'totalAmount' | 'pendingAmount' | 'entityName' | 'reference' | 'promisedPaymentDate' | 'status'
    sortDir?: 'asc' | 'desc'
    page?: number
    limit?: number
  }) {
    // Materialise pending recurrence instances within the 180-day horizon so the list
    // surfaces the "Futuras" tab content without waiting on a dashboard view to trigger
    // the engine. Idempotent: returns immediately when there's nothing to generate.
    await this.recurrencesSvc.processForClient(clientId, 180)

    const { page = 1, limit = 50, status, origin, categoryId, entityName, dueDateFrom, dueDateTo, docDateFrom, docDateTo, paymentDateFrom, paymentDateTo, isRecurrent, overdue, tocCustomerId, sortBy = 'dueDate', sortDir = 'asc' } = filters
    const statusList: TreasuryDocStatus[] | undefined = overdue
      ? ['OPEN', 'PARTIAL']
      : Array.isArray(status) ? status : status ? [status] : undefined
    const effectiveStatusFilter = statusList ? { status: { in: statusList } } : {}

    const where: Prisma.TreasuryReceivableWhereInput = {
      clientId,
      deletedAt: null,
      NOT: { parentId: { not: null }, recurrenceId: null },
      ...effectiveStatusFilter,
      ...(origin ? { origin } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(tocCustomerId ? { tocCustomerId } : {}),
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
      ...(paymentDateFrom || paymentDateTo ? {
        promisedPaymentDate: {
          ...(paymentDateFrom ? { gte: new Date(paymentDateFrom) } : {}),
          ...(paymentDateTo ? { lt: new Date(new Date(paymentDateTo).getTime() + 86400000) } : {}),
        },
      } : {}),
      ...(isRecurrent !== undefined ? { recurrenceId: isRecurrent ? { not: null } : null } : {}),
    }

    const localItems = await this.prisma.treasuryReceivable.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, color: true, launchToc: true } },
        children: { where: { deletedAt: null }, orderBy: { dueDate: 'asc' } },
      },
    })

    // Docs TOC ainda não materializados localmente — vêm das tabelas espelho
    // sincronizadas pelo TocScheduler. Excluímos os que já têm receivable
    // correspondente (via tocSalesDocId). Filtros locais (categoryId,
    // isRecurrent) excluem todos os TOC docs porque estes campos não existem
    // na fonte; nesse caso a lista TOC fica vazia.
    const importedTocIds = new Set(localItems.map((r) => r.tocSalesDocId).filter((s): s is string => !!s))
    const tocCandidates = (categoryId || isRecurrent !== undefined || origin === 'LOCAL')
      ? []
      : await this.prisma.tocSalesDocument.findMany({
          where: {
            clientId,
            ...(tocCustomerId ? { customerId: Number(tocCustomerId) } : {}),
            ...(dueDateFrom || dueDateTo ? {
              dueDate: {
                ...(dueDateFrom ? { gte: dueDateFrom } : {}),
                ...(dueDateTo ? { lte: dueDateTo } : {}),
              },
            } : {}),
          },
        })

    const SALES_INVOICE_TYPES = new Set(['ft', 'fs', 'fr'])
    const now = new Date()
    const tocMapped = tocCandidates
      .filter((d) => !importedTocIds.has(String(d.tocId)))
      .filter((d) => {
        const docType = String((d.raw as { document_type?: unknown } | null)?.document_type ?? '').toLowerCase()
        return SALES_INVOICE_TYPES.has(docType)
      })
      .map((d) => mapTocSalesToReceivable(d, now))
      .filter((r) => r !== null)
      .filter((r) => {
        if (!statusList) return true
        return statusList.includes(r!.status)
      })
      .filter((r) => {
        if (!entityName) return true
        const q = entityName.toLowerCase()
        return (r!.entityName ?? '').toLowerCase().includes(q) || (r!.reference ?? '').toLowerCase().includes(q)
      })
      .filter((r) => {
        if (!overdue) return true
        return r!.dueDate < now
      })
      .filter((r) => {
        if (!docDateFrom && !docDateTo) return true
        if (!r!.documentDate) return false
        if (docDateFrom && r!.documentDate < new Date(docDateFrom)) return false
        if (docDateTo && r!.documentDate >= new Date(new Date(docDateTo).getTime() + 86400000)) return false
        return true
      }) as ReceivableListItem[]

    const allItems: ReceivableListItem[] = [
      ...localItems.map((r) => ({ ...r, _src: 'local' as const, _tocRaw: null })),
      ...tocMapped,
    ]

    const sortKey = sortBy as string
    allItems.sort((a, b) => {
      const va = a[sortKey] as Date | number | string | null | undefined
      const vb = b[sortKey] as Date | number | string | null | undefined
      if (va == null && vb == null) return 0
      if (va == null) return sortDir === 'asc' ? 1 : -1
      if (vb == null) return sortDir === 'asc' ? -1 : 1
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })

    const total = allItems.length
    const items = allItems.slice((page - 1) * limit, page * limit)

    return { total, page, limit, items }
  }

  async getById(clientId: string, id: string) {
    const item = await this.prisma.treasuryReceivable.findFirst({
      where: { id, clientId, deletedAt: null },
      include: {
        category: true,
        recurrence: true,
        reconciliationLinks: { include: { reconciliation: true } },
        children: { where: { deletedAt: null }, orderBy: { dueDate: 'asc' } },
      },
    })
    if (!item) throw httpError(404, 'Receivable not found')
    return item
  }

  async create(clientId: string, userId: string, data: {
    categoryId?: string
    entityName?: string
    entityNif?: string
    tocCustomerId?: string
    tocSalesDocId?: string
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
        type: 'REVENUE',
        description: data.description ?? data.reference ?? null,
        counterpartName: data.entityName ?? null,
      })
      if (matched) {
        data.categoryId = matched.categoryId
      } else if (data.entityName || data.tocCustomerId) {
        // Entity config tem prioridade sobre lookup histórico
        if (data.tocCustomerId) {
          const entityConfig = await this.prisma.treasuryEntityConfig.findUnique({
            where: {
              clientId_entityType_tocEntityId: {
                clientId,
                entityType: 'customer',
                tocEntityId: String(data.tocCustomerId),
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
          const last = await this.prisma.treasuryReceivable.findFirst({
            where: {
              clientId, deletedAt: null,
              categoryId: { not: null },
              OR: [
                ...(data.tocCustomerId ? [{ tocCustomerId: data.tocCustomerId }] : []),
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
      await this.budgetsSvc.assertCompatible(clientId, data.budgetId, 'REVENUE')
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

    if (data.tocSalesDocId) {
      const existing = await this.prisma.treasuryReceivable.findFirst({
        where: { clientId, tocSalesDocId: data.tocSalesDocId, deletedAt: null },
      })
      if (existing) throw httpError(409, `Documento ${data.reference ?? data.tocSalesDocId} já importado`)
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
          nextRunAt: firstDueDate,
        },
      })
      recurrenceId = rec.id
    }

    const created = await this.prisma.treasuryReceivable.create({
      data: {
        clientId,
        createdById: userId,
        origin: category?.launchToc ? 'TOCONLINE' : 'LOCAL',
        totalAmount: data.totalAmount,
        pendingAmount: data.recurrence ? 0 : data.totalAmount,
        documentDate: data.documentDate ? new Date(data.documentDate) : null,
        dueDate: new Date(data.dueDate),
        currency: data.currency ?? 'EUR',
        categoryId: data.categoryId,
        entityName: data.entityName ?? null,
        entityNif: data.entityNif,
        tocCustomerId: data.tocCustomerId,
        tocSalesDocId: data.tocSalesDocId,
        reference: data.reference ?? null,
        description: data.description,
        recurrenceId,
        ...(resolvedBudgetId ? { budgetId: resolvedBudgetId, budgetAutoAssigned } : {}),
      },
    })

    await audit(this.prisma, {
      clientId, userId,
      action: 'receivable.create',
      entityType: 'Receivable', entityId: created.id,
      payload: {
        source: data.tocSalesDocId ? 'TOCONLINE' : 'MANUAL',
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
    description: string
    reference: string
    documentDate: string
    dueDate: string
    promisedPaymentDate: string | null
    categoryId: string
    budgetId: string | null
    budgetAutoAssigned: boolean
    totalAmount: number
    status: TreasuryDocStatus
    tocCustomerId: string | null
  }>) {
    const item = await this.getById(clientId, id)

    const updateData: Prisma.TreasuryReceivableUpdateInput = {}
    if (data.entityName   !== undefined) updateData.entityName   = data.entityName
    if (data.description  !== undefined) updateData.description  = data.description
    if (data.reference    !== undefined) updateData.reference    = data.reference
    if (data.dueDate)                    updateData.dueDate      = new Date(data.dueDate)
    if (data.documentDate)               updateData.documentDate = new Date(data.documentDate)
    if (data.status)                     updateData.status       = data.status
    if (data.tocCustomerId !== undefined) updateData.tocCustomerId = data.tocCustomerId
    if (data.promisedPaymentDate !== undefined) {
      updateData.promisedPaymentDate = data.promisedPaymentDate ? new Date(data.promisedPaymentDate) : null
    }

    if (data.categoryId) {
      const category = await this.prisma.treasuryCategory.findFirst({ where: { id: data.categoryId, clientId, deletedAt: null } })
      if (!category) throw httpError(404, 'Category not found')
      if (category.type !== 'REVENUE') throw httpError(400, `Categoria '${category.name}' é de Despesa; não pode ser associada a uma conta a receber`)
      updateData.category = { connect: { id: data.categoryId } }
      updateData.origin = category.launchToc ? 'TOCONLINE' : 'LOCAL'
    }

    if (data.budgetId !== undefined) {
      if (data.budgetId === null) {
        updateData.budget = { disconnect: true }
        updateData.budgetAutoAssigned = false
      } else {
        await this.budgetsSvc.assertCompatible(clientId, data.budgetId, 'REVENUE')
        updateData.budget = { connect: { id: data.budgetId } }
        updateData.budgetAutoAssigned = false
      }
    }
    // Confirmar/mover/remover associação automática
    if (data.budgetAutoAssigned !== undefined) {
      updateData.budgetAutoAssigned = data.budgetAutoAssigned
    }

    if (data.totalAmount !== undefined) {
      if (item.status !== 'OPEN') throw httpError(409, 'Só é possível alterar o valor de documentos em aberto sem pagamentos')
      updateData.totalAmount = data.totalAmount
      updateData.pendingAmount = data.totalAmount
    }

    const updated = await this.prisma.treasuryReceivable.update({ where: { id }, data: updateData })

    // Cascade para instâncias futuras geradas a partir desta programada.
    // Considera "programada" qualquer receivable que seja raiz de recorrência
    // (`recurrenceId != null && parentId == null`). Replica campos relevantes
    // nos filhos com dueDate >= hoje e status OPEN (sem pagamentos), para que
    // o dashboard e as listagens reflitam imediatamente as alterações.
    if (item.recurrenceId && !item.parentId) {
      const childUpdate: Prisma.TreasuryReceivableUpdateManyMutationInput = {}
      if (data.entityName !== undefined)        childUpdate.entityName = data.entityName
      if (data.description !== undefined)       childUpdate.description = data.description
      if (data.totalAmount !== undefined) {
        childUpdate.totalAmount = data.totalAmount
        childUpdate.pendingAmount = data.totalAmount
      }
      if (data.tocCustomerId !== undefined)     childUpdate.tocCustomerId = data.tocCustomerId
      if (data.categoryId !== undefined)        childUpdate.categoryId = data.categoryId

      // Campos com FK (budget*) actualizam-se via updateMany com set diretamente
      if (data.budgetCategoryId !== undefined)  childUpdate.budgetCategoryId = data.budgetCategoryId
      if (data.budgetId !== undefined)          childUpdate.budgetId = data.budgetId

      if (Object.keys(childUpdate).length > 0) {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        await this.prisma.treasuryReceivable.updateMany({
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
        action: 'receivable.update',
        entityType: 'Receivable', entityId: id,
        payload: { changes },
      })
    }

    return updated
  }

  private async syncParentStatus(clientId: string, parentId: string) {
    const children = await this.prisma.treasuryReceivable.findMany({
      where: { parentId, deletedAt: null, recurrenceId: null },
      select: { status: true, receivedAmount: true, pendingAmount: true, promisedPaymentDate: true, dueDate: true },
    })
    if (children.length === 0) return
    const receivedAmount = children.reduce((s, c) => s + Number(c.receivedAmount ?? 0), 0)
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

    await this.prisma.treasuryReceivable.update({
      where: { id: parentId },
      data: { status, receivedAmount, pendingAmount, promisedPaymentDate },
    })
  }

  async settle(clientId: string, userId: string, id: string) {
    const item = await this.getById(clientId, id)
    if (item.status === 'SETTLED') throw httpError(409, 'Already settled')
    if (item.status === 'VOID') throw httpError(409, 'Cannot settle a voided receivable')
    if (item.recurrenceId && item.parentId) {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
      if (item.dueDate > todayStart) throw httpError(409, 'Não é possível liquidar uma recorrência futura antes da sua data de vencimento')
    }

    const splitChildren = (item.children ?? []).filter((c) => !c.recurrenceId && c.status !== 'SETTLED' && c.status !== 'VOID')

    const result = await this.prisma.$transaction(async (tx) => {
      const parent = await tx.treasuryReceivable.update({
        where: { id },
        data: { status: 'SETTLED', pendingAmount: 0, receivedAmount: item.totalAmount, promisedPaymentDate: null },
      })
      // Cascade: settling a parent settles all its non-recurring open/partial children at once.
      if (splitChildren.length > 0) {
        await tx.$executeRaw`
          UPDATE "treasury_receivables"
          SET "status" = 'SETTLED', "pendingAmount" = 0, "receivedAmount" = "totalAmount", "updatedAt" = NOW()
          WHERE "parentId" = ${id}
            AND "recurrenceId" IS NULL
            AND "deletedAt" IS NULL
            AND "status" NOT IN ('SETTLED', 'VOID')
        `
      }
      await audit(tx, {
        clientId, userId,
        action: 'receivable.settle',
        entityType: 'Receivable', entityId: id,
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
      const parent = await tx.treasuryReceivable.update({
        where: { id },
        data: { status: 'OPEN', pendingAmount: item.totalAmount, receivedAmount: 0 },
      })
      // Cascade: reverting the parent reverts every SETTLED non-recurring child.
      if (settledChildren.length > 0) {
        await tx.$executeRaw`
          UPDATE "treasury_receivables"
          SET "status" = 'OPEN', "pendingAmount" = "totalAmount", "receivedAmount" = 0, "updatedAt" = NOW()
          WHERE "parentId" = ${id}
            AND "recurrenceId" IS NULL
            AND "deletedAt" IS NULL
            AND "status" = 'SETTLED'
        `
      }
      await audit(tx, {
        clientId, userId,
        action: 'receivable.unsettle',
        entityType: 'Receivable', entityId: id,
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
    if (item.status === 'VOID') throw httpError(409, 'Cannot pay a voided receivable')
    if (amount <= 0) throw httpError(400, 'Amount must be positive')
    const newReceived = Number(item.receivedAmount ?? 0) + amount
    const newPending = Math.max(0, Number(item.totalAmount) - newReceived)
    const newStatus = newPending < 0.005 ? 'SETTLED' : 'PARTIAL'
    const result = await this.prisma.treasuryReceivable.update({
      where: { id },
      data: { receivedAmount: newReceived, pendingAmount: newPending, status: newStatus },
    })
    await audit(this.prisma, {
      clientId, userId,
      action: 'receivable.partial_payment',
      entityType: 'Receivable', entityId: id,
      payload: { amount, from: item.status, to: newStatus, newReceived, newPending },
    })
    if (item.parentId && !item.recurrenceId) await this.syncParentStatus(clientId, item.parentId)
    return result
  }

  async void(clientId: string, userId: string, id: string) {
    const item = await this.getById(clientId, id)
    if (item.status === 'SETTLED') throw httpError(409, 'Cannot void a settled receivable')
    const result = await this.prisma.treasuryReceivable.update({ where: { id }, data: { status: 'VOID' } })
    await audit(this.prisma, {
      clientId, userId,
      action: 'receivable.void',
      entityType: 'Receivable', entityId: id,
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
        const affected = await tx.treasuryReceivable.updateMany({
          where: { clientId, recurrenceId: item.recurrenceId!, deletedAt: null },
          data: { deletedAt: now },
        })
        await tx.treasuryRecurrence.update({
          where: { id: item.recurrenceId! },
          data: { isActive: false },
        })
        await audit(tx, {
          clientId, userId,
          action: 'receivable.delete',
          entityType: 'Receivable', entityId: id,
          payload: { recurrenceCascade: true, affectedCount: affected.count, recurrenceId: item.recurrenceId },
        })
        return tx.treasuryReceivable.findUnique({ where: { id } })
      })
    }
    const result = await this.prisma.treasuryReceivable.update({ where: { id }, data: { deletedAt: new Date() } })
    await audit(this.prisma, {
      clientId, userId,
      action: 'receivable.delete',
      entityType: 'Receivable', entityId: id,
      payload: { reference: item.reference, totalAmount: Number(item.totalAmount.toString()) },
    })
    return result
  }

  async setPromisedDate(clientId: string, userId: string, id: string, date: string | null) {
    const item = await this.getById(clientId, id)
    const newDate = date ? new Date(date) : null
    const result = await this.prisma.treasuryReceivable.update({
      where: { id },
      data: { promisedPaymentDate: newDate },
    })
    await audit(this.prisma, {
      clientId, userId,
      action: 'receivable.set_promised_date',
      entityType: 'Receivable', entityId: id,
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
          const child = await tx.treasuryReceivable.create({
            data: {
              clientId,
              createdById: userId,
              origin: item.origin,
              categoryId: item.categoryId,
              entityName: item.entityName,
              entityNif: item.entityNif ?? undefined,
              tocCustomerId: item.tocCustomerId ?? undefined,
              tocSalesDocId: item.tocSalesDocId ?? undefined,
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
        await tx.treasuryReceivable.update({
          where: { id },
          data: { promisedPaymentDate: minPaymentDate },
        })
        await audit(tx, {
          clientId, userId,
          action: 'receivable.split',
          entityType: 'Receivable', entityId: id,
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
    await this.prisma.treasuryReceivable.deleteMany({ where: { parentId: id } })
    const result = await this.prisma.treasuryReceivable.update({
      where: { id },
      data: { status: 'OPEN', receivedAmount: 0, pendingAmount: item.totalAmount },
    })
    await audit(this.prisma, {
      clientId, userId,
      action: 'receivable.unsplit',
      entityType: 'Receivable', entityId: id,
      payload: { removedChildIds: splitChildren.map((c) => c.id) },
    })
    return result
  }

  async deleteByTocCustomerId(clientId: string, tocCustomerId: string) {
    return this.prisma.treasuryReceivable.updateMany({
      where: { clientId, tocCustomerId, deletedAt: null },
      data: { deletedAt: new Date() },
    })
  }

  /**
   * Aplica regras de classificação ativas + fallback de histórico de entidade
   * a todas as faturas a receber sem categoria. Devolve contagem de classificadas
   * e ignoradas. Espelha o comportamento de payables.applyRulesToExisting.
   */
  async applyRulesToExisting(clientId: string): Promise<{ classified: number; skipped: number }> {
    const [rules, unclassified] = await Promise.all([
      this.prisma.treasuryClassificationRule.findMany({
        where: { clientId, isActive: true },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, direction: true, amountMin: true, amountMax: true, matchField: true, matchOp: true, matchValue: true, categoryId: true },
      }),
      this.prisma.treasuryReceivable.findMany({
        where: { clientId, deletedAt: null, categoryId: null },
        select: { id: true, totalAmount: true, description: true, reference: true, entityName: true, tocCustomerId: true, budgetCategoryId: true },
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
        type: 'REVENUE',
        description: inv.description ?? inv.reference ?? null,
        counterpartName: inv.entityName ?? null,
      })

      if (matched) {
        categoryId = matched.categoryId
        ruleHits.set(matched.id, (ruleHits.get(matched.id) ?? 0) + 1)
      } else if (inv.entityName || inv.tocCustomerId) {
        const last = await this.prisma.treasuryReceivable.findFirst({
          where: {
            clientId, deletedAt: null,
            categoryId: { not: null },
            id: { not: inv.id },
            OR: [
              ...(inv.tocCustomerId ? [{ tocCustomerId: inv.tocCustomerId }] : []),
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
        await this.prisma.treasuryReceivable.update({
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
    // "Abertas": emitted but not settled. Excludes recurrence templates (parentless
    // with recurrenceId) and future recurrence instances (dueDate > now).
    const abertasClause: Prisma.TreasuryReceivableWhereInput = {
      OR: [
        { recurrenceId: null },
        { AND: [{ parentId: { not: null } }, { dueDate: { lte: now } }] },
      ],
    }
    const [totalOpen, overdue, settledMonth] = await Promise.all([
      this.prisma.treasuryReceivable.aggregate({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, ...abertasClause },
        _sum: { pendingAmount: true },
        _count: true,
      }),
      this.prisma.treasuryReceivable.count({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now }, ...abertasClause },
      }),
      this.prisma.treasuryReceivable.aggregate({
        where: {
          clientId, deletedAt: null, status: 'SETTLED',
          updatedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) },
        },
        _sum: { totalAmount: true },
      }),
    ])

    // Aging buckets
    const buckets = await Promise.all([30, 60, 90].map(async (days, i) => {
      const from = i === 0 ? new Date(0) : new Date(Date.now() - days * 86400000)
      const to = new Date(Date.now() - (i === 0 ? 0 : (i === 1 ? 31 : (i === 2 ? 61 : 91))) * 86400000)
      return this.prisma.treasuryReceivable.count({
        where: { clientId, deletedAt: null, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now, gte: from, lte: to }, ...abertasClause },
      })
    }))

    // KPIs do TOC: docs sincronizados ainda não importados como receivable.
    // Status 1/2/5 (emitido, parcial, vencido) e tipos FT/FS/FR — mesmo critério
    // do auto-import. countOverdue extra é detectado via status==5 OU dueDate<hoje.
    const localTocIds = await this.prisma.treasuryReceivable.findMany({
      where: { clientId, deletedAt: null, tocSalesDocId: { not: null } },
      select: { tocSalesDocId: true },
    })
    const importedTocIds = new Set(localTocIds.map((r) => r.tocSalesDocId).filter((s): s is string => !!s))
    const todayStr = now.toISOString().slice(0, 10)
    const tocDocs = await this.prisma.tocSalesDocument.findMany({
      where: { clientId, status: { in: [1, 2, 5] } },
      select: { tocId: true, dueDate: true, status: true, pendingTotal: true, grossTotal: true, raw: true },
    })
    const SALES_INVOICE_TYPES = new Set(['ft', 'fs', 'fr'])
    let tocTotalPending = 0
    let tocOpenCount = 0
    let tocOverdue = 0
    for (const d of tocDocs) {
      if (importedTocIds.has(String(d.tocId))) continue
      const docType = String((d.raw as { document_type?: unknown } | null)?.document_type ?? '').toLowerCase()
      if (!SALES_INVOICE_TYPES.has(docType)) continue
      const pending = Number(d.pendingTotal ?? d.grossTotal ?? 0)
      if (pending <= 0) continue
      tocTotalPending += pending
      tocOpenCount += 1
      const isOverdue = d.status === 5 || (d.dueDate != null && d.dueDate < todayStr)
      if (isOverdue) tocOverdue += 1
    }

    return {
      totalPending: Number(totalOpen._sum?.pendingAmount ?? 0) + tocTotalPending,
      countOpen: totalOpen._count + tocOpenCount,
      countOverdue: overdue + tocOverdue,
      settledThisMonth: Number(settledMonth._sum?.totalAmount ?? 0),
      aging: { '0-30': buckets[0], '31-60': buckets[1], '61-90': buckets[2] },
    }
  }
}
