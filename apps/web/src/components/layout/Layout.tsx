import { Outlet, NavLink } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import {
  LayoutDashboard, Building2, RefreshCw, ArrowDownToLine,
  ArrowUpFromLine, TrendingUp, Settings, LogOut, Menu, X, ChevronDown, AlertTriangle, SlidersHorizontal,
} from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import CompanyManagerModal from '@/components/ui/CompanyManagerModal'

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
  const [showManager, setShowManager] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!clientDropdown) return
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setClientDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [clientDropdown])

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients'),
  })

  type TocStatus = { status?: string; lastError?: string | null }
  const { data: tocConfig } = useQuery<TocStatus | null>({
    queryKey: ['toconline-config', selectedClientId],
    queryFn: () => (api.get(`/toconline/config/${selectedClientId}`) as Promise<TocStatus>).catch(() => null),
    enabled: !!selectedClientId,
    refetchInterval: 5 * 60 * 1000,
  })

  const { data: receivablesKpis } = useQuery<{ countOverdue: number }>({
    queryKey: ['receivables-kpis', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/receivables/kpis`),
    enabled: !!selectedClientId,
    staleTime: 60_000,
  })
  const { data: payablesKpis } = useQuery<{ countOverdue: number }>({
    queryKey: ['payables-kpis', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/payables/kpis`),
    enabled: !!selectedClientId,
    staleTime: 60_000,
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
          {nav.map((item) => {
            const overdueCount =
              item.to === '/contas-a-receber' ? receivablesKpis?.countOverdue
              : item.to === '/contas-a-pagar' ? payablesKpis?.countOverdue
              : undefined
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.exact}
                title={!sidebarOpen ? item.label : undefined}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive ? 'bg-primary-50 text-primary-700' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`
                }
              >
                <item.icon className="w-5 h-5 flex-shrink-0" />
                {sidebarOpen && <span className="flex-1">{item.label}</span>}
                {sidebarOpen && !!overdueCount && (
                  <span className="ml-auto text-xs bg-red-100 text-red-700 rounded-full px-1.5 py-0.5 font-semibold min-w-[1.25rem] text-center leading-none">
                    {overdueCount}
                  </span>
                )}
              </NavLink>
            )
          })}
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
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setClientDropdown(!clientDropdown)}
              className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 bg-gray-100 px-3 py-1.5 rounded-lg"
            >
              <Building2 className="w-4 h-4 text-gray-400" />
              <span className="max-w-[180px] truncate">{selectedClient?.name ?? 'Selecionar empresa'}</span>
              <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
            </button>
            {clientDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-[240px]">
                <div className="py-1">
                  {clients.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { setSelectedClientId(c.id); setClientDropdown(false) }}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 ${c.id === selectedClientId ? 'text-primary-600 font-medium' : 'text-gray-700'}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="truncate">{c.name}</div>
                        <div className="text-xs text-gray-400">NIF {c.nif}</div>
                      </div>
                      {c.id === selectedClientId && <span className="w-1.5 h-1.5 rounded-full bg-primary-500 flex-shrink-0" />}
                    </button>
                  ))}
                </div>
                <div className="border-t border-gray-100 py-1">
                  <button
                    onClick={() => { setClientDropdown(false); setShowManager(true) }}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-2"
                  >
                    <SlidersHorizontal className="w-4 h-4 text-gray-400" />
                    Gerir empresas...
                  </button>
                </div>
              </div>
            )}
          </div>

          <CompanyManagerModal open={showManager} onClose={() => setShowManager(false)} />

          <div className="ml-auto flex items-center gap-3">
            {tocConfig?.status === 'ERROR' && (
              <NavLink
                to="/definicoes"
                title={tocConfig.lastError ?? 'Erro na ligação TOConline'}
                className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 hover:bg-amber-100 transition-colors"
              >
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                TOConline — erro de autenticação
              </NavLink>
            )}
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
