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

  console.log('\n🎉 Seed complete!')
  console.log(`   Admin login: admin@mapa-tesouraria.pt / admin123`)
  console.log(`   Empresa selecionável após login: ${demoClient.name}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
