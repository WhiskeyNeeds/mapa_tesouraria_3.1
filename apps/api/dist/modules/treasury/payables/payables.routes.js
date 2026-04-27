import { TreasuryPayablesService } from './payables.service.js';
export async function payablesRoutes(fastify) {
    const svc = new TreasuryPayablesService(fastify.prisma);
    const prefix = '/treasury/:clientId/payables';
    const auth = [fastify.authenticate, fastify.requireClientAccess];
    fastify.get(prefix, { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        const q = request.query;
        const statusValue = q.status?.includes(',')
            ? q.status.split(',')
            : q.status;
        const validSortBy = ['dueDate', 'totalAmount', 'pendingAmount', 'entityName'].includes(q.sortBy ?? '') ? q.sortBy : undefined;
        const validSortDir = q.sortDir === 'asc' || q.sortDir === 'desc' ? q.sortDir : undefined;
        return reply.send(await svc.list(clientId, {
            ...q,
            status: statusValue,
            isRecurrent: q.isRecurrent !== undefined ? q.isRecurrent === 'true' : undefined,
            sortBy: validSortBy,
            sortDir: validSortDir,
            page: q.page ? parseInt(q.page) : undefined,
            limit: q.limit ? parseInt(q.limit) : undefined,
        }));
    });
    fastify.get(`${prefix}/kpis`, { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        return reply.send(await svc.getKpis(clientId));
    });
    fastify.get(`${prefix}/export.csv`, { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        const q = request.query;
        const statusValue = q.status?.includes(',')
            ? q.status.split(',')
            : q.status;
        const { items } = await svc.list(clientId, { status: statusValue, origin: q.origin, entityName: q.entityName, categoryId: q.categoryId, dueDateFrom: q.dueDateFrom, dueDateTo: q.dueDateTo, limit: 10000, page: 1 });
        const header = 'Documento;Fornecedor;NIF;Categoria;Data Doc.;Vencimento;Total;Pendente;Pago;Estado;Origem\n';
        const pt = (n) => n.toFixed(2).replace('.', ',');
        const rows = items.map((p) => [
            p.reference,
            p.entityName,
            p.entityNif ?? '',
            p.category?.name ?? '',
            p.documentDate instanceof Date ? p.documentDate.toISOString().slice(0, 10) : String(p.documentDate),
            p.dueDate instanceof Date ? p.dueDate.toISOString().slice(0, 10) : String(p.dueDate),
            pt(Number(p.totalAmount)),
            pt(Number(p.pendingAmount)),
            pt(Number(p.paidAmount ?? 0)),
            p.status,
            p.origin,
        ].join(';')).join('\n');
        reply.header('Content-Type', 'text/csv; charset=utf-8')
            .header('Content-Disposition', 'attachment; filename="contas-a-pagar.csv"');
        return reply.send('﻿' + header + rows);
    });
    fastify.get(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
        const { clientId, id } = request.params;
        return reply.send(await svc.getById(clientId, id));
    });
    fastify.post(prefix, { onRequest: auth }, async (request, reply) => {
        const { clientId } = request.params;
        const body = request.body;
        return reply.status(201).send(await svc.create(clientId, request.user.sub, body));
    });
    fastify.patch(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
        const { clientId, id } = request.params;
        const body = request.body;
        return reply.send(await svc.update(clientId, id, body));
    });
    fastify.post(`${prefix}/:id/settle`, { onRequest: auth }, async (request, reply) => {
        const { clientId, id } = request.params;
        return reply.send(await svc.settle(clientId, id));
    });
    fastify.post(`${prefix}/:id/partial-payment`, { onRequest: auth }, async (request, reply) => {
        const { clientId, id } = request.params;
        const { amount } = request.body;
        return reply.send(await svc.partialPayment(clientId, id, amount));
    });
    fastify.post(`${prefix}/:id/void`, { onRequest: auth }, async (request, reply) => {
        const { clientId, id } = request.params;
        return reply.send(await svc.void(clientId, id));
    });
    fastify.delete(`${prefix}/:id`, { onRequest: auth }, async (request, reply) => {
        const { clientId, id } = request.params;
        await svc.delete(clientId, id);
        return reply.status(204).send();
    });
}
//# sourceMappingURL=payables.routes.js.map