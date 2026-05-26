import type { PrismaClient, Prisma } from '@prisma/client'

export type AuditEntityType = 'Receivable' | 'Payable' | 'Reconciliation' | 'Budget'

export interface AuditOpts {
  clientId: string
  userId?: string | null
  action: string
  entityType: AuditEntityType
  entityId: string
  payload?: Record<string, unknown>
}

/**
 * Grava uma entrada em treasury_audit_logs.
 * Aceita tanto o prisma global como o tx interior — usar tx quando a auditoria
 * deve ser atómica com a mutação (ex: settle com cascade).
 */
export async function audit(
  prisma: PrismaClient | Prisma.TransactionClient,
  opts: AuditOpts,
): Promise<void> {
  try {
    await prisma.treasuryAuditLog.create({
      data: {
        clientId: opts.clientId,
        userId: opts.userId ?? null,
        action: opts.action,
        entityType: opts.entityType,
        entityId: opts.entityId,
        payload: (opts.payload ?? null) as Prisma.InputJsonValue | null,
      },
    })
  } catch (err) {
    console.error(`[audit] falha ao gravar ${opts.action} em ${opts.entityType}:${opts.entityId}`, err)
  }
}

// Campos internos que nunca devem aparecer no diff
const IGNORED_KEYS = new Set([
  'updatedAt', 'createdAt', 'createdById', 'clientId', 'id',
  // relações expandidas pelo include — não interessam no diff
  'category', 'recurrence', 'parent', 'children', 'reconciliationLinks',
  'followups', 'attachments', 'createdBy',
])

/**
 * Calcula o diff entre dois snapshots de uma entidade, devolvendo um objeto
 * `{ campo: { from, to } }`. Decimais e datas são normalizados para JSON.
 */
export function diffEntity<T extends Record<string, unknown>>(
  before: T,
  after: T,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {}
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const key of keys) {
    if (IGNORED_KEYS.has(key)) continue
    const a = normalize(before[key])
    const b = normalize(after[key])
    if (!equal(a, b)) {
      changes[key] = { from: a, to: b }
    }
  }
  return changes
}

function normalize(v: unknown): unknown {
  if (v === undefined) return null
  if (v === null) return null
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'object' && v !== null) {
    // Prisma Decimal expõe toString() que devolve "100.00"
    const s = (v as { toString?: () => string }).toString?.()
    if (typeof s === 'string' && /^-?\d+(\.\d+)?$/.test(s)) {
      return Number(s)
    }
    return v
  }
  return v
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.0001
  if (typeof a !== typeof b) return false
  return JSON.stringify(a) === JSON.stringify(b)
}
