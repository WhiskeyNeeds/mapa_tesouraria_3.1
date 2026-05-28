import type { PrismaClient } from '@prisma/client'
import type { ToconlineService } from '../../modules/toconline/toconline.service.js'
import {
  syncCustomers, syncSuppliers, syncProducts, syncServices,
  syncSalesDocuments, syncPurchaseDocuments, syncSalesReceipts, syncPurchasePayments,
} from './sync-entities.js'

export type EntityType =
  | 'customers' | 'suppliers' | 'products' | 'services'
  | 'salesDocuments' | 'purchaseDocuments' | 'salesReceipts' | 'purchasePayments'

export const MASTER_ENTITIES: EntityType[] = ['customers', 'suppliers', 'products', 'services']
export const TRANSACTIONAL_ENTITIES: EntityType[] = [
  'salesDocuments', 'purchaseDocuments', 'salesReceipts', 'purchasePayments',
]

export interface SyncResult {
  counts: Partial<Record<EntityType, number>>
  errors: Partial<Record<EntityType, string>>
  syncedAt: string
}

async function runEntity(
  entityType: EntityType,
  prisma: PrismaClient,
  svc: ToconlineService,
  clientId: string,
): Promise<number> {
  switch (entityType) {
    case 'customers':         return syncCustomers(prisma, svc, clientId)
    case 'suppliers':         return syncSuppliers(prisma, svc, clientId)
    case 'products':          return syncProducts(prisma, svc, clientId)
    case 'services':          return syncServices(prisma, svc, clientId)
    case 'salesDocuments':    return syncSalesDocuments(prisma, svc, clientId)
    case 'purchaseDocuments': return syncPurchaseDocuments(prisma, svc, clientId)
    case 'salesReceipts':     return syncSalesReceipts(prisma, svc, clientId)
    case 'purchasePayments':  return syncPurchasePayments(prisma, svc, clientId)
  }
}

export async function syncClientGroup(
  prisma: PrismaClient,
  svc: ToconlineService,
  clientId: string,
  group: 'master' | 'transactional',
): Promise<SyncResult> {
  const entities = group === 'master' ? MASTER_ENTITIES : TRANSACTIONAL_ENTITIES
  const counts: Partial<Record<EntityType, number>> = {}
  const errors: Partial<Record<EntityType, string>> = {}

  for (const entityType of entities) {
    try {
      const count = await runEntity(entityType, prisma, svc, clientId)
      counts[entityType] = count
      await prisma.tocSyncState.upsert({
        where: { clientId_entityType: { clientId, entityType } },
        create: { clientId, entityType, lastSyncAt: new Date(), recordCount: count, lastError: null },
        update: { lastSyncAt: new Date(), recordCount: count, lastError: null },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors[entityType] = msg
      console.error(`[TocSync] ${clientId}/${entityType} failed:`, msg)
      await prisma.tocSyncState.upsert({
        where: { clientId_entityType: { clientId, entityType } },
        create: { clientId, entityType, lastSyncAt: null, recordCount: null, lastError: msg },
        update: { lastError: msg },
      })
    }
  }

  return { counts, errors, syncedAt: new Date().toISOString() }
}

export async function syncClientFull(
  prisma: PrismaClient,
  svc: ToconlineService,
  clientId: string,
): Promise<SyncResult> {
  const [transactional, master] = await Promise.all([
    syncClientGroup(prisma, svc, clientId, 'transactional'),
    syncClientGroup(prisma, svc, clientId, 'master'),
  ])
  return {
    counts: { ...transactional.counts, ...master.counts },
    errors: { ...transactional.errors, ...master.errors },
    syncedAt: new Date().toISOString(),
  }
}
