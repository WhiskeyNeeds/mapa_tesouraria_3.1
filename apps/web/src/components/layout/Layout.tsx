import { Outlet, NavLink } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import {
  LayoutDashboard, Building2, Landmark, ArrowLeftRight, Euro, Plus, Minus,
  Settings, LogOut, Menu, X, ChevronDown, AlertTriangle, SlidersHorizontal, Briefcase, Wallet, FlaskConical,
} from 'lucide-react'

// Ícones compostos para Contas a Receber (€+) e Contas a Pagar (€−).
// Lucide-react não fornece estes combinados; sobrepomos o sinal no canto sup. direito.
function EuroPlus({ className }: { className?: string }) {
  return (
    <span className={`relative inline-flex items-center justify-center ${className ?? ''}`}>
      <Euro className="w-full h-full" strokeWidth={2.25} />
      <Plus className="absolute -top-1 -right-1 w-2.5 h-2.5" strokeWidth={4} />
    </span>
  )
}

function EuroMinus({ className }: { className?: string }) {
  return (
    <span className={`relative inline-flex items-center justify-center ${className ?? ''}`}>
      <Euro className="w-full h-full" strokeWidth={2.25} />
      <Minus className="absolute -top-1 -right-1 w-2.5 h-2.5" strokeWidth={4} />
    </span>
  )
}
import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import CompanyManagerModal from '@/components/ui/CompanyManagerModal'

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { to: '/bancos', label: 'Bancos & Movimentos', icon: Landmark },
  { to: '/reconciliacao', label: 'Reconciliação', icon: ArrowLeftRight },
  { to: '/contas-a-receber', label: 'Contas a Receber', icon: EuroPlus },
  { to: '/contas-a-pagar', label: 'Contas a Pagar', icon: EuroMinus },
  { to: '/budgets', label: 'Budgets', icon: Wallet },
  { to: '/empresa', label: 'Empresa', icon: Briefcase },
  { to: '/definicoes', label: 'Definições', icon: Settings },
  { to: '/toc-explorer', label: 'TOC Explorer', icon: FlaskConical },
]

interface Client { id: string; name: string; nif: string }

export default function Layout() {
  const { user, selectedClientId, setSelectedClientId, logout } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1280 : true))
  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth < 768 : false))
  const [clientDropdown, setClientDropdown] = useState(false)
  const [showManager, setShowManager] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Adapta a sidebar à largura da janela: colapsa automaticamente abaixo de xl
  // (1280px) e passa a overlay com backdrop abaixo de md (768px). O utilizador
  // pode sempre forçar manualmente via o botão menu.
  useEffect(() => {
    const handler = () => {
      const w = window.innerWidth
      setIsMobile(w < 768)
      setSidebarOpen(w >= 1280)
    }
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

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


  const selectedClient = clients.find((c) => c.id === selectedClientId)

  // Em mobile, a sidebar fica em overlay (fora do flow). Em desktop ocupa
  // espaço próprio. A largura aplicada também muda: em mobile só há "aberta"
  // (w-64) ou "fechada" (escondida com -translate-x-full).
  const sidebarClasses = isMobile
    ? `fixed inset-y-0 left-0 z-40 w-64 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`
    : `relative flex-shrink-0 ${sidebarOpen ? 'w-64' : 'w-16'}`

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Backdrop (só em mobile, com sidebar aberta) */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px]"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`${sidebarClasses} flex flex-col transition-all duration-300 ease-out`}
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
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.exact}
                title={!sidebarOpen ? item.label : undefined}
                onClick={() => { if (isMobile) setSidebarOpen(false) }}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 group ${
                    isActive
                      ? 'text-white bg-white/10'
                      : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`
                }
              >
                <item.icon className="w-4.5 h-4.5 flex-shrink-0 w-[18px] h-[18px]" />
                {sidebarOpen && <span className="flex-1 truncate">{item.label}</span>}
              </NavLink>
            )
          })}
        </nav>

        {/* Bottom */}
        <div className="px-2.5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <button
            onClick={logout}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-white/5 w-full transition-colors duration-150"
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
