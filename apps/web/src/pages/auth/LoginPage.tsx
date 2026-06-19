import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { login } from '@/lib/auth'
import { useAuth } from '@/contexts/AuthContext'
import { Eye, EyeOff } from 'lucide-react'

export default function LoginPage() {
  const navigate = useNavigate()
  const { refetch } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(email, password)
      refetch()
      navigate('/auth/empresa')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao iniciar sessão')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)' }}>
      {/* Left panel — branding */}
      <div className="hidden lg:flex flex-col justify-between w-2/5 p-12 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(ellipse at 30% 50%, rgba(59,130,246,0.12) 0%, transparent 60%)',
        }} />
        <div className="relative">
          <div className="w-10 h-10 bg-primary-500 rounded-xl flex items-center justify-center shadow-lg mb-8">
            <span className="text-white font-bold text-base leading-none">T</span>
          </div>
          <h1 className="text-3xl font-bold text-white leading-snug">Mapa de<br />Tesouraria</h1>
          <p className="mt-3 text-slate-400 text-sm leading-relaxed max-w-xs">
            Gestão integrada de tesouraria, contas a receber e a pagar, com ligação direta ao TOConline.
          </p>
        </div>
        <p className="relative text-xs text-slate-600">© {new Date().getFullYear()} Mapa de Tesouraria</p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-modal w-full max-w-sm p-8">
          {/* Mobile logo */}
          <div className="flex lg:hidden justify-center mb-6">
            <div className="w-10 h-10 bg-primary-600 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-base leading-none">T</span>
            </div>
          </div>

          <div className="mb-7">
            <h2 className="text-xl font-bold text-gray-900">Bem-vindo de volta</h2>
            <p className="text-gray-400 text-sm mt-1">Inicie sessão para continuar</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label">Email</label>
              <input
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@empresa.pt"
                autoComplete="email"
                required
              />
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4 text-primary-600" /> : <Eye className="w-4 h-4 text-primary-600" />}
                </button>
              </div>
              {/* Link colocado depois do input no DOM (apesar de aparecer visualmente
                  alinhado com o label) para que o TAB vá: email → password → link. */}
              <Link to="/auth/forgot-password" className="absolute top-0 right-0 text-xs text-primary-600 hover:text-primary-700 font-medium">
                Esqueceu-se da palavra-passe?
              </Link>
            </div>

            {error && (
              <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">{error}</p>
            )}

            <button type="submit" className="btn-primary w-full mt-2" disabled={loading}>
              {loading ? 'A entrar...' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
