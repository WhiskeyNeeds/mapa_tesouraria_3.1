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

  // ── Categorias de tesouraria ───────────────────────────────────────────────
  // Templates partilhados; o ID real é prefixado com os últimos 8 chars do clientId
  // para que o upsert seja idempotente e funcione para qualquer empresa.
  type CatTemplate = {
    key: string
    name: string
    type: 'REVENUE' | 'EXPENSE'
    parentKey?: string
    color?: string
  }

  const categoryTemplates: CatTemplate[] = [
    // ── RECEITAS (Contas a Receber) ──────────────────────────────────────────
    { key: 'rev-01',    name: 'Vendas de Mercadorias',          type: 'REVENUE', color: '#16a34a' },
    { key: 'rev-01-01', name: 'Vendas Nacionais',               type: 'REVENUE', parentKey: 'rev-01' },
    { key: 'rev-01-02', name: 'Vendas Internacionais',          type: 'REVENUE', parentKey: 'rev-01' },
    { key: 'rev-02',    name: 'Prestações de Serviços',         type: 'REVENUE', color: '#0ea5e9' },
    { key: 'rev-02-01', name: 'Consultoria',                    type: 'REVENUE', parentKey: 'rev-02' },
    { key: 'rev-02-02', name: 'Manutenção e Assistência',       type: 'REVENUE', parentKey: 'rev-02' },
    { key: 'rev-03',    name: 'Rendimentos Financeiros',        type: 'REVENUE', color: '#7c3aed' },
    { key: 'rev-03-01', name: 'Juros e Similares',              type: 'REVENUE', parentKey: 'rev-03' },
    { key: 'rev-03-02', name: 'Ganhos Cambiais',                type: 'REVENUE', parentKey: 'rev-03' },
    { key: 'rev-04',    name: 'Outros Rendimentos',             type: 'REVENUE', color: '#84cc16' },
    { key: 'rev-04-01', name: 'Subsídios à Exploração',         type: 'REVENUE', parentKey: 'rev-04' },
    { key: 'rev-04-02', name: 'Outros Proveitos',               type: 'REVENUE', parentKey: 'rev-04' },

    // ── GASTOS (Contas a Pagar) ──────────────────────────────────────────────
    { key: 'exp-01',    name: 'Fornecedores e Compras',            type: 'EXPENSE', color: '#dc2626' },
    { key: 'exp-01-01', name: 'Mercadorias e Matérias-Primas',     type: 'EXPENSE', parentKey: 'exp-01' },
    { key: 'exp-01-02', name: 'Outros Fornecedores',               type: 'EXPENSE', parentKey: 'exp-01' },
    { key: 'exp-02',    name: 'Gastos com Pessoal',                type: 'EXPENSE', color: '#ea580c' },
    { key: 'exp-02-01', name: 'Salários e Remunerações',           type: 'EXPENSE', parentKey: 'exp-02' },
    { key: 'exp-02-02', name: 'Segurança Social',                  type: 'EXPENSE', parentKey: 'exp-02' },
    { key: 'exp-02-03', name: 'Seguros de Acidentes de Trabalho',  type: 'EXPENSE', parentKey: 'exp-02' },
    { key: 'exp-02-04', name: 'Formação e Desenvolvimento',        type: 'EXPENSE', parentKey: 'exp-02' },
    { key: 'exp-03',    name: 'Serviços Externos',                 type: 'EXPENSE', color: '#d97706' },
    { key: 'exp-03-01', name: 'Rendas e Alugueres',                type: 'EXPENSE', parentKey: 'exp-03' },
    { key: 'exp-03-02', name: 'Comunicações',                      type: 'EXPENSE', parentKey: 'exp-03' },
    { key: 'exp-03-03', name: 'Transportes e Deslocações',         type: 'EXPENSE', parentKey: 'exp-03' },
    { key: 'exp-03-04', name: 'Contabilidade e Auditoria',         type: 'EXPENSE', parentKey: 'exp-03' },
    { key: 'exp-03-05', name: 'Publicidade e Marketing',           type: 'EXPENSE', parentKey: 'exp-03' },
    { key: 'exp-03-06', name: 'Serviços de Tecnologia',            type: 'EXPENSE', parentKey: 'exp-03' },
    { key: 'exp-04',    name: 'Encargos Fiscais',                  type: 'EXPENSE', color: '#9333ea' },
    { key: 'exp-04-01', name: 'IVA',                               type: 'EXPENSE', parentKey: 'exp-04' },
    { key: 'exp-04-02', name: 'IRC / IRS',                         type: 'EXPENSE', parentKey: 'exp-04' },
    { key: 'exp-04-03', name: 'IMI e Outros Impostos',             type: 'EXPENSE', parentKey: 'exp-04' },
    { key: 'exp-05',    name: 'Gastos Financeiros',                type: 'EXPENSE', color: '#0891b2' },
    { key: 'exp-05-01', name: 'Juros de Empréstimos',              type: 'EXPENSE', parentKey: 'exp-05' },
    { key: 'exp-05-02', name: 'Comissões Bancárias',               type: 'EXPENSE', parentKey: 'exp-05' },
    { key: 'exp-05-03', name: 'Leasing e Locação Financeira',      type: 'EXPENSE', parentKey: 'exp-05' },
    { key: 'exp-06',    name: 'Outros Gastos',                     type: 'EXPENSE', color: '#64748b' },
    { key: 'exp-06-01', name: 'Amortizações e Depreciações',       type: 'EXPENSE', parentKey: 'exp-06' },
    { key: 'exp-06-02', name: 'Gastos Extraordinários',            type: 'EXPENSE', parentKey: 'exp-06' },
  ]

  const parentTemplates = categoryTemplates.filter(c => !c.parentKey)
  const childTemplates  = categoryTemplates.filter(c =>  c.parentKey)

  async function seedCategoriesForClient(clientId: string, clientName: string) {
    for (const cat of parentTemplates) {
      await prisma.treasuryCategory.upsert({
        where:  { clientId_name_type: { clientId, name: cat.name, type: cat.type } },
        update: { color: cat.color },
        create: { clientId, name: cat.name, type: cat.type, color: cat.color },
      })
    }
    console.log(`✅ ${parentTemplates.length} categorias → ${clientName}`)
  }

  // Seed para todos os clientes activos na base de dados
  const allClients = await prisma.client.findMany({ where: { isActive: true } })
  for (const client of allClients) {
    await seedCategoriesForClient(client.id, client.name)
  }

  console.log('\n🎉 Seed complete!')
  console.log(`   Admin login: admin@mapa-tesouraria.pt / admin123`)
  console.log(`   Empresa selecionável após login: ${demoClient.name}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
