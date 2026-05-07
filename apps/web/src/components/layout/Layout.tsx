import { Outlet, NavLink } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import {
  LayoutDashboard, Building2, RefreshCw, ArrowDownToLine,
  ArrowUpFromLine, TrendingUp, Settings, LogOut, Menu, X, ChevronDown, AlertTriangle, SlidersHorizontal, Briefcase,
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
  { to: '/empresa', label: 'Empresa', icon: Briefcase },
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
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <aside
        className={`${sidebarOpen ? 'w-64' : 'w-16'} flex-shrink-0 flex flex-col transition-all duration-300 ease-out`}
        style={{ background: '#0f172a' }}
      >
        {/* Logo */}
        <div
          className="flex items-center h-16 px-4 gap-3 flex-shrink-0"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="w-8 h-8 bg-primary-500 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm">
            <span className="text-white font-bold text-sm leading-none">T</span>
          </div>
          {sidebarOpen && (
            <div className="min-w-0">
              <span className="font-semibold text-white text-sm truncate block leading-tight">Mapa de Tesouraria</span>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2.5 py-3 space-y-0.5 overflow-y-auto">
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
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 group ${
                    isActive
                      ? 'text-white'
                      : 'text-slate-400 hover:text-white'
                  }`
                }
                style={({ isActive }) => ({
                  background: isActive ? 'rgba(255,255,255,0.10)' : undefined,
                })}
                onMouseEnter={(e) => {
                  const el = e.currentTarget
                  if (!el.classList.contains('text-white') || el.style.background === '') {
                    el.style.background = 'rgba(255,255,255,0.05)'
                  }
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget
                  if (el.style.background === 'rgba(255,255,255,0.05)') {
                    el.style.background = ''
                  }
                }}
              >
                <item.icon className="w-4.5 h-4.5 flex-shrink-0 w-[18px] h-[18px]" />
                {sidebarOpen && <span className="flex-1 truncate">{item.label}</span>}
                {sidebarOpen && !!overdueCount && (
                  <span className="ml-auto text-[10px] bg-red-500 text-white rounded-full px-1.5 py-0.5 font-bold min-w-[18px] text-center leading-none">
                    {overdueCount}
                  </span>
                )}
              </NavLink>
            )
          })}
        </nav>

        {/* Bottom */}
        <div className="px-2.5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <button
            onClick={logout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white w-full transition-colors duration-150"
            style={{ ':hover': { background: 'rgba(255,255,255,0.05)' } } as React.CSSProperties}
            onMouseEnter={(e) => { (e.currentTarget.style.background = 'rgba(255,255,255,0.05)') }}
            onMouseLeave={(e) => { (e.currentTarget.style.background = '') }}
          >
            <LogOut className="w-[18px] h-[18px] flex-shrink-0" />
            {sidebarOpen && <span>Terminar sessão</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="h-16 bg-white flex items-center px-5 gap-4 flex-shrink-0 z-10"
          style={{ boxShadow: '0 1px 0 0 rgba(0,0,0,0.06)' }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            {sidebarOpen ? <X className="w-4.5 h-4.5 w-[18px] h-[18px]" /> : <Menu className="w-[18px] h-[18px]" />}
          </button>

          {/* Company selector */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setClientDropdown(!clientDropdown)}
              className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 border border-gray-200 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Building2 className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <span className="max-w-[200px] truncate">{selectedClient?.name ?? 'Selecionar empresa'}</span>
              <ChevronDown className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform duration-150 ${clientDropdown ? 'rotate-180' : ''}`} />
            </button>
            {clientDropdown && (
              <div className="absolute top-full left-0 mt-1.5 bg-white border border-gray-100 rounded-xl shadow-card-lg z-50 min-w-[260px] animate-fade-in overflow-hidden">
                <div className="py-1.5">
                  {clients.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => { setSelectedClientId(c.id); setClientDropdown(false) }}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center gap-3 transition-colors ${c.id === selectedClientId ? 'text-primary-600' : 'text-gray-700'}`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.id === selectedClientId ? 'bg-primary-500' : 'bg-transparent'}`} />
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">{c.name}</div>
                        <div className="text-xs text-gray-400 mt-0.5">NIF {c.nif}</div>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="border-t border-gray-100 py-1.5">
                  <button
                    onClick={() => { setClientDropdown(false); setShowManager(true) }}
                    className="w-full text-left px-4 py-2.5 text-sm text-gray-500 hover:bg-slate-50 hover:text-gray-700 flex items-center gap-3 transition-colors"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 text-gray-400" />
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
                className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200/80 rounded-full px-3 py-1.5 hover:bg-amber-100 transition-colors"
              >
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                TOConline — erro de autenticação
              </NavLink>
            )}
            <div className="flex items-center gap-2.5">
              <div className="text-right hidden sm:block">
                <div className="text-sm font-medium text-gray-800 leading-tight">{user?.name}</div>
                <div className="text-xs text-gray-400 leading-tight mt-0.5">{user?.email}</div>
              </div>
              <div className="w-8 h-8 bg-gradient-to-br from-primary-400 to-primary-600 rounded-full flex items-center justify-center text-white font-semibold text-sm shadow-sm">
                {user?.name?.charAt(0).toUpperCase()}
              </div>
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
