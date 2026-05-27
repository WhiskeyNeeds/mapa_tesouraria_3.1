import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // ── Roles ─────────────────────────────────────────────────────────────────
  const roles = [
    { name: 'ADMIN', level: 0 },
    { name: 'TREASURY_ADMIN', level: 1 },
    { name: 'TREASURY_FINANCE', level: 2 },
    { name: 'TREASURY_VIEWER', level: 3 },
    { name: 'CLIENT', level: 10 },
  ]

  for (const role of roles) {
    await prisma.appRole.upsert({ where: { name: role.name }, update: {}, create: role })
  }
  console.log('✅ Roles created')

  // ── Admin user ─────────────────────────────────────────────────────────────
  const adminRole = await prisma.appRole.findUnique({ where: { name: 'ADMIN' } })
  const passwordHash = await bcrypt.hash('admin123', 12)

  const admin = await prisma.user.upsert({
    where: { email: 'admin@mapa-tesouraria.pt' },
    update: {},
    create: {
      name: 'Administrador',
      email: 'admin@mapa-tesouraria.pt',
      passwordHash,
      emailConfirmed: true,
      passwordSetAt: new Date(),
      userRoles: { create: { roleId: adminRole!.id } },
    },
    include: { userRoles: true },
  })
  console.log(`✅ Admin user: ${admin.email}`)

  // ── Demo company ───────────────────────────────────────────────────────────
  const demoClient = await prisma.client.upsert({
    where: { nif: '500000001' },
    update: {},
    create: {
      name: 'Empresa Demo',
      nif: '500000001',
      companyType: 'MICRO',
      countryCode: 'PT',
      isActive: true,
    },
  })

  await prisma.userClient.upsert({
    where: { userId_clientId: { userId: admin.id, clientId: demoClient.id } },
    update: {},
    create: { userId: admin.id, clientId: demoClient.id },
  })
  console.log(`✅ Empresa demo: ${demoClient.name} (NIF ${demoClient.nif})`)

  // ── Categorias de movimentos típicas portuguesas ────────────────────────────
  // Aplicadas a todos os clientes ativos (idempotente: usa @@unique [clientId, name, type]).
  // Cores escolhidas para serem visualmente distintas no dashboard.
  const defaultCategories = [
    // Receita — tons de verde/azul
    { name: 'Vendas',                 type: 'REVENUE' as const, color: '#10B981' },
    { name: 'Prestação de Serviços',  type: 'REVENUE' as const, color: '#14B8A6' },
    { name: 'Subsídios e Apoios',     type: 'REVENUE' as const, color: '#06B6D4' },
    { name: 'Juros Recebidos',        type: 'REVENUE' as const, color: '#3B82F6' },
    { name: 'Outras Receitas',        type: 'REVENUE' as const, color: '#6366F1' },
    // Despesa — tons quentes + neutros
    { name: 'Salários',               type: 'EXPENSE' as const, color: '#DC2626' },
    { name: 'Segurança Social',       type: 'EXPENSE' as const, color: '#B91C1C' },
    { name: 'Rendas',                 type: 'EXPENSE' as const, color: '#EA580C' },
    { name: 'Comunicações',           type: 'EXPENSE' as const, color: '#F59E0B' },
    { name: 'Combustível',            type: 'EXPENSE' as const, color: '#D97706' },
    { name: 'Eletricidade, Água e Gás', type: 'EXPENSE' as const, color: '#F97316' },
    { name: 'Material de Escritório', type: 'EXPENSE' as const, color: '#EC4899' },
    { name: 'Marketing e Publicidade', type: 'EXPENSE' as const, color: '#A855F7' },
    { name: 'Serviços Externos',      type: 'EXPENSE' as const, color: '#8B5CF6' },
    { name: 'Impostos e Taxas',       type: 'EXPENSE' as const, color: '#6B7280' },
    { name: 'Comissões Bancárias',    type: 'EXPENSE' as const, color: '#4B5563' },
    { name: 'Outras Despesas',        type: 'EXPENSE' as const, color: '#9CA3AF' },
  ]

  const allClients = await prisma.client.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true, name: true },
  })

  for (const client of allClients) {
    for (const cat of defaultCategories) {
      await prisma.treasuryCategory.upsert({
        where: { clientId_name_type: { clientId: client.id, name: cat.name, type: cat.type } },
        update: {},
        create: { clientId: client.id, name: cat.name, type: cat.type, color: cat.color, launchToc: false },
      })
    }
    console.log(`✅ Categorias de movimentos asseguradas para: ${client.name}`)
  }

  // ── Templates de email + regras de cobrança ─────────────────────────────────
  // 3 templates fixos (tom amigável, formal, firme). A regra escolhe um
  // aleatoriamente ao disparar — o timing é controlado pelo offsetDays da regra,
  // o tom pelo template selecionado.
  const defaultTemplates = [
    {
      name: 'Tom amigável',
      subject: 'Lembrete: fatura {{numero}}',
      bodyHtml: `<p>Caro(a) {{entidade}},</p>
<p>Esperamos que se encontre bem. Vimos por este meio lembrar que a fatura <strong>{{numero}}</strong>, no valor de <strong>{{valor}}</strong>, tem como data prometida de pagamento <strong>{{pagamento_prometido}}</strong>.</p>
<p>Caso já tenha efetuado o pagamento, agradecemos que ignore este email.</p>
<p>Com os melhores cumprimentos,<br/>A nossa equipa de Tesouraria</p>`,
    },
    {
      name: 'Tom formal',
      subject: 'Notificação de pagamento — fatura {{numero}}',
      bodyHtml: `<p>Exmo.(a) {{entidade}},</p>
<p>Servimo-nos do presente para vos notificar do compromisso de pagamento da fatura <strong>{{numero}}</strong>, no montante de <strong>{{valor}}</strong>, com data prometida de pagamento a <strong>{{pagamento_prometido}}</strong>.</p>
<p>Agradecemos a vossa atenção e ficamos ao dispor para esclarecimentos.</p>
<p>Atentamente,<br/>Departamento de Tesouraria</p>`,
    },
    {
      name: 'Tom firme',
      subject: 'AÇÃO REQUERIDA: fatura {{numero}}',
      bodyHtml: `<p>Caro(a) {{entidade}},</p>
<p>De acordo com os nossos registos, a fatura <strong>{{numero}}</strong> no valor de <strong>{{valor}}</strong> tem como data prometida de pagamento <strong>{{pagamento_prometido}}</strong>.</p>
<p>Solicitamos a sua regularização com a maior brevidade. Caso pretenda combinar um plano de pagamento, por favor contacte-nos de imediato.</p>
<p>Com os melhores cumprimentos,<br/>A nossa equipa de Tesouraria</p>`,
    },
  ] as const

  for (const client of allClients) {
    // Cria/atualiza os 3 templates fixos para este cliente (upsert: refresca
    // subject/bodyHtml em existentes para refletir alterações nesta seed).
    const tplIds: Record<string, string> = {}
    for (const tpl of defaultTemplates) {
      const existing = await prisma.treasuryEmailTemplate.findFirst({
        where: { clientId: client.id, name: tpl.name, deletedAt: null },
        select: { id: true },
      })
      if (existing) {
        await prisma.treasuryEmailTemplate.update({
          where: { id: existing.id },
          data: { subject: tpl.subject, bodyHtml: tpl.bodyHtml },
        })
        tplIds[tpl.name] = existing.id
      } else {
        const created = await prisma.treasuryEmailTemplate.create({
          data: {
            clientId: client.id,
            createdById: admin.id,
            name: tpl.name,
            scope: 'RECEIVABLE',
            subject: tpl.subject,
            bodyHtml: tpl.bodyHtml,
          },
        })
        tplIds[tpl.name] = created.id
      }
    }

    console.log(`✅ Templates de cobrança asseguradas para: ${client.name}`)
  }

  console.log('\n🎉 Seed complete!')
  console.log(`   Admin login: admin@mapa-tesouraria.pt / admin123`)
  console.log(`   Empresa selecionável após login: ${demoClient.name}`)
  console.log(`   Categorias: ${defaultCategories.length} típicas por cliente`)
  console.log(`   Templates de email: ${defaultTemplates.length} típicos por cliente`)
  console.log(`   Regras de cobrança: criadas manualmente no UI (nenhuma é seedada)`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
