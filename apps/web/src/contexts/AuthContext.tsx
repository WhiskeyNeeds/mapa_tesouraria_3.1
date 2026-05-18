import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { getUser, clearTokens, type JwtUser } from '@/lib/auth'

const INACTIVITY_MS = 15 * 60 * 1000

interface AuthContextValue {
  user: JwtUser | null
  isLoading: boolean
  selectedClientId: string | null
  setSelectedClientId: (id: string) => void
  clearSelectedClientId: () => void
  logout: () => void
  refetch: () => void
  isTocEnabled: boolean
  setIsTocEnabled: (v: boolean) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<JwtUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [selectedClientId, setSelectedClientIdState] = useState<string | null>(
    localStorage.getItem('selected_client_id')
  )
  const [isTocEnabled, setIsTocEnabledState] = useState<boolean>(
    localStorage.getItem('toc_enabled') !== 'false'
  )
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refetch = useCallback(() => {
    const u = getUser()
    setUser(u)
    setIsLoading(false)
  }, [])

  useEffect(() => { refetch() }, [refetch])

  const setSelectedClientId = (id: string) => {
    localStorage.setItem('selected_client_id', id)
    setSelectedClientIdState(id)
  }

  const clearSelectedClientId = () => {
    localStorage.removeItem('selected_client_id')
    setSelectedClientIdState(null)
  }

  const setIsTocEnabled = (v: boolean) => {
    localStorage.setItem('toc_enabled', String(v))
    setIsTocEnabledState(v)
  }

  const logout = useCallback(() => {
    clearTokens()
    setUser(null)
    setSelectedClientIdState(null)
    window.location.href = '/auth/login'
  }, [])

  useEffect(() => {
    const resetTimer = () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
      inactivityTimer.current = setTimeout(() => logout(), INACTIVITY_MS)
    }

    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }))
    resetTimer()

    return () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
      events.forEach((e) => window.removeEventListener(e, resetTimer))
    }
  }, [logout])

  return (
    <AuthContext.Provider value={{ user, isLoading, selectedClientId, setSelectedClientId, clearSelectedClientId, logout, refetch, isTocEnabled, setIsTocEnabled }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
