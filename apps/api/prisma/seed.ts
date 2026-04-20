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
  let company = await prisma.client.findFirst({ where: { nif: '500000000', deletedAt: null } })
  if (!company) {
    company = await prisma.client.create({
      data: {
        name: 'Empresa Demo Lda.',
        nif: '500000000',
        morada: 'Rua das Flores, 123',
        codigoPostal: '1200-001',
        userClients: { create: { userId: admin.id } },
      },
    })
  }
  console.log(`✅ Company: ${company.name}`)

  // ── Treasury settings ─────────────────────────────────────────────────────
  await prisma.treasurySettings.upsert({
    where: { clientId: company.id },
    update: {},
    create: { clientId: company.id, reconciliationDryRun: true, lowBalanceChannels: ['inapp', 'email'] },
  })

  // ── Categories ────────────────────────────────────────────────────────────
  const categories = [
    { name: 'Vendas de Produtos', type: 'REVENUE' as const, launchToc: true, color: '#10b981' },
    { name: 'Prestação de Serviços', type: 'REVENUE' as const, launchToc: true, color: '#3b82f6' },
    { name: 'Rendas Recebidas', type: 'REVENUE' as const, launchToc: false, color: '#8b5cf6' },
    { name: 'Outros Recebimentos', type: 'REVENUE' as const, launchToc: false, color: '#6b7280' },
    { name: 'Compras de Mercadoria', type: 'EXPENSE' as const, launchToc: true, color: '#ef4444' },
    { name: 'Fornecimentos e Serviços', type: 'EXPENSE' as const, launchToc: true, color: '#f97316' },
    { name: 'Salários', type: 'EXPENSE' as const, launchToc: false, color: '#f59e0b' },
    { name: 'Rendas Pagas', type: 'EXPENSE' as const, launchToc: false, color: '#ec4899' },
    { name: 'Leasings', type: 'EXPENSE' as const, launchToc: false, color: '#14b8a6' },
    { name: 'IRS / Impostos', type: 'EXPENSE' as const, launchToc: false, color: '#6366f1' },
    { name: 'Seguros', type: 'EXPENSE' as const, launchToc: false, color: '#64748b' },
    { name: 'Comunicações', type: 'EXPENSE' as const, launchToc: true, color: '#0ea5e9' },
  ]

  for (const cat of categories) {
    await prisma.treasuryCategory.upsert({
      where: { clientId_name: { clientId: company.id, name: cat.name } },
      update: {},
      create: { clientId: company.id, ...cat },
    })
  }
  console.log('✅ Categories created')

  // ── Bank account ──────────────────────────────────────────────────────────
  const catVendas = await prisma.treasuryCategory.findFirst({ where: { clientId: company.id, name: 'Vendas de Produtos' } })
  const catSalarios = await prisma.treasuryCategory.findFirst({ where: { clientId: company.id, name: 'Salários' } })
  const catCompras = await prisma.treasuryCategory.findFirst({ where: { clientId: company.id, name: 'Compras de Mercadoria' } })

  let bankAccount = await prisma.treasuryBankAccount.findFirst({ where: { clientId: company.id, name: 'Conta Principal CGD', deletedAt: null } })
  if (!bankAccount) {
    bankAccount = await prisma.treasuryBankAccount.create({
      data: {
        clientId: company.id,
        name: 'Conta Principal CGD',
        bankName: 'Caixa Geral de Depósitos',
        ibanLast4: '4321',
        openingBalance: 50000,
        currentBalance: 50000,
        minBalance: 5000,
      },
    })
  }
  console.log(`✅ Bank account: ${bankAccount.name}`)

  // ── Demo receivables ──────────────────────────────────────────────────────
  const receivables = [
    { entityName: 'Cliente ABC Lda.', reference: 'FT2024/001', totalAmount: 12500.00, dueDate: new Date('2024-05-15'), documentDate: new Date('2024-04-15') },
    { entityName: 'Empresa XYZ SA', reference: 'FT2024/002', totalAmount: 8750.50, dueDate: new Date('2024-06-01'), documentDate: new Date('2024-05-01') },
    { entityName: 'Serviços Beta Lda.', reference: 'FT2024/003', totalAmount: 3200.00, dueDate: new Date('2024-04-30'), documentDate: new Date('2024-04-01') },
  ]

  for (const rec of receivables) {
    const existing = await prisma.treasuryReceivable.findFirst({ where: { clientId: company.id, reference: rec.reference } })
    if (!existing) {
      await prisma.treasuryReceivable.create({
        data: {
          clientId: company.id,
          createdById: admin.id,
          categoryId: catVendas!.id,
          origin: 'TOCONLINE',
          status: 'OPEN',
          pendingAmount: rec.totalAmount,
          currency: 'EUR',
          ...rec,
        },
      })
    }
  }
  console.log('✅ Demo receivables created')

  // ── Demo payables ─────────────────────────────────────────────────────────
  const payables = [
    { entityName: 'Fornecedor Delta SA', reference: 'FC2024/001', totalAmount: 5600.00, dueDate: new Date('2024-05-20'), documentDate: new Date('2024-04-20'), categoryId: catCompras!.id },
    { entityName: 'Colaboradores', reference: 'SAL2024/04', totalAmount: 15000.00, dueDate: new Date('2024-04-30'), documentDate: new Date('2024-04-01'), categoryId: catSalarios!.id },
  ]

  for (const pay of payables) {
    const existing = await prisma.treasuryPayable.findFirst({ where: { clientId: company.id, reference: pay.reference } })
    if (!existing) {
      await prisma.treasuryPayable.create({
        data: {
          clientId: company.id,
          createdById: admin.id,
          origin: pay.categoryId === catSalarios!.id ? 'LOCAL' : 'TOCONLINE',
          status: 'OPEN',
          pendingAmount: pay.totalAmount,
          currency: 'EUR',
          entityName: pay.entityName,
          reference: pay.reference,
          totalAmount: pay.totalAmount,
          dueDate: pay.dueDate,
          documentDate: pay.documentDate,
          categoryId: pay.categoryId,
        },
      })
    }
  }
  console.log('✅ Demo payables created')

  // ── Demo bank movements ────────────────────────────────────────────────────
  const { createHash } = await import('crypto')
  const movementsData = [
    { date: new Date('2024-04-01'), amount: 12500.00, description: 'Transferência recebida - Cliente ABC' },
    { date: new Date('2024-04-05'), amount: -5600.00, description: 'Pagamento fornecedor Delta' },
    { date: new Date('2024-04-10'), amount: 8750.50, description: 'Recebimento Empresa XYZ' },
    { date: new Date('2024-04-15'), amount: -15000.00, description: 'Salários Abril 2024' },
    { date: new Date('2024-04-18'), amount: -1200.00, description: 'Seguro multirriscos' },
    { date: new Date('2024-04-20'), amount: 3200.00, description: 'Recebimento Serviços Beta' },
  ]

  for (const mov of movementsData) {
    const hash = createHash('sha256').update(`${company.id}|${bankAccount.id}|${mov.date.toISOString()}|${mov.amount}|${mov.description}`).digest('hex')
    const existing = await prisma.treasuryBankMovement.findUnique({ where: { clientId_dedupeHash: { clientId: company.id, dedupeHash: hash } } })
    if (!existing) {
      await prisma.treasuryBankMovement.create({
        data: {
          clientId: company.id,
          bankAccountId: bankAccount.id,
          date: mov.date,
          amount: mov.amount,
          description: mov.description,
          normalizedDesc: mov.description.toLowerCase(),
          source: 'MANUAL',
          dedupeHash: hash,
          status: 'UNCLASSIFIED',
        },
      })
    }
  }

  // Recalc balance
  const agg = await prisma.treasuryBankMovement.aggregate({
    where: { bankAccountId: bankAccount.id, deletedAt: null },
    _sum: { amount: true },
  })
  await prisma.treasuryBankAccount.update({
    where: { id: bankAccount.id },
    data: { currentBalance: 50000 + Number(agg._sum.amount ?? 0) },
  })
  console.log('✅ Demo bank movements created')

  console.log('\n🎉 Seed complete!')
  console.log(`   Admin login: admin@mapa-tesouraria.pt / admin123`)
  console.log(`   Company ID: ${company.id}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
