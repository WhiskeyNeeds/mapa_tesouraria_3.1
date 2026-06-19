const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api/v1`

function getToken(): string | null {
  return localStorage.getItem('access_token')
}

// Shared refresh promise — prevents concurrent 401s from triggering multiple refresh calls.
// All requests that hit 401 simultaneously wait on the same promise; only one refresh is made.
let refreshing: Promise<boolean> | null = null
// Once a refresh fails, the session is dead: short-circuit todos os pedidos
// seguintes e redireciona uma única vez (evita a tempestade de /auth/refresh).
let sessionDead = false

function endSession() {
  if (sessionDead) return
  sessionDead = true
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  window.location.href = '/auth/login'
}

async function tryRefresh(): Promise<boolean> {
  if (sessionDead) return false
  if (refreshing) return refreshing

  refreshing = (async () => {
    const rt = localStorage.getItem('refresh_token')
    if (!rt) return false
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      })
      if (!res.ok) return false
      const data = await res.json() as { accessToken: string; refreshToken: string }
      localStorage.setItem('access_token', data.accessToken)
      localStorage.setItem('refresh_token', data.refreshToken)
      return true
    } catch {
      return false
    } finally {
      refreshing = null
    }
  })()

  return refreshing
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (sessionDead) throw new Error('Unauthorized')
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })

  if (res.status === 401) {
    const refreshed = await tryRefresh()
    if (refreshed) return request(path, init)
    endSession()
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string }
    throw new Error(err.error ?? 'Request failed')
  }

  if (res.status === 204) return undefined as unknown as T
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
}
