import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await api.post('/auth/forgot-password', { email }).catch(() => {})
    setSent(true)
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-blue-100 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Recuperar password</h1>
        {sent ? (
          <div className="bg-green-50 text-green-800 rounded-lg p-4 text-sm">
            Se o email existir, recebeu instruções para recuperar a password.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <div>
              <label className="label">Email</label>
              <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={loading}>{loading ? 'A enviar...' : 'Enviar instruções'}</button>
          </form>
        )}
        <div className="mt-4 text-center">
          <Link to="/auth/login" className="text-sm text-primary-600 hover:underline">Voltar ao login</Link>
        </div>
      </div>
    </div>
  )
}
