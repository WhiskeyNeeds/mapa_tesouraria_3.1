import { describe, it, expect } from 'vitest'
import {
  extractCustomerFields,
  extractSupplierFields,
  extractSalesDocFields,
  extractPurchaseDocFields,
  extractSalesReceiptFields,
  extractPurchasePaymentFields,
  extractProductFields,
  extractServiceFields,
} from './sync-entities.js'

describe('extractCustomerFields', () => {
  it('mapeia fiscal_id para nif', () => {
    const raw = { id: 23, name: 'Acme Lda', fiscal_id: '501234567', email: 'a@b.com', mobile: '912345678' }
    const result = extractCustomerFields('client1', raw)
    expect(result.tocId).toBe(23)
    expect(result.clientId).toBe('client1')
    expect(result.name).toBe('Acme Lda')
    expect(result.nif).toBe('501234567')
    expect(result.email).toBe('a@b.com')
    expect(result.phone).toBe('912345678')
  })

  it('aceita campos opcionais em falta', () => {
    const raw = { id: 5, name: 'Test' }
    const result = extractCustomerFields('c1', raw)
    expect(result.nif).toBeNull()
    expect(result.email).toBeNull()
    expect(result.phone).toBeNull()
  })
})

describe('extractSalesDocFields', () => {
  it('extrai receipts_ids como array de inteiros', () => {
    const raw = {
      id: 88, customer_id: 23, date: '2026-01-15', due_date: '2026-02-15',
      status: 3, gross_total: 1230.50, pending_total: 0, receipts_ids: [100, 101],
    }
    const result = extractSalesDocFields('c1', raw)
    expect(result.tocId).toBe(88)
    expect(result.customerId).toBe(23)
    expect(result.status).toBe(3)
    expect(result.grossTotal).toBeCloseTo(1230.50, 2)
    expect(result.receiptsIds).toEqual([100, 101])
  })

  it('trata receipts_ids ausente como array vazio', () => {
    const raw = { id: 1, customer_id: 5, date: '2026-01-01' }
    const result = extractSalesDocFields('c1', raw)
    expect(result.receiptsIds).toEqual([])
  })
})

describe('extractSalesReceiptFields', () => {
  it('extrai campos básicos do recibo', () => {
    const raw = { id: 100, customer_id: 23, date: '2026-01-20', gross_total: 1230 }
    const result = extractSalesReceiptFields('c1', raw)
    expect(result.tocId).toBe(100)
    expect(result.customerId).toBe(23)
    expect(result.date).toBe('2026-01-20')
    expect(result.grossTotal).toBe(1230)
  })
})

describe('extractPurchaseDocFields', () => {
  it('extrai payments_ids', () => {
    const raw = { id: 55, supplier_id: 10, date: '2026-03-01', payments_ids: [200, 201] }
    const result = extractPurchaseDocFields('c1', raw)
    expect(result.paymentsIds).toEqual([200, 201])
    expect(result.supplierId).toBe(10)
  })
})
