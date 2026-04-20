import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { saveTokens, type TokenPair } from '@/lib/auth'
import { useAuth } from '@/contexts/AuthContext'

export default function SetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { refetch } = useAuth()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('As passwords não coincidem'); return }
    setLoading(true)
    try {
      const tokens = await api.post<TokenPair>('/auth/set-password', { token, password })
      saveTokens(tokens)
      refetch()
      navigate('/auth/empresa')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-blue-100 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-4">Definir password</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Nova password</label>
            <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>
          <div>
            <label className="label">Confirmar password</label>
            <input type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          <button type="submit" className="btn-primary w-full" disabled={loading}>{loading ? 'A guardar...' : 'Definir password'}</button>
        </form>
      </div>
    </div>
  )
}
