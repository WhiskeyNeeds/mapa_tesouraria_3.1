import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate, statusLabel, statusVariant } from '@/lib/utils'
import KpiCard from '@/components/ui/KpiCard'
import Badge from '@/components/ui/Badge'
import Modal from '@/components/ui/Modal'
import { Plus, Upload, Building2, Filter, FileUp, CheckCircle2 } from 'lucide-react'

const SUPPORTED_BANKS = ['CGD', 'BCP', 'BPI', 'Bankinter', 'Santander'] as const
type SupportedBank = typeof SUPPORTED_BANKS[number]

interface BankAccount { id: string; name: string; bankName: string; currentBalance: number; ibanLast4: string; currency: string }
interface Movement { id: string; date: string; amount: number; description: string; status: string; category?: { name: string; color: string }; bankAccount?: { name: string } }
interface MovementsResponse { total: number; page: number; limit: number; items: Movement[] }
interface Summary { totalIncome: number; totalExpense: number; countIncome: number; countExpense: number; byStatus: Record<string, number> }

export default function BanksPage() {
  const { selectedClientId } = useAuth()
  const qc = useQueryClient()
  const [selectedAccount, setSelectedAccount] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [showNewAccount, setShowNewAccount] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [newAccount, setNewAccount] = useState({ name: '', bankName: '', iban: '', openingBalance: '0', minBalance: '' })
  const [importBank, setImportBank] = useState<SupportedBank>('CGD')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<{ imported: number; duplicated: number; failed: number; parsed: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: accounts = [] } = useQuery<BankAccount[]>({
    queryKey: ['bank-accounts', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/bank-accounts`),
    enabled: !!selectedClientId,
  })

  const { data: summary } = useQuery<Summary>({
    queryKey: ['movements-summary', selectedClientId, selectedAccount],
    queryFn: () => api.get(`/treasury/${selectedClientId}/movements/summary${selectedAccount ? `?bankAccountId=${selectedAccount}` : ''}`),
    enabled: !!selectedClientId,
  })

  const { data: movements } = useQuery<MovementsResponse>({
    queryKey: ['movements', selectedClientId, selectedAccount, statusFilter, page],
    queryFn: () => api.get(`/treasury/${selectedClientId}/movements?page=${page}&limit=20${selectedAccount ? `&bankAccountId=${selectedAccount}` : ''}${statusFilter ? `&status=${statusFilter}` : ''}`),
    enabled: !!selectedClientId,
  })

  const createAccount = useMutation({
    mutationFn: (data: typeof newAccount) => api.post(`/treasury/${selectedClientId}/bank-accounts`, {
      ...data,
      openingBalance: parseFloat(data.openingBalance),
      minBalance: data.minBalance ? parseFloat(data.minBalance) : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bank-accounts'] }); setShowNewAccount(false) },
  })

  const uploadStatementMutation = useMutation({
    mutationFn: async ({ file, bank, bankAccountId }: { file: File; bank: string; bankAccountId: string }) => {
      const token = localStorage.getItem('access_token')
      const form = new FormData()
      form.append('file', file)
      form.append('bankAccountId', bankAccountId)
      form.append('bank', bank)
      const res = await fetch(`/api/v1/treasury/${selectedClientId}/movements/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }))
        throw new Error(err.error ?? 'Erro ao importar')
      }
      return res.json()
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['movements'] })
      qc.invalidateQueries({ queryKey: ['bank-accounts'] })
      setImportResult(data)
    },
  })

  const totalBalance = accounts.reduce((s, a) => s + a.currentBalance, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Bancos & Movimentos</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="btn-secondary flex items-center gap-2"><Upload className="w-4 h-4" />Importar CSV</button>
          <button onClick={() => setShowNewAccount(true)} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" />Nova Conta</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Saldo Total" value={formatCurrency(totalBalance)} />
        <KpiCard title="Entradas" value={formatCurrency(summary?.totalIncome ?? 0)} subtitle={`${summary?.countIncome ?? 0} movimentos`} />
        <KpiCard title="Saídas" value={formatCurrency(summary?.totalExpense ?? 0)} subtitle={`${summary?.countExpense ?? 0} movimentos`} />
        <KpiCard title="Por classificar" value={String(summary?.byStatus?.UNCLASSIFIED ?? 0)} />
      </div>

      {/* Bank cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {accounts.map((acc) => (
          <button
            key={acc.id}
            onClick={() => setSelectedAccount(selectedAccount === acc.id ? '' : acc.id)}
            className={`card p-4 text-left transition-all ${selectedAccount === acc.id ? 'border-primary-400 bg-primary-50' : 'hover:border-gray-300'}`}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 bg-primary-100 rounded-lg flex items-center justify-center"><Building2 className="w-5 h-5 text-primary-600" /></div>
              <div className="min-w-0">
                <div className="font-medium text-gray-900 text-sm truncate">{acc.name}</div>
                <div className="text-xs text-gray-400">{acc.bankName} •••• {acc.ibanLast4}</div>
              </div>
            </div>
            <div className={`text-xl font-bold ${acc.currentBalance >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{formatCurrency(acc.currentBalance)}</div>
          </button>
        ))}
      </div>

      {/* Movements table */}
      <div className="card">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-3">
          <Filter className="w-4 h-4 text-gray-400" />
          <select className="input w-auto text-sm py-1" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}>
            <option value="">Todos os estados</option>
            <option value="UNCLASSIFIED">Por classificar</option>
            <option value="CLASSIFIED">Classificados</option>
            <option value="RECONCILED">Reconciliados</option>
          </select>
          <span className="text-sm text-gray-400 ml-auto">{movements?.total ?? 0} movimentos</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                <th className="text-left px-5 py-3">Data</th>
                <th className="text-left px-5 py-3">Descrição</th>
                <th className="text-left px-5 py-3">Categoria</th>
                <th className="text-right px-5 py-3">Valor</th>
                <th className="text-left px-5 py-3">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {movements?.items.map((m) => (
                <tr key={m.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{formatDate(m.date)}</td>
                  <td className="px-5 py-3 text-gray-900 max-w-xs truncate">{m.description}</td>
                  <td className="px-5 py-3">
                    {m.category ? (
                      <span className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: m.category.color }} />
                        <span className="text-gray-700">{m.category.name}</span>
                      </span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className={`px-5 py-3 text-right font-semibold whitespace-nowrap ${Number(m.amount) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {Number(m.amount) >= 0 ? '+' : ''}{formatCurrency(Number(m.amount))}
                  </td>
                  <td className="px-5 py-3"><Badge variant={statusVariant(m.status)}>{statusLabel(m.status)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {movements && movements.total > movements.limit && (
            <div className="flex justify-center gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary px-3 py-1 text-xs">‹ Anterior</button>
              <span className="text-xs text-gray-500 self-center">Pág. {page} de {Math.ceil(movements.total / movements.limit)}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={page * movements.limit >= movements.total} className="btn-secondary px-3 py-1 text-xs">Seguinte ›</button>
            </div>
          )}
        </div>
      </div>

      {/* New account modal */}
      <Modal open={showNewAccount} onClose={() => { setShowNewAccount(false); createAccount.reset() }} title="Nova Conta Bancária">
        <div className="space-y-4">
          <div><label className="label">Nome</label><input className="input" value={newAccount.name} onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })} placeholder="Ex: Conta Principal CGD" /></div>
          <div><label className="label">Banco</label><input className="input" value={newAccount.bankName} onChange={(e) => setNewAccount({ ...newAccount, bankName: e.target.value })} placeholder="Ex: Caixa Geral de Depósitos" /></div>
          <div><label className="label">IBAN</label><input className="input" value={newAccount.iban} onChange={(e) => setNewAccount({ ...newAccount, iban: e.target.value })} placeholder="PT50 0000 0000 0000 0000 0000 0" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Saldo inicial (€)</label><input type="number" className="input" value={newAccount.openingBalance} onChange={(e) => setNewAccount({ ...newAccount, openingBalance: e.target.value })} /></div>
            <div><label className="label">Saldo mínimo (€)</label><input type="number" className="input" value={newAccount.minBalance} onChange={(e) => setNewAccount({ ...newAccount, minBalance: e.target.value })} /></div>
          </div>
          {createAccount.isError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {(createAccount.error as Error).message}
            </p>
          )}
          <div className="flex gap-3 pt-2">
            <button onClick={() => { setShowNewAccount(false); createAccount.reset() }} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={() => createAccount.mutate(newAccount)} className="btn-primary flex-1" disabled={createAccount.isPending || !newAccount.name}>
              {createAccount.isPending ? 'A guardar...' : 'Criar conta'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Import modal */}
      <Modal open={showImport} onClose={() => { setShowImport(false); setImportFile(null); setImportResult(null); setImportBank('CGD') }} title="Importar Extrato Bancário" size="lg">
        {importResult ? (
          <div className="space-y-5">
            <div className="flex flex-col items-center gap-3 py-4">
              <CheckCircle2 className="w-12 h-12 text-green-500" />
              <p className="text-lg font-semibold text-gray-900">Importação concluída</p>
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="bg-green-50 rounded-xl p-3">
                <div className="text-2xl font-bold text-green-700">{importResult.imported}</div>
                <div className="text-xs text-green-600 mt-1">Importados</div>
              </div>
              <div className="bg-yellow-50 rounded-xl p-3">
                <div className="text-2xl font-bold text-yellow-700">{importResult.duplicated}</div>
                <div className="text-xs text-yellow-600 mt-1">Duplicados</div>
              </div>
              <div className="bg-red-50 rounded-xl p-3">
                <div className="text-2xl font-bold text-red-700">{importResult.failed}</div>
                <div className="text-xs text-red-600 mt-1">Com erro</div>
              </div>
            </div>
            <button onClick={() => { setShowImport(false); setImportFile(null); setImportResult(null); setImportBank('CGD') }} className="btn-primary w-full">Fechar</button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Banco</label>
                <select className="input" value={importBank} onChange={(e) => setImportBank(e.target.value as SupportedBank)}>
                  {SUPPORTED_BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Conta de destino</label>
                <select className="input" value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="label">Ficheiro</label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xls,.xlsx"
                className="hidden"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`w-full border-2 border-dashed rounded-xl p-8 flex flex-col items-center gap-3 transition-colors ${importFile ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <FileUp className={`w-8 h-8 ${importFile ? 'text-primary-500' : 'text-gray-400'}`} />
                {importFile ? (
                  <span className="text-sm font-medium text-primary-700">{importFile.name}</span>
                ) : (
                  <span className="text-sm text-gray-500">Clique para selecionar ficheiro CSV, XLS ou XLSX</span>
                )}
              </button>
            </div>

            {uploadStatementMutation.isError && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                {(uploadStatementMutation.error as Error).message}
              </p>
            )}

            <div className="flex gap-3 pt-1">
              <button onClick={() => { setShowImport(false); setImportFile(null) }} className="btn-secondary flex-1">Cancelar</button>
              <button
                onClick={() => {
                  if (!importFile || (!selectedAccount && !accounts[0]?.id)) return
                  uploadStatementMutation.mutate({ file: importFile, bank: importBank, bankAccountId: selectedAccount || accounts[0].id })
                }}
                className="btn-primary flex-1"
                disabled={uploadStatementMutation.isPending || !importFile || accounts.length === 0}
              >
                {uploadStatementMutation.isPending ? 'A importar...' : 'Importar'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
