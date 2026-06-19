import type { PrismaClient } from '@prisma/client'
import type { ToconlineService } from '../../modules/toconline/toconline.service.js'
import { clearBareTocSalesStub, clearBareTocPurchaseStub } from './dedup.js'

type Raw = Record<string, unknown>

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function intArr(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  return v.map(Number).filter(n => Number.isFinite(n) && n > 0)
}

export function extractCustomerFields(clientId: string, item: Raw) {
  return {
    clientId,
    tocId: num(item.id) ?? 0,
    name: str(item.name) ?? '',
    nif: str(item.fiscal_id) ?? str(item.nif),
    email: str(item.email),
    phone: str(item.mobile) ?? str(item.phone),
    raw: item as object,
    syncedAt: new Date(),
  }
}

export function extractSupplierFields(clientId: string, item: Raw) {
  return {
    clientId,
    tocId: num(item.id) ?? 0,
    name: str(item.name) ?? '',
    nif: str(item.fiscal_id) ?? str(item.nif),
    email: str(item.email),
    phone: str(item.mobile) ?? str(item.phone),
    raw: item as object,
    syncedAt: new Date(),
  }
}

export function extractProductFields(clientId: string, item: Raw) {
  return {
    clientId,
    tocId: num(item.id) ?? 0,
    name: str(item.name) ?? '',
    unitPrice: num(item.price) ?? num(item.unit_price),
    taxRate: num(item.tax_rate),
    raw: item as object,
    syncedAt: new Date(),
  }
}

export function extractServiceFields(clientId: string, item: Raw) {
  return {
    clientId,
    tocId: num(item.id) ?? 0,
    name: str(item.name) ?? '',
    unitPrice: num(item.price) ?? num(item.unit_price),
    taxRate: num(item.tax_rate),
    raw: item as object,
    syncedAt: new Date(),
  }
}

export function extractSalesDocFields(clientId: string, item: Raw) {
  return {
    clientId,
    tocId: num(item.id) ?? 0,
    customerId: num(item.customer_id) !== null ? Math.round(num(item.customer_id)!) : null,
    date: str(item.date),
    dueDate: str(item.due_date),
    status: num(item.status) !== null ? Math.round(num(item.status)!) : null,
    grossTotal: num(item.gross_total),
    pendingTotal: num(item.pending_total),
    receiptsIds: intArr(item.receipts_ids),
    documentType: str(item.document_type)?.toLowerCase() ?? null,
    // Sem trim: espelha `raw->>'...'` do backfill (valor verbatim ou null).
    documentNo: typeof item.document_no === 'string' ? item.document_no : null,
    customerName: typeof item.customer_business_name === 'string' ? item.customer_business_name : null,
    raw: item as object,
    syncedAt: new Date(),
  }
}

export function extractPurchaseDocFields(clientId: string, item: Raw) {
  return {
    clientId,
    tocId: num(item.id) ?? 0,
    supplierId: num(item.supplier_id) !== null ? Math.round(num(item.supplier_id)!) : null,
    date: str(item.date),
    dueDate: str(item.due_date),
    status: num(item.status) !== null ? Math.round(num(item.status)!) : null,
    grossTotal: num(item.gross_total),
    pendingTotal: num(item.pending_total),
    paymentsIds: intArr(item.payments_ids),
    raw: item as object,
    syncedAt: new Date(),
  }
}

export function extractSalesReceiptFields(clientId: string, item: Raw) {
  return {
    clientId,
    tocId: num(item.id) ?? 0,
    customerId: num(item.customer_id) !== null ? Math.round(num(item.customer_id)!) : null,
    date: str(item.date),
    grossTotal: num(item.gross_total),
    raw: item as object,
    syncedAt: new Date(),
  }
}

export function extractPurchasePaymentFields(clientId: string, item: Raw) {
  return {
    clientId,
    tocId: num(item.id) ?? 0,
    supplierId: num(item.supplier_id) !== null ? Math.round(num(item.supplier_id)!) : null,
    date: str(item.date),
    grossTotal: num(item.gross_total),
    raw: item as object,
    syncedAt: new Date(),
  }
}

async function upsertAll<T extends { clientId: string; tocId: number }>(
  items: T[],
  upsertOne: (item: T) => Promise<unknown>,
): Promise<number> {
  for (const item of items) await upsertOne(item)
  return items.length
}

export async function syncCustomers(prisma: PrismaClient, svc: ToconlineService, clientId: string) {
  const rows = await svc.getCustomers(clientId)
  return upsertAll(
    rows.map(r => extractCustomerFields(clientId, r)),
    item => prisma.tocCustomer.upsert({
      where: { clientId_tocId: { clientId, tocId: item.tocId } },
      create: item,
      update: { ...item },
    }),
  )
}

export async function syncSuppliers(prisma: PrismaClient, svc: ToconlineService, clientId: string) {
  const rows = await svc.getSuppliers(clientId)
  return upsertAll(
    rows.map(r => extractSupplierFields(clientId, r)),
    item => prisma.tocSupplier.upsert({
      where: { clientId_tocId: { clientId, tocId: item.tocId } },
      create: item,
      update: { ...item },
    }),
  )
}

export async function syncProducts(prisma: PrismaClient, svc: ToconlineService, clientId: string) {
  const rows = await svc.getItems(clientId)
  return upsertAll(
    rows.map(r => extractProductFields(clientId, r)),
    item => prisma.tocProduct.upsert({
      where: { clientId_tocId: { clientId, tocId: item.tocId } },
      create: item,
      update: { ...item },
    }),
  )
}

