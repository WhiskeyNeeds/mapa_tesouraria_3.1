import type { PrismaClient, TreasuryDocStatus, TreasuryDocOrigin, TreasuryRecurrenceFrequency, Prisma, TocPurchaseDocument, TreasurySettlementSource } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'
import { computeNextDate } from '../recurrences/utils.js'
import { TreasuryRecurrencesService } from '../recurrences/recurrences.service.js'
import { TreasuryBudgetsService } from '../budgets/budgets.service.js'
import { TreasuryBudgetRulesService } from '../budget-rules/budget-rules.service.js'
import { audit, diffEntity } from '../../../lib/audit.js'
import { matchClassificationRule } from '../../../lib/classification.js'
import { mapTocStatus, resolveStatusOverlay } from '../../../lib/toc-overlay.js'
import { clearBareTocPurchaseStub } from '../../../lib/toc-sync/dedup.js'
import { compareDocs } from '../../../lib/doc-sort.js'
import { detachDocFromConfirmedReconciliations } from '../../../lib/reconciliation-detach.js'
import { earliestPendingDueAt } from '../../../lib/pending-action.js'
import { syncParentDocStatus } from '../../../lib/parent-status.js'

interface PayableListItem {
  id: string
  reference: string | null
  entityName: string | null
  documentDate: Date | null
  dueDate: Date | null
  totalAmount: number | Prisma.Decimal | null
  pendingAmount: number | Prisma.Decimal | null
  paidAmount: number | Prisma.Decimal | null
  status: TreasuryDocStatus
  settledVia: TreasurySettlementSource | null
  settledAt: Date | null
  /** Referência do comprovativo de pagamento registado ao liquidar (null se não houver). */
  paymentReference: string | null
  /** Valor coberto pelo comprovativo interno (null se não houver). */
  paymentAmount: number | Prisma.Decimal | null
  /** Data efetiva de pagamento (calculada): pagamento ao fornecedor no TOConline ›
   *  última parcela paga › settledAt manual. null enquanto não houver pagamento. */
  paymentDate: Date | string | null
  origin: TreasuryDocOrigin
  tocPurchasesDocId: string | null
  tocSupplierId: string | null
  recurrenceId: string | null
  parentId: string | null
  promisedPaymentDate: Date | null
  readyToPay: boolean
  /** Tem tarefa de contacto pendente (CALL_TASK PENDING) — mostra ícone "Contatar Cliente". */
  needsContact?: boolean
  /** dueAt (ISO) mais antigo das CALL_TASK PENDING com prazo — alimenta o "!" de ação pendente. null se não houver. */
  _pendingActionDueAt?: string | null
  category: { id: string; name: string; color: string | null; launchToc: boolean } | null
  budget: { id: string; name: string; color: string | null } | null
  children: unknown[]
  _src: 'local' | 'toc'
  _tocRaw: Prisma.JsonValue | null
  _statusToc: TreasuryDocStatus | null
  _statusDiffersFromToc: boolean
  [key: string]: unknown
}

function mapTocPurchaseToPayable(d: TocPurchaseDocument): PayableListItem | null {
  const mappedStatus = mapTocStatus(d.status)
  if (mappedStatus == null) return null
  const gross = Number(d.grossTotal ?? 0)
  const pending = Number(d.pendingTotal ?? gross)
  const paid = Math.max(0, gross - pending)
  const raw = (d.raw ?? {}) as Record<string, unknown>
  return {
    id: `toc-${d.tocId}`,
    reference: (raw.document_no as string) ?? null,
    entityName: (raw.supplier_business_name as string) ?? null,
    documentDate: d.date ? new Date(d.date) : null,
    dueDate: d.dueDate ? new Date(d.dueDate) : null,
    totalAmount: gross,
    pendingAmount: pending,
    paidAmount: paid,
    status: mappedStatus,
    settledVia: null,
    settledAt: null,
    paymentReference: null,
    paymentAmount: null,
    paymentDate: null,
    origin: 'TOCONLINE',
    tocPurchasesDocId: String(d.tocId),
    tocSupplierId: d.supplierId != null ? String(d.supplierId) : null,
    recurrenceId: null,
    parentId: null,
    promisedPaymentDate: null,
    readyToPay: false,
    category: null,
    budget: null,
    children: [],
    _src: 'toc',
    _tocRaw: d.raw,
    _statusToc: mappedStatus,
    _statusDiffersFromToc: false,
  }
}

type LocalPayableRow = Prisma.TreasuryPayableGetPayload<{
  include: {
    category: { select: { id: true; name: true; color: true; launchToc: true } }
    budget: { select: { id: true; name: true; color: true } }
    children: true
  }
}>

/** Data-base de pagamento (sem TOC): a maior data de liquidação das parcelas
 *  (última parcela paga) quando o doc está dividido; caso contrário o `settledAt`
 *  da marcação manual de Pago/Liquidado. O pagamento ao fornecedor no TOConline,
 *  quando existe, sobrepõe-se a isto na fase de enriquecimento da listagem. */
function basePaymentDate(local: LocalPayableRow): Date | null {
  const paidSplits = (local.children ?? []).filter((c) => c.recurrenceId == null && c.settledAt != null)
  if (paidSplits.length > 0) {
    return paidSplits.reduce<Date>((max, c) => (c.settledAt! > max ? c.settledAt! : max), paidSplits[0].settledAt!)
  }
  return local.settledAt ?? null
}

