import { httpError } from '../../../lib/errors.js';
import { ToconlineService } from '../../toconline/toconline.service.js';
export class TreasuryReconciliationsService {
    prisma;
    tocSvc;
    constructor(prisma) {
        this.prisma = prisma;
        this.tocSvc = new ToconlineService(prisma);
    }
    async list(clientId, filters) {
        const { page = 1, limit = 20, status } = filters;
        const where = { clientId, ...(status ? { status: status } : {}) };
        const [total, items] = await Promise.all([
            this.prisma.treasuryReconciliation.count({ where }),
            this.prisma.treasuryReconciliation.findMany({
                where,
                include: {
                    movements: { include: { movement: { select: { id: true, date: true, amount: true, description: true } } } },
                    receivables: { include: { receivable: { select: { id: true, reference: true, entityName: true, pendingAmount: true } } } },
                    payables: { include: { payable: { select: { id: true, reference: true, entityName: true, pendingAmount: true } } } },
                    createdBy: { select: { id: true, name: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
        ]);
        return { total, page, limit, items };
    }
    async getById(clientId, id) {
        const item = await this.prisma.treasuryReconciliation.findFirst({
            where: { id, clientId },
            include: {
                movements: { include: { movement: true } },
                receivables: { include: { receivable: { include: { category: true } } } },
                payables: { include: { payable: { include: { category: true } } } },
                createdBy: { select: { id: true, name: true } },
                reversedBy: { select: { id: true, name: true } },
            },
        });
        if (!item)
            throw httpError(404, 'Reconciliation not found');
        return item;
    }
    async preview(clientId, data) {
        const movements = await this.prisma.treasuryBankMovement.findMany({
            where: { id: { in: data.movementIds }, clientId, deletedAt: null },
        });
        if (movements.length !== data.movementIds.length)
            throw httpError(404, 'One or more movements not found');
        const hasPositive = movements.some((m) => Number(m.amount) > 0);
        const hasNegative = movements.some((m) => Number(m.amount) < 0);
        if (hasPositive && hasNegative)
            throw httpError(400, 'Não é possível misturar movimentos de entrada e saída na mesma reconciliação');
        const totalMovements = movements.reduce((sum, m) => sum + Number(m.amount), 0);
        const direction = totalMovements >= 0 ? 'REVENUE' : 'EXPENSE';
        // Validate allocations
        let totalAllocated = 0;
        const allocDetails = [];
        for (const alloc of data.allocations) {
            const doc = alloc.type === 'receivable'
                ? await this.prisma.treasuryReceivable.findFirst({ where: { id: alloc.id, clientId, deletedAt: null }, include: { category: true } })
                : await this.prisma.treasuryPayable.findFirst({ where: { id: alloc.id, clientId, deletedAt: null }, include: { category: true } });
            if (!doc)
                throw httpError(404, `Document ${alloc.id} not found`);
            if (alloc.amount <= 0)
                throw httpError(400, `Allocation amount must be positive`);
            if (alloc.amount > Number(doc.pendingAmount))
                throw httpError(400, `Allocation ${alloc.amount} exceeds pending ${doc.pendingAmount} for ${doc.reference}`);
            totalAllocated += alloc.amount;
            allocDetails.push({ ...alloc, doc, launchToc: doc.category.launchToc });
        }
        if (Math.abs(totalAllocated - Math.abs(totalMovements)) > 0.01) {
            throw httpError(400, `Allocated (${totalAllocated}) must equal movements total (${Math.abs(totalMovements)})`);
        }
        const tocActions = allocDetails.filter((a) => a.launchToc).map((a) => ({
            type: a.type,
            reference: a.doc.reference,
            amount: a.amount,
        }));
        return { direction, totalMovements: Math.abs(totalMovements), totalAllocated, tocActions, isDryRun: data.isDryRun ?? true };
    }
    async isDryRunForClient(clientId, explicitValue) {
        if (explicitValue !== undefined)
            return explicitValue;
        const settings = await this.prisma.treasurySettings.findUnique({ where: { clientId } });
        return settings?.reconciliationDryRun ?? true;
    }
    async confirm(clientId, userId, data) {
        const isDryRun = await this.isDryRunForClient(clientId, data.isDryRun);
        const preview = await this.preview(clientId, { ...data, isDryRun });
        return this.prisma.$transaction(async (tx) => {
            const recon = await tx.treasuryReconciliation.create({
                data: {
                    clientId,
                    createdById: userId,
                    direction: preview.direction,
                    isDryRun,
                    status: 'CONFIRMED',
                    totalMovements: preview.totalMovements,
                    totalAllocated: preview.totalAllocated,
                },
            });
            // Link movements
            for (const movId of data.movementIds) {
                const mov = await tx.treasuryBankMovement.findUnique({ where: { id: movId } });
                if (!mov)
                    continue;
                await tx.treasuryReconciliationMovement.create({
                    data: { reconciliationId: recon.id, movementId: movId, amount: Number(mov.amount) },
                });
                await tx.treasuryBankMovement.update({
                    where: { id: movId },
                    data: {
                        reconciledAmount: { increment: Math.abs(Number(mov.amount)) },
                        status: 'RECONCILED',
                    },
                });
            }
            // Link and process allocations
            let tocReceipts = 0;
            let tocPayments = 0;
            let tocFirstError;
            for (const alloc of data.allocations) {
                const launchToc = alloc.type === 'receivable'
                    ? (await tx.treasuryReceivable.findUnique({ where: { id: alloc.id }, include: { category: true } }))?.category.launchToc
                    : (await tx.treasuryPayable.findUnique({ where: { id: alloc.id }, include: { category: true } }))?.category.launchToc;
                if (alloc.type === 'receivable') {
                    let tocReceiptId;
                    let tocError;
                    if (launchToc && !isDryRun) {
                        try {
                            const result = await this.tocSvc.createSalesReceipt(clientId, {
                                sales_document_id: (await tx.treasuryReceivable.findUnique({ where: { id: alloc.id } }))?.tocSalesDocId,
                                value: alloc.amount,
                            });
                            tocReceiptId = String(result?.id);
                            tocReceipts++;
                        }
                        catch (err) {
                            tocError = err instanceof Error ? err.message : 'TOConline error';
                            if (!tocFirstError)
                                tocFirstError = tocError;
                        }
                    }
                    await tx.treasuryReconciliationReceivable.create({
                        data: { reconciliationId: recon.id, receivableId: alloc.id, amountAllocated: alloc.amount, tocReceiptId, tocError },
                    });
                    const rec = await tx.treasuryReceivable.findUnique({ where: { id: alloc.id } });
                    if (rec) {
                        const newReceived = Number(rec.receivedAmount) + alloc.amount;
                        const newPending = Number(rec.totalAmount) - newReceived;
                        await tx.treasuryReceivable.update({
                            where: { id: alloc.id },
                            data: {
                                receivedAmount: newReceived,
                                pendingAmount: Math.max(0, newPending),
                                status: newPending <= 0.01 ? 'SETTLED' : 'PARTIAL',
                            },
                        });
                    }
                }
                else {
                    let tocPaymentId;
                    let tocError;
                    if (launchToc && !isDryRun) {
                        try {
                            const result = await this.tocSvc.createPurchasePayment(clientId, {
                                purchases_document_id: (await tx.treasuryPayable.findUnique({ where: { id: alloc.id } }))?.tocPurchasesDocId,
                                value: alloc.amount,
                            });
                            tocPaymentId = String(result?.id);
                            tocPayments++;
                        }
                        catch (err) {
                            tocError = err instanceof Error ? err.message : 'TOConline error';
                            if (!tocFirstError)
                                tocFirstError = tocError;
                        }
                    }
                    await tx.treasuryReconciliationPayable.create({
                        data: { reconciliationId: recon.id, payableId: alloc.id, amountAllocated: alloc.amount, tocPaymentId, tocError },
                    });
                    const pay = await tx.treasuryPayable.findUnique({ where: { id: alloc.id } });
                    if (pay) {
                        const newPaid = Number(pay.paidAmount) + alloc.amount;
                        const newPending = Number(pay.totalAmount) - newPaid;
                        await tx.treasuryPayable.update({
                            where: { id: alloc.id },
                            data: {
                                paidAmount: newPaid,
                                pendingAmount: Math.max(0, newPending),
                                status: newPending <= 0.01 ? 'SETTLED' : 'PARTIAL',
                            },
                        });
                    }
                }
            }
            await tx.treasuryReconciliation.update({
                where: { id: recon.id },
                data: { tocReceiptsCreated: tocReceipts, tocPaymentsCreated: tocPayments, tocFirstError },
            });
            // Audit log
            await tx.treasuryAuditLog.create({
                data: {
                    clientId,
                    userId,
                    action: 'reconciliation.confirm',
                    entityType: 'Reconciliation',
                    entityId: recon.id,
                    payload: { isDryRun, movementsCount: data.movementIds.length, allocationsCount: data.allocations.length },
                },
            });
            return tx.treasuryReconciliation.findUnique({ where: { id: recon.id } });
        });
    }
    async reverse(clientId, reconciliationId, userId, reason) {
        const recon = await this.getById(clientId, reconciliationId);
        if (recon.status !== 'CONFIRMED')
            throw httpError(409, 'Only confirmed reconciliations can be reversed');
        return this.prisma.$transaction(async (tx) => {
            // Reverse movements
            for (const link of recon.movements) {
                await tx.treasuryBankMovement.update({
                    where: { id: link.movementId },
                    data: { reconciledAmount: { decrement: Math.abs(Number(link.amount)) }, status: 'CLASSIFIED' },
                });
            }
            // Reverse receivables
            for (const link of recon.receivables) {
                const rec = await tx.treasuryReceivable.findUnique({ where: { id: link.receivableId } });
                if (rec) {
                    const newReceived = Math.max(0, Number(rec.receivedAmount) - Number(link.amountAllocated));
                    await tx.treasuryReceivable.update({
                        where: { id: link.receivableId },
                        data: {
                            receivedAmount: newReceived,
                            pendingAmount: Number(rec.totalAmount) - newReceived,
                            status: newReceived <= 0 ? 'OPEN' : 'PARTIAL',
                        },
                    });
                }
            }
            // Reverse payables
            for (const link of recon.payables) {
                const pay = await tx.treasuryPayable.findUnique({ where: { id: link.payableId } });
                if (pay) {
                    const newPaid = Math.max(0, Number(pay.paidAmount) - Number(link.amountAllocated));
                    await tx.treasuryPayable.update({
                        where: { id: link.payableId },
                        data: {
                            paidAmount: newPaid,
                            pendingAmount: Number(pay.totalAmount) - newPaid,
                            status: newPaid <= 0 ? 'OPEN' : 'PARTIAL',
                        },
                    });
                }
            }
            await tx.treasuryReconciliation.update({
                where: { id: reconciliationId },
                data: { status: 'REVERSED', reversedAt: new Date(), reversedById: userId, reversedReason: reason },
            });
            await tx.treasuryAuditLog.create({
                data: { clientId, userId, action: 'reconciliation.reverse', entityType: 'Reconciliation', entityId: reconciliationId, payload: { reason } },
            });
        });
    }
}
//# sourceMappingURL=reconciliations.service.js.map