import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'crypto'
import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import type { JwtPayload } from '../../plugins/auth.js'
import { httpError } from '../../lib/errors.js'
import { sendEmail } from '../../plugins/email.js'

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

const BCRYPT_ROUNDS = 12

/** Hash determinístico (SHA-256) do refresh token — guardamos só o hash na BD. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export class AuthService {
  constructor(
    private prisma: PrismaClient,
    private fastify: FastifyInstance,
  ) {}

  private async buildPayload(userId: string): Promise<Omit<JwtPayload, 'type'>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: { include: { role: true } },
        userClients: { select: { clientId: true } },
      },
    })
    if (!user) throw httpError(404, 'User not found')

    return {
      sub: user.id,
      name: user.name,
      email: user.email,
      roles: user.userRoles.map((ur) => ({ name: ur.role.name, level: ur.role.level })),
      clientIds: user.userClients.map((uc) => uc.clientId),
    }
  }

  private async issueTokens(userId: string): Promise<TokenPair> {
    const payload = await this.buildPayload(userId)
    const expiresIn = this.parseExpiry(process.env.JWT_EXPIRES_IN ?? '15m')
    const refreshExpiresIn = this.parseExpiry(process.env.JWT_REFRESH_EXPIRES_IN ?? '7d')

    const accessToken = this.fastify.jwt.sign({ ...payload, type: 'access' }, { expiresIn: process.env.JWT_EXPIRES_IN ?? '15m' })
    const refreshToken = this.fastify.jwt.sign({ ...payload, type: 'refresh' }, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d' })

    // Persiste o refresh token (hash) na BD — durável, sobrevive a reinícios e
    // suporta vários em simultâneo (multi-separador). Limpa expirados do utilizador.
    await this.prisma.refreshToken.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } })
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: hashToken(refreshToken), expiresAt: new Date(Date.now() + refreshExpiresIn * 1000) },
    })

    return { accessToken, refreshToken, expiresIn }
  }

  private parseExpiry(exp: string): number {
    const unit = exp.slice(-1)
    const value = parseInt(exp.slice(0, -1), 10)
    if (unit === 'm') return value * 60
    if (unit === 'h') return value * 3600
    if (unit === 'd') return value * 86400
    return value
  }

  async login(dto: { email: string; password: string }): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } })
    if (!user || !user.passwordHash) throw httpError(401, 'Invalid credentials')
    if (!user.isActive || user.deletedAt) throw httpError(401, 'Account inactive')
    if (!user.emailConfirmed) throw httpError(403, 'Email not confirmed. Check your inbox.')

    const valid = await bcrypt.compare(dto.password, user.passwordHash)
    if (!valid) throw httpError(401, 'Invalid credentials')

    return this.issueTokens(user.id)
  }

  async register(dto: { name: string; email: string; password: string; phone?: string }): Promise<TokenPair> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } })
    if (existing) throw httpError(409, 'Email already in use')

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS)
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email.toLowerCase(),
        passwordHash,
        phone: dto.phone,
        emailConfirmed: true,
        passwordSetAt: new Date(),
      },
    })

    return this.issueTokens(user.id)
  }

  async refresh(token: string): Promise<TokenPair> {
    let payload: JwtPayload
    try {
      payload = this.fastify.jwt.verify<JwtPayload>(token)
    } catch {
      throw httpError(401, 'Invalid refresh token')
    }

    if (payload.type !== 'refresh') throw httpError(401, 'Invalid token type')

    // Rotação: o token tem de existir na BD (não revogado/rodado) e estar válido.
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) } })
    if (!row || row.expiresAt < new Date()) throw httpError(401, 'Refresh token revoked')
    await this.prisma.refreshToken.delete({ where: { id: row.id } })

    return this.issueTokens(payload.sub)
  }

  async logout(userId: string): Promise<void> {
    await this.prisma.refreshToken.deleteMany({ where: { userId } })
  }

  async setPassword(token: string, password: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { inviteToken: token } })
    if (!user || !user.inviteTokenExpiresAt) throw httpError(400, 'Invalid or expired token')
    if (user.inviteTokenExpiresAt < new Date()) throw httpError(400, 'Token expired')

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        passwordSetAt: new Date(),
        emailConfirmed: true,
        inviteToken: null,
        inviteTokenExpiresAt: null,
        inviteTokenPurpose: null,
      },
    })

    return this.issueTokens(user.id)
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } })
    // Always return 200 to not reveal user existence
    if (!user || !user.isActive || user.deletedAt) return

    const token = randomBytes(32).toString('hex')
    const purpose = user.passwordSetAt ? 'reset' : 'invite'

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        inviteToken: token,
        inviteTokenExpiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
        inviteTokenPurpose: purpose,
      },
    })

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173'
    const link = `${frontendUrl}/auth/set-password?token=${token}`
    const subject = purpose === 'invite' ? 'Bem-vindo ao Mapa de Tesouraria' : 'Recuperar password'
    const html = purpose === 'invite'
      ? `<p>Olá ${user.name},</p><p>Clique <a href="${link}">aqui</a> para definir a sua password.</p>`
      : `<p>Olá ${user.name},</p><p>Clique <a href="${link}">aqui</a> para redefinir a sua password.</p>`

    await sendEmail({ to: user.email, subject, html })
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user?.passwordHash) throw httpError(400, 'No password set')

    const valid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!valid) throw httpError(400, 'Current password incorrect')

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } })
  }
}