function overlayLocalPayableWithToc(local: LocalPayableRow, tocDoc?: TocPurchaseDocument): PayableListItem | null {
  if (!tocDoc) {
    return {
      id: local.id,
      reference: local.reference,
      entityName: local.entityName,
      documentDate: local.documentDate,
      dueDate: local.dueDate,
      totalAmount: local.totalAmount,
      pendingAmount: local.pendingAmount,
      paidAmount: local.paidAmount,
      status: local.status,
      settledVia: local.settledVia,
      settledAt: local.settledAt,
      paymentReference: local.paymentReference,
      paymentAmount: local.paymentAmount,
      paymentDate: basePaymentDate(local),
      origin: local.origin,
      tocPurchasesDocId: local.tocPurchasesDocId,
      tocSupplierId: local.tocSupplierId,
      recurrenceId: local.recurrenceId,
      parentId: local.parentId,
      promisedPaymentDate: local.promisedPaymentDate,
      readyToPay: local.readyToPay,
      category: local.category,
      budget: local.budget,
      children: local.children,
      _src: local.tocPurchasesDocId ? 'toc' : 'local',
      _tocRaw: null,
      _statusToc: null,
      _statusDiffersFromToc: false,
    }
  }
  const tocMapped = mapTocStatus(tocDoc.status)
  if (tocMapped == null) return null
  const gross = Number(tocDoc.grossTotal ?? 0)
  const tocPending = Number(tocDoc.pendingTotal ?? gross)
  const merged = resolveStatusOverlay(local.status, local.paidAmount, tocMapped, gross, tocPending)
  const raw = (tocDoc.raw ?? {}) as Record<string, unknown>
  return {
    id: local.id,
    reference: (raw.document_no as string) ?? local.reference,
    entityName: (raw.supplier_business_name as string) ?? local.entityName,
    documentDate: tocDoc.date ? new Date(tocDoc.date) : local.documentDate,
    dueDate: tocDoc.dueDate ? new Date(tocDoc.dueDate) : local.dueDate,
    totalAmount: gross,
    pendingAmount: merged.pending,
    paidAmount: merged.settled,
    status: merged.status,
    settledVia: local.settledVia,
    settledAt: local.settledAt,
    paymentReference: local.paymentReference,
    paymentAmount: local.paymentAmount,
    paymentDate: basePaymentDate(local),
    origin: 'TOCONLINE',
    tocPurchasesDocId: local.tocPurchasesDocId,
    tocSupplierId: local.tocSupplierId ?? (tocDoc.supplierId != null ? String(tocDoc.supplierId) : null),
    recurrenceId: local.recurrenceId,
    parentId: local.parentId,
    promisedPaymentDate: local.promisedPaymentDate,
    readyToPay: local.readyToPay,
    category: local.category,
    budget: local.budget,
    children: local.children,
    _src: 'toc',
    _tocRaw: tocDoc.raw,
    _statusToc: tocMapped,
    _statusDiffersFromToc: merged.statusDiffers,
  }
}

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
    uncategorized?: boolean
    budgetId?: string
    unbudgeted?: boolean
    entityName?: string
    dueDateFrom?: string
    dueDateTo?: string
    docDateFrom?: string
    docDateTo?: string
    paymentDateFrom?: string
    paymentDateTo?: string
    isRecurrent?: boolean
    overdue?: boolean
    // "Passou prazo pagamento": pendentes cuja data prometida de pagamento — ou,
    // na ausência desta, a data de vencimento de origem — já passou.
    pastPaymentDeadline?: boolean
    tocSupplierId?: string
    // 'fornecedores' = ligados ao TOConline (tocPurchasesDocId != null);
    // 'outras' = operações locais (tocPurchasesDocId == null). Cada separador
    // ordena/pagina o seu próprio conjunto no servidor.
    bucket?: 'fornecedores' | 'outras'
    // "Futuros Pagamentos": faturas marcadas como Pronta para Pagar. Atravessa os
    // buckets (Fornecedores + Outras) — quando ligado, ignora a restrição de bucket.
    readyToPay?: boolean
    // Modo de reconciliação: mostra as parcelas (filhas de split) em vez da mãe
    // dividida. Inverte a exclusão padrão (que esconde parcelas e mostra a mãe).
    reconcilable?: boolean
    sortBy?: 'dueDate' | 'totalAmount' | 'pendingAmount' | 'entityName' | 'reference' | 'promisedPaymentDate' | 'settledAt' | 'status'
    sortDir?: 'asc' | 'desc'
    page?: number
    limit?: number
  }) {
    // Materialise pending recurrence instances within the 180-day horizon so the list
    // surfaces the "Futuras" tab content without waiting on a dashboard view to trigger
    // the engine. Idempotent: returns immediately when there's nothing to generate.
    await this.recurrencesSvc.processForClient(clientId, 180)

    const { page = 1, limit = 50, status, origin, categoryId, uncategorized, budgetId, unbudgeted, entityName, dueDateFrom, dueDateTo, docDateFrom, docDateTo, paymentDateFrom, paymentDateTo, isRecurrent, overdue, pastPaymentDeadline, tocSupplierId, bucket, readyToPay, reconcilable, sortBy = 'dueDate', sortDir = 'asc' } = filters
    const statusList: TreasuryDocStatus[] | undefined = (overdue || pastPaymentDeadline)
      ? ['OPEN', 'PARTIAL']
      : Array.isArray(status) ? status : status ? [status] : undefined

    // Estratégia: filtros aplicados em memória depois do overlay TOC, porque
    // para payables ligados (tocPurchasesDocId != null) os campos da fatura
    // vêm do tocPurchaseDocument. Só os filtros sobre anotações locais
    // (categoryId, recurrenceId, parentId, promisedPaymentDate) vão a SQL.
    const localWhere: Prisma.TreasuryPayableWhereInput = {
      clientId,
      deletedAt: null,
      ...(reconcilable
        ? { NOT: { children: { some: { recurrenceId: null, deletedAt: null } } } }
        : { NOT: { parentId: { not: null }, recurrenceId: null } }),
      ...(categoryId ? { categoryId } : {}),
      ...(budgetId ? { budgetId } : {}),
      ...(paymentDateFrom || paymentDateTo ? {
        promisedPaymentDate: {
          ...(paymentDateFrom ? { gte: new Date(paymentDateFrom) } : {}),
          ...(paymentDateTo ? { lt: new Date(new Date(paymentDateTo).getTime() + 86400000) } : {}),
        },
      } : {}),
      ...(isRecurrent !== undefined ? { recurrenceId: isRecurrent ? { not: null } : null } : {}),
    }

    const [localRows, allTocDocs] = await Promise.all([
      this.prisma.treasuryPayable.findMany({
        where: localWhere,
        include: {
          category: { select: { id: true, name: true, color: true, launchToc: true } },
          budget: { select: { id: true, name: true, color: true } },
          children: { where: { deletedAt: null }, orderBy: { dueDate: 'asc' } },
        },
      }),
      (categoryId || budgetId || isRecurrent !== undefined || paymentDateFrom || paymentDateTo)
        ? Promise.resolve([] as TocPurchaseDocument[])
        : this.prisma.tocPurchaseDocument.findMany({
            where: {
              clientId,
              ...(tocSupplierId ? { supplierId: Number(tocSupplierId) } : {}),
            },
          }),
    ])

    const tocById = new Map(allTocDocs.map((d) => [d.tocId, d]))

    const localWithOverlay: PayableListItem[] = []
    for (const p of localRows) {
      const tocId = p.tocPurchasesDocId ? Number(p.tocPurchasesDocId) : null
      const tocDoc = tocId != null ? tocById.get(tocId) : undefined
      const overlaid = overlayLocalPayableWithToc(p, tocDoc)
      if (overlaid) localWithOverlay.push(overlaid)
    }

    const importedTocIds = new Set(localRows.map((p) => p.tocPurchasesDocId).filter((s): s is string => !!s))
    const PURCH_INVOICE_TYPES = new Set(['fc', 'dsp'])
    const tocPureMapped: PayableListItem[] = []
    if (origin !== 'LOCAL' && bucket !== 'outras') {
      for (const d of allTocDocs) {
        if (importedTocIds.has(String(d.tocId))) continue
        const docType = String((d.raw as { document_type?: unknown } | null)?.document_type ?? '').toLowerCase()
        if (!PURCH_INVOICE_TYPES.has(docType)) continue
        const item = mapTocPurchaseToPayable(d)
        if (item) tocPureMapped.push(item)
      }
    }

    // "Vencido" = prazo já passou (antes de hoje); um documento com vencimento
    // hoje ainda não está vencido. Usar meia-noite de hoje mantém este filtro
    // alinhado com a contagem do cartão "Vencidas" (que compara contra hoje 00:00).
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0)
    const docDateFromTs = docDateFrom ? new Date(docDateFrom).getTime() : null
    const docDateToTs = docDateTo ? new Date(new Date(docDateTo).getTime() + 86400000).getTime() : null
    const dueDateFromTs = dueDateFrom ? new Date(dueDateFrom).getTime() : null
    const dueDateToTs = dueDateTo ? new Date(new Date(dueDateTo).getTime() + 86400000).getTime() : null
    const entityQuery = entityName?.toLowerCase()

    const matches = (item: PayableListItem) => {
      if (bucket === 'outras' && item.tocPurchasesDocId != null) return false
      if (bucket === 'fornecedores' && item.tocPurchasesDocId == null) return false
      // "Futuros Pagamentos": só faturas marcadas e ainda por pagar. Faturas
      // pagas/liquidadas/anuladas saem do separador (a flag é limpa ao pagar,
      // mas guardamos esta rede de segurança para docs TOC liquidados via sync).
      if (readyToPay) {
        if (!item.readyToPay) return false
        if (item.status === 'PAID' || item.status === 'SETTLED' || item.status === 'VOID') return false
      }
      if (statusList && !statusList.includes(item.status)) return false
      if (uncategorized && item.category != null) return false
      if (unbudgeted && item.budget != null) return false
      if (origin && item.origin !== origin) return false
      if (entityQuery) {
        const en = (item.entityName ?? '').toLowerCase()
        const rf = (item.reference ?? '').toLowerCase()
        if (!en.includes(entityQuery) && !rf.includes(entityQuery)) return false
      }
      if (tocSupplierId && item.tocSupplierId !== tocSupplierId) return false
      if (overdue && (item.dueDate == null || item.dueDate >= startOfToday)) return false
      if (pastPaymentDeadline) {
        const effPay = item.promisedPaymentDate ?? item.dueDate
        if (effPay == null || effPay >= startOfToday) return false
      }
      if (dueDateFromTs != null && (item.dueDate == null || item.dueDate.getTime() < dueDateFromTs)) return false
      if (dueDateToTs != null && (item.dueDate == null || item.dueDate.getTime() >= dueDateToTs)) return false
      if (docDateFromTs != null && (item.documentDate == null || item.documentDate.getTime() < docDateFromTs)) return false
      if (docDateToTs != null && (item.documentDate == null || item.documentDate.getTime() >= docDateToTs)) return false
      return true
    }

    const allItems = [...localWithOverlay, ...tocPureMapped].filter(matches)

    allItems.sort((a, b) => compareDocs(a, b, sortBy, sortDir))

    const total = allItems.length
    const items = allItems.slice((page - 1) * limit, page * limit)

    // Enriquecimento via pagamentos ao fornecedor no TOConline:
    //  - filtra `payments_ids` no raw para só os ATIVOS (exclui anulados), para o
    //    contador de pagamentos do frontend não os incluir;
    //  - data efetiva de pagamento (precedência máxima) para docs liquidados/pagos.
    const paymentIdsByItem = new Map<string, number[]>()
    const allPaymentIds = new Set<number>()
    for (const it of items) {
      if (!it.tocPurchasesDocId) continue
      const toc = tocById.get(Number(it.tocPurchasesDocId))
      const ids = Array.isArray(toc?.paymentsIds)
        ? (toc!.paymentsIds as unknown[]).map(Number).filter((n) => !Number.isNaN(n))
        : []
      if (ids.length) {
        paymentIdsByItem.set(it.id, ids)
        ids.forEach((n) => allPaymentIds.add(n))
      }
    }
    if (allPaymentIds.size) {
      const payments = await this.prisma.tocPurchasePayment.findMany({
        where: { clientId, tocId: { in: [...allPaymentIds] }, NOT: { raw: { path: ['deleted'], equals: true } } },
        select: { tocId: true, date: true },
      })
      const activeIds = new Set(payments.map((pm) => pm.tocId))
      const dateByPayment = new Map(payments.map((pm) => [pm.tocId, pm.date]))
      for (const it of items) {
        const ids = paymentIdsByItem.get(it.id)
        if (!ids) continue
        const active = ids.filter((id) => activeIds.has(id))
        // Reescreve payments_ids no raw com só os ativos (alimenta o contador).
        if (it._tocRaw && typeof it._tocRaw === 'object') {
          it._tocRaw = { ...(it._tocRaw as Record<string, unknown>), payments_ids: active }
        }
        if (it.status === 'SETTLED' || it.status === 'PAID') {
          const dates = active.map((id) => dateByPayment.get(id)).filter((d): d is string => !!d).sort()
          if (dates.length) it.paymentDate = dates[dates.length - 1] // ISO date mais recente
        }
      }
    }

    // Sinaliza as faturas (da página atual) com tarefa de contacto pendente
    // (CALL_TASK PENDING) — o frontend mostra o ícone "Contatar Cliente". Só os
    // ids locais (cuid) têm follow-ups; itens TOC puros (id `toc-…`) nunca casam.
    const localIds = items.map((i) => i.id).filter((id) => !id.startsWith('toc-'))
    if (localIds.length > 0) {
      const pendingTasks = await this.prisma.treasuryFollowup.findMany({
        where: { clientId, payableId: { in: localIds }, kind: 'CALL_TASK', status: 'PENDING' },
        select: { payableId: true, dueAt: true },
      })
      const needsContactIds = new Set(pendingTasks.map((t) => t.payableId))
      const dueByDoc = earliestPendingDueAt(pendingTasks.map((t) => ({ docId: t.payableId, dueAt: t.dueAt })))
      for (const item of items) {
        item.needsContact = needsContactIds.has(item.id)
        item._pendingActionDueAt = dueByDoc.get(item.id) ?? null
      }
    }

    return { total, page, limit, items }
  }

  /** Resolve id local; aceita cuid ou `toc-{tocId}`. Cria registo de ligação
   *  mínimo on-demand quando recebe prefixed id sem entrada local. */
  private async resolveLocalPayableId(clientId: string, userId: string, id: string): Promise<string> {
    if (!id.startsWith('toc-')) return id
    const tocPurchasesDocId = id.slice(4)
    const existing = await this.prisma.treasuryPayable.findFirst({
      where: { clientId, tocPurchasesDocId, deletedAt: null },
      select: { id: true },
    })
    if (existing) return existing.id
    const created = await this.prisma.treasuryPayable.create({
      data: {
        clientId,
        createdById: userId,
        tocPurchasesDocId,
        currency: 'EUR',
        status: 'OPEN',
        origin: 'TOCONLINE',
      },
      select: { id: true },
    })
    return created.id
  }

  /**
   * Lookup puro (sem criar): id do payable local ligado a um doc de compras TOConline.
   * Devolve null quando ainda não existe ligação local — usado para decidir se a UI
   * abre o painel rico ou mantém o comportamento inline.
   */
  async findLocalIdByTocDoc(clientId: string, tocDocId: string): Promise<{ id: string } | null> {
    const existing = await this.prisma.treasuryPayable.findFirst({
      where: { clientId, tocPurchasesDocId: tocDocId, deletedAt: null },
      select: { id: true },
    })
    return existing ? { id: existing.id } : null
  }

  /** Bloqueia mutações que alteram dados da fatura em docs com tocPurchasesDocId. */
  private assertEditableInvoiceFields(item: { tocPurchasesDocId: string | null }, action: string) {
    if (item.tocPurchasesDocId) {
      throw httpError(409, `Acção "${action}" não permitida em documentos do TOConline — os valores da fatura são geridos no TOConline`)
    }
  }

  async getById(clientId: string, id: string) {
    if (id.startsWith('toc-')) {
      // O caller é uma rota de leitura/escrita sobre um doc TOC. Para escritas
      // o `resolveLocalPayableId` já criou/encontrou a ligação local antes
      // desta chamada, por isso aqui esperamos um id local; nas leituras
      // (`receivable-detail`) o frontend usa o id local mesmo para overlay.
      // Mantemos compatibilidade com leituras a id prefixed: damos placeholder
      // se não houver ligação local ainda.
      const tocPurchasesDocId = id.slice(4)
      const tocIdNum = Number(tocPurchasesDocId)
      const existing = await this.prisma.treasuryPayable.findFirst({
        where: { clientId, tocPurchasesDocId, deletedAt: null },
        include: {
          category: true,
          budget: { select: { id: true, name: true, color: true } },
          recurrence: true,
          reconciliationLinks: { include: { reconciliation: true } },
          children: { where: { deletedAt: null }, orderBy: { dueDate: 'asc' } },
        },
      })
      const tocDoc = !isNaN(tocIdNum)
        ? await this.prisma.tocPurchaseDocument.findUnique({
            where: { clientId_tocId: { clientId, tocId: tocIdNum } },
          })
        : null
      if (!existing && !tocDoc) throw httpError(404, 'Payable not found')
      // Para resolveLocalPayableId já termos um existing, devolvemos esse com overlay
      const localReturn = existing ? { ...existing, _tocOverlay: tocDoc ?? null } : null
      if (localReturn) return localReturn
      // Leitura de um doc TOConline puro (sem registo local ainda): devolvemos o
      // documento TOC mapeado em vez de 404 para o painel poder abrir. Apenas as
      // rotas de leitura chegam aqui; as de escrita resolvem o id local antes.
      if (tocDoc) {
        const mapped = mapTocPurchaseToPayable(tocDoc)
        if (mapped) return { ...mapped, _tocOverlay: tocDoc } as unknown as NonNullable<typeof localReturn>
      }
      throw httpError(404, 'Payable não tem registo de ligação ainda — chame primeiro resolveLocalPayableId')
    }
    const item = await this.prisma.treasuryPayable.findFirst({
      where: { id, clientId, deletedAt: null },
      include: {
        category: true,
        budget: { select: { id: true, name: true, color: true } },
        recurrence: true,
        reconciliationLinks: { include: { reconciliation: true } },
        children: { where: { deletedAt: null }, orderBy: { dueDate: 'asc' } },
      },
    })
    if (!item) throw httpError(404, 'Payable not found')
    if (item.tocPurchasesDocId) {
      const tocIdNum = Number(item.tocPurchasesDocId)
      if (!isNaN(tocIdNum)) {
        const tocDoc = await this.prisma.tocPurchaseDocument.findUnique({
          where: { clientId_tocId: { clientId, tocId: tocIdNum } },
        })
        return { ...item, _tocOverlay: tocDoc }
      }
    }
    return { ...item, _tocOverlay: null as Awaited<ReturnType<PrismaClient['tocPurchaseDocument']['findUnique']>> }
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
      if (!(data.totalAmount > 0)) throw httpError(400, 'Valor estimado obrigatório na recorrência')
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

    // Origem determinada pela ligação ao TOConline (tocPurchasesDocId), não pela
    // categoria: `launchToc` está descontinuado (a app já não escreve no TOC).
    // Um documento só é 'TOCONLINE' quando está efetivamente associado a um doc
    // TOConline; caso contrário é local e totalmente editável.
    const origin: TreasuryDocOrigin = data.tocPurchasesDocId ? 'TOCONLINE' : 'LOCAL'
    const created = await this.prisma.$transaction(async (tx) => {
      // Docs TOC mantêm a referência do TOConline. Locais usam a referência que o
      // utilizador escreve (a numeração interna automática foi descontinuada).
      // Estado inicial: recorrência → SCHEDULED; local avulsa SEM referência →
      // SCHEDULED (Futura); com referência (ou TOC) → OPEN (real, em aberto).
      const trimmedRef = data.reference?.trim() || null
      const reference = data.recurrence ? null : (data.tocPurchasesDocId ? (data.reference ?? null) : trimmedRef)
      const scheduled = !!data.recurrence || (origin === 'LOCAL' && !data.tocPurchasesDocId && !trimmedRef)
      // Dedup por referência: liga a um doc TOConline de compra com a mesma referência.
      const autoTocId = (!scheduled && !data.tocPurchasesDocId) ? await this.matchTocPurchasesDocId(clientId, reference) : null
      return tx.treasuryPayable.create({
        data: {
          clientId,
          createdById: userId,
          origin,
          totalAmount: data.totalAmount,
          // Raiz de recorrência = template (não é uma ocorrência): pendingAmount 0,
          // para não duplicar com a 1.ª instância gerada. As restantes (incl. avulsas
          // Futuras) levam o valor.
          pendingAmount: data.recurrence ? 0 : data.totalAmount,
          ...(scheduled ? { status: 'SCHEDULED' as const } : {}),
          documentDate: data.documentDate ? new Date(data.documentDate) : null,
          dueDate: new Date(data.dueDate),
          currency: data.currency ?? 'EUR',
          categoryId: data.categoryId,
          entityName: data.entityName ?? null,
          entityNif: data.entityNif,
          tocSupplierId: data.tocSupplierId,
          tocPurchasesDocId: data.tocPurchasesDocId ?? autoTocId,
          reference,
          description: data.description,
          recurrenceId,
          ...(resolvedBudgetId ? { budgetId: resolvedBudgetId, budgetAutoAssigned } : {}),
        },
      })
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

  /** Dedup por referência: devolve o tocPurchasesDocId de um documento TOConline de
   *  compra com o MESMO número (igual, com trim) que ainda não esteja ligado a outro
   *  local. O nº vive no raw.document_no (não há coluna), por isso usa-se filtro JSON. */
  private async matchTocPurchasesDocId(clientId: string, reference: string | null | undefined): Promise<string | null> {
    const ref = reference?.trim()
    if (!ref) return null
    const toc = await this.prisma.tocPurchaseDocument.findFirst({
      where: { clientId, status: { in: [1, 2, 3, 5] }, raw: { path: ['document_no'], equals: ref } },
      select: { tocId: true },
    })
    if (!toc) return null
    const tocId = String(toc.tocId)
    // Unifica: se um stub vazio já estiver ligado a este TOC, remove-o; se houver um
    // local com dados, é conflito real e não se liga.
    const canLink = await clearBareTocPurchaseStub(this.prisma, clientId, tocId)
    return canLink ? tocId : null
  }

  async update(clientId: string, userId: string, id: string, data: Partial<{
    entityName: string
    entityNif: string | null
    description: string
    reference: string
    documentDate: string
    dueDate: string
    categoryId: string | null
    budgetId: string | null
    budgetAutoAssigned: boolean
    totalAmount: number
    status: TreasuryDocStatus
    tocPurchasesDocId: string
    tocSupplierId: string | null
  }>) {
    id = await this.resolveLocalPayableId(clientId, userId, id)
    const item = await this.getById(clientId, id)
    const isTocLinked = !!item.tocPurchasesDocId

    // Fatura programada (previsão futura de recorrência): só o valor estimado e
    // a categoria são editáveis. A data vem da cadência da recorrência e a
    // referência define-se ao comprometer — qualquer dueDate/reference enviado é
    // ignorado (sem erro). totalAmount e categoryId são tratados mais abaixo.
    const isScheduled = item.status === 'SCHEDULED'

    const updateData: Prisma.TreasuryPayableUpdateInput = {}
    if (isScheduled) {
      // Adicionar uma referência promove a Futura a Em aberto (OPEN) — equivalente,
      // via edição, a "Marcar como Comprometido".
      if (data.reference !== undefined) {
        const ref = data.reference?.trim() || null
        if (ref) {
          updateData.reference = ref; updateData.status = 'OPEN'
          if (!item.tocPurchasesDocId) {
            const tocId = await this.matchTocPurchasesDocId(clientId, ref)
            if (tocId) updateData.tocPurchasesDocId = tocId
          }
        }
      }
      // Numa avulsa local (sem recorrência) os restantes campos são editáveis; numa
      // ocorrência de recorrência a data vem da cadência (não se aplica aqui).
      if (item.recurrenceId == null) {
        if (data.entityName   !== undefined) updateData.entityName   = data.entityName
        if (data.entityNif    !== undefined) updateData.entityNif    = data.entityNif
        if (data.description  !== undefined) updateData.description  = data.description
        if (data.dueDate)                    updateData.dueDate      = new Date(data.dueDate)
        if (data.documentDate)               updateData.documentDate = new Date(data.documentDate)
      }
    } else if (!isTocLinked) {
      if (data.entityName   !== undefined) updateData.entityName   = data.entityName
      if (data.entityNif    !== undefined) updateData.entityNif    = data.entityNif
      if (data.description  !== undefined) updateData.description  = data.description
      if (data.reference    !== undefined) updateData.reference    = data.reference
      if (data.dueDate)                    updateData.dueDate      = new Date(data.dueDate)
      if (data.documentDate)               updateData.documentDate = new Date(data.documentDate)
      if (data.status)                     updateData.status       = data.status
      if (data.tocSupplierId !== undefined) updateData.tocSupplierId = data.tocSupplierId
    } else {
      if (data.description !== undefined) updateData.description = data.description
    }

    if (!isScheduled && data.tocPurchasesDocId !== undefined) {
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

    if (data.categoryId === null) {
      updateData.category = { disconnect: true }
    } else if (data.categoryId) {
      const category = await this.prisma.treasuryCategory.findFirst({ where: { id: data.categoryId, clientId, deletedAt: null } })
      if (!category) throw httpError(404, 'Category not found')
      if (category.type !== 'EXPENSE') throw httpError(400, `Categoria '${category.name}' é de Receita; não pode ser associada a uma conta a pagar`)
      updateData.category = { connect: { id: data.categoryId } }
      // A origem reflete a ligação ao TOConline, não a categoria. Considera também
      // uma associação feita nesta mesma chamada (data.tocPurchasesDocId).
      updateData.origin = (data.tocPurchasesDocId ?? item.tocPurchasesDocId) ? 'TOCONLINE' : 'LOCAL'
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
      if (item.status !== 'OPEN' && !isScheduled && !data.tocPurchasesDocId) throw httpError(409, 'Só é possível alterar o valor de documentos em aberto sem pagamentos')
      updateData.totalAmount = data.totalAmount
      // Mantém pendingAmount sincronizado com o valor estimado em OPEN e SCHEDULED.
      // Exceção: a raiz-template de uma recorrência (recurrenceId != null &&
      // parentId == null) é um template, não uma ocorrência — fica a 0 para não
      // duplicar com a 1.ª instância gerada.
      if (item.status === 'OPEN' || isScheduled) {
        const isRecurrenceTemplate = item.recurrenceId != null && item.parentId == null
        updateData.pendingAmount = isRecurrenceTemplate ? 0 : data.totalAmount
      }
    }

    const updated = await this.prisma.treasuryPayable.update({ where: { id }, data: updateData })

    // Cascade para instâncias futuras geradas a partir desta programada.
    // Simétrico ao receivables: replica campos relevantes nos filhos com
    // dueDate >= hoje e status OPEN (sem pagamentos).
    if (item.recurrenceId && !item.parentId) {
      const childUpdate: Prisma.TreasuryPayableUncheckedUpdateManyInput = {}
      if (data.entityName !== undefined)       childUpdate.entityName = data.entityName
      if (data.description !== undefined)      childUpdate.description = data.description
      if (data.totalAmount !== undefined) {
        childUpdate.totalAmount = data.totalAmount
        childUpdate.pendingAmount = data.totalAmount
      }
      if (data.categoryId !== undefined)       childUpdate.categoryId = data.categoryId

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

  /** Atribuição de categoria em massa. Reaproveita `update()` por documento (que
   *  resolve docs TOC para um registo local, valida a categoria, faz cascade às
   *  parcelas e regista auditoria). Resiliente: documentos que falhem não abortam
   *  os restantes. Devolve a contagem de sucessos e os erros por id.
   *  `categoryId: null` remove a categoria (reverter categorização em massa). */
  async bulkSetCategory(clientId: string, userId: string, ids: string[], categoryId: string | null) {
    if (categoryId !== null) {
      const category = await this.prisma.treasuryCategory.findFirst({ where: { id: categoryId, clientId, deletedAt: null } })
      if (!category) throw httpError(404, 'Category not found')
      if (category.type !== 'EXPENSE') throw httpError(400, `Categoria '${category.name}' é de Receita; não pode ser associada a contas a pagar`)
    }

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

  /** Atribuição de budget em massa. Espelha `bulkSetCategory`. Resiliente a
   *  falhas individuais. `budgetId: null` remove o budget. */
  async bulkSetBudget(clientId: string, userId: string, ids: string[], budgetId: string | null) {
    if (budgetId !== null) await this.budgetsSvc.assertCompatible(clientId, budgetId, 'EXPENSE')

    let updated = 0
    const errors: Array<{ id: string; error: string }> = []
    for (const id of ids) {
      try {
        await this.update(clientId, userId, id, { budgetId })
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
    // Liquidar exige registar o comprovativo (referência + data) por documento,
    // por isso não é permitido em massa: cada fatura liquida-se individualmente.
    if (status === 'SETTLED') throw httpError(400, 'A liquidação tem de registar o pagamento — liquide cada documento individualmente.')
    let updated = 0
    const errors: Array<{ id: string; error: string }> = []
    for (const id of ids) {
      try {
        if (status === 'PAID') await this.pay(clientId, userId, id)
        else if (status === 'OPEN') await this.unsettle(clientId, userId, id)
        else await this.void(clientId, userId, id)
        updated++
      } catch (err) {
        errors.push({ id, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return { updated, failed: errors.length, errors }
  }

  /** Eliminação em massa. Despacha cada documento para `delete`, herdando o
   *  soft-delete, cascata de recorrências e auditoria. Resiliente: falhas
   *  individuais são apanhadas e não abortam os restantes. */
  async bulkDelete(clientId: string, userId: string, ids: string[]) {
    let updated = 0
    const errors: Array<{ id: string; error: string }> = []
    for (const id of ids) {
      try {
        await this.delete(clientId, userId, id)
        updated++
      } catch (err) {
        errors.push({ id, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return { updated, failed: errors.length, errors }
  }

  private syncParentStatus(clientId: string, parentId: string) {
    return syncParentDocStatus(this.prisma, clientId, 'payable', parentId)
  }

  async commit(clientId: string, userId: string, id: string, opts: { reference: string; amount: number; date: string }) {
    id = await this.resolveLocalPayableId(clientId, userId, id)
    const item = await this.getById(clientId, id)
    if (item.status !== 'SCHEDULED') throw httpError(409, 'Só é possível comprometer uma fatura programada')
    const reference = opts.reference?.trim()
    if (!reference) throw httpError(400, 'A referência é obrigatória')
    if (!opts.date) throw httpError(400, 'A data é obrigatória')
    if (!(opts.amount > 0)) throw httpError(400, 'O valor é obrigatório')
    // Dedup: se já existe um documento TOConline com esta referência, liga.
    const autoTocId = item.tocPurchasesDocId ? null : await this.matchTocPurchasesDocId(clientId, reference)
    const result = await this.prisma.treasuryPayable.update({
      where: { id },
      data: {
        status: 'OPEN',
        reference,
        totalAmount: opts.amount,
        pendingAmount: opts.amount,
        paidAmount: 0,
        dueDate: new Date(opts.date),
        ...(autoTocId ? { tocPurchasesDocId: autoTocId } : {}),
      },
    })
    await audit(this.prisma, { clientId, userId, action: 'payable.commit', entityType: 'Payable', entityId: id, payload: { reference, amount: opts.amount, date: opts.date } })
    return result
  }

  async settle(clientId: string, userId: string, id: string, opts: { paymentReference?: string; date?: string } = {}) {
    id = await this.resolveLocalPayableId(clientId, userId, id)
    const item = await this.getById(clientId, id)
    if (item.status === 'SCHEDULED') throw httpError(409, 'Fatura programada: comprometa-a primeiro (Marcar como Comprometido)')
    const ref = opts.paymentReference?.trim()
    const manual = !!ref
    // Via manual (registo do comprovativo de pagamento): exige documento Pago +
    // referência + data. Única forma de liquidar manualmente (incl. faturas TOC,
    // cuja liquidação automática continua a vir do sync).
    if (item.tocPurchasesDocId && !manual) throw httpError(409, 'A liquidação de faturas do TOConline é gerida automaticamente pelo TOConline')
    if (manual) {
      if (item.status !== 'PAID') throw httpError(409, 'Só é possível registar comprovativo numa conta paga (Pago → Liquidado)')
      if (!opts.date) throw httpError(400, 'A data do pagamento é obrigatória')
    }
    if (item.status === 'SETTLED') throw httpError(409, 'Already settled')
    if (item.status === 'VOID') throw httpError(409, 'Cannot settle a voided payable')
    // (As futuras são SCHEDULED e já bloqueadas acima; uma recorrência comprometida
    // é OPEN e pode liquidar-se mesmo com data futura.)
    const settledAt = manual && opts.date ? new Date(opts.date) : new Date()
    // Valor do comprovativo interno = parte ainda não coberta pelos pagamentos do
    // TOC. Para docs TOC = pendente do espelho TOC; para locais = total da fatura.
    const tocOverlay = (item as { _tocOverlay?: { pendingTotal?: unknown; grossTotal?: unknown } | null })._tocOverlay
    const paymentAmount = !manual ? undefined
      : item.tocPurchasesDocId
        ? Number((tocOverlay?.pendingTotal ?? tocOverlay?.grossTotal ?? 0) as Prisma.Decimal | number)
        : Number(item.totalAmount ?? 0)

    const nonRecurChildren = (item.children ?? []).filter((c) => !c.recurrenceId)
    const isSplitParent = nonRecurChildren.length > 0

    const result = await this.prisma.$transaction(async (tx) => {
      if (isSplitParent) {
        await tx.$executeRaw`
          UPDATE "treasury_payables"
          SET "status" = 'SETTLED', "pendingAmount" = 0, "paidAmount" = "totalAmount", "readyToPay" = false, "settledVia" = 'LOCAL', "settledAt" = ${settledAt}, "updatedAt" = NOW()
          WHERE "parentId" = ${id} AND "recurrenceId" IS NULL AND "deletedAt" IS NULL AND "status" NOT IN ('SETTLED','VOID')
        `
        if (manual) await tx.treasuryPayable.update({ where: { id }, data: { paymentReference: ref, paymentAmount } })
        await audit(tx, { clientId, userId, action: 'payable.settle', entityType: 'Payable', entityId: id, payload: { from: item.status, to: 'SETTLED', via: 'INSTALLMENTS', cascadedChildren: nonRecurChildren.length } })
        return null
      }
      const parent = await tx.treasuryPayable.update({
        where: { id },
        data: {
          status: 'SETTLED',
          pendingAmount: item.tocPurchasesDocId ? null : 0,
          paidAmount: item.tocPurchasesDocId ? null : item.totalAmount,
          promisedPaymentDate: null,
          readyToPay: false,
          settledVia: 'LOCAL',
          settledAt,
          ...(manual ? { paymentReference: ref, paymentAmount } : {}),
        },
      })
      await audit(tx, { clientId, userId, action: 'payable.settle', entityType: 'Payable', entityId: id, payload: { from: item.status, to: 'SETTLED', via: 'LOCAL', paymentReference: ref ?? null } })
      return parent
    })

    if (isSplitParent) await this.syncParentStatus(clientId, id)
    if (item.parentId && !item.recurrenceId) await this.syncParentStatus(clientId, item.parentId)
    return result ?? this.prisma.treasuryPayable.findUnique({ where: { id } })
  }

  async pay(clientId: string, userId: string, id: string) {
    id = await this.resolveLocalPayableId(clientId, userId, id)
    const item = await this.getById(clientId, id)
    if (item.status === 'SCHEDULED') throw httpError(409, 'Fatura programada: comprometa-a primeiro (Marcar como Comprometido)')
    if (item.status === 'PAID') throw httpError(409, 'Already paid')
    if (item.status === 'SETTLED') throw httpError(409, 'Already settled')
    if (item.status === 'VOID') throw httpError(409, 'Cannot pay a voided payable')
    // (As futuras são SCHEDULED e já bloqueadas acima; uma recorrência comprometida
    // é OPEN e pode pagar-se mesmo com data futura.)

    const nonRecurChildren = (item.children ?? []).filter((c) => !c.recurrenceId)
    const isSplitParent = nonRecurChildren.length > 0

    const result = await this.prisma.$transaction(async (tx) => {
      if (isSplitParent) {
        await tx.$executeRaw`
          UPDATE "treasury_payables"
          SET "status" = 'PAID', "pendingAmount" = 0, "paidAmount" = "totalAmount", "readyToPay" = false, "settledVia" = 'LOCAL', "settledAt" = NOW(), "updatedAt" = NOW()
          WHERE "parentId" = ${id} AND "recurrenceId" IS NULL AND "deletedAt" IS NULL AND "status" NOT IN ('PAID','SETTLED','VOID')
        `
        await audit(tx, { clientId, userId, action: 'payable.pay', entityType: 'Payable', entityId: id, payload: { from: item.status, to: 'PAID', via: 'INSTALLMENTS', cascadedChildren: nonRecurChildren.length } })
        return null
      }
      const parent = await tx.treasuryPayable.update({
        where: { id },
        data: {
          status: 'PAID',
          pendingAmount: item.tocPurchasesDocId ? null : 0,
          paidAmount: item.tocPurchasesDocId ? null : item.totalAmount,
          promisedPaymentDate: null,
          readyToPay: false,
          settledVia: 'LOCAL',
          settledAt: new Date(),
        },
      })
      await audit(tx, { clientId, userId, action: 'payable.pay', entityType: 'Payable', entityId: id, payload: { from: item.status, to: 'PAID', via: 'LOCAL' } })
      return parent
    })

    if (isSplitParent) await this.syncParentStatus(clientId, id)
    if (item.parentId && !item.recurrenceId) await this.syncParentStatus(clientId, item.parentId)
    return result ?? this.prisma.treasuryPayable.findUnique({ where: { id } })
  }

  async unsettle(clientId: string, userId: string, id: string) {
    id = await this.resolveLocalPayableId(clientId, userId, id)
    const item = await this.getById(clientId, id)
    // Faturas liquidadas no TOConline (recibo emitido, status 3) refletem a
    // contabilidade — a liquidação não pode ser anulada aqui, só no TOConline.
    const tocOverlay = (item as { _tocOverlay?: { status?: number | null } | null })._tocOverlay
    if (item.tocPurchasesDocId && mapTocStatus(tocOverlay?.status ?? null) === 'SETTLED') {
      throw httpError(409, 'Fatura liquidada no TOConline (recibo emitido) — não é possível anular a liquidação aqui.')
    }
    if (item.status !== 'SETTLED' && item.status !== 'PAID') throw httpError(409, 'Apenas documentos pagos ou liquidados podem ser revertidos')
    if (item.settledVia === 'INSTALLMENTS') throw httpError(409, 'Esta fatura ficou paga pelas parcelas — reverta parcela a parcela.')
    if (item.settledVia === 'RECONCILIATION') throw httpError(409, 'Esta fatura ficou paga por reconciliação — reverta anulando a reconciliação correspondente.')

    const result = await this.prisma.$transaction(async (tx) => {
      const parent = await tx.treasuryPayable.update({
        where: { id },
        data: {
          status: 'OPEN',
          pendingAmount: item.tocPurchasesDocId ? null : item.totalAmount,
          paidAmount: item.tocPurchasesDocId ? null : 0,
          settledVia: null,
          settledAt: null,
          paymentReference: null,
          paymentAmount: null,
        },
      })
      await audit(tx, {
        clientId, userId,
        action: 'payable.unsettle',
        entityType: 'Payable', entityId: id,
        payload: { from: item.status, to: 'OPEN', via: item.settledVia },
      })
      // Anular o pagamento também reverte (parcialmente) a reconciliação: desliga
      // apenas esta fatura, mantendo os restantes documentos/movimentos.
      const detached = await detachDocFromConfirmedReconciliations(tx, clientId, userId, 'payable', id)
      if (detached.reconciliations > 0) {
        await audit(tx, {
          clientId, userId,
          action: 'payable.reconcile_reverse',
          entityType: 'Payable', entityId: id,
          payload: { amount: detached.amount, reconciliations: detached.reconciliations, partial: true },
        })
      }
      return parent
    })

    if (item.parentId && !item.recurrenceId) await this.syncParentStatus(clientId, item.parentId)
    return result
  }

  async partialPayment(clientId: string, userId: string, id: string, amount: number) {
    id = await this.resolveLocalPayableId(clientId, userId, id)
    const item = await this.getById(clientId, id)
    if (item.status === 'SCHEDULED') throw httpError(409, 'Fatura programada: comprometa-a primeiro (Marcar como Comprometido)')
    if (item.status === 'PAID') throw httpError(409, 'Already paid')
    if (item.status === 'SETTLED') throw httpError(409, 'Already settled')
    if (item.status === 'VOID') throw httpError(409, 'Cannot pay a voided payable')
    if (amount <= 0) throw httpError(400, 'Amount must be positive')
    const tocOverlay = (item as { _tocOverlay?: { grossTotal: unknown } | null })._tocOverlay
    const baseTotal = item.totalAmount != null
      ? Number(item.totalAmount)
      : tocOverlay?.grossTotal != null ? Number(tocOverlay.grossTotal as Prisma.Decimal | number) : 0
    const newPaid = Number(item.paidAmount ?? 0) + amount
    const newPending = Math.max(0, baseTotal - newPaid)
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
    // Faturas do TOConline não podem ser anuladas na app: o seu ciclo de vida
    // (incl. anulação) é gerido no TOConline e refletido via sync. Bloqueia antes
    // de `resolveLocalPayableId` para não criar uma anotação local desnecessária.
    if (id.startsWith('toc-')) {
      throw httpError(409, 'Faturas do TOConline não podem ser anuladas na app — a anulação tem de ser feita no TOConline.')
    }
    id = await this.resolveLocalPayableId(clientId, userId, id)
    const item = await this.getById(clientId, id)
    if (item.tocPurchasesDocId) {
      throw httpError(409, 'Faturas do TOConline não podem ser anuladas na app — a anulação tem de ser feita no TOConline.')
    }
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
    if (id.startsWith('toc-')) {
      const tocPurchasesDocId = id.slice(4)
      const existing = await this.prisma.treasuryPayable.findFirst({
        where: { clientId, tocPurchasesDocId, deletedAt: null },
        select: { id: true },
      })
      if (!existing) {
        await audit(this.prisma, {
          clientId, userId,
          action: 'payable.delete',
          entityType: 'Payable', entityId: id,
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
      payload: { reference: item.reference, totalAmount: item.totalAmount != null ? Number(item.totalAmount.toString()) : null },
    })
    return result
  }

  async setPromisedDate(clientId: string, userId: string, id: string, date: string | null) {
    id = await this.resolveLocalPayableId(clientId, userId, id)
    const item = await this.getById(clientId, id)
    if (item.status === 'SCHEDULED') throw httpError(409, 'Fatura programada: comprometa-a primeiro (Marcar como Comprometido)')
    if (item.status === 'SETTLED') throw httpError(409, 'Não é possível definir data de pagamento numa fatura já paga/liquidada')
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

  /** Marca/desmarca "Pronta para Pagar" (separador Futuros Pagamentos). Anotação
   *  local não destrutiva — não altera o estado nem move a fatura do seu bucket.
   *  Ao desmarcar, `promisedPaymentDate` opcional define/repõe a data de pagamento
   *  no mesmo update (atómico): data → define; `null` → repõe a data de vencimento
   *  (limpa o promisedPaymentDate); `undefined` → não toca na data.
   *  Quando se define uma NOVA data (não null) ao desmarcar, `reason` é obrigatório:
   *  registamos uma nota com o motivo e criamos uma tarefa para contactar o
   *  fornecedor — tudo na mesma transação. */
  async setReadyToPay(
    clientId: string,
    userId: string,
    id: string,
    ready: boolean,
    promisedPaymentDate?: string | null,
    reason?: string,
  ) {
    id = await this.resolveLocalPayableId(clientId, userId, id)
    const item = await this.getById(clientId, id)
    if (item.status === 'SCHEDULED') throw httpError(409, 'Fatura programada: comprometa-a primeiro (Marcar como Comprometido)')
    // Só faturas em aberto podem entrar em Futuros Pagamentos. Parcialmente pagas,
    // pagas, liquidadas ou anuladas ficam de fora. Desmarcar (ready=false) é sempre
    // permitido (rede de limpeza para docs que mudaram de estado).
    if (ready && item.status !== 'OPEN') {
      throw httpError(409, 'Apenas faturas em aberto podem ser marcadas como prontas para pagar')
    }
    // A directiva de data só se aplica ao desmarcar e só quando o campo é fornecido.
    const alsoSetDate = !ready && promisedPaymentDate !== undefined
    const newDate = alsoSetDate ? (promisedPaymentDate ? new Date(promisedPaymentDate) : null) : undefined
    // "Definir data de pagamento" no fluxo de remover: nova data (não null) exige
    // motivo e gera nota + tarefa de contacto ao fornecedor.
    const settingNewDate = alsoSetDate && newDate != null
    const trimmedReason = reason?.trim()
    if (settingNewDate && !trimmedReason) {
      throw httpError(400, 'Motivo obrigatório ao definir uma nova data de pagamento')
    }

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.treasuryPayable.update({
        where: { id },
        data: {
          readyToPay: ready,
          ...(alsoSetDate ? { promisedPaymentDate: newDate } : {}),
        },
      })
      await audit(tx, {
        clientId, userId,
        action: 'payable.set_ready_to_pay',
        entityType: 'Payable', entityId: id,
        payload: { from: item.readyToPay, to: ready },
      })
      if (alsoSetDate) {
        await audit(tx, {
          clientId, userId,
          action: 'payable.set_promised_date',
          entityType: 'Payable', entityId: id,
          payload: {
            from: item.promisedPaymentDate?.toISOString() ?? null,
            to: newDate?.toISOString() ?? null,
          },
        })
      }
      if (settingNewDate) {
        const dateStr = newDate!.toISOString().slice(0, 10)
        // Nota com o motivo da alteração (registo histórico na timeline).
        await tx.treasuryFollowup.create({
          data: {
            clientId,
            createdById: userId,
            direction: 'PAYABLE',
            kind: 'NOTE',
            status: 'DONE',
            payableId: id,
            title: 'Alteração de data de pagamento',
            description: `Nova data de pagamento: ${dateStr}. Motivo: ${trimmedReason}`,
            completedAt: new Date(),
          },
        })
        // Tarefa pendente para contactar o fornecedor sobre a nova data.
        await tx.treasuryFollowup.create({
          data: {
            clientId,
            createdById: userId,
            direction: 'PAYABLE',
            kind: 'CALL_TASK',
            status: 'PENDING',
            importance: 'NORMAL',
            payableId: id,
            title: 'Contactar fornecedor sobre nova data de pagamento',
            description: `Nova data de pagamento: ${dateStr}. Motivo: ${trimmedReason}`,
            dueAt: newDate,
          },
        })
      }
      return result
    })
  }

  async split(clientId: string, userId: string, id: string, installments: Array<{ promisedPaymentDate: string; amount: number; description?: string }>) {
    id = await this.resolveLocalPayableId(clientId, userId, id)
    const item = await this.getById(clientId, id)
    if (item.status === 'SCHEDULED') throw httpError(409, 'Fatura programada: comprometa-a primeiro (Marcar como Comprometido)')
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
              // Abordagem A: as parcelas NÃO herdam o tocPurchasesDocId da mãe.
              // São documentos locais com referência sufixada (-1, -2…) e valor
              // próprio; assim o overlay TOC não as reescreve com o nº/valor da
              // fatura inteira. A mãe mantém a ligação ao TOConline.
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
    id = await this.resolveLocalPayableId(clientId, userId, id)
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
        select: { id: true, totalAmount: true, description: true, reference: true, entityName: true, tocSupplierId: true },
      }),
    ])

    if (unclassified.length === 0) return { classified: 0, skipped: 0 }

    let classified = 0
    const ruleHits = new Map<string, number>()

    for (const inv of unclassified) {
      let categoryId: string | undefined

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
          select: { categoryId: true },
        })
        if (last?.categoryId) categoryId = last.categoryId
      }

      if (categoryId) {
        await this.prisma.treasuryPayable.update({
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

  async getKpis(clientId: string, opts: { days?: number; all?: boolean } = {}) {
    const now = new Date()
    // Janela do "Pago": 'all' = desde sempre; days = últimos N dias a contar de
    // hoje; sem opção = mês civil atual (default histórico, usado pela query
    // principal de KPIs que não passa parâmetros).
    const paidFrom = opts.all
      ? null
      : opts.days != null
        ? new Date(now.getTime() - opts.days * 86400000)
        : new Date(now.getFullYear(), now.getMonth(), 1)
    // "Abertas": emitted but not settled. Excludes recurrence templates (parentless
    // with recurrenceId) and future recurrence instances (dueDate > now).
    // "Em aberto" = OPEN/PARTIAL, independentemente da data (ver receivables).
    // Recorrências comprometidas (OPEN) contam mesmo com vencimento futuro; as
    // futuras não comprometidas são SCHEDULED e ficam de fora pelo filtro de estado.
    const abertasClause: Prisma.TreasuryPayableWhereInput = {
      OR: [
        { recurrenceId: null },
        { parentId: { not: null } },
      ],
    }
    const localOnlyClause: Prisma.TreasuryPayableWhereInput = {
      clientId, deletedAt: null,
      tocPurchasesDocId: null,
      // Exclui as parcelas-filhas de um split (parentId != null, recurrenceId null):
      // a mãe já agrega o pendingAmount das parcelas (via syncParentStatus), por isso
      // contá-las também duplicava o valor. Alinha com o clause da lista.
      NOT: { parentId: { not: null }, recurrenceId: null },
      ...abertasClause,
    }
    // Programadas (SCHEDULED): recorrências futuras ainda não comprometidas. Não
    // se aplica o abertasClause (são futuras por natureza); mantém-se a dedup de
    // splits e a exclusão de docs TOC (SCHEDULED é sempre local).
    const programmedClause: Prisma.TreasuryPayableWhereInput = {
      clientId, deletedAt: null, tocPurchasesDocId: null,
      NOT: { parentId: { not: null }, recurrenceId: null },
    }
    const [totalOpenLocal, overdueLocal, paidMonth, totalProgrammedLocal] = await Promise.all([
      this.prisma.treasuryPayable.aggregate({
        where: { ...localOnlyClause, status: { in: ['OPEN', 'PARTIAL'] } },
        _sum: { pendingAmount: true },
        _count: true,
      }),
      this.prisma.treasuryPayable.count({
        where: { ...localOnlyClause, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now } },
      }),
      this.prisma.treasuryPayable.aggregate({
        where: { clientId, deletedAt: null, status: { in: ['PAID', 'SETTLED'] }, ...(paidFrom ? { updatedAt: { gte: paidFrom } } : {}) },
        _sum: { totalAmount: true },
      }),
      this.prisma.treasuryPayable.aggregate({
        where: { ...programmedClause, status: 'SCHEDULED' },
        _sum: { pendingAmount: true },
        _count: true,
      }),
    ])

    const buckets = await Promise.all([30, 60, 90].map(async (_days, i) => {
      const from = i === 0 ? new Date(0) : new Date(Date.now() - [30, 60, 90][i] * 86400000)
      const to = new Date(Date.now() - (i === 0 ? 0 : (i === 1 ? 31 : 61)) * 86400000)
      return this.prisma.treasuryPayable.count({
        where: { ...localOnlyClause, status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: now, gte: from, lte: to } },
      })
    }))

    // KPIs do TOC: TODOS os tocPurchaseDocument com status 1/2/5 e tipos FC/DSP.
    // Inclui os que têm payable anotado (porque já não há dupla contagem).
    const todayStr = now.toISOString().slice(0, 10)
    const tocDocs = await this.prisma.tocPurchaseDocument.findMany({
      where: { clientId, status: { in: [1, 2, 5] } },
      select: { tocId: true, dueDate: true, status: true, pendingTotal: true, grossTotal: true, raw: true },
    })
    // Docs TOC liquidados/pagos/anulados localmente (overlay) deixam de ser
    // pendentes — excluídos dos totais (decisão: "Pago" não conta como pendente).
    const overriddenToc = await this.prisma.treasuryPayable.findMany({
      where: { clientId, deletedAt: null, tocPurchasesDocId: { not: null }, status: { in: ['PAID', 'SETTLED', 'VOID'] } },
      select: { tocPurchasesDocId: true },
    })
    const overriddenTocIds = new Set(overriddenToc.map((p) => Number(p.tocPurchasesDocId)))
    const PURCH_INVOICE_TYPES = new Set(['fc', 'dsp'])
    let tocTotalPending = 0
    let tocOpenCount = 0
    let tocOverdue = 0
    for (const d of tocDocs) {
      if (overriddenTocIds.has(d.tocId)) continue
      const docType = String((d.raw as { document_type?: unknown } | null)?.document_type ?? '').toLowerCase()
      if (!PURCH_INVOICE_TYPES.has(docType)) continue
      const pending = Number(d.pendingTotal ?? d.grossTotal ?? 0)
      if (pending <= 0) continue
      tocTotalPending += pending
      tocOpenCount += 1
      const isOverdue = d.status === 5 || (d.dueDate != null && d.dueDate < todayStr)
      if (isOverdue) tocOverdue += 1
    }

    // Contadores dos cartões compactos clicáveis (dataset completo, com overlay TOC).
    // Os cartões aplicam os seus presets ao separador Fornecedores, por isso a
    // contagem tem de partilhar o mesmo universo (bucket 'fornecedores'); caso
    // contrário o badge incluiria "Outras Operações" que o filtro não mostra.
    const cardItems = (await this.list(clientId, { limit: 1_000_000, page: 1, bucket: 'fornecedores' })).items
    const startToday = new Date(); startToday.setHours(0, 0, 0, 0)
    const wd = startToday.getDay() // 0=Dom … 6=Sáb
    const weekStart = new Date(startToday); weekStart.setDate(startToday.getDate() + (wd === 0 ? -6 : 1 - wd))
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 7) // exclusivo
    const isPending = (s: string) => s === 'OPEN' || s === 'PARTIAL'
    let cUncat = 0, cUnbudgeted = 0, cPending = 0, cOverdue = 0, cWeek = 0, cPastPay = 0
    for (const it of cardItems) {
      if (it.status !== 'VOID' && it.category == null) cUncat++
      if (it.status !== 'VOID' && it.budget == null) cUnbudgeted++
      if (isPending(it.status)) {
        cPending++
        if (it.dueDate != null && it.dueDate < startToday) cOverdue++
        if (it.promisedPaymentDate != null && it.promisedPaymentDate >= weekStart && it.promisedPaymentDate < weekEnd) cWeek++
        // "Passou prazo pagamento": usa a data prometida ou, na falta dela, a data
        // de vencimento de origem. Itens vencidos sem compromisso registado entram.
        const effPay = it.promisedPaymentDate ?? it.dueDate
        if (effPay != null && effPay < startToday) cPastPay++
      }
    }

    return {
      totalPending: Number(totalOpenLocal._sum?.pendingAmount ?? 0) + tocTotalPending,
      // Programadas (SCHEDULED) — separado, para o dashboard poder incluir/excluir.
      totalProgrammed: Number(totalProgrammedLocal._sum?.pendingAmount ?? 0),
      countProgrammed: totalProgrammedLocal._count,
      countOpen: totalOpenLocal._count + tocOpenCount,
      countOverdue: overdueLocal + tocOverdue,
      paidThisMonth: Number(paidMonth._sum?.totalAmount ?? 0),
      aging: { '0-30': buckets[0], '31-60': buckets[1], '61-90': buckets[2] },
      cards: {
        uncategorized: cUncat,
        unbudgeted: cUnbudgeted,
        pending: cPending,
        overdue: cOverdue,
        dueThisWeek: cWeek,
        pastPaymentDeadline: cPastPay,
      },
    }
  }
}
