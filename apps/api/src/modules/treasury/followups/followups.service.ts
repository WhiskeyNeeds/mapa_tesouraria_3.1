import type {
  PrismaClient,
  TreasuryFollowupDirection,
  TreasuryFollowupImportance,
  TreasuryFollowupKind,
  TreasuryFollowupStatus,
} from '@prisma/client'
import { httpError } from '../../../lib/errors.js'
import { sendEmail } from '../../../plugins/email.js'
import { buildVariables, interpolate } from './variables.js'
import type { ToconlineService } from '../../toconline/toconline.service.js'

type DocLike = {
  id: string
  reference: string | null
  entityName: string | null
  totalAmount: { toString(): string }
  dueDate: Date | null
  promisedPaymentDate?: Date | null
  origin: 'TOCONLINE' | 'LOCAL'
  tocSalesDocId?: string | null
  tocPurchasesDocId?: string | null
}

export class FollowupsService {
  constructor(
    private prisma: PrismaClient,
    private toconline: ToconlineService,
  ) {}

  // ── Timeline ────────────────────────────────────────────────────────────

  async list(clientId: string, filters: {
    receivableId?: string
    payableId?: string
    tocCustomerId?: string
    tocSupplierId?: string
    kind?: TreasuryFollowupKind
    status?: TreasuryFollowupStatus
    direction?: TreasuryFollowupDirection
  } = {}) {
    return this.prisma.treasuryFollowup.findMany({
      where: {
        clientId,
        ...(filters.receivableId ? { receivableId: filters.receivableId } : {}),
        ...(filters.payableId ? { payableId: filters.payableId } : {}),
        ...(filters.tocCustomerId
          ? { receivable: { tocCustomerId: filters.tocCustomerId, deletedAt: null } }
          : {}),
        ...(filters.tocSupplierId
          ? { payable: { tocSupplierId: filters.tocSupplierId, deletedAt: null } }
          : {}),
        ...(filters.kind ? { kind: filters.kind } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.direction ? { direction: filters.direction } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        receivable: { select: { id: true, reference: true, entityName: true, totalAmount: true } },
        payable: { select: { id: true, reference: true, entityName: true, totalAmount: true } },
      },
      take: 200,
    })
  }

  async getById(clientId: string, id: string) {
    const f = await this.prisma.treasuryFollowup.findFirst({
      where: { id, clientId },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    })
    if (!f) throw httpError(404, 'Acompanhamento não encontrado')
    return f
  }

  /**
   * Linha temporal unificada — junta followups (emails, chamadas, notas) com
   * eventos de auditoria (criação/edição/estado da fatura), ordenados do mais
   * recente para o mais antigo. É o que o painel "Follow-ups" usa.
   */
  async getActivity(clientId: string, filters: {
    receivableId?: string
    payableId?: string
  }) {
    if (!filters.receivableId && !filters.payableId) {
      throw httpError(400, 'receivableId ou payableId obrigatório')
    }

    const entityType = filters.receivableId ? 'Receivable' : 'Payable'
    const entityId = filters.receivableId ?? filters.payableId!

    const [followups, audits] = await Promise.all([
      this.prisma.treasuryFollowup.findMany({
        where: {
          clientId,
          ...(filters.receivableId ? { receivableId: filters.receivableId } : {}),
          ...(filters.payableId ? { payableId: filters.payableId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        include: {
          assignedTo: { select: { id: true, name: true, email: true } },
          createdBy: { select: { id: true, name: true, email: true } },
        },
        take: 500,
      }),
      this.prisma.treasuryAuditLog.findMany({
        where: { clientId, entityType, entityId },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true, email: true } } },
        take: 500,
      }),
    ])

    const followupEvents = followups.map((f) => ({
      id: f.id,
      source: 'followup' as const,
      kind: f.kind as string,
      status: f.status as string,
      importance: f.importance as string,
      direction: f.direction as string,
      title: f.title,
      description: f.description,
      payload: f.payload,
      dueAt: f.dueAt?.toISOString() ?? null,
      completedAt: f.completedAt?.toISOString() ?? null,
      createdAt: f.createdAt.toISOString(),
      createdBy: f.createdBy,
      assignedTo: f.assignedTo ?? null,
    }))

    const auditEvents = audits.map((a) => ({
      id: a.id,
      source: 'audit' as const,
      kind: a.action,
      status: null,
      importance: 'NORMAL',
      direction: entityType === 'Receivable' ? 'RECEIVABLE' : 'PAYABLE',
      title: null,
      description: null,
      payload: a.payload,
      dueAt: null,
      completedAt: null,
      createdAt: a.createdAt.toISOString(),
      createdBy: a.user ?? { id: '', name: 'Sistema', email: '' },
      assignedTo: null,
    }))

    return [...followupEvents, ...auditEvents].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt),
    )
  }

  // ── Email ──────────────────────────────────────────────────────────────

  async sendEmailFollowup(clientId: string, createdById: string, input: {
    receivableId?: string
    payableId?: string
    direction: TreasuryFollowupDirection
    to: string[]
    cc?: string[]
    subject: string
    bodyHtml: string
    templateId?: string
    attachInvoicePdf?: boolean
    attachmentIds?: string[]
  }) {
    if (!input.receivableId && !input.payableId) throw httpError(400, 'receivableId ou payableId obrigatório')
    if (!input.to || input.to.length === 0) throw httpError(400, 'Destinatário (to) obrigatório')

    const doc = await this.requireDoc(clientId, input.direction, input.receivableId, input.payableId)
    const vars = await this.collectVariables(clientId, doc)

    const subject = interpolate(input.subject, vars)
    const html = interpolate(input.bodyHtml, vars)

    const attachments: { filename: string; content: Buffer; mimeType: string }[] = []

    if (input.attachInvoicePdf) {
      const pdf = await this.fetchTocInvoicePdf(clientId, input.direction, doc)
      if (pdf) attachments.push(pdf)
    }

    if (input.attachmentIds && input.attachmentIds.length > 0) {
      const extra = await this.loadAttachmentBuffers(clientId, input.attachmentIds)
      attachments.push(...extra)
    }

    const result = await sendEmail({
      to: input.to,
      subject,
      html,
      attachments,
    })

    return this.prisma.treasuryFollowup.create({
      data: {
        clientId,
        createdById,
        direction: input.direction,
        kind: 'EMAIL_SENT',
        status: result.success ? 'DONE' : 'FAILED',
        receivableId: input.receivableId ?? null,
        payableId: input.payableId ?? null,
        title: subject,
        description: result.success ? null : `Falha no envio: ${result.error ?? 'erro desconhecido'}`,
        payload: {
          to: input.to,
          cc: input.cc ?? [],
          templateId: input.templateId ?? null,
          attachInvoicePdf: !!input.attachInvoicePdf,
          attachmentIds: input.attachmentIds ?? [],
          provider: result.provider,
          bodyPreview: html.slice(0, 500),
          error: result.error ?? null,
        },
        completedAt: result.success ? new Date() : null,
      },
    })
  }

  // ── Tarefas e chamadas ──────────────────────────────────────────────────

  async createCallTask(clientId: string, createdById: string, input: {
    receivableId?: string
    payableId?: string
    direction: TreasuryFollowupDirection
    title: string
    description?: string
    dueAt?: string | Date | null
    assignedToId?: string | null
    importance?: TreasuryFollowupImportance
    phone?: string
  }) {
    if (!input.receivableId && !input.payableId) throw httpError(400, 'receivableId ou payableId obrigatório')
    if (!input.title.trim()) throw httpError(400, 'Título obrigatório')

    return this.prisma.treasuryFollowup.create({
      data: {
        clientId,
        createdById,
        direction: input.direction,
        kind: 'CALL_TASK',
        status: 'PENDING',
        importance: input.importance ?? 'NORMAL',
        receivableId: input.receivableId ?? null,
        payableId: input.payableId ?? null,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        assignedToId: input.assignedToId ?? null,
        payload: input.phone ? { phone: input.phone } : undefined,
      },
    })
  }

  async logCall(clientId: string, createdById: string, input: {
    receivableId?: string
    payableId?: string
    direction: TreasuryFollowupDirection
    title: string
    description?: string
    durationMinutes?: number
    outcome?: 'CONTACTED' | 'NO_ANSWER' | 'COMMITTED_PAYMENT' | 'DISPUTE' | 'OTHER'
    phone?: string
    sourceTaskId?: string
  }) {
    if (!input.receivableId && !input.payableId) throw httpError(400, 'receivableId ou payableId obrigatório')
    if (!input.title.trim()) throw httpError(400, 'Título obrigatório')

    const logged = await this.prisma.treasuryFollowup.create({
      data: {
        clientId,
        createdById,
        direction: input.direction,
        kind: 'CALL_LOGGED',
        status: 'DONE',
        receivableId: input.receivableId ?? null,
        payableId: input.payableId ?? null,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        completedAt: new Date(),
        payload: {
          durationMinutes: input.durationMinutes ?? null,
          outcome: input.outcome ?? null,
          phone: input.phone ?? null,
          sourceTaskId: input.sourceTaskId ?? null,
        },
      },
    })

    if (input.sourceTaskId) {
      await this.prisma.treasuryFollowup.updateMany({
        where: { id: input.sourceTaskId, clientId, kind: 'CALL_TASK', status: 'PENDING' },
        data: { status: 'DONE', completedAt: new Date() },
      })
    }

    return logged
  }

  async addNote(clientId: string, createdById: string, input: {
    receivableId?: string
    payableId?: string
    direction: TreasuryFollowupDirection
    title?: string
    description: string
  }) {
    if (!input.description.trim()) throw httpError(400, 'Conteúdo da nota obrigatório')
    return this.prisma.treasuryFollowup.create({
      data: {
        clientId,
        createdById,
        direction: input.direction,
        kind: 'NOTE',
        status: 'DONE',
        receivableId: input.receivableId ?? null,
        payableId: input.payableId ?? null,
        title: input.title?.trim() || 'Nota',
        description: input.description.trim(),
        completedAt: new Date(),
      },
    })
  }

  async update(clientId: string, id: string, data: Partial<{
    status: TreasuryFollowupStatus
    title: string
    description: string
    dueAt: string | Date | null
    assignedToId: string | null
    importance: TreasuryFollowupImportance
  }>) {
    await this.getById(clientId, id)
    return this.prisma.treasuryFollowup.update({
      where: { id },
      data: {
        ...data,
        ...(data.dueAt !== undefined ? { dueAt: data.dueAt ? new Date(data.dueAt) : null } : {}),
        ...(data.status === 'DONE' ? { completedAt: new Date() } : {}),
      },
    })
  }

  async delete(clientId: string, id: string) {
    await this.getById(clientId, id)
    await this.prisma.treasuryFollowup.delete({ where: { id } })
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private async requireDoc(
    clientId: string,
    direction: TreasuryFollowupDirection,
    receivableId?: string,
    payableId?: string,
  ): Promise<DocLike> {
    if (direction === 'RECEIVABLE') {
      if (!receivableId) throw httpError(400, 'receivableId obrigatório para direction=RECEIVABLE')
      const r = await this.prisma.treasuryReceivable.findFirst({ where: { id: receivableId, clientId } })
      if (!r) throw httpError(404, 'Documento não encontrado')
      return r as DocLike
    } else {
      if (!payableId) throw httpError(400, 'payableId obrigatório para direction=PAYABLE')
      const p = await this.prisma.treasuryPayable.findFirst({ where: { id: payableId, clientId } })
      if (!p) throw httpError(404, 'Documento não encontrado')
      return p as DocLike
    }
  }

  private async collectVariables(clientId: string, doc: DocLike) {
    // IBAN: usar conta bancária principal ativa do cliente
    const bankAccount = await this.prisma.treasuryBankAccount.findFirst({
      where: { clientId, isActive: true, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    })
    const iban = bankAccount?.ibanLast4 ? `**** **** **** ${bankAccount.ibanLast4}` : ''

    return buildVariables({
      entityName: doc.entityName,
      reference: doc.reference,
      totalAmount: Number(doc.totalAmount.toString()),
      dueDate: doc.dueDate,
      promisedPaymentDate: doc.promisedPaymentDate ?? null,
      iban,
      mbReference: null,
      mbEntity: null,
    })
  }

  private async fetchTocInvoicePdf(
    clientId: string,
    direction: TreasuryFollowupDirection,
    doc: DocLike,
  ): Promise<{ filename: string; content: Buffer; mimeType: string } | null> {
    const tocId = direction === 'RECEIVABLE' ? doc.tocSalesDocId : doc.tocPurchasesDocId
    if (!tocId) return null
    try {
      const pdf = await this.toconline.downloadInvoicePdf(clientId, direction, tocId)
      if (!pdf) return null
      const ref = doc.reference?.replace(/[^a-zA-Z0-9._-]/g, '_') ?? tocId
      return { filename: `${ref}.pdf`, content: pdf, mimeType: 'application/pdf' }
    } catch (err) {
      console.error('[Followups] falha a descarregar PDF TOConline:', err)
      return null
    }
  }

  private async loadAttachmentBuffers(clientId: string, ids: string[]) {
    const records = await this.prisma.treasuryInvoiceAttachment.findMany({
      where: { id: { in: ids }, clientId },
    })
    const { readFile } = await import('fs/promises')
    const result: { filename: string; content: Buffer; mimeType: string }[] = []
    for (const r of records) {
      try {
        const content = await readFile(r.storageKey)
        result.push({ filename: r.filename, content, mimeType: r.mimeType })
      } catch (err) {
        console.error(`[Followups] ficheiro em falta para attachment ${r.id}:`, err)
      }
    }
    return result
  }
}
