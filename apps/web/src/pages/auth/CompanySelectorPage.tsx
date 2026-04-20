import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { Building2 } from 'lucide-react'

interface Client { id: string; name: string; nif: string; isActive: boolean }

export default function CompanySelectorPage() {
  const { setSelectedClientId, logout } = useAuth()
  const navigate = useNavigate()

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients'),
  })

  function selectClient(id: string) {
    setSelectedClientId(id)
    navigate('/')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary-50 to-blue-100 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="w-12 h-12 bg-primary-600 rounded-xl flex items-center justify-center text-white font-bold text-xl mx-auto mb-4">T</div>
          <h1 className="text-2xl font-bold text-gray-900">Selecionar empresa</h1>
          <p className="text-gray-500 text-sm mt-1">Escolha a empresa com que quer trabalhar</p>
        </div>

        {isLoading ? (
          <div className="text-center text-gray-500 py-8">A carregar...</div>
        ) : clients.length === 0 ? (
          <div className="text-center text-gray-500 py-8">Sem empresas disponíveis.</div>
        ) : (
          <div className="space-y-2">
            {clients.map((c) => (
              <button
                key={c.id}
                onClick={() => selectClient(c.id)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-200 hover:border-primary-400 hover:bg-primary-50 transition-colors text-left"
              >
                <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <div className="font-medium text-gray-900">{c.name}</div>
                  <div className="text-xs text-gray-500">NIF {c.nif}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        <button onClick={logout} className="mt-6 w-full text-sm text-gray-500 hover:text-gray-700">
          Terminar sessão
        </button>
      </div>
    </div>
  )
}