export async function syncServices(prisma: PrismaClient, svc: ToconlineService, clientId: string) {
  const rows = await svc.getServices(clientId)
  return upsertAll(
    rows.map(r => extractServiceFields(clientId, r)),
    item => prisma.tocService.upsert({
      where: { clientId_tocId: { clientId, tocId: item.tocId } },
      create: item,
      update: { ...item },
    }),
  )
}

export async function syncSalesDocuments(prisma: PrismaClient, svc: ToconlineService, clientId: string) {
  const rows = await svc.getAllSalesDocumentsFlat(clientId)
  const items = rows.map(r => extractSalesDocFields(clientId, r))
  const result = await upsertAll(
    items,
    item => prisma.tocSalesDocument.upsert({
      where: { clientId_tocId: { clientId, tocId: item.tocId } },
      create: item,
      update: { ...item },
    }),
  )
  // Recibo interno (stand-in): quando o TOConline já cobre a fatura por completo
  // (recibo emitido / pendente 0), o recibo registado manualmente deixa de fazer
  // sentido — limpa-o para não duplicar com o recibo real do TOConline.
  const coveredTocIds = items
    .filter(i => Number(i.status) === 3 || Number(i.pendingTotal ?? 0) <= 0)
    .map(i => String(i.tocId))
  if (coveredTocIds.length) {
    await prisma.treasuryReceivable.updateMany({
      where: { clientId, tocSalesDocId: { in: coveredTocIds }, receiptReference: { not: null } },
      data: { receiptReference: null, receiptAmount: null },
    })
  }
  // Dedup por referência (TOC → local): liga faturas locais sem ligação TOC cuja
  // referência coincide (igual, com trim) com o nº do documento TOC sincronizado —
  // evita duplicados. Aplica-se a locais em aberto OU fechadas (não anuladas).
  const unlinkedRec = await prisma.treasuryReceivable.findMany({
    where: { clientId, tocSalesDocId: null, deletedAt: null, reference: { not: null }, status: { in: ['OPEN', 'PARTIAL', 'PAID', 'SETTLED'] } },
    select: { id: true, reference: true },
  })
  if (unlinkedRec.length) {
    const byRef = new Map(unlinkedRec.map(r => [r.reference!.trim(), r.id]))
    for (const i of items) {
      const ref = i.documentNo?.trim()
      if (!ref) continue
      const localId = byRef.get(ref)
      if (!localId) continue
      byRef.delete(ref)
      const tocId = String(i.tocId)
      if (!(await clearBareTocSalesStub(prisma, clientId, tocId))) continue
      await prisma.treasuryReceivable.update({ where: { id: localId }, data: { tocSalesDocId: tocId } })
    }
  }
  return result
}

export async function syncPurchaseDocuments(prisma: PrismaClient, svc: ToconlineService, clientId: string) {
  const rows = await svc.getAllPurchaseDocumentsFlat(clientId)
  const items = rows.map(r => extractPurchaseDocFields(clientId, r))
  const result = await upsertAll(
    items,
    item => prisma.tocPurchaseDocument.upsert({
      where: { clientId_tocId: { clientId, tocId: item.tocId } },
      create: item,
      update: { ...item },
    }),
  )
  // Comprovativo interno (stand-in): quando o TOConline já cobre a fatura por
  // completo (pagamento registado / pendente 0), limpa o comprovativo manual
  // para não duplicar com o pagamento real do TOConline.
  const coveredTocIds = items
    .filter(i => Number(i.status) === 3 || Number(i.pendingTotal ?? 0) <= 0)
    .map(i => String(i.tocId))
  if (coveredTocIds.length) {
    await prisma.treasuryPayable.updateMany({
      where: { clientId, tocPurchasesDocId: { in: coveredTocIds }, paymentReference: { not: null } },
      data: { paymentReference: null, paymentAmount: null },
    })
  }
  // Dedup por referência (TOC → local), igual aos receivables. O nº do documento
  // de compra vive no `raw.document_no` (não há coluna), por isso lê-se do raw.
  const unlinkedPay = await prisma.treasuryPayable.findMany({
    where: { clientId, tocPurchasesDocId: null, deletedAt: null, reference: { not: null }, status: { in: ['OPEN', 'PARTIAL', 'PAID', 'SETTLED'] } },
    select: { id: true, reference: true },
  })
  if (unlinkedPay.length) {
    const byRef = new Map(unlinkedPay.map(r => [r.reference!.trim(), r.id]))
    for (const i of items) {
      const docNo = (i.raw as Record<string, unknown>).document_no
      const ref = typeof docNo === 'string' ? docNo.trim() : ''
      if (!ref) continue
      const localId = byRef.get(ref)
      if (!localId) continue
      byRef.delete(ref)
      const tocId = String(i.tocId)
      if (!(await clearBareTocPurchaseStub(prisma, clientId, tocId))) continue
      await prisma.treasuryPayable.update({ where: { id: localId }, data: { tocPurchasesDocId: tocId } })
    }
  }
  return result
}

export async function syncSalesReceipts(prisma: PrismaClient, svc: ToconlineService, clientId: string) {
  const rows = await svc.getAllSalesReceiptsFlat(clientId)
  return upsertAll(
    rows.map(r => extractSalesReceiptFields(clientId, r)),
    item => prisma.tocSalesReceipt.upsert({
      where: { clientId_tocId: { clientId, tocId: item.tocId } },
      create: item,
      update: { ...item },
    }),
  )
}

export async function syncPurchasePayments(prisma: PrismaClient, svc: ToconlineService, clientId: string) {
  const rows = await svc.getAllPurchasePaymentsFlat(clientId)
  return upsertAll(
    rows.map(r => extractPurchasePaymentFields(clientId, r)),
    item => prisma.tocPurchasePayment.upsert({
      where: { clientId_tocId: { clientId, tocId: item.tocId } },
      create: item,
      update: { ...item },
    }),
  )
}
