const BASE = '/api/v1'

function getToken(): string | null {
  return localStorage.getItem('access_token')
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
    // Try refresh
    const rt = localStorage.getItem('refresh_token')
    if (rt) {
      const refreshRes = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: rt }),
      })
      if (refreshRes.ok) {
        const data = await refreshRes.json() as { accessToken: string; refreshToken: string }
        localStorage.setItem('access_token', data.accessToken)
        localStorage.setItem('refresh_token', data.refreshToken)
        return request(path, init)
      }
    }
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    window.location.href = '/auth/login'
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
