import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import Layout from '@/components/layout/Layout'
import LoginPage from '@/pages/auth/LoginPage'
import SetPasswordPage from '@/pages/auth/SetPasswordPage'
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage'
import CompanySelectorPage from '@/pages/auth/CompanySelectorPage'
import DashboardPage from '@/pages/DashboardPage'
import BanksPage from '@/pages/BanksPage'
import ReconciliationPage from '@/pages/ReconciliationPage'
import ReceivablesPage from '@/pages/ReceivablesPage'
import PayablesPage from '@/pages/PayablesPage'
import BudgetsPage from '@/pages/BudgetsPage'
import ForecastPage from '@/pages/ForecastPage'
import EmpresaPage from '@/pages/EmpresaPage'
import SettingsPage from '@/pages/SettingsPage'
import ToconlineCallbackPage from '@/pages/ToconlineCallbackPage'
import NotFoundPage from '@/pages/NotFoundPage'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading, selectedClientId } = useAuth()
  if (isLoading) return <div className="flex h-screen items-center justify-center"><div className="text-gray-500">A carregar...</div></div>
  if (!user) return <Navigate to="/auth/login" replace />
  if (!selectedClientId) return <Navigate to="/auth/empresa" replace />
  return <>{children}</>
}

function RequireNoAuth({ children }: { children: React.ReactNode }) {
  const { user, selectedClientId } = useAuth()
  if (user && selectedClientId) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/auth/login" element={<RequireNoAuth><LoginPage /></RequireNoAuth>} />
          <Route path="/auth/set-password" element={<SetPasswordPage />} />
          <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/auth/empresa" element={<CompanySelectorPage />} />

          <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
            <Route index element={<DashboardPage />} />
            <Route path="bancos" element={<BanksPage />} />
            <Route path="reconciliacao" element={<ReconciliationPage />} />
            <Route path="contas-a-receber" element={<ReceivablesPage />} />
            <Route path="contas-a-pagar" element={<PayablesPage />} />
            <Route path="budgets" element={<BudgetsPage />} />
            <Route path="previsao" element={<ForecastPage />} />
            <Route path="empresa" element={<EmpresaPage />} />
            <Route path="definicoes" element={<SettingsPage />} />
          </Route>

          <Route path="/toconline/callback" element={<ToconlineCallbackPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
