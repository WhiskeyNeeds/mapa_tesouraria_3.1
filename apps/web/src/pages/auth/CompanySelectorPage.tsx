import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { isAdmin } from '@/lib/auth'
import { Building2, Plus, AlertTriangle, X } from 'lucide-react'

interface Client { id: string; name: string; nif: string; isActive: boolean }

export default function CompanySelectorPage() {
  const { user, setSelectedClientId, logout } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const admin = isAdmin(user)

  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', nif: '' })
  const [error, setError] = useState('')

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients'),
  })

  function selectClient(id: string) {
    setSelectedClientId(id)
    navigate('/')
  }

  const createMutation = useMutation({
    mutationFn: (): Promise<Client> => api.post<Client>('/clients', form),
    onSuccess: (newClient) => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      setSelectedClientId(newClient.id)
      navigate('/')
    },
    onError: (e) => setError((e as Error).message),
  })

  function handleCreate() {
    setError('')
    createMutation.mutate()
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)' }}>
      <div className="bg-white rounded-2xl shadow-modal w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="w-10 h-10 bg-primary-500 rounded-xl flex items-center justify-center text-white font-bold text-base mx-auto mb-4 shadow-sm">T</div>
          <h1 className="text-xl font-bold text-gray-900">Selecionar empresa</h1>
          <p className="text-gray-400 text-sm mt-1">Escolha a empresa com que quer trabalhar</p>
        </div>

        {isLoading ? (
          <div className="text-center text-gray-500 py-8">A carregar...</div>
        ) : (
          <div className="space-y-2">
            {clients.map((c) => (
              <button
                key={c.id}
                onClick={() => selectClient(c.id)}
                disabled={!c.isActive}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-100 hover:border-primary-300 hover:bg-primary-50/50 transition-all duration-150 text-left disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                <div className="w-9 h-9 bg-slate-50 border border-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-4 h-4 text-gray-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 truncate">{c.name}</div>
                  <div className="text-xs text-gray-500">NIF {c.nif}{!c.isActive && ' · Inativa'}</div>
                </div>
              </button>
            ))}

            {clients.length === 0 && !showCreate && (
              <div className="text-center text-gray-400 py-6 text-sm">Sem empresas disponíveis.</div>
            )}
          </div>
        )}

        {/* Create company form (admin only) */}
        {admin && (
          <div className="mt-4">
            {!showCreate ? (
              <button
                onClick={() => setShowCreate(true)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-gray-300 text-sm text-gray-600 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Nova empresa
              </button>
            ) : (
              <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-700">Nova empresa</span>
                  <button
                    onClick={() => { setShowCreate(false); setForm({ name: '', nif: '' }); setError('') }}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nome <span className="text-red-500">*</span></label>
                  <input
                    className="input w-full text-sm"
                    placeholder="Ex: Empresa XPTO, Lda."
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">NIF <span className="text-red-500">*</span></label>
                  <input
                    className="input w-full text-sm"
                    placeholder="123456789"
                    value={form.nif}
                    onChange={(e) => setForm((f) => ({ ...f, nif: e.target.value.replace(/\D/g, '') }))}
                    maxLength={9}
                  />
                </div>
                {error && (
                  <div className="flex items-center gap-2 text-xs text-red-700 bg-white border border-red-200 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                <button
                  onClick={handleCreate}
                  disabled={!form.name.trim() || form.nif.length < 9 || createMutation.isPending}
                  className="btn-primary w-full text-sm"
                >
                  {createMutation.isPending ? 'A criar...' : 'Criar e entrar'}
                </button>
              </div>
            )}
          </div>
        )}

        <button onClick={logout} className="mt-6 w-full text-sm text-gray-500 hover:text-gray-700">
          Terminar sessão
        </button>
      </div>
    </div>
  )
}
