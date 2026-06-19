import type { PrismaClient, Prisma, TreasuryDocStatus } from '@prisma/client'

/** Fonte única do overlay TOConline.
 *
 *  Documentos ligados ao TOConline (`tocSalesDocId` / `tocPurchasesDocId`)
 *  guardam `null` nas colunas de valor (totalAmount/pendingAmount/…) — os
 *  valores reais vivem no espelho `toc{Sales,Purchase}Document` e são aplicados
 *  em runtime. Todo o código que precise do total/pending/liquidado fiável de um
 *  documento deve passar por aqui, em vez de ler as colunas locais cruas. */

/** Mapeia status TOC (1/2/3/5) para o enum local. Devolve null para status que
 *  não fazem sentido como documento ativo (0=rascunho, 4=anulado). */
export function mapTocStatus(tocStatus: number | null | undefined): TreasuryDocStatus | null {
  if (tocStatus == null || tocStatus === 0 || tocStatus === 4) return null
  if (tocStatus === 3) return 'SETTLED'
  if (tocStatus === 2) return 'PARTIAL'
  return 'OPEN' // 1 ou 5
}

/** Combina status local + TOC. Regra: anulação local prevalece; recibo emitido
 *  no TOC (SETTLED) liquida automaticamente; SETTLED/PAID locais prevalecem
 *  sobre OPEN do TOC; PARTIAL local deriva o pending do liquidado local; OPEN
 *  local segue o TOC. `settled` = received (receivables) ou paid (payables). */
export function resolveStatusOverlay(
  localStatus: TreasuryDocStatus,
  localSettled: number | Prisma.Decimal | null | undefined,
  tocStatus: TreasuryDocStatus,
  tocGross: number,
  tocPending: number,
): { status: TreasuryDocStatus; settled: number; pending: number; statusDiffers: boolean } {
  if (localStatus === 'VOID') {
    return { status: 'VOID', settled: 0, pending: 0, statusDiffers: true }
  }
  if (tocStatus === 'SETTLED') {
    return { status: 'SETTLED', settled: tocGross, pending: 0, statusDiffers: false }
  }
  if (localStatus === 'SETTLED') {
    return { status: 'SETTLED', settled: tocGross, pending: 0, statusDiffers: true }
  }
  if (localStatus === 'PAID') {
    return { status: 'PAID', settled: tocGross, pending: 0, statusDiffers: true }
  }
  if (localStatus === 'PARTIAL') {
    const settled = Number(localSettled ?? 0)
    return { status: 'PARTIAL', settled, pending: Math.max(0, tocGross - settled), statusDiffers: tocStatus !== 'PARTIAL' }
  }
  return {
    status: tocStatus,
    settled: Math.max(0, tocGross - tocPending),
    pending: tocPending,
    statusDiffers: false,
  }
}

/** Campos mínimos de uma linha local de receivable/payable para resolver valores. */
export interface DocAmountInputs {
  status: TreasuryDocStatus
  reference: string | null
  totalAmount: number | Prisma.Decimal | null
  pendingAmount: number | Prisma.Decimal | null
  /** receivedAmount (receivables) ou paidAmount (payables). */
  settledAmount: number | Prisma.Decimal | null | undefined
  isTocLinked: boolean
}

/** Espelho TOC (subconjunto de Toc{Sales,Purchase}Document) necessário ao overlay. */
export interface TocMirror {
  status: number | null
  grossTotal: number | Prisma.Decimal | null
  pendingTotal: number | Prisma.Decimal | null
  raw: Prisma.JsonValue | null
}

/** Resolve os valores fiáveis (total/settled/pending/reference) de um documento.
 *  Função pura: recebe a linha local e o espelho TOC já obtido. */
export function resolveDocAmounts(
  doc: DocAmountInputs,
  tocDoc: TocMirror | null,
): { total: number; settled: number; pending: number; reference: string | null } {
  // Doc puramente local, ou ligado mas sem espelho TOC (removido do sync): os
  // campos da própria linha são a melhor fonte disponível.
  if (!doc.isTocLinked || !tocDoc) {
    return {
      total: Number(doc.totalAmount ?? 0),
      settled: Number(doc.settledAmount ?? 0),
      pending: Math.max(0, Number(doc.pendingAmount ?? 0)),
      reference: doc.reference ?? null,
    }
  }

  const gross = Number(tocDoc.grossTotal ?? doc.totalAmount ?? 0)
  const tocPending = Number(tocDoc.pendingTotal ?? gross)
  const raw = (tocDoc.raw ?? {}) as Record<string, unknown>
  const reference = doc.reference ?? (raw.document_no as string | undefined) ?? null
  // Status TOC inválido (rascunho/anulado) → trata como OPEN para seguir os
  // valores do espelho sem aplicar overlay de estado.
  const merged = resolveStatusOverlay(doc.status, doc.settledAmount, mapTocStatus(tocDoc.status) ?? 'OPEN', gross, tocPending)
  return { total: gross, settled: merged.settled, pending: merged.pending, reference }
}

/** Variante com acesso à BD: obtém o espelho TOC e delega em `resolveDocAmounts`.
 *  Usada pela reconciliação (preview/confirm/reverse) e pela eliminação de
 *  movimentos. Lê o espelho via prisma (dados imutáveis nestes fluxos). */
export async function resolveDocAmountsFromDb(
  prisma: PrismaClient,
  clientId: string,
  type: 'receivable' | 'payable',
  doc: {
    status: TreasuryDocStatus
    reference: string | null
    totalAmount: number | Prisma.Decimal | null
    pendingAmount: number | Prisma.Decimal | null
    receivedAmount?: number | Prisma.Decimal | null
    paidAmount?: number | Prisma.Decimal | null
    tocSalesDocId?: string | null
    tocPurchasesDocId?: string | null
  },
): Promise<{ total: number; settled: number; pending: number; reference: string | null }> {
  const tocId = type === 'receivable' ? doc.tocSalesDocId : doc.tocPurchasesDocId
  const tocIdNum = tocId != null ? Number(tocId) : NaN
  const tocDoc = Number.isNaN(tocIdNum)
    ? null
    : type === 'receivable'
      ? await prisma.tocSalesDocument.findUnique({ where: { clientId_tocId: { clientId, tocId: tocIdNum } } })
      : await prisma.tocPurchaseDocument.findUnique({ where: { clientId_tocId: { clientId, tocId: tocIdNum } } })

  return resolveDocAmounts(
    {
      status: doc.status,
      reference: doc.reference,
      totalAmount: doc.totalAmount,
      pendingAmount: doc.pendingAmount,
      settledAmount: type === 'receivable' ? doc.receivedAmount : doc.paidAmount,
      isTocLinked: tocId != null,
    },
    tocDoc,
  )
}
