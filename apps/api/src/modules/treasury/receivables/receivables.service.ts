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
  dueDate: Date | null
  totalAmount: number | Prisma.Decimal | null
  pendingAmount: number | Prisma.Decimal | null
  receivedAmount: number | Prisma.Decimal | null
  status: TreasuryDocStatus
  origin: TreasuryDocOrigin
  tocSalesDocId: string | null
  tocCustomerId: string | null
  recurrenceId: string | null
  parentId: string | null
  promisedPaymentDate: Date | null
  category: { id: string; name: string; color: string | null; launchToc: boolean } | null
  children: unknown[]
  _src: 'local' | 'toc'
  _tocRaw: Prisma.JsonValue | null
  /** Status apresentado pelo TOC (quando o registo é/tem ligação TOC). null
   *  para receivables puramente locais. Permite ao frontend mostrar "Liquidado
   *  localmente" quando _statusLocal difere de _statusToc. */
  _statusToc: TreasuryDocStatus | null
  _statusDiffersFromToc: boolean
  [key: string]: unknown
}

/** Mapeia status TOC (1/2/3/5) para o enum local. Devolve null para status que
 *  não fazem sentido como receivable (0=rascunho, 4=anulado). */
function mapTocStatus(tocStatus: number | null | undefined): TreasuryDocStatus | null {
  if (tocStatus == null || tocStatus === 0 || tocStatus === 4) return null
  if (tocStatus === 3) return 'SETTLED'
  if (tocStatus === 2) return 'PARTIAL'
  return 'OPEN' // 1 ou 5
}

/** Devolve apenas dados do TOC, para docs TOC sem registo `treasuryReceivable` ligado.
 *  Usa ID prefixado `toc-{tocId}` para que ações on-demand consigam criar
 *  o registo de ligação no momento. */
function mapTocSalesToReceivable(d: TocSalesDocument): ReceivableListItem | null {
  const mappedStatus = mapTocStatus(d.status)
  if (mappedStatus == null) return null
  const gross = Number(d.grossTotal ?? 0)
  const pending = Number(d.pendingTotal ?? gross)
  const received = Math.max(0, gross - pending)
  const raw = (d.raw ?? {}) as Record<string, unknown>
  return {
    id: `toc-${d.tocId}`,
    reference: (raw.document_no as string) ?? null,
    entityName: (raw.customer_business_name as string) ?? null,
    documentDate: d.date ? new Date(d.date) : null,
    dueDate: d.dueDate ? new Date(d.dueDate) : null,
    totalAmount: gross,
    pendingAmount: pending,
    receivedAmount: received,
    status: mappedStatus,
    origin: 'TOCONLINE',
    tocSalesDocId: String(d.tocId),
    tocCustomerId: d.customerId != null ? String(d.customerId) : null,
    recurrenceId: null,
    parentId: null,
    promisedPaymentDate: null,
    category: null,
    children: [],
    _src: 'toc',
    _tocRaw: d.raw,
    _statusToc: mappedStatus,
    _statusDiffersFromToc: false,
  }
}

/** Combina status local + TOC. Regra: se o utilizador marcou explicitamente
 *  como SETTLED/PARTIAL/VOID o estado local prevalece; OPEN no local segue o
 *  TOC. Devolve também os valores derivados (received/pending) corretos. */
function resolveStatusOverlay(
  localStatus: TreasuryDocStatus,
  localReceived: number | Prisma.Decimal | null | undefined,
  tocStatus: TreasuryDocStatus,
  tocGross: number,
  tocPending: number,
): { status: TreasuryDocStatus; received: number; pending: number; statusDiffers: boolean } {
  // Anulação local prevalece sempre.
  if (localStatus === 'VOID') {
    return { status: 'VOID', received: 0, pending: 0, statusDiffers: true }
  }
  // Recibo emitido no TOConline (status 3 → SETTLED) liquida automaticamente,
  // mesmo que localmente esteja só "Pago" ou em aberto.
  if (tocStatus === 'SETTLED') {
    return { status: 'SETTLED', received: tocGross, pending: 0, statusDiffers: false }
  }
  // Liquidada manualmente na plataforma antes de o TOC reportar o recibo.
  if (localStatus === 'SETTLED') {
    return { status: 'SETTLED', received: tocGross, pending: 0, statusDiffers: true }
  }
  // "Pago": recebimento registado na plataforma, ainda sem recibo no TOC.
  if (localStatus === 'PAID') {
    return { status: 'PAID', received: tocGross, pending: 0, statusDiffers: true }
  }
  // PARTIAL local → received vem do local (escrito por partialPayment)
  if (localStatus === 'PARTIAL') {
    const received = Number(localReceived ?? 0)
    return { status: 'PARTIAL', received, pending: Math.max(0, tocGross - received), statusDiffers: tocStatus !== 'PARTIAL' }
  }
  // OPEN local = padrão → segue o TOC
  return {
    status: tocStatus,
    received: Math.max(0, tocGross - tocPending),
    pending: tocPending,
    statusDiffers: false,
  }
}

