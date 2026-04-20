import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { getUser, clearTokens, type JwtUser } from '@/lib/auth'

interface AuthContextValue {
  user: JwtUser | null
  isLoading: boolean
  selectedClientId: string | null
  setSelectedClientId: (id: string) => void
  logout: () => void
  refetch: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<JwtUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [selectedClientId, setSelectedClientIdState] = useState<string | null>(
    localStorage.getItem('selected_client_id')
  )

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

  const logout = useCallback(() => {
    clearTokens()
    setUser(null)
    setSelectedClientIdState(null)
    window.location.href = '/auth/login'
  }, [])

  return (
    <AuthContext.Provider value={{ user, isLoading, selectedClientId, setSelectedClientId, logout, refetch }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
