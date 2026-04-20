import { api } from './api'

export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export interface JwtUser {
  sub: string
  name: string
  email: string
  roles: Array<{ name: string; level: number }>
  clientIds: string[]
}

function parseJwt(token: string): JwtUser | null {
  try {
    const payload = token.split('.')[1]
    return JSON.parse(atob(payload)) as JwtUser
  } catch {
    return null
  }
}

export function saveTokens(tokens: TokenPair) {
  localStorage.setItem('access_token', tokens.accessToken)
  localStorage.setItem('refresh_token', tokens.refreshToken)
}

export function clearTokens() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  localStorage.removeItem('selected_client_id')
}

export function getUser(): JwtUser | null {
  const token = localStorage.getItem('access_token')
  if (!token) return null
  return parseJwt(token)
}

export function isAdmin(user: JwtUser | null): boolean {
  return user?.roles.some((r) => r.level === 0) ?? false
}

export async function login(email: string, password: string): Promise<TokenPair> {
  const tokens = await api.post<TokenPair>('/auth/login', { email, password })
  saveTokens(tokens)
  return tokens
}

export async function logout(): Promise<void> {
  await api.post('/auth/logout').catch(() => {})
  clearTokens()
}

export function getSelectedClientId(): string | null {
  return localStorage.getItem('selected_client_id')
}

export function setSelectedClientId(id: string) {
  localStorage.setItem('selected_client_id', id)
}
