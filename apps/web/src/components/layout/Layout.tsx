import { Outlet, NavLink } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import {
  LayoutDashboard, Building2, RefreshCw, ArrowDownToLine,
  ArrowUpFromLine, TrendingUp, Settings, LogOut, Menu, X, ChevronDown,
} from 'lucide-react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/bancos', label: 'Bancos & Movimentos', icon: Building2 },
  { to: '/reconciliacao', label: 'Reconciliação', icon: RefreshCw },
  { to: '/contas-a-receber', label: 'Contas a Receber', icon: ArrowDownToLine },
  { to: '/contas-a-pagar', label: 'Contas a Pagar', icon: ArrowUpFromLine },
  { to: '/previsao', label: 'Previsão', icon: TrendingUp },
  { to: '/definicoes', label: 'Definições', icon: Settings },
]

interface Client { id: string; name: string; nif: string }

export default function Layout() {
  const { user, selectedClientId, setSelectedClientId, logout } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [clientDropdown, setClientDropdown] = useState(false)

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients'),
  })

  const selectedClient = clients.find((c) => c.id === selectedClientId)

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-16'} bg-white border-r border-gray-200 flex flex-col transition-all duration-300`}>
        {/* Logo */}
        <div className="flex items-center h-16 px-4 border-b border-gray-200 gap-3">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0">T</div>
          {sidebarOpen && <span className="font-semibold text-gray-900 truncate">Mapa de Tesouraria</span>}
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              <item.icon className="w-5 h-5 flex-shrink-0" />
              {sidebarOpen && <span>{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom */}
        <div className="p-3 border-t border-gray-200">
          <button
            onClick={logout}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 w-full"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {sidebarOpen && <span>Terminar sessão</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center px-4 gap-4">
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-gray-500 hover:text-gray-700">
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          {/* Company selector */}
          <div className="relative">
            <button
              onClick={() => setClientDropdown(!clientDropdown)}
              className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 bg-gray-100 px-3 py-1.5 rounded-lg"
            >
              <Building2 className="w-4 h-4 text-gray-400" />
              <span>{selectedClient?.name ?? 'Selecionar empresa'}</span>
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>
            {clientDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[220px]">
                {clients.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setSelectedClientId(c.id); setClientDropdown(false) }}
                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 ${c.id === selectedClientId ? 'text-primary-600 font-medium' : 'text-gray-700'}`}
                  >
                    <div>{c.name}</div>
                    <div className="text-xs text-gray-400">NIF {c.nif}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-medium text-gray-900">{user?.name}</div>
              <div className="text-xs text-gray-500">{user?.email}</div>
            </div>
            <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center text-primary-700 font-semibold text-sm">
              {user?.name?.charAt(0).toUpperCase()}
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
