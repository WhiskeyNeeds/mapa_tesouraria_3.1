import type { PrismaClient } from '@prisma/client'
import type { ToconlineService } from '../../modules/toconline/toconline.service.js'

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
    tocId: Number(item.id),
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
    tocId: Number(item.id),
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
    tocId: Number(item.id),
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
    tocId: Number(item.id),
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
    tocId: Number(item.id),
    customerId: num(item.customer_id) !== null ? Math.round(num(item.customer_id)!) : null,
    date: str(item.date),
    dueDate: str(item.due_date),
    status: num(item.status) !== null ? Math.round(num(item.status)!) : null,
    grossTotal: num(item.gross_total),
    pendingTotal: num(item.pending_total),
    receiptsIds: intArr(item.receipts_ids),
    raw: item as object,
    syncedAt: new Date(),
  }
}

export function extractPurchaseDocFields(clientId: string, item: Raw) {
  return {
    clientId,
    tocId: Number(item.id),
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
    tocId: Number(item.id),
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
    tocId: Number(item.id),
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

export async function syncCustomers(clientId: string, svc: ToconlineService, prisma: PrismaClient) {
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

export async function syncSuppliers(clientId: string, svc: ToconlineService, prisma: PrismaClient) {
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

export async function syncProducts(clientId: string, svc: ToconlineService, prisma: PrismaClient) {
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

export async function syncServices(clientId: string, svc: ToconlineService, prisma: PrismaClient) {
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

export async function syncSalesDocuments(clientId: string, svc: ToconlineService, prisma: PrismaClient) {
  const rows = await svc.getAllSalesDocumentsFlat(clientId)
  return upsertAll(
    rows.map(r => extractSalesDocFields(clientId, r)),
    item => prisma.tocSalesDocument.upsert({
      where: { clientId_tocId: { clientId, tocId: item.tocId } },
      create: item,
      update: { ...item },
    }),
  )
}

export async function syncPurchaseDocuments(clientId: string, svc: ToconlineService, prisma: PrismaClient) {
  const rows = await svc.getAllPurchaseDocumentsFlat(clientId)
  return upsertAll(
    rows.map(r => extractPurchaseDocFields(clientId, r)),
    item => prisma.tocPurchaseDocument.upsert({
      where: { clientId_tocId: { clientId, tocId: item.tocId } },
      create: item,
      update: { ...item },
    }),
  )
}

export async function syncSalesReceipts(clientId: string, svc: ToconlineService, prisma: PrismaClient) {
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

export async function syncPurchasePayments(clientId: string, svc: ToconlineService, prisma: PrismaClient) {
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
