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

  console.log('\n🎉 Seed complete!')
  console.log(`   Admin login: admin@mapa-tesouraria.pt / admin123`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
