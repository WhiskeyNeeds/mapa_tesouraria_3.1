import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

const clientId = 'cmo6xfa4e00068gofmysh2lec'

// Get admin user id
const admin = await prisma.user.findFirst({ where: { email: 'admin@mapa-tesouraria.pt' } })
if (!admin) { console.error('Admin user not found'); process.exit(1) }

// Get or create active bank account
let bankAccount = await prisma.treasuryBankAccount.findFirst({
  where: { clientId, isActive: true, deletedAt: null }
})
if (!bankAccount) {
  bankAccount = await prisma.treasuryBankAccount.create({
    data: {
      clientId,
      name: 'Conta Teste CGD',
      bankName: 'CGD',
      iban: 'PT50003500000000000000000',
      currency: 'EUR',
      isActive: true,
      currentBalance: 10000,
    }
  })
}
console.log('✅ Conta bancária:', bankAccount.name)

// Get categories
let revCat = await prisma.treasuryCategory.findFirst({ where: { clientId, type: 'REVENUE', deletedAt: null } })
if (!revCat) {
  revCat = await prisma.treasuryCategory.create({
    data: { clientId, name: 'Vendas', type: 'REVENUE', color: '#16a34a', launchToc: false }
  })
}
let expCat = await prisma.treasuryCategory.findFirst({ where: { clientId, type: 'EXPENSE', deletedAt: null } })
if (!expCat) {
  expCat = await prisma.treasuryCategory.create({
    data: { clientId, name: 'Compras', type: 'EXPENSE', color: '#dc2626', launchToc: false }
  })
}
console.log('✅ Categorias:', revCat.name, '/', expCat.name)

// Create classified credit movement (entrada)
const creditMov = await prisma.treasuryBankMovement.create({
  data: {
    clientId,
    bankAccountId: bankAccount.id,
    date: new Date('2026-05-02'),
    amount: 1234.56,
    description: 'TRANSF. RECEBIDA CLIENTE TESTE',
    normalizedDesc: 'transf. recebida cliente teste',
    status: 'CLASSIFIED',
    categoryId: revCat.id,
    source: 'MANUAL',
    dedupeHash: `test-credit-${Date.now()}`,
  }
})
console.log('✅ Movimento crédito:', creditMov.description, '+' + creditMov.amount)

// Create classified debit movement (saída)
const debitMov = await prisma.treasuryBankMovement.create({
  data: {
    clientId,
    bankAccountId: bankAccount.id,
    date: new Date('2026-05-03'),
    amount: -567.89,
    description: 'PAGAMENTO FORNECEDOR TESTE',
    normalizedDesc: 'pagamento fornecedor teste',
    status: 'CLASSIFIED',
    categoryId: expCat.id,
    source: 'MANUAL',
    dedupeHash: `test-debit-${Date.now()}`,
  }
})
console.log('✅ Movimento débito:', debitMov.description, debitMov.amount)

// Create open receivable
const receivable = await prisma.treasuryReceivable.create({
  data: {
    clientId,
    categoryId: revCat.id,
    createdById: admin.id,
    entityName: 'Cliente Teste Lda.',
    reference: 'FT2026/TEST-001',
    documentDate: new Date('2026-04-15'),
    dueDate: new Date('2026-05-15'),
    totalAmount: 1234.56,
    receivedAmount: 0,
    pendingAmount: 1234.56,
    status: 'OPEN',
    origin: 'LOCAL',
    currency: 'EUR',
  }
})
console.log('✅ Conta a receber:', receivable.reference, receivable.pendingAmount)

// Create open payable
const payable = await prisma.treasuryPayable.create({
  data: {
    clientId,
    categoryId: expCat.id,
    createdById: admin.id,
    entityName: 'Fornecedor Teste Unipessoal',
    reference: 'FC2026/TEST-001',
    documentDate: new Date('2026-04-20'),
    dueDate: new Date('2026-05-20'),
    totalAmount: 567.89,
    paidAmount: 0,
    pendingAmount: 567.89,
    status: 'OPEN',
    origin: 'LOCAL',
    currency: 'EUR',
  }
})
console.log('✅ Conta a pagar:', payable.reference, payable.pendingAmount)

console.log('\n🎉 Dados de teste criados com sucesso!')
console.log('   Abre /reconciliacao para ver os dados.')
await prisma.$disconnect()