type LocalReceivableRow = Prisma.TreasuryReceivableGetPayload<{
  include: {
    category: { select: { id: true; name: true; color: true; launchToc: true } }
    children: true
  }
}>

/** Overlay TOC: para um `treasuryReceivable` com `tocSalesDocId`, sobrepõe os
 *  campos da fatura (dueDate, totalAmount, pendingAmount, status…) com os
 *  valores actuais do `tocSalesDocument`. Anotações locais (categoryId,
 *  budgetId, promisedPaymentDate, splits, recurrenceId) ficam do local. */
function overlayLocalWithToc(local: LocalReceivableRow, tocDoc?: TocSalesDocument): ReceivableListItem | null {
  if (!tocDoc) {
    // Sem espelho TOC: registo manual ou ligação cujo doc TOC foi removido do
    // sync. Devolve os campos do local tal como estão.
    return {
      id: local.id,
      reference: local.reference,
      entityName: local.entityName,
      documentDate: local.documentDate,
      dueDate: local.dueDate,
      totalAmount: local.totalAmount,
      pendingAmount: local.pendingAmount,
      receivedAmount: local.receivedAmount,
      status: local.status,
      origin: local.origin,
      tocSalesDocId: local.tocSalesDocId,
      tocCustomerId: local.tocCustomerId,
      recurrenceId: local.recurrenceId,
      parentId: local.parentId,
      promisedPaymentDate: local.promisedPaymentDate,
      category: local.category,
      children: local.children,
      _src: local.tocSalesDocId ? 'toc' : 'local',
      _tocRaw: null,
      _statusToc: null,
      _statusDiffersFromToc: false,
    }
  }
  const tocMapped = mapTocStatus(tocDoc.status)
  if (tocMapped == null) return null
  const gross = Number(tocDoc.grossTotal ?? 0)
  const tocPending = Number(tocDoc.pendingTotal ?? gross)
  const merged = resolveStatusOverlay(local.status, local.receivedAmount, tocMapped, gross, tocPending)
  const raw = (tocDoc.raw ?? {}) as Record<string, unknown>
  return {
    id: local.id,
    reference: (raw.document_no as string) ?? local.reference,
    entityName: (raw.customer_business_name as string) ?? local.entityName,
    documentDate: tocDoc.date ? new Date(tocDoc.date) : local.documentDate,
    dueDate: tocDoc.dueDate ? new Date(tocDoc.dueDate) : local.dueDate,
    totalAmount: gross,
    pendingAmount: merged.pending,
    receivedAmount: merged.received,
    status: merged.status,
    origin: 'TOCONLINE',
    tocSalesDocId: local.tocSalesDocId,
    tocCustomerId: local.tocCustomerId ?? (tocDoc.customerId != null ? String(tocDoc.customerId) : null),
    recurrenceId: local.recurrenceId,
    parentId: local.parentId,
    promisedPaymentDate: local.promisedPaymentDate,
    category: local.category,
    children: local.children,
    _src: 'toc',
    _tocRaw: tocDoc.raw,
    _statusToc: tocMapped,
    _statusDiffersFromToc: merged.statusDiffers,
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
    // Separa os documentos por separador da UI: 'clientes' = ligados ao TOConline
    // (tocSalesDocId != null); 'outras' = operações locais (tocSalesDocId == null).
    // Permite que cada separador ordene/pagine o seu próprio conjunto no servidor.
    bucket?: 'clientes' | 'outras'
    sortBy?: 'dueDate' | 'totalAmount' | 'pendingAmount' | 'entityName' | 'reference' | 'promisedPaymentDate' | 'status'
    sortDir?: 'asc' | 'desc'
    page?: number
    limit?: number
  }) {
    // Materialise pending recurrence instances within the 180-day horizon so the list
    // surfaces the "Futuras" tab content without waiting on a dashboard view to trigger
    // the engine. Idempotent: returns immediately when there's nothing to generate.
    await this.recurrencesSvc.processForClient(clientId, 180)

    const { page = 1, limit = 50, status, origin, categoryId, entityName, dueDateFrom, dueDateTo, docDateFrom, docDateTo, paymentDateFrom, paymentDateTo, isRecurrent, overdue, tocCustomerId, bucket, sortBy = 'dueDate', sortDir = 'asc' } = filters
    const statusList: TreasuryDocStatus[] | undefined = overdue
      ? ['OPEN', 'PARTIAL']
      : Array.isArray(status) ? status : status ? [status] : undefined

    // Estratégia: filtros aplicados em memória depois do overlay TOC, porque
    // para receivables ligados (tocSalesDocId != null) os campos da fatura
    // vêm do tocSalesDocument — não estão no registo local. Só os filtros
    // que actuam sobre anotações locais (categoryId, recurrenceId, parentId,
    // promisedPaymentDate) podem ir directos a SQL.
    const localWhere: Prisma.TreasuryReceivableWhereInput = {
      clientId,
      deletedAt: null,
      NOT: { parentId: { not: null }, recurrenceId: null },
      ...(categoryId ? { categoryId } : {}),
      ...(paymentDateFrom || paymentDateTo ? {
        promisedPaymentDate: {
          ...(paymentDateFrom ? { gte: new Date(paymentDateFrom) } : {}),
          ...(paymentDateTo ? { lt: new Date(new Date(paymentDateTo).getTime() + 86400000) } : {}),
        },
      } : {}),
      ...(isRecurrent !== undefined ? { recurrenceId: isRecurrent ? { not: null } : null } : {}),
    }

    const [localRows, allTocDocs] = await Promise.all([
      this.prisma.treasuryReceivable.findMany({
        where: localWhere,
        include: {
          category: { select: { id: true, name: true, color: true, launchToc: true } },
          children: { where: { deletedAt: null }, orderBy: { dueDate: 'asc' } },
        },
      }),
      // Filtros locais excluem todos os docs TOC porque não têm equivalente
      // na fonte; nesse caso a lista TOC fica vazia.
      (categoryId || isRecurrent !== undefined || paymentDateFrom || paymentDateTo)
        ? Promise.resolve([] as TocSalesDocument[])
        : this.prisma.tocSalesDocument.findMany({
            where: {
              clientId,
              ...(tocCustomerId ? { customerId: Number(tocCustomerId) } : {}),
            },
          }),
    ])

    // Mapa tocId → tocSalesDocument para overlay rápido
    const tocById = new Map(allTocDocs.map((d) => [d.tocId, d]))

    // 1. Receivables locais com overlay TOC quando ligados
    const localWithOverlay: ReceivableListItem[] = []
    for (const r of localRows) {
      const tocId = r.tocSalesDocId ? Number(r.tocSalesDocId) : null
      const tocDoc = tocId != null ? tocById.get(tocId) : undefined
      const overlaid = overlayLocalWithToc(r, tocDoc)
      if (overlaid) localWithOverlay.push(overlaid)
    }

    // 2. Docs TOC SEM registo local — entram com id `toc-{tocId}`
    const importedTocIds = new Set(localRows.map((r) => r.tocSalesDocId).filter((s): s is string => !!s))
    const SALES_INVOICE_TYPES = new Set(['ft', 'fs', 'fr'])
    const tocPureMapped: ReceivableListItem[] = []
    if (origin !== 'LOCAL' && bucket !== 'outras') {
      for (const d of allTocDocs) {
        if (importedTocIds.has(String(d.tocId))) continue
        const docType = String((d.raw as { document_type?: unknown } | null)?.document_type ?? '').toLowerCase()
        if (!SALES_INVOICE_TYPES.has(docType)) continue
        const item = mapTocSalesToReceivable(d)
        if (item) tocPureMapped.push(item)
      }
    }

    // 3. Aplicar filtros de status / texto / datas / overdue em memória
    const now = new Date()
    const docDateFromTs = docDateFrom ? new Date(docDateFrom).getTime() : null
    const docDateToTs = docDateTo ? new Date(new Date(docDateTo).getTime() + 86400000).getTime() : null
    const dueDateFromTs = dueDateFrom ? new Date(dueDateFrom).getTime() : null
    const dueDateToTs = dueDateTo ? new Date(new Date(dueDateTo).getTime() + 86400000).getTime() : null
    const entityQuery = entityName?.toLowerCase()

    const matches = (item: ReceivableListItem) => {
      if (bucket === 'outras' && item.tocSalesDocId != null) return false
      if (bucket === 'clientes' && item.tocSalesDocId == null) return false
      if (statusList && !statusList.includes(item.status)) return false
      if (origin && item.origin !== origin) return false
      if (entityQuery) {
        const en = (item.entityName ?? '').toLowerCase()
        const rf = (item.reference ?? '').toLowerCase()
        if (!en.includes(entityQuery) && !rf.includes(entityQuery)) return false
      }
      if (tocCustomerId && item.tocCustomerId !== tocCustomerId) return false
      if (overdue && (item.dueDate == null || item.dueDate >= now)) return false
      if (dueDateFromTs != null && (item.dueDate == null || item.dueDate.getTime() < dueDateFromTs)) return false
      if (dueDateToTs != null && (item.dueDate == null || item.dueDate.getTime() >= dueDateToTs)) return false
      if (docDateFromTs != null && (item.documentDate == null || item.documentDate.getTime() < docDateFromTs)) return false
      if (docDateToTs != null && (item.documentDate == null || item.documentDate.getTime() >= docDateToTs)) return false
      return true
    }

    const allItems = [...localWithOverlay, ...tocPureMapped].filter(matches)

    // 4. Ordenação em memória
    const sortKey = sortBy as keyof ReceivableListItem
    allItems.sort((a, b) => {
      const rawA = a[sortKey], rawB = b[sortKey]
      const va = rawA instanceof Date ? rawA.getTime() : rawA
      const vb = rawB instanceof Date ? rawB.getTime() : rawB
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

  /**
   * Resolve um id de receivable, suportando 2 formatos:
   *  - cuid local → devolve directo
   *  - `toc-{tocId}` → procura registo de ligação local com esse tocSalesDocId;
   *    se não existe, faz upsert mínimo (createdById obrigatório). Os campos
   *    da fatura ficam null e são lidos do espelho `tocSalesDocument` (overlay).
   * Devolve sempre o cuid local pronto para usar em writes/reads subsequentes.
   */
  private async resolveLocalReceivableId(clientId: string, userId: string, id: string): Promise<string> {
    if (!id.startsWith('toc-')) return id
    const tocSalesDocId = id.slice(4)
    const existing = await this.prisma.treasuryReceivable.findFirst({
      where: { clientId, tocSalesDocId, deletedAt: null },
      select: { id: true },
    })
    if (existing) return existing.id
    const created = await this.prisma.treasuryReceivable.create({
      data: {
        clientId,
        createdById: userId,
        tocSalesDocId,
        currency: 'EUR',
        status: 'OPEN',
        origin: 'TOCONLINE',
      },
      select: { id: true },
    })
    return created.id
  }

  /** Bloqueia mutações que alteram dados da fatura em docs com tocSalesDocId.
   *  Status/pendingAmount/totalAmount/dueDate vêm do TOC — alterá-los seria
   *  divergir do espelho. Categoria/budget/promisedPaymentDate/splits são
   *  anotações locais e continuam permitidos. */
  private assertEditableInvoiceFields(item: { tocSalesDocId: string | null }, action: string) {
    if (item.tocSalesDocId) {
      throw httpError(409, `Acção "${action}" não permitida em documentos do TOConline — os valores da fatura são geridos no TOConline`)
    }
  }

  async getById(clientId: string, id: string) {
    if (id.startsWith('toc-')) {
      const tocSalesDocId = id.slice(4)
      const tocIdNum = Number(tocSalesDocId)
      const existing = await this.prisma.treasuryReceivable.findFirst({
        where: { clientId, tocSalesDocId, deletedAt: null },
        include: {
          category: true,
          recurrence: true,
          reconciliationLinks: { include: { reconciliation: true } },
          children: { where: { deletedAt: null }, orderBy: { dueDate: 'asc' } },
        },
      })
      const tocDoc = !isNaN(tocIdNum)
        ? await this.prisma.tocSalesDocument.findUnique({
            where: { clientId_tocId: { clientId, tocId: tocIdNum } },
          })
        : null
      if (!existing && !tocDoc) throw httpError(404, 'Receivable not found')
      if (existing) return { ...existing, _tocOverlay: tocDoc ?? null }
      throw httpError(404, 'Receivable não tem registo de ligação ainda — chame primeiro resolveLocalReceivableId')
    }
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
    if (item.tocSalesDocId) {
      const tocIdNum = Number(item.tocSalesDocId)
      if (!isNaN(tocIdNum)) {
        const tocDoc = await this.prisma.tocSalesDocument.findUnique({
          where: { clientId_tocId: { clientId, tocId: tocIdNum } },
        })
        return { ...item, _tocOverlay: tocDoc }
      }
    }
    return { ...item, _tocOverlay: null as Awaited<ReturnType<PrismaClient['tocSalesDocument']['findUnique']>> }
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
          totalAmount: created.totalAmount != null ? Number(created.totalAmount.toString()) : null,
          dueDate: created.dueDate?.toISOString() ?? null,
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
    categoryId: string | null
    budgetId: string | null
    budgetAutoAssigned: boolean
    totalAmount: number
    status: TreasuryDocStatus
    tocCustomerId: string | null
  }>) {
    id = await this.resolveLocalReceivableId(clientId, userId, id)
    const item = await this.getById(clientId, id)
    const isTocLinked = !!item.tocSalesDocId

    const updateData: Prisma.TreasuryReceivableUpdateInput = {}
    if (!isTocLinked) {
      // Campos da fatura — só editáveis em receivables manuais.
      if (data.entityName   !== undefined) updateData.entityName   = data.entityName
      if (data.description  !== undefined) updateData.description  = data.description
      if (data.reference    !== undefined) updateData.reference    = data.reference
      if (data.dueDate)                    updateData.dueDate      = new Date(data.dueDate)
      if (data.documentDate)               updateData.documentDate = new Date(data.documentDate)
      if (data.status)                     updateData.status       = data.status
      if (data.tocCustomerId !== undefined) updateData.tocCustomerId = data.tocCustomerId
    } else {
      // Em docs TOC: description pode ser nota local. Tudo o resto vem do TOC.
      if (data.description !== undefined) updateData.description = data.description
    }
    if (data.promisedPaymentDate !== undefined) {
      updateData.promisedPaymentDate = data.promisedPaymentDate ? new Date(data.promisedPaymentDate) : null
    }

    if (data.categoryId === null) {
      updateData.category = { disconnect: true }
    } else if (data.categoryId) {
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
      if (isTocLinked) throw httpError(409, 'O valor da fatura é gerido no TOConline')
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
      const childUpdate: Prisma.TreasuryReceivableUncheckedUpdateManyInput = {}
      if (data.entityName !== undefined)        childUpdate.entityName = data.entityName
      if (data.description !== undefined)       childUpdate.description = data.description
      if (data.totalAmount !== undefined) {
        childUpdate.totalAmount = data.totalAmount
        childUpdate.pendingAmount = data.totalAmount
      }
      if (data.tocCustomerId !== undefined)     childUpdate.tocCustomerId = data.tocCustomerId
      if (data.categoryId !== undefined)        childUpdate.categoryId = data.categoryId

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

  /** Atribuição de categoria em massa. Reaproveita `update()` por documento (que
   *  resolve docs TOC para um registo local, valida a categoria, faz cascade às
   *  parcelas e regista auditoria). Resiliente: documentos que falhem não abortam
   *  os restantes. Devolve a contagem de sucessos e os erros por id. */
  async bulkSetCategory(clientId: string, userId: string, ids: string[], categoryId: string) {
    const category = await this.prisma.treasuryCategory.findFirst({ where: { id: categoryId, clientId, deletedAt: null } })
    if (!category) throw httpError(404, 'Category not found')
    if (category.type !== 'REVENUE') throw httpError(400, `Categoria '${category.name}' é de Despesa; não pode ser associada a contas a receber`)

    let updated = 0
    const errors: Array<{ id: string; error: string }> = []
    for (const id of ids) {
      try {
        await this.update(clientId, userId, id, { categoryId })
        updated++
      } catch (err) {
        errors.push({ id, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return { updated, failed: errors.length, errors }
  }

  /** Atribuição de estado em massa. Despacha cada documento para o método
   *  por-documento correspondente (`pay`/`settle`/`unsettle`/`void`), herdando
   *  todas as regras de negócio, cascatas às parcelas e auditoria. Resiliente:
   *  documentos que não possam transitar (ex.: liquidar fatura TOConline, anular
   *  já liquidado) são apanhados e não abortam os restantes. */
  async bulkSetStatus(clientId: string, userId: string, ids: string[], status: 'PAID' | 'SETTLED' | 'OPEN' | 'VOID') {
    let updated = 0
    const errors: Array<{ id: string; error: string }> = []
    for (const id of ids) {
      try {
        if (status === 'PAID') await this.pay(clientId, userId, id)
        else if (status === 'SETTLED') await this.settle(clientId, userId, id)
        else if (status === 'OPEN') await this.unsettle(clientId, userId, id)
        else await this.void(clientId, userId, id)
        updated++
      } catch (err) {
        errors.push({ id, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return { updated, failed: errors.length, errors }
  }

  private async syncParentStatus(clientId: string, parentId: string) {
    const children = await this.prisma.treasuryReceivable.findMany({
      where: { parentId, deletedAt: null, recurrenceId: null },
      select: { status: true, receivedAmount: true, pendingAmount: true, promisedPaymentDate: true, dueDate: true },
    })
    if (children.length === 0) return
    const receivedAmount = children.reduce((s, c) => s + Number(c.receivedAmount ?? 0), 0)
    const pendingAmount = children.reduce((s, c) => s + Number(c.pendingAmount ?? 0), 0)
    const active = children.filter((c) => c.status !== 'VOID')
    const allSettled = active.length > 0 && active.every((c) => c.status === 'SETTLED')
    const allClosed = active.length > 0 && active.every((c) => c.status === 'SETTLED' || c.status === 'PAID')
    const someProgress = active.some((c) => c.status === 'SETTLED' || c.status === 'PAID' || c.status === 'PARTIAL')
    const status: TreasuryDocStatus = allSettled ? 'SETTLED' : allClosed ? 'PAID' : someProgress ? 'PARTIAL' : 'OPEN'

    // Earliest pending parcela drives the parent's promisedPaymentDate.
    // PAID/SETTLED/VOID children are excluded (already paid or cancelled).
    const pendingDates = children
      .filter((c) => c.status !== 'PAID' && c.status !== 'SETTLED' && c.status !== 'VOID')
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
    id = await this.resolveLocalReceivableId(clientId, userId, id)
    const item = await this.getById(clientId, id)
    // Faturas do TOConline não podem ser liquidadas manualmente: a liquidação é
    // gerida pelo recibo emitido no TOConline (sync status 3 → SETTLED).
    if (item.tocSalesDocId) throw httpError(409, 'A liquidação de faturas do TOConline é gerida automaticamente pelo recibo no TOConline')
    if (item.status === 'SETTLED') throw httpError(409, 'Already settled')
    if (item.status === 'VOID') throw httpError(409, 'Cannot settle a voided receivable')
    if (item.recurrenceId && item.parentId) {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
      if (item.dueDate && item.dueDate > todayStart) throw httpError(409, 'Não é possível liquidar uma recorrência futura antes da sua data de vencimento')
    }

    const splitChildren = (item.children ?? []).filter((c) => !c.recurrenceId && c.status !== 'SETTLED' && c.status !== 'VOID')

    // Para docs TOC, totalAmount é null no local — o "received" será calculado
    // dinamicamente no overlay a partir do tocSalesDocument.
    const result = await this.prisma.$transaction(async (tx) => {
      const parent = await tx.treasuryReceivable.update({
        where: { id },
        data: {
          status: 'SETTLED',
          pendingAmount: item.tocSalesDocId ? null : 0,
          receivedAmount: item.tocSalesDocId ? null : item.totalAmount,
          promisedPaymentDate: null,
        },
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

  async pay(clientId: string, userId: string, id: string) {
    id = await this.resolveLocalReceivableId(clientId, userId, id)
    const item = await this.getById(clientId, id)
    if (item.status === 'PAID') throw httpError(409, 'Already paid')
    if (item.status === 'SETTLED') throw httpError(409, 'Already settled')
    if (item.status === 'VOID') throw httpError(409, 'Cannot pay a voided receivable')
    if (item.recurrenceId && item.parentId) {
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
      if (item.dueDate && item.dueDate > todayStart) throw httpError(409, 'Não é possível pagar uma recorrência futura antes da sua data de vencimento')
    }

    const splitChildren = (item.children ?? []).filter((c) => !c.recurrenceId && c.status !== 'PAID' && c.status !== 'SETTLED' && c.status !== 'VOID')

    const result = await this.prisma.$transaction(async (tx) => {
      const parent = await tx.treasuryReceivable.update({
        where: { id },
        data: {
          status: 'PAID',
          pendingAmount: item.tocSalesDocId ? null : 0,
          receivedAmount: item.tocSalesDocId ? null : item.totalAmount,
          promisedPaymentDate: null,
        },
      })
      // Cascade: marcar a mãe como paga marca as parcelas em aberto/parciais.
      if (splitChildren.length > 0) {
        await tx.$executeRaw`
          UPDATE "treasury_receivables"
          SET "status" = 'PAID', "pendingAmount" = 0, "receivedAmount" = "totalAmount", "updatedAt" = NOW()
          WHERE "parentId" = ${id}
            AND "recurrenceId" IS NULL
            AND "deletedAt" IS NULL
            AND "status" NOT IN ('PAID', 'SETTLED', 'VOID')
        `
      }
      await audit(tx, {
        clientId, userId,
        action: 'receivable.pay',
        entityType: 'Receivable', entityId: id,
        payload: { from: item.status, to: 'PAID', cascadedChildren: splitChildren.length },
      })
      return parent
    })

    if (item.parentId && !item.recurrenceId) await this.syncParentStatus(clientId, item.parentId)
    return result
  }

  async unsettle(clientId: string, userId: string, id: string) {
    id = await this.resolveLocalReceivableId(clientId, userId, id)
    const item = await this.getById(clientId, id)
    // Faturas liquidadas no TOConline (recibo emitido, status 3) refletem a
    // contabilidade — a liquidação não pode ser anulada aqui, só no TOConline.
    const tocOverlay = (item as { _tocOverlay?: { status?: number | null } | null })._tocOverlay
    if (item.tocSalesDocId && mapTocStatus(tocOverlay?.status ?? null) === 'SETTLED') {
      throw httpError(409, 'Fatura liquidada no TOConline (recibo emitido) — não é possível anular a liquidação aqui.')
    }
    if (item.status !== 'SETTLED' && item.status !== 'PAID') throw httpError(409, 'Apenas documentos pagos ou liquidados podem ser revertidos')

    const settledChildren = (item.children ?? []).filter((c) => !c.recurrenceId && (c.status === 'SETTLED' || c.status === 'PAID'))

    const result = await this.prisma.$transaction(async (tx) => {
      const parent = await tx.treasuryReceivable.update({
        where: { id },
        data: {
          status: 'OPEN',
          pendingAmount: item.tocSalesDocId ? null : item.totalAmount,
          receivedAmount: item.tocSalesDocId ? null : 0,
        },
      })
      // Cascade: reverting the parent reverts every PAID/SETTLED non-recurring child.
      if (settledChildren.length > 0) {
        await tx.$executeRaw`
          UPDATE "treasury_receivables"
          SET "status" = 'OPEN', "pendingAmount" = "totalAmount", "receivedAmount" = 0, "updatedAt" = NOW()
          WHERE "parentId" = ${id}
            AND "recurrenceId" IS NULL
            AND "deletedAt" IS NULL
            AND "status" IN ('SETTLED', 'PAID')
        `
      }
      await audit(tx, {
        clientId, userId,
        action: 'receivable.unsettle',
        entityType: 'Receivable', entityId: id,
        payload: { from: item.status, to: 'OPEN', cascadedChildren: settledChildren.length },
      })
      return parent
    })
    if (item.parentId && !item.recurrenceId) await this.syncParentStatus(clientId, item.parentId)
    return result
  }

  async partialPayment(clientId: string, userId: string, id: string, amount: number) {
    id = await this.resolveLocalReceivableId(clientId, userId, id)
    const item = await this.getById(clientId, id)
    if (item.status === 'PAID') throw httpError(409, 'Already paid')
    if (item.status === 'SETTLED') throw httpError(409, 'Already settled')
    if (item.status === 'VOID') throw httpError(409, 'Cannot pay a voided receivable')
    if (amount <= 0) throw httpError(400, 'Amount must be positive')
    // Para docs TOC, totalAmount está no espelho. Recuperar do overlay.
    const tocOverlay = (item as { _tocOverlay?: { grossTotal: unknown } | null })._tocOverlay
    const baseTotal = item.totalAmount != null
      ? Number(item.totalAmount)
      : tocOverlay?.grossTotal != null ? Number(tocOverlay.grossTotal as Prisma.Decimal | number) : 0
    const newReceived = Number(item.receivedAmount ?? 0) + amount
    const newPending = Math.max(0, baseTotal - newReceived)
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
    id = await this.resolveLocalReceivableId(clientId, userId, id)
    const item = await this.getById(clientId, id)
    // Faturas liquidadas no TOConline (recibo emitido, status 3) refletem a
    // contabilidade — não podem ser anuladas aqui (o status local fica OPEN, a
    // liquidação vive no espelho TOC). A anulação tem de ser feita no TOConline.
    const tocOverlay = (item as { _tocOverlay?: { status?: number | null } | null })._tocOverlay
    if (item.tocSalesDocId && mapTocStatus(tocOverlay?.status ?? null) === 'SETTLED') {
      throw httpError(409, 'Fatura liquidada no TOConline (recibo emitido) — não é possível anulá-la aqui.')
    }
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
    // Para docs TOC: se for prefixed e ainda não há ligação local, não há nada
    // para apagar (o doc TOC continua a existir no espelho). Devolve no-op.
    if (id.startsWith('toc-')) {
      const tocSalesDocId = id.slice(4)
      const existing = await this.prisma.treasuryReceivable.findFirst({
        where: { clientId, tocSalesDocId, deletedAt: null },
        select: { id: true },
      })
      if (!existing) {
        await audit(this.prisma, {
          clientId, userId,
          action: 'receivable.delete',
          entityType: 'Receivable', entityId: id,
          payload: { reference: null, totalAmount: null, tocOnly: true },
        })
        return null
      }
      id = existing.id
    }
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
      payload: { reference: item.reference, totalAmount: item.totalAmount != null ? Number(item.totalAmount.toString()) : null },
    })
    return result
  }

  async setPromisedDate(clientId: string, userId: string, id: string, date: string | null) {
    id = await this.resolveLocalReceivableId(clientId, userId, id)
    const item = await this.getById(clientId, id)
    if (item.status === 'SETTLED') throw httpError(409, 'Não é possível definir data de pagamento numa fatura já paga/liquidada')
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
    id = await this.resolveLocalReceivableId(clientId, userId, id)
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
    id = await this.resolveLocalReceivableId(clientId, userId, id)
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
        select: { id: true, totalAmount: true, description: true, reference: true, entityName: true, tocCustomerId: true },
      }),
    ])

    if (unclassified.length === 0) return { classified: 0, skipped: 0 }

    let classified = 0
    const ruleHits = new Map<string, number>()

    for (const inv of unclassified) {
      let categoryId: string | undefined

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
          select: { categoryId: true },
        })
        if (last?.categoryId) categoryId = last.categoryId
      }

      if (categoryId) {
        await this.prisma.treasuryReceivable.update({
          where: { id: inv.id },
          data: { categoryId },
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
    // Após overlay TOC, os receivables com tocSalesDocId são "anotações" sobre
    // docs TOC — os dados da fatura vivem no espelho tocSalesDocument. KPIs:
    //   - locais SEM tocLink (puramente locais: manuais, splits, recurrences)
    //     vão ao treasuryReceivable
    //   - locais COM tocLink E TOC docs puros vão ao tocSalesDocument
    // Evita-se assim a dupla contagem que existia quando o local copiava os
    // valores do TOC.
    const abertasClause: Prisma.TreasuryReceivableWhereInput = {
      OR: [
        { recurrenceId: null },
        { AND: [{ parentId: { not: null } }, { dueDate: { lte: now } }] },
      ],
    }
    const localOnlyClause: Prisma.TreasuryReceivableWhereInput = {
      clientId, deletedAt: null,
      tocSalesDocId: null,
      // Exclui as parcelas-filhas de um split (parentId != null, recurrenceId null):
      // a mãe já agrega o pendingAmount das parcelas (via syncParentStatus), por isso
      // contá-las também duplicava o valor. Alinha com o clause da lista.
      NOT: { parentId: { not: null }, recurrenceId: null },
      ...abertasClause,
    }
    const [totalOpenLocal, overdueLocal, settledMonth] = await Promise.all([
      this.prisma.treasuryReceivable.aggregate({
        where: { ...localOnlyClause, status: { in: ['OPEN', 'PARTIAL'] } },
        _sum: { pendingAmount: true },
        _count: true,
      }),
      this.prisma.treasuryReceivable.count({
        where: { ...localOnlyClause, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now } },
      }),
      this.prisma.treasuryReceivable.aggregate({
        where: {
          clientId, deletedAt: null, status: { in: ['PAID', 'SETTLED'] },
          updatedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) },
        },
        _sum: { totalAmount: true },
      }),
    ])

    // Aging buckets — só locais sem tocLink (TOC ainda não tem aging info por bucket)
    const buckets = await Promise.all([30, 60, 90].map(async (_days, i) => {
      const from = i === 0 ? new Date(0) : new Date(Date.now() - [30, 60, 90][i] * 86400000)
      const to = new Date(Date.now() - (i === 0 ? 0 : (i === 1 ? 31 : 61)) * 86400000)
      return this.prisma.treasuryReceivable.count({
        where: { ...localOnlyClause, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now, gte: from, lte: to } },
      })
    }))

    // KPIs do TOC: TODOS os tocSalesDocument com status 1/2/5 e tipos FT/FS/FR.
    // Inclui os que têm receivable anotado (porque já não há dupla contagem).
    const todayStr = now.toISOString().slice(0, 10)
    const tocDocs = await this.prisma.tocSalesDocument.findMany({
      where: { clientId, status: { in: [1, 2, 5] } },
      select: { tocId: true, dueDate: true, status: true, pendingTotal: true, grossTotal: true, raw: true },
    })
    // Docs TOC liquidados/pagos/anulados localmente (overlay) deixam de ser
    // pendentes — excluídos dos totais (decisão: "Pago" não conta como pendente).
    const overriddenToc = await this.prisma.treasuryReceivable.findMany({
      where: { clientId, deletedAt: null, tocSalesDocId: { not: null }, status: { in: ['PAID', 'SETTLED', 'VOID'] } },
      select: { tocSalesDocId: true },
    })
    const overriddenTocIds = new Set(overriddenToc.map((r) => Number(r.tocSalesDocId)))
    const SALES_INVOICE_TYPES = new Set(['ft', 'fs', 'fr'])
    let tocTotalPending = 0
    let tocOpenCount = 0
    let tocOverdue = 0
    for (const d of tocDocs) {
      if (overriddenTocIds.has(d.tocId)) continue
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
      totalPending: Number(totalOpenLocal._sum?.pendingAmount ?? 0) + tocTotalPending,
      countOpen: totalOpenLocal._count + tocOpenCount,
      countOverdue: overdueLocal + tocOverdue,
      settledThisMonth: Number(settledMonth._sum?.totalAmount ?? 0),
      aging: { '0-30': buckets[0], '31-60': buckets[1], '61-90': buckets[2] },
    }
  }
}
