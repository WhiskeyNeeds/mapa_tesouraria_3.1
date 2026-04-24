import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { formatCurrency, formatDate } from '@/lib/utils'
import KpiCard from '@/components/ui/KpiCard'
import Modal from '@/components/ui/Modal'
import { Plus, Upload, Building2, FileUp, CheckCircle2, Trash2, Search, X, ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, PenLine, AlertTriangle } from 'lucide-react'

const SUPPORTED_BANKS = ['CGD', 'BCP', 'BPI', 'Bankinter', 'Santander', 'NovoBanco'] as const
type SupportedBank = typeof SUPPORTED_BANKS[number]

const PORTUGUESE_BANKS = [
  'Bankinter',
  'Millennium BCP',
  'Banco BPI',
  'Caixa Geral de Depósitos',
  'Novo Banco',
  'Santander',
]

const BANK_PARSER_CODES: Record<string, SupportedBank> = {
  'Caixa Geral de Depósitos': 'CGD',
  'Millennium BCP': 'BCP',
  'Banco BPI': 'BPI',
  'Bankinter': 'Bankinter',
  'Santander': 'Santander',
  'Novo Banco': 'NovoBanco',
}

const BANK_CODE_TO_NAME: Record<SupportedBank, string> = Object.fromEntries(
  Object.entries(BANK_PARSER_CODES).map(([name, code]) => [code, name])
) as Record<SupportedBank, string>

const BANK_IMPORT_OPTIONS = PORTUGUESE_BANKS.map((name) => ({
  name,
  code: BANK_PARSER_CODES[name] ?? name,
  supported: name in BANK_PARSER_CODES,
}))

const BANK_BRAND: Record<string, { abbr: string; bg: string }> = {
  'Bankinter': { abbr: 'BK', bg: '#FF6200' },
  'Millennium BCP': { abbr: 'BCP', bg: '#DA2128' },
  'Banco BPI': { abbr: 'BPI', bg: '#F47920' },
  'Caixa Geral de Depósitos': { abbr: 'CGD', bg: '#008A3B' },
  'Novo Banco': { abbr: 'NB', bg: '#C8000A' },
  'Santander': { abbr: 'SAN', bg: '#EC0000' },
}

