import type { PrismaClient, Prisma, TreasuryFollowupDirection } from '@prisma/client'
import { httpError } from '../../../lib/errors.js'
import type { FollowupsService } from '../followups/followups.service.js'
import type { ToconlineService } from '../../toconline/toconline.service.js'

export interface DunningRuleInput {
  trackId: string
  name: string
  offsetDays: number
  direction?: TreasuryFollowupDirection
  emailTemplateId?: string | null
  minAmount?: number | null
  maxAmount?: number | null
  categoryId?: string | null
  isActive?: boolean
  sortOrder?: number
}

export class TreasuryDunningRulesService {
  constructor(
    private prisma: PrismaClient,
    private followups?: FollowupsService,
    private toconline?: ToconlineService,
  ) {}

  async list(clientId: string, filters: { trackId?: string } = {}) {
    return this.prisma.treasuryDunningRule.findMany({
      where: {
        clientId,
        deletedAt: null,
        ...(filters.trackId ? { trackId: filters.trackId } : {}),
      },
      include: {
        emailTemplate: { select: { id: true, name: true, scope: true } },
        category: { select: { id: true, name: true, color: true, type: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { offsetDays: 'asc' }],
    })
  }

  private async assertTemplateOwnership(clientId: string, templateId: string) {
    const tpl = await this.prisma.treasuryEmailTemplate.findFirst({
      where: { id: templateId, clientId, deletedAt: null },
      select: { id: true },
    })
    if (!tpl) throw httpError(404, 'Template de email não encontrado')
  }

  private async assertTrackOwnership(clientId: string, trackId: string) {
    const t = await this.prisma.treasuryDunningTrack.findFirst({
      where: { id: trackId, clientId, deletedAt: null },
      select: { id: true },
    })
    if (!t) throw httpError(404, 'Régua não encontrada')
  }

  async create(clientId: string, data: DunningRuleInput) {
    if (!data.trackId) throw httpError(400, 'Régua (trackId) é obrigatória')
    if (!data.name?.trim()) throw httpError(400, 'Nome é obrigatório')
    if (typeof data.offsetDays !== 'number' || !Number.isFinite(data.offsetDays)) {
      throw httpError(400, 'Offset de dias inválido')
    }
    if (!data.emailTemplateId) throw httpError(400, 'Template de email é obrigatório')
    await this.assertTrackOwnership(clientId, data.trackId)
    await this.assertTemplateOwnership(clientId, data.emailTemplateId)

    return this.prisma.treasuryDunningRule.create({
      data: {
        clientId,
        trackId: data.trackId,
        name: data.name.trim(),
        offsetDays: Math.trunc(data.offsetDays),
        direction: data.direction ?? 'RECEIVABLE',
        emailTemplateId: data.emailTemplateId,
        minAmount: data.minAmount ?? null,
        maxAmount: data.maxAmount ?? null,
        categoryId: data.categoryId ?? null,
        isActive: data.isActive ?? true,
        sortOrder: data.sortOrder ?? 100,
      },
    })
  }

  async update(clientId: string, id: string, data: Partial<DunningRuleInput>) {
    const rule = await this.prisma.treasuryDunningRule.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!rule) throw httpError(404, 'Regra não encontrada')

    const updateData: Prisma.TreasuryDunningRuleUpdateInput = {}
    if (data.name !== undefined) {
      const n = data.name.trim()
      if (!n) throw httpError(400, 'Nome é obrigatório')
      updateData.name = n
    }
    if (data.offsetDays !== undefined) updateData.offsetDays = Math.trunc(data.offsetDays)
    if (data.direction !== undefined) updateData.direction = data.direction
    if (data.minAmount !== undefined) updateData.minAmount = data.minAmount
    if (data.maxAmount !== undefined) updateData.maxAmount = data.maxAmount
    if (data.isActive !== undefined) updateData.isActive = data.isActive
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder

    if (data.categoryId !== undefined) {
      updateData.category = data.categoryId === null
        ? { disconnect: true }
        : { connect: { id: data.categoryId } }
    }

    if (data.emailTemplateId !== undefined) {
      if (!data.emailTemplateId) throw httpError(400, 'Template de email é obrigatório')
      await this.assertTemplateOwnership(clientId, data.emailTemplateId)
      updateData.emailTemplate = { connect: { id: data.emailTemplateId } }
    }

    if (data.trackId !== undefined && data.trackId !== rule.trackId) {
      await this.assertTrackOwnership(clientId, data.trackId)
      updateData.track = { connect: { id: data.trackId } }
    }

    return this.prisma.treasuryDunningRule.update({ where: { id }, data: updateData })
  }

  async delete(clientId: string, id: string) {
    const rule = await this.prisma.treasuryDunningRule.findFirst({ where: { id, clientId, deletedAt: null } })
    if (!rule) throw httpError(404, 'Regra não encontrada')
    await this.prisma.treasuryDunningRule.update({ where: { id }, data: { deletedAt: new Date() } })
  }

  /**
   * Corre o motor de dunning para um cliente. Elegibilidade baseada em
   * `promisedPaymentDate` (faturas sem data prometida são ignoradas).
   * Usa o template único associado à regra. Idempotente por
   * `(ruleId, receivableId)`.
   *
   * `opts.trackIds`: se fornecido, restringe a execução às regras das réguas
   * cujos ids constam da lista. Se vazio ou undefined, corre todas as ativas.
   */
  async execute(clientId: string, opts: { now?: Date; trackIds?: string[] } = {}) {
    const now = opts.now ?? new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

    const trackFilter = opts.trackIds && opts.trackIds.length > 0
      ? { trackId: { in: opts.trackIds } }
      : {}

    // Só corre regras cujas réguas estão ativas.
    const rules = await this.prisma.treasuryDunningRule.findMany({
      where: {
        clientId,
        deletedAt: null,
        isActive: true,
        track: { isActive: true, deletedAt: null },
        ...trackFilter,
      },
      include: { emailTemplate: true, track: { select: { id: true, name: true, isDefault: true } } },
      orderBy: [{ sortOrder: 'asc' }, { offsetDays: 'asc' }],
    })

    // Mapa de atribuição (cliente TOC → trackId) + track default do tenant.
    // Permite resolver, para cada receivable, qual a régua aplicável.
    const assignments = await this.prisma.treasuryDunningTrackAssignment.findMany({
      where: { clientId },
      select: { tocCustomerId: true, trackId: true },
    })
    const assignmentMap = new Map(assignments.map((a) => [a.tocCustomerId, a.trackId]))

    const defaultTrack = await this.prisma.treasuryDunningTrack.findFirst({
      where: { clientId, deletedAt: null, isDefault: true, isActive: true },
      select: { id: true },
    })
    const defaultTrackId = defaultTrack?.id ?? null

    function trackForCustomer(tocCustomerId: string | null): string | null {
      if (tocCustomerId && assignmentMap.has(tocCustomerId)) {
        return assignmentMap.get(tocCustomerId) ?? null
      }
      return defaultTrackId
    }

    let totalSent = 0
    let totalSkipped = 0
    const errors: { ruleId: string; message: string }[] = []
    const ruleResults: Array<{
      ruleId: string
      ruleName: string
      trackId: string
      trackName: string
      offsetDays: number
      templateName: string | null
      reason?: 'NO_TEMPLATE' | 'PAYABLE_NOT_SUPPORTED'
      eligibleCount: number
      sentCount: number
      skippedCount: number
      sent: Array<{
        receivableId: string
        reference: string | null
        entityName: string | null
        totalAmount: string
        promisedPaymentDate: string | null
      }>
    }> = []

    const adminId = (await this.prisma.user.findFirst({
      where: { userRoles: { some: { role: { name: 'ADMIN' } } } },
      select: { id: true },
    }))?.id ?? ''

    // Auto-import: materializa em local quaisquer faturas TOC ativas cuja due_date
    // caia na janela coberta pelas regras ativas. Permite ao motor processar
    // faturas que ainda não foram importadas manualmente.
    await this.autoImportTocSalesDocs(clientId, rules, today, adminId)

    for (const rule of rules) {
      const ruleSummary = {
        ruleId: rule.id,
        ruleName: rule.name,
        trackId: rule.trackId,
        trackName: rule.track.name,
        offsetDays: rule.offsetDays,
        templateName: rule.emailTemplate?.name ?? null,
        eligibleCount: 0,
        sentCount: 0,
        skippedCount: 0,
        sent: [] as typeof ruleResults[number]['sent'],
      }

      if (rule.direction === 'PAYABLE') {
        ruleResults.push({ ...ruleSummary, reason: 'PAYABLE_NOT_SUPPORTED' })
        continue
      }
      if (!rule.emailTemplate) {
        ruleResults.push({ ...ruleSummary, reason: 'NO_TEMPLATE' })
        continue
      }

      // Alvo: faturas cuja promisedPaymentDate cai em (today - offsetDays).
      // Ex.: offsetDays=-7 → faturas com pagamento prometido daqui a 7 dias.
      const targetDate = new Date(today)
      targetDate.setDate(targetDate.getDate() - rule.offsetDays)
      const targetEnd = new Date(targetDate)
      targetEnd.setDate(targetEnd.getDate() + 1)

      const baseFilter = {
        clientId,
        deletedAt: null,
        status: { in: ['OPEN', 'PARTIAL'] as ('OPEN' | 'PARTIAL')[] },
        promisedPaymentDate: { gte: targetDate, lt: targetEnd },
        ...(rule.minAmount ? { totalAmount: { gte: rule.minAmount } } : {}),
        ...(rule.maxAmount ? { totalAmount: { lte: rule.maxAmount } } : {}),
        ...(rule.categoryId ? { categoryId: rule.categoryId } : {}),
      } as const

      const allInvoices = await this.prisma.treasuryReceivable.findMany({
        where: baseFilter,
        select: { id: true, reference: true, entityName: true, totalAmount: true, promisedPaymentDate: true, pendingAmount: true, tocCustomerId: true },
      })
      // Só conta como elegível se a régua aplicável ao receivable for a desta regra.
      // Se o cliente TOC não tem atribuição, cai na régua default (resolvido por trackForCustomer).
      const invoices = allInvoices.filter((inv) => trackForCustomer(inv.tocCustomerId) === rule.trackId)
      ruleSummary.eligibleCount = invoices.length

      for (const inv of invoices) {
        const existing = await this.prisma.treasuryDunningExecution.findUnique({
          where: { dunning_unique_rule_receivable: { ruleId: rule.id, receivableId: inv.id } },
        })
        // Idempotência: só execuções com SENT bloqueiam retry. FAILED é re-tentado
        // (ex.: utilizador corrige email do cliente no TOC e volta a executar).
        if (existing && existing.status === 'SENT') {
          totalSkipped++; ruleSummary.skippedCount++; continue
        }

        // Reutiliza ou cria a execução
        const exec = existing
          ? await this.prisma.treasuryDunningExecution.update({
              where: { id: existing.id },
              data: { status: 'PENDING', scheduledAt: now, errorMessage: null, executedAt: null },
            })
          : await this.prisma.treasuryDunningExecution.create({
              data: {
                clientId, ruleId: rule.id, receivableId: inv.id,
                scheduledAt: now, status: 'PENDING',
              },
            })

        try {
          // Override de teste em dev — todos os emails vão para um endereço fixo.
          const overrideTo = process.env.DUNNING_TEST_RECIPIENT?.trim()
          let recipient: string | null = overrideTo || null

          if (!recipient) {
            const clientLabel = inv.entityName ?? `TOC ${inv.tocCustomerId ?? '?'}`
            if (!inv.tocCustomerId) {
              throw new Error(`Fatura ${inv.reference ?? inv.id} sem tocCustomerId — impossível resolver email do cliente`)
            }
            if (!this.toconline) throw new Error('ToconlineService não injetado no DunningRulesService')
            recipient = await this.toconline.getCustomerEmail(clientId, inv.tocCustomerId)
            if (!recipient) {
              throw new Error(`Cliente "${clientLabel}" não tem email registado no TOConline. Adiciona um email principal ao cliente e volta a clicar "Executar agora" — a fatura ${inv.reference ?? inv.id} será re-tentada automaticamente.`)
            }
          }

          if (!this.followups) throw new Error('FollowupsService não injetado no DunningRulesService')

          // Delegamos o envio + interpolação + registo na timeline ao FollowupsService.
          const followup = await this.followups.sendEmailFollowup(clientId, adminId, {
            receivableId: inv.id,
            direction: 'RECEIVABLE',
            to: [recipient],
            subject: rule.emailTemplate.subject,
            bodyHtml: rule.emailTemplate.bodyHtml,
            templateId: rule.emailTemplate.id,
            attachInvoicePdf: false,
          })

          if (followup.status === 'FAILED') {
            throw new Error(typeof followup.description === 'string' ? followup.description : 'Falha de envio')
          }

          // Marca a execução de dunning como SENT (idempotência) e regista no payload do followup.
          await this.prisma.treasuryDunningExecution.update({
            where: { id: exec.id },
            data: { status: 'SENT', executedAt: now },
          })
          await this.prisma.treasuryFollowup.update({
            where: { id: followup.id },
            data: {
              payload: {
                ...(typeof followup.payload === 'object' && followup.payload !== null ? followup.payload as Record<string, unknown> : {}),
                dunningRuleId: rule.id,
                executionId: exec.id,
                automatic: true,
              },
            },
          })
          totalSent++
          ruleSummary.sentCount++
          ruleSummary.sent.push({
            receivableId: inv.id,
            reference: inv.reference,
            entityName: inv.entityName,
            totalAmount: inv.totalAmount.toString(),
            promisedPaymentDate: inv.promisedPaymentDate ? inv.promisedPaymentDate.toISOString() : null,
          })
        } catch (err) {
          await this.prisma.treasuryDunningExecution.update({
            where: { id: exec.id },
            data: { status: 'FAILED', errorMessage: err instanceof Error ? err.message : String(err) },
          })
          errors.push({ ruleId: rule.id, message: err instanceof Error ? err.message : String(err) })
        }
      }

      await this.prisma.treasuryDunningRule.update({
        where: { id: rule.id },
        data: { lastExecutedAt: now, totalExecutions: { increment: 1 } },
      })
      ruleResults.push(ruleSummary)
    }

    return { totalSent, totalSkipped, errors, rules: ruleResults }
  }

  /**
   * Pre-passo do execute(): para cada regra ativa, calcula a janela de
   * `due_date` que pode disparar a regra (today - offsetDays). Vai ao TOC
   * buscar faturas de venda ativas dentro dessa janela e, das que não
   * estão em local, cria receivables com `promisedPaymentDate = due_date`.
   * Idempotente — só importa o que ainda não existe (chave: tocSalesDocId).
   */
  private async autoImportTocSalesDocs(
    clientId: string,
    rules: Array<{ direction: string; offsetDays: number; emailTemplate: unknown }>,
    today: Date,
    adminId: string,
  ) {
    if (!this.toconline) return

    const offsets = rules
      .filter((r) => r.direction !== 'PAYABLE' && r.emailTemplate)
      .map((r) => r.offsetDays)
    if (offsets.length === 0) return

    const minOff = Math.min(...offsets)
    const maxOff = Math.max(...offsets)
    // due_date = today - offsetDays ⇒ janela: [today - maxOff, today - minOff + 1d]
    const rangeStart = new Date(today); rangeStart.setDate(rangeStart.getDate() - maxOff)
    const rangeEnd = new Date(today); rangeEnd.setDate(rangeEnd.getDate() - minOff + 1)

    let tocDocs: Array<Record<string, unknown>>
    try {
      const raw = await this.toconline.getSalesDocuments(clientId)
      tocDocs = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : []
    } catch (err) {
      console.error('[Dunning] auto-import: TOC inacessível:', err)
      return
    }

    const ACTIVE_STATUS = new Set([1, 2, 5]) // 1=emitido, 2=parcial, 5=vencido
    const INVOICE_TYPES = new Set(['ft', 'fs', 'fr'])

    const eligible = tocDocs.filter((d) => {
      if (!ACTIVE_STATUS.has(Number(d.status))) return false
      const t = String(d.document_type ?? '').toLowerCase()
      if (!INVOICE_TYPES.has(t)) return false
      const dueRaw = d.due_date as string | undefined
      if (!dueRaw) return false
      const due = new Date(dueRaw)
      return due >= rangeStart && due < rangeEnd
    })
    if (eligible.length === 0) return

    const tocIds = eligible.map((d) => String(d.id))
    const existing = await this.prisma.treasuryReceivable.findMany({
      where: { clientId, tocSalesDocId: { in: tocIds }, deletedAt: null },
      select: { tocSalesDocId: true },
    })
    const existingIds = new Set(existing.map((r) => r.tocSalesDocId))
    const toImport = eligible.filter((d) => !existingIds.has(String(d.id)))

    for (const d of toImport) {
      try {
        const dueDate = new Date(d.due_date as string)
        const docDate = d.date ? new Date(d.date as string) : dueDate
        const gross = Number(d.gross_total ?? 0)
        const pending = Number(d.pending_total ?? gross)
        const received = Math.max(0, gross - pending)
        const status = Number(d.status) === 2 ? 'PARTIAL' : 'OPEN'

        await this.prisma.treasuryReceivable.create({
          data: {
            clientId,
            createdById: adminId,
            entityName: (d.customer_business_name as string) ?? null,
            entityNif: (d.customer_tax_registration_number as string) ?? null,
            tocCustomerId: d.customer_id != null ? String(d.customer_id) : null,
            tocSalesDocId: String(d.id),
            reference: (d.document_no as string) ?? null,
            description: (d.notes as string) ?? null,
            documentDate: docDate,
            dueDate,
            promisedPaymentDate: dueDate,
            totalAmount: gross,
            pendingAmount: pending,
            receivedAmount: received,
            currency: (d.currency_iso_code as string) ?? 'EUR',
            status,
            origin: 'TOCONLINE',
            tocSyncedAt: new Date(),
          },
        })
      } catch (err) {
        console.error('[Dunning] auto-import falhou para', d.id, err)
      }
    }
  }

  /**
   * Corre o motor para todos os clientes. Usado pelo cron diário.
   */
  async executeAll(opts: { now?: Date } = {}) {
    const clients = await this.prisma.client.findMany({
      where: { deletedAt: null },
      select: { id: true },
    })
    const summary = { totalSent: 0, totalSkipped: 0, clients: 0, errors: [] as { clientId: string; message: string }[] }
    for (const { id } of clients) {
      try {
        const r = await this.execute(id, opts)
        summary.totalSent += r.totalSent
        summary.totalSkipped += r.totalSkipped
        summary.clients++
      } catch (err) {
        summary.errors.push({ clientId: id, message: err instanceof Error ? err.message : String(err) })
      }
    }
    return summary
  }
}
