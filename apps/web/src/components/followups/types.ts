export type FollowupDirection = 'RECEIVABLE' | 'PAYABLE'

export type FollowupKind = 'EMAIL_SENT' | 'CALL_TASK' | 'CALL_LOGGED' | 'NOTE' | 'AUTO_REMINDER'

export type FollowupStatus = 'PENDING' | 'DONE' | 'FAILED' | 'CANCELLED'

export type FollowupImportance = 'LOW' | 'NORMAL' | 'HIGH'

export type EmailTemplateScope = 'RECEIVABLE' | 'PAYABLE' | 'BOTH'

export interface FollowupUserRef {
  id: string
  name: string
  email?: string
}

export interface Followup {
  id: string
  clientId: string
  direction: FollowupDirection
  kind: FollowupKind
  status: FollowupStatus
  importance: FollowupImportance
  receivableId: string | null
  payableId: string | null
  title: string | null
  description: string | null
  payload: Record<string, unknown> | null
  dueAt: string | null
  completedAt: string | null
  assignedTo?: FollowupUserRef | null
  createdBy: FollowupUserRef
  assignedToId: string | null
  createdById: string
  createdAt: string
  updatedAt: string
}

export interface EmailTemplate {
  id: string
  clientId: string
  name: string
  scope: EmailTemplateScope
  subject: string
  bodyHtml: string
  isDefault: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface InvoiceAttachment {
  id: string
  clientId: string
  receivableId: string | null
  payableId: string | null
  filename: string
  mimeType: string
  size: number
  createdAt: string
  uploadedBy?: { id: string; name: string }
}

export interface FollowupDoc {
  id: string
  reference: string
  entityName: string
  totalAmount: number
  dueDate: string
  origin: 'TOC' | 'TOCONLINE' | 'LOCAL'
  tocSalesDocId?: string | null
  tocPurchasesDocId?: string | null
}

export interface FollowupVariable {
  name: string
  label: string
}

/**
 * Evento da timeline unificada (/activity) — pode vir de followups ou audit log.
 * Os campos com sufixo "?" só fazem sentido para um dos dois tipos.
 */
export interface TimelineEvent {
  id: string
  source: 'followup' | 'audit'
  kind: string
  status: string | null
  importance: string
  direction: FollowupDirection
  title: string | null
  description: string | null
  payload: Record<string, unknown> | null
  dueAt: string | null
  completedAt: string | null
  createdAt: string
  createdBy: FollowupUserRef | { id: string; name: string; email: string }
  assignedTo: FollowupUserRef | null
}