function BankAvatar({ bankName }: { bankName: string }) {
  const brand = BANK_BRAND[bankName]
  const bg = brand?.bg ?? '#6B7280'
  const abbr = brand?.abbr ?? bankName.slice(0, 2).toUpperCase()
  return (
    <div
      className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-white ${abbr.length <= 2 ? 'text-sm' : 'text-xs'}`}
      style={{ backgroundColor: bg }}
    >
      {abbr}
    </div>
  )
}

function formatIban(raw: string): string {
  const clean = raw.replace(/\s/g, '').toUpperCase().slice(0, 25)
  return clean.match(/.{1,4}/g)?.join(' ') ?? clean
}

interface BankAccount { id: string; name: string; bankName: string; currentBalance: number; minBalance?: number | null; ibanLast4: string; currency: string; lowBalanceWarning?: boolean }
interface Movement { id: string; date: string; amount: number; description: string; status: string; source: string; balanceAfter?: number | null; category?: { name: string; color: string }; bankAccount?: { id: string; name: string; bankName: string } }
interface MovementsResponse { total: number; page: number; limit: number; items: Movement[] }
interface Summary { totalIncome: number; totalExpense: number; countIncome: number; countExpense: number; byStatus: Record<string, number> }

export default function BanksPage() {
  const { selectedClientId } = useAuth()
  const qc = useQueryClient()
  const [selectedAccount, setSelectedAccount] = useState<string>('')
  const [page, setPage] = useState(1)
  const [showNewAccount, setShowNewAccount] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmDeleteMovementId, setConfirmDeleteMovementId] = useState<string | null>(null)
  const [newAccount, setNewAccount] = useState({ name: '', bankName: '', iban: '', openingBalance: '0', minBalance: '' })
  const [bankSearch, setBankSearch] = useState('')
  const [showBankDropdown, setShowBankDropdown] = useState(false)
  const [ibanTouched, setIbanTouched] = useState(false)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [direction, setDirection] = useState<'' | 'income' | 'expense'>('')
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'description' | 'balanceAfter'>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [importBank, setImportBank] = useState<SupportedBank>('CGD')
  const [importAccountId, setImportAccountId] = useState<string>('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importResult, setImportResult] = useState<{ imported: number; duplicated: number; failed: number; parsed: number } | null>(null)
  const [showNewMovement, setShowNewMovement] = useState(false)
  const [newMovement, setNewMovement] = useState({ bankAccountId: '', date: new Date().toISOString().slice(0, 10), description: '', amount: '', direction: 'income' as 'income' | 'expense' })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bankDropdownRef = useRef<HTMLDivElement>(null)
  const carouselRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  function checkScroll() {
    const el = carouselRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 2)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }

  useEffect(() => {
    if (!showBankDropdown) return
    function handleClickOutside(e: MouseEvent) {
      if (bankDropdownRef.current && !bankDropdownRef.current.contains(e.target as Node)) {
        setShowBankDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showBankDropdown])

  const filteredBanks = PORTUGUESE_BANKS.filter((b) =>
    b.toLowerCase().includes(bankSearch.toLowerCase())
  )

  const { data: accounts = [] } = useQuery<BankAccount[]>({
    queryKey: ['bank-accounts', selectedClientId],
    queryFn: () => api.get(`/treasury/${selectedClientId}/bank-accounts`),
    enabled: !!selectedClientId,
  })

  useEffect(() => { setTimeout(checkScroll, 0) }, [accounts])

  const { data: summary } = useQuery<Summary>({
    queryKey: ['movements-summary', selectedClientId, selectedAccount],
    queryFn: () => api.get(`/treasury/${selectedClientId}/movements/summary${selectedAccount ? `?bankAccountId=${selectedAccount}` : ''}`),
    enabled: !!selectedClientId && accounts.length > 0,
  })

  const { data: movements } = useQuery<MovementsResponse>({
    queryKey: ['movements', selectedClientId, selectedAccount, page, search, dateFrom, dateTo, direction, sortBy, sortDir],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), limit: '20' })
      if (selectedAccount) p.set('bankAccountId', selectedAccount)
      if (search) p.set('search', search)
      if (dateFrom) p.set('dateFrom', dateFrom)
      if (dateTo) p.set('dateTo', dateTo)
      if (direction) p.set('direction', direction)
      if (sortBy !== 'date' || sortDir !== 'desc') { p.set('sortBy', sortBy); p.set('sortDir', sortDir) }
      return api.get(`/treasury/${selectedClientId}/movements?${p.toString()}`)
    },
    enabled: !!selectedClientId && accounts.length > 0,
    placeholderData: keepPreviousData,
  })

  const createAccount = useMutation({
    mutationFn: (data: typeof newAccount) => api.post(`/treasury/${selectedClientId}/bank-accounts`, {
      ...data,
      openingBalance: parseFloat(data.openingBalance),
      minBalance: data.minBalance ? parseFloat(data.minBalance) : undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bank-accounts'] }); setShowNewAccount(false) },
  })

  const deleteAccount = useMutation({
    mutationFn: (id: string) => api.delete(`/treasury/${selectedClientId}/bank-accounts/${id}`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['bank-accounts'] })
      qc.invalidateQueries({ queryKey: ['movements'] })
      qc.invalidateQueries({ queryKey: ['movements-summary'] })
      if (selectedAccount === id) setSelectedAccount('')
      setConfirmDeleteId(null)
    },
  })

  const deleteMovement = useMutation({
    mutationFn: (id: string) => api.delete(`/treasury/${selectedClientId}/movements/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movements'] })
      qc.invalidateQueries({ queryKey: ['movements-summary'] })
      qc.invalidateQueries({ queryKey: ['bank-accounts'] })
      setConfirmDeleteMovementId(null)
    },
  })

  const createMovement = useMutation({
    mutationFn: (data: { bankAccountId: string; date: string; amount: number; description: string }) =>
      api.post(`/treasury/${selectedClientId}/movements`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['movements'] })
      qc.invalidateQueries({ queryKey: ['movements-summary'] })
      qc.invalidateQueries({ queryKey: ['bank-accounts'] })
      setShowNewMovement(false)
      setNewMovement({ bankAccountId: '', date: new Date().toISOString().slice(0, 10), description: '', amount: '', direction: 'income' })
    },
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

  const selectedAccountData = accounts.find((a) => a.id === selectedAccount)
  const totalBalance = selectedAccountData ? selectedAccountData.currentBalance : accounts.reduce((s, a) => s + a.currentBalance, 0)
  const confirmDeleteAccount = accounts.find((a) => a.id === confirmDeleteId)

  const hasFilters = !!(search || dateFrom || dateTo || direction)

  function clearFilters() {
    setSearch(''); setDateFrom(''); setDateTo(''); setDirection(''); setPage(1)
  }

  function toggleSort(field: typeof sortBy) {
    if (sortBy === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    } else {
      setSortBy(field)
      setSortDir('desc')
    }
    setPage(1)
  }

  function SortIcon({ field }: { field: typeof sortBy }) {
    if (sortBy !== field) return <ArrowUpDown className="inline w-3 h-3 ml-1 text-gray-300" />
    return sortDir === 'desc'
      ? <ArrowDown className="inline w-3 h-3 ml-1 text-primary-500" />
      : <ArrowUp className="inline w-3 h-3 ml-1 text-primary-500" />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Bancos & Movimentos</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="btn-secondary flex items-center gap-2"><Upload className="w-4 h-4" />Importar movimentos de conta</button>
          <button onClick={() => { setNewMovement(m => ({ ...m, bankAccountId: selectedAccount || accounts[0]?.id || '', date: new Date().toISOString().slice(0, 10) })); setShowNewMovement(true) }} className="btn-secondary flex items-center gap-2"><PenLine className="w-4 h-4" />Novo Movimento</button>
          <button onClick={() => setShowNewAccount(true)} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" />Nova Conta</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <KpiCard
          title={selectedAccountData ? 'Saldo da Conta' : 'Saldo total da(s) Conta(s)'}
          value={formatCurrency(totalBalance)}
          valueColor="auto"
          rawValue={totalBalance}
          subtitle={selectedAccountData ? selectedAccountData.name : `${accounts.length} conta${accounts.length !== 1 ? 's' : ''}`}
        />
        <KpiCard
          title="Entradas"
          value={formatCurrency(summary?.totalIncome ?? 0)}
          valueColor="green"
          subtitle={`${summary?.countIncome ?? 0} movimentos`}
        />
        <KpiCard
          title="Saídas"
          value={formatCurrency(summary?.totalExpense ?? 0)}
          valueColor="red"
          subtitle={`${summary?.countExpense ?? 0} movimentos`}
        />
      </div>

      {/* Bank cards carousel */}
      <div className="relative">
        {canScrollLeft && (
          <button
            type="button"
            onClick={() => carouselRef.current?.scrollBy({ left: -304, behavior: 'smooth' })}
            className="absolute -left-4 top-1/2 -translate-y-1/2 z-10 w-8 h-8 bg-white border border-gray-200 rounded-full shadow-md flex items-center justify-center hover:bg-gray-50 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
        )}
        <div className="overflow-hidden">
          <div
            ref={carouselRef}
            onScroll={checkScroll}
            className="flex gap-4 overflow-x-auto pb-4 -mb-4 snap-x snap-mandatory"
          >
            {accounts.map((acc) => (
              <div
                key={acc.id}
                onClick={() => { setSelectedAccount(selectedAccount === acc.id ? '' : acc.id); setPage(1) }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && (setSelectedAccount(selectedAccount === acc.id ? '' : acc.id), setPage(1))}
                className={`snap-start flex-none w-72 card p-4 text-left transition-all cursor-pointer relative group ${selectedAccount === acc.id ? 'border-primary-400 bg-primary-50' : 'hover:border-gray-300'}`}
              >
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(acc.id) }}
                  className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                  title="Remover conta"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <div className="flex items-center gap-3 mb-3">
                  <BankAvatar bankName={acc.bankName} />
                  <div className="min-w-0 pr-6">
                    <div className="font-medium text-gray-900 text-sm truncate">{acc.name}</div>
                    <div className="text-xs text-gray-400">{acc.bankName} •••• {acc.ibanLast4}</div>
                  </div>
                </div>
                <div className={`text-xl font-bold ${acc.currentBalance >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{formatCurrency(acc.currentBalance)}</div>
                {acc.lowBalanceWarning && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    Saldo abaixo do mínimo ({formatCurrency(acc.minBalance ?? 0)})
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        {canScrollRight && (
          <button
            type="button"
            onClick={() => carouselRef.current?.scrollBy({ left: 304, behavior: 'smooth' })}
            className="absolute -right-4 top-1/2 -translate-y-1/2 z-10 w-8 h-8 bg-white border border-gray-200 rounded-full shadow-md flex items-center justify-center hover:bg-gray-50 transition-colors"
          >
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
        )}
      </div>

      {/* Movements table */}
      {accounts.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <Building2 className="w-10 h-10 text-gray-300 mb-3" />
          <p className="text-gray-500 font-medium">Sem contas bancárias</p>
          <p className="text-sm text-gray-400 mt-1">Adicione uma conta para começar a registar movimentos.</p>
        </div>
      ) : (
        <div className="card">
          {/* Filter toolbar */}
          <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                className="input pl-8 text-sm py-1.5 w-52"
                placeholder="Pesquisar descrição..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              />
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="date"
                className="input text-sm py-1.5 w-36"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
              />
              <span className="text-gray-400 text-xs">–</span>
              <input
                type="date"
                className="input text-sm py-1.5 w-36"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
              />
            </div>

            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
              {(['', 'income', 'expense'] as const).map((d, i) => (
                <button
                  key={d}
                  onClick={() => { setDirection(d); setPage(1) }}
                  className={`px-3 py-1.5 transition-colors ${direction === d ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'}${i > 0 ? ' border-l border-gray-200' : ''}`}
                >
                  {d === '' ? 'Todos' : d === 'income' ? 'Entradas' : 'Saídas'}
                </button>
              ))}
            </div>

            {hasFilters && (
              <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 px-2 py-1.5 hover:bg-gray-50 rounded-lg transition-colors">
                <X className="w-3.5 h-3.5" /> Limpar
              </button>
            )}

            <span className="text-sm text-gray-400 ml-auto">{movements?.total ?? 0} movimentos</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                  <th
                    onClick={() => toggleSort('date')}
                    className="text-left px-5 py-3 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap"
                  >
                    Data <SortIcon field="date" />
                  </th>
                  {!selectedAccount && (
                    <th className="text-left px-5 py-3 whitespace-nowrap text-xs text-gray-500 uppercase">Conta</th>
                  )}
                  <th
                    onClick={() => toggleSort('description')}
                    className="text-left px-5 py-3 cursor-pointer hover:text-gray-700 select-none"
                  >
                    Descrição <SortIcon field="description" />
                  </th>
                  <th
                    onClick={() => toggleSort('amount')}
                    className="text-right px-1 py-3 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap"
                  >
                    Valor <SortIcon field="amount" />
                  </th>
                  <th
                    onClick={() => toggleSort('balanceAfter')}
                    className="text-right px-5 py-3 cursor-pointer hover:text-gray-700 select-none whitespace-nowrap"
                  >
                    Saldo <SortIcon field="balanceAfter" />
                  </th>
                  <th className="w-8 px-2 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {movements?.items.map((m) => (
                  <tr key={m.id} className="hover:bg-gray-50 group">
                    <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{formatDate(m.date)}</td>
                    {!selectedAccount && (
                      <td className="px-5 py-3 whitespace-nowrap">
                        {m.bankAccount && (
                          <div className="flex items-center gap-2">
                            <BankAvatar bankName={m.bankAccount.bankName} />
                            <span className="text-xs text-gray-500 truncate max-w-[8rem]">{m.bankAccount.name}</span>
                          </div>
                        )}
                      </td>
                    )}
                    <td className="px-5 py-3 text-gray-900 max-w-xs">
                      <span className="truncate block">{m.description}</span>
                      {m.source === 'MANUAL' && <span className="text-xs text-gray-400">manual</span>}
                    </td>
                    <td className={`px-1 py-3 text-right font-semibold whitespace-nowrap ${Number(m.amount) >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {Number(m.amount) >= 0 ? '+' : ''}{formatCurrency(Number(m.amount))}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-500 whitespace-nowrap">
                      {m.balanceAfter != null ? formatCurrency(Number(m.balanceAfter)) : '—'}
                    </td>
                    <td className="px-2 py-3 w-8">
                      {m.source === 'MANUAL' && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteMovementId(m.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-all"
                          title="Remover movimento"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {movements?.items.length === 0 && (
                  <tr>
                    <td colSpan={selectedAccount ? 5 : 6} className="px-5 py-10 text-center text-sm text-gray-400">
                      {hasFilters ? 'Nenhum movimento corresponde aos filtros.' : 'Sem movimentos.'}
                    </td>
                  </tr>
                )}
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
      )}

      {/* Delete movement confirmation modal */}
      <Modal open={!!confirmDeleteMovementId} onClose={() => { setConfirmDeleteMovementId(null); deleteMovement.reset() }} title="Remover movimento">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Tem a certeza que pretende remover este movimento manual? Esta ação não pode ser desfeita.</p>
          {deleteMovement.isError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{(deleteMovement.error as Error).message}</p>
          )}
          <div className="flex gap-3 pt-2">
            <button onClick={() => { setConfirmDeleteMovementId(null); deleteMovement.reset() }} className="btn-secondary flex-1">Cancelar</button>
            <button
              type="button"
              onClick={() => { if (confirmDeleteMovementId) deleteMovement.mutate(confirmDeleteMovementId) }}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
              disabled={deleteMovement.isPending}
            >
              {deleteMovement.isPending ? 'A remover...' : 'Remover'}
            </button>
          </div>
        </div>
      </Modal>

      {/* New account modal */}
      {(() => {
        const ibanChars = newAccount.iban.replace(/\s/g, '').length
        const ibanInvalid = ibanTouched && ibanChars > 0 && ibanChars !== 25
        const bankValid = PORTUGUESE_BANKS.includes(newAccount.bankName)
        const canSubmit = !createAccount.isPending && !!newAccount.name && bankValid && (ibanChars === 0 || ibanChars === 25)
        const resetModal = () => { setShowNewAccount(false); setBankSearch(''); setShowBankDropdown(false); setIbanTouched(false); setNewAccount({ name: '', bankName: '', iban: '', openingBalance: '0', minBalance: '' }); createAccount.reset() }
        return (
          <Modal open={showNewAccount} onClose={resetModal} title="Nova Conta Bancária">
            <div className="space-y-4">
              <div>
                <label className="label">Nome</label>
                <input className="input" value={newAccount.name} onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })} placeholder="Ex: Conta Principal CGD" />
              </div>

              <div ref={bankDropdownRef} className="relative">
                <label className="label">Banco</label>
                <input
                  className={`input ${bankSearch && !bankValid ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''}`}
                  value={bankSearch}
                  onChange={(e) => { setBankSearch(e.target.value); setNewAccount({ ...newAccount, bankName: '' }); setShowBankDropdown(true) }}
                  onFocus={() => setShowBankDropdown(true)}
                  onBlur={() => { if (!bankValid) { setBankSearch(''); setNewAccount({ ...newAccount, bankName: '' }) } }}
                  placeholder="Selecionar banco..."
                  autoComplete="off"
                />
                {showBankDropdown && (
                  <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredBanks.length > 0 ? filteredBanks.map((bank) => (
                      <button
                        key={bank}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg last:rounded-b-lg"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setBankSearch(bank); setNewAccount({ ...newAccount, bankName: bank }); setShowBankDropdown(false) }}
                      >
                        {bank}
                      </button>
                    )) : (
                      <p className="px-3 py-2 text-sm text-gray-400">Sem resultados</p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="label">IBAN</label>
                <input
                  className={`input font-mono tracking-wider ${ibanInvalid ? 'border-red-300 focus:border-red-400 focus:ring-red-100' : ''}`}
                  value={newAccount.iban}
                  onChange={(e) => setNewAccount({ ...newAccount, iban: formatIban(e.target.value) })}
                  onBlur={() => setIbanTouched(true)}
                  placeholder="PT50 0000 0000 0000 0000 0000 0"
                  maxLength={31}
                  spellCheck={false}
                />
                <p className={`text-xs mt-1 ${ibanInvalid ? 'text-red-500' : 'text-gray-400'}`}>
                  {ibanChars} / 25 caracteres{ibanInvalid ? ' — IBAN incompleto' : ''}
                </p>
              </div>

              {createAccount.isError && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                  {(createAccount.error as Error).message}
                </p>
              )}
              <div className="flex gap-3 pt-2">
                <button onClick={resetModal} className="btn-secondary flex-1">Cancelar</button>
                <button onClick={() => createAccount.mutate(newAccount)} className="btn-primary flex-1" disabled={!canSubmit}>
                  {createAccount.isPending ? 'A guardar...' : 'Criar conta'}
                </button>
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* Delete confirmation modal */}
      <Modal open={!!confirmDeleteId} onClose={() => { setConfirmDeleteId(null); deleteAccount.reset() }} title="Remover conta bancária">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Tem a certeza que pretende remover a conta <span className="font-semibold text-gray-900">{confirmDeleteAccount?.name}</span>?
            Esta ação irá arquivar a conta e não poderá ser desfeita.
          </p>
          {deleteAccount.isError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {(deleteAccount.error as Error).message}
            </p>
          )}
          <div className="flex gap-3 pt-2">
            <button onClick={() => { setConfirmDeleteId(null); deleteAccount.reset() }} className="btn-secondary flex-1">Cancelar</button>
            <button
              type="button"
              onClick={() => { if (confirmDeleteId) deleteAccount.mutate(confirmDeleteId) }}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50"
              disabled={deleteAccount.isPending}
            >
              {deleteAccount.isPending ? 'A remover...' : 'Remover conta'}
            </button>
          </div>
        </div>
      </Modal>

      {/* New movement modal */}
      <Modal open={showNewMovement} onClose={() => { setShowNewMovement(false); createMovement.reset() }} title="Novo Movimento Manual">
        <div className="space-y-4">
          <div>
            <label className="label">Conta bancária</label>
            <select className="input" value={newMovement.bankAccountId} onChange={(e) => setNewMovement({ ...newMovement, bankAccountId: e.target.value })}>
              <option value="">Selecionar conta...</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.bankName}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Data</label>
              <input type="date" className="input" value={newMovement.date} onChange={(e) => setNewMovement({ ...newMovement, date: e.target.value })} />
            </div>
            <div>
              <label className="label">Tipo</label>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm font-medium h-[38px]">
                {(['income', 'expense'] as const).map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setNewMovement({ ...newMovement, direction: d })}
                    className={`flex-1 transition-colors ${newMovement.direction === d ? (d === 'income' ? 'bg-green-600 text-white' : 'bg-red-600 text-white') : 'text-gray-600 hover:bg-gray-50'}${i > 0 ? ' border-l border-gray-200' : ''}`}
                  >
                    {d === 'income' ? '＋ Entrada' : '－ Saída'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="label">Valor (€)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="input"
              placeholder="0,00"
              value={newMovement.amount}
              onChange={(e) => setNewMovement({ ...newMovement, amount: e.target.value })}
            />
          </div>

          <div>
            <label className="label">Descrição</label>
            <input
              className="input"
              placeholder="Ex: Transferência recebida"
              value={newMovement.description}
              onChange={(e) => setNewMovement({ ...newMovement, description: e.target.value })}
            />
          </div>

          {createMovement.isError && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              {(createMovement.error as Error).message}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={() => { setShowNewMovement(false); createMovement.reset() }} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={() => {
                const amt = parseFloat(newMovement.amount)
                if (!amt || amt <= 0) return
                createMovement.mutate({
                  bankAccountId: newMovement.bankAccountId,
                  date: newMovement.date,
                  amount: newMovement.direction === 'income' ? amt : -amt,
                  description: newMovement.description,
                })
              }}
              className="btn-primary flex-1"
              disabled={createMovement.isPending || !newMovement.bankAccountId || !newMovement.date || !newMovement.description || !newMovement.amount}
            >
              {createMovement.isPending ? 'A guardar...' : 'Criar movimento'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Import modal */}
      <Modal open={showImport} onClose={() => { setShowImport(false); setImportFile(null); setImportResult(null); setImportBank('CGD'); setImportAccountId('') }} title="Importar Extrato Bancário" size="lg">
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
            <button onClick={() => { setShowImport(false); setImportFile(null); setImportResult(null); setImportBank('CGD'); setImportAccountId('') }} className="btn-primary w-full">Fechar</button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Banco</label>
                <select
                  className="input"
                  value={importBank}
                  onChange={(e) => {
                    const bank = e.target.value as SupportedBank
                    setImportBank(bank)
                    const bankName = BANK_CODE_TO_NAME[bank]
                    const first = accounts.find((a) => a.bankName === bankName)
                    setImportAccountId(first?.id ?? '')
                  }}
                >
                  {BANK_IMPORT_OPTIONS.map((b) => (
                    <option key={b.code} value={b.code} disabled={!b.supported}>
                      {b.name}{!b.supported ? ' (não suportado)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Conta de destino</label>
                {(() => {
                  const bankName = BANK_CODE_TO_NAME[importBank]
                  const filtered = bankName ? accounts.filter((a) => a.bankName === bankName) : accounts
                  if (filtered.length === 0) {
                    return <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Nenhuma conta de {bankName ?? importBank} encontrada.</p>
                  }
                  const value = importAccountId && filtered.find((a) => a.id === importAccountId) ? importAccountId : filtered[0].id
                  return (
                    <select className="input" value={value} onChange={(e) => setImportAccountId(e.target.value)}>
                      {filtered.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  )
                })()}
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
              <button onClick={() => { setShowImport(false); setImportFile(null); setImportAccountId('') }} className="btn-secondary flex-1">Cancelar</button>
              <button
                onClick={() => {
                  const bankName = BANK_CODE_TO_NAME[importBank]
                  const filtered = bankName ? accounts.filter((a) => a.bankName === bankName) : accounts
                  const targetId = (importAccountId && filtered.find((a) => a.id === importAccountId))
                    ? importAccountId
                    : filtered[0]?.id
                  if (!importFile || !targetId) return
                  uploadStatementMutation.mutate({ file: importFile, bank: importBank, bankAccountId: targetId })
                }}
                className="btn-primary flex-1"
                disabled={uploadStatementMutation.isPending || !importFile || (() => {
                  const bankName = BANK_CODE_TO_NAME[importBank]
                  const filtered = bankName ? accounts.filter((a) => a.bankName === bankName) : accounts
                  return filtered.length === 0
                })()}
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
