import type { PrismaClient } from '@prisma/client'
import { mkdir, writeFile, readFile, unlink } from 'fs/promises'
import { join, resolve } from 'path'
import { randomUUID } from 'crypto'
import { httpError } from '../../../lib/errors.js'

const STORAGE_ROOT = process.env.INVOICE_ATTACHMENTS_DIR
  ?? resolve(process.cwd(), 'storage', 'invoice-attachments')

const ALLOWED_MIME = new Set(['application/pdf'])
const MAX_SIZE_BYTES = 10 * 1024 * 1024

export class InvoiceAttachmentsService {
  constructor(private prisma: PrismaClient) {}

  async list(clientId: string, filters: { receivableId?: string; payableId?: string }) {
    return this.prisma.treasuryInvoiceAttachment.findMany({
      where: {
        clientId,
        ...(filters.receivableId ? { receivableId: filters.receivableId } : {}),
        ...(filters.payableId ? { payableId: filters.payableId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { uploadedBy: { select: { id: true, name: true } } },
    })
  }

  async create(clientId: string, uploadedById: string, input: {
    receivableId?: string
    payableId?: string
    filename: string
    mimeType: string
    buffer: Buffer
  }) {
    if (!input.receivableId && !input.payableId) {
      throw httpError(400, 'receivableId ou payableId obrigatório')
    }
    if (!ALLOWED_MIME.has(input.mimeType)) {
      throw httpError(400, `Tipo de ficheiro não suportado: ${input.mimeType}`)
    }
    if (input.buffer.length > MAX_SIZE_BYTES) {
      throw httpError(400, `Ficheiro demasiado grande (máx ${MAX_SIZE_BYTES / 1024 / 1024}MB)`)
    }

    const id = randomUUID()
    const dir = join(STORAGE_ROOT, clientId)
    await mkdir(dir, { recursive: true })
    const storageKey = join(dir, `${id}.pdf`)
    await writeFile(storageKey, input.buffer)

    return this.prisma.treasuryInvoiceAttachment.create({
      data: {
        clientId,
        uploadedById,
        receivableId: input.receivableId ?? null,
        payableId: input.payableId ?? null,
        filename: input.filename,
        mimeType: input.mimeType,
        size: input.buffer.length,
        storageKey,
      },
    })
  }

  async getFile(clientId: string, id: string) {
    const record = await this.prisma.treasuryInvoiceAttachment.findFirst({
      where: { id, clientId },
    })
    if (!record) throw httpError(404, 'Anexo não encontrado')
    try {
      const content = await readFile(record.storageKey)
      return { record, content }
    } catch {
      throw httpError(410, 'Ficheiro indisponível no disco')
    }
  }

  async delete(clientId: string, id: string) {
    const record = await this.prisma.treasuryInvoiceAttachment.findFirst({
      where: { id, clientId },
    })
    if (!record) throw httpError(404, 'Anexo não encontrado')
    await this.prisma.treasuryInvoiceAttachment.delete({ where: { id } })
    try { await unlink(record.storageKey) } catch { /* ignore */ }
  }
}
