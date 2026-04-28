import { useState, useEffect, useRef } from 'react'
import type { ComponentType } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import {
  Search, Users, Truck, Package, Wrench, AlertTriangle,
  ArrowUp, ArrowDown, ArrowUpDown, X, Plus, BarChart2, Trash2, Check,
} from 'lucide-react'

type Tab = 'clientes' | 'fornecedores' | 'produtos' | 'servicos'
type TocRow = Record<string, unknown>
type Icon = ComponentType<{ className?: string }>
type SortDir = 'asc' | 'desc'

// ── helpers ──────────────────────────────────────────────────────────────────

function toRows(val: unknown): TocRow[] {
  if (Array.isArray(val)) return val as TocRow[]
  if (val != null && typeof val === 'object') {
    const obj = val as Record<string, unknown>
    for (const k of ['data', 'items', 'results', 'records', 'list']) {
      if (Array.isArray(obj[k])) return obj[k] as TocRow[]
    }
  }
  return []
}

function getVal(row: TocRow, keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] != null && row[k] !== '') return row[k]
  }
  return null
}

function searchMatch(row: TocRow, q: string): boolean {
  if (!q) return true
  const lower = q.toLowerCase()
  return Object.values(row).some((v) => v != null && String(v).toLowerCase().includes(lower))
}

function fmtDate(v: unknown): string {
  if (!v) return '—'
  try {
    return new Date(v as string).toLocaleDateString('pt-PT')
  } catch {
    return String(v)
  }
}

function fmtPrice(v: unknown): string {
  return v != null && v !== '' && !isNaN(Number(v)) ? Number(v).toFixed(2) + ' €' : '—'
}

function fmtInativo(v: unknown): string {
  if (v === false || v === 0 || v === '0') return 'Sim'
  if (v === true  || v === 1 || v === '1') return 'Não'
  return '—'
}

function fmtBool(v: unknown): string {
  if (v === true  || v === 1 || v === '1' || v === 'true')  return 'Sim'
  if (v === false || v === 0 || v === '0' || v === 'false') return 'Não'
  return '—'
}

// ── tabs ─────────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: Icon }[] = [
  { id: 'clientes',     label: 'Clientes',     icon: Users   },
  { id: 'fornecedores', label: 'Fornecedores', icon: Truck   },
  { id: 'produtos',     label: 'Produtos',     icon: Package },
  { id: 'servicos',     label: 'Serviços',     icon: Wrench  },
]

// ── column definitions ────────────────────────────────────────────────────────

interface ColDef {
  header: string
  keys: string[]
  sortKey?: string
  numeric?: boolean
  className?: string
  format?: (val: unknown) => string
  /** special render handled by caller */
  special?: 'analitica'
}

const COLUMNS: Record<Tab, ColDef[]> = {
  clientes: [
    { header: 'NIF',                  keys: ['tax_registration_number'],  sortKey: 'tax_registration_number', className: 'font-mono text-xs' },
    { header: 'Último Aviso Enviado', keys: ['last_notice_sent_at'],      sortKey: 'last_notice_sent_at',     format: fmtDate, className: 'text-xs text-gray-500' },
    { header: 'Nome',                 keys: ['business_name'],            sortKey: 'business_name' },
    { header: 'Sub-Conta',            keys: ['sub_account'],              sortKey: 'sub_account',             className: 'text-xs font-mono text-gray-500' },
    // not_final_customer = Sujeito Passivo (não consumidor final)
    { header: 'S.P.',                 keys: ['not_final_customer'],       sortKey: 'not_final_customer',      format: fmtBool, className: 'text-xs text-center text-gray-500' },
    // cashed_vat = Regime de IVA de Caixa
    { header: 'RIC',                  keys: ['cashed_vat'],               sortKey: 'cashed_vat',              format: fmtBool, className: 'text-xs text-center text-gray-500' },
    { header: 'Inactivo?',            keys: ['active'],                   sortKey: 'active',                  format: fmtInativo, className: 'text-xs text-center' },
  ],
  fornecedores: [
    { header: 'NIF',       keys: ['tax_registration_number'],  sortKey: 'tax_registration_number', className: 'font-mono text-xs' },
    { header: 'Nome',      keys: ['business_name'],            sortKey: 'business_name' },
    { header: 'Sub-conta', keys: ['sub_account'],              sortKey: 'sub_account',             className: 'text-xs font-mono text-gray-500' },
    // is_taxable = Sujeito Passivo
    { header: 'S.P.',      keys: ['is_taxable'],               sortKey: 'is_taxable',              format: fmtBool, className: 'text-xs text-center text-gray-500' },
    // self_billing = Auto-faturação
    { header: 'A.F.',      keys: ['self_billing'],             sortKey: 'self_billing',            format: fmtBool, className: 'text-xs text-center text-gray-500' },
    // is_independent_worker = sujeito a Modelo 10
    { header: 'Modelo 10', keys: ['is_independent_worker'],    sortKey: 'is_independent_worker',   format: fmtBool, className: 'text-xs text-center text-gray-500' },
    { header: 'Inactivo?', keys: ['active'],                   sortKey: 'active',                  format: fmtInativo, className: 'text-xs text-center' },
  ],
  produtos: [
    { header: 'Código',               keys: ['item_code'],                sortKey: 'item_code',            className: 'font-mono text-xs text-gray-500' },
    // products API has no family field
    { header: 'Família',              keys: ['service_group', 'family'],  sortKey: 'service_group',        className: 'text-xs text-gray-500' },
    { header: 'Descrição',            keys: ['item_description'],         sortKey: 'item_description' },
    { header: 'Analítica',            keys: [],                           special: 'analitica' },
    // unit_of_measure not returned by API currently
    { header: 'Uni.',                 keys: ['unit_of_measure', 'unit'],  sortKey: 'unit_of_measure',      className: 'text-xs text-center text-gray-500' },
    { header: 'Preço de venda',       keys: ['sales_price'],              sortKey: 'sales_price',          numeric: true, format: fmtPrice, className: 'text-right font-medium' },
    // estimated_total_cost is the correct API field
    { header: 'Custo total estimado', keys: ['estimated_total_cost'],     sortKey: 'estimated_total_cost', numeric: true, format: fmtPrice, className: 'text-right text-gray-500' },
    // accounting_number is the closest to sub-account for items
    { header: 'Sub-Conta',            keys: ['accounting_number'],        sortKey: 'accounting_number',    className: 'text-xs font-mono text-gray-500' },
  ],
  servicos: [
    { header: 'Código',               keys: ['item_code'],                sortKey: 'item_code',            className: 'font-mono text-xs text-gray-500' },
    // service_group = Família for services
    { header: 'Família',              keys: ['service_group'],            sortKey: 'service_group',        className: 'text-xs text-gray-500' },
    { header: 'Descrição',            keys: ['item_description'],         sortKey: 'item_description' },
    { header: 'Analítica',            keys: [],                           special: 'analitica' },
    { header: 'Uni.',                 keys: ['unit_of_measure', 'unit'],  sortKey: 'unit_of_measure',      className: 'text-xs text-center text-gray-500' },
    { header: 'Preço de venda',       keys: ['sales_price'],              sortKey: 'sales_price',          numeric: true, format: fmtPrice, className: 'text-right font-medium' },
    { header: 'Custo total estimado', keys: ['estimated_total_cost'],     sortKey: 'estimated_total_cost', numeric: true, format: fmtPrice, className: 'text-right text-gray-500' },
    { header: 'Sub-Conta',            keys: ['accounting_number'],        sortKey: 'accounting_number',    className: 'text-xs font-mono text-gray-500' },
  ],
}

// ── sort icon ─────────────────────────────────────────────────────────────────

function SortIcon({ field, sortField, sortDir }: { field: string; sortField: string; sortDir: SortDir }) {
  if (sortField !== field) return <ArrowUpDown className="inline w-3 h-3 ml-1 text-gray-300" />
  return sortDir === 'asc'
    ? <ArrowUp   className="inline w-3 h-3 ml-1 text-primary-500" />
    : <ArrowDown className="inline w-3 h-3 ml-1 text-primary-500" />
}

// ── Analítica modal ──────────────────────────────────────────────────────────

interface CostLine {
  centro_custo: string
  percentagem: string
}

interface AnalyticConfig {
  rubrica_toc_id?: number
  rubrica_id: string
  rubrica_name: string
  use_default: boolean
  lines: CostLine[]
}

interface Rubrica { id: number; code: string; name: string }
interface SavedAnalytic { entries: AnalyticConfig[] }

// Lista completa de dimensões analíticas TOConline — 68 rubricas (cost_dimensions/search)
const RUBRICAS_ANALITICAS: Rubrica[] = [
  // 01 – Rendimentos
  { id: 4566673, code: '010101', name: 'Vendas A' },
  { id: 4566674, code: '010102', name: 'Vendas B' },
  { id: 4566675, code: '010201', name: 'Serviço A' },
  { id: 4566676, code: '010202', name: 'Serviço B' },
  // 02 – Gastos directos
  { id: 4566677, code: '020101', name: 'Apuramento cmv' },
  { id: 4566678, code: '020102', name: 'Outros custos das vendas' },
  { id: 4566679, code: '020201', name: 'Outros custos dos serviços' },
  // 03 – Gastos indirectos
  { id: 4566680, code: '030101', name: 'Outros Custos do Produto' },
  { id: 4566681, code: '030201', name: 'Electricidade' },
  { id: 4566682, code: '030202', name: 'Água' },
  { id: 4566683, code: '030203', name: 'Outros fluidos' },
  { id: 4566684, code: '030204', name: 'Ferramentas & Livros e documentação técnica' },
  { id: 4566685, code: '030205', name: 'Alojamentos Sites / Servidores / Licenças' },
  { id: 4566686, code: '030206', name: 'Material de escritório' },
  { id: 4566687, code: '030207', name: 'Rendas equipamentos' },
  { id: 4566688, code: '030208', name: 'Rendas instalações' },
  { id: 4566689, code: '030209', name: 'Seguro estabelecimento' },
  { id: 4566690, code: '030210', name: 'Seguro mercadorias' },
  { id: 4566691, code: '030211', name: 'Conservações instalações' },
  { id: 4566692, code: '030212', name: 'Conservações equipamento' },
  { id: 4566693, code: '030213', name: 'Conservações veículos' },
  { id: 4566694, code: '030214', name: 'Limpeza, higiene e conforto' },
  { id: 4566695, code: '030215', name: 'Assistência informática' },
  { id: 4566696, code: '030216', name: 'Outros Custos gerais' },
  { id: 4566697, code: '030301', name: 'Telefone' },
  { id: 4566698, code: '030302', name: 'Telemoveis' },
  { id: 4566699, code: '030303', name: 'Internet' },
  { id: 4566700, code: '030304', name: 'Outras Comunicações' },
  { id: 4566701, code: '030401', name: 'Ajudas de custo' },
  { id: 4566702, code: '030402', name: 'Kms viatura própria' },
  { id: 4566703, code: '030403', name: 'Combustíveis' },
  { id: 4566704, code: '030404', name: 'Viaverde e Estacionamentos' },
  { id: 4566705, code: '030405', name: 'Aluguer Ocasional de Viaturas' },
  { id: 4566706, code: '030406', name: 'Viagens' },
  { id: 4566707, code: '030407', name: 'Estadias' },
  { id: 4566708, code: '030408', name: 'Refeições' },
  { id: 4566709, code: '030409', name: 'Outros custos deslocações' },
  { id: 4566710, code: '030501', name: 'Participação em eventos' },
  { id: 4566711, code: '030502', name: 'Produção de Conteúdos' },
  { id: 4566712, code: '030503', name: 'Merchandising e ofertas' },
  { id: 4566713, code: '030504', name: 'Marketing directo' },
  { id: 4566714, code: '030505', name: 'Publicidade Media&Other' },
  { id: 4566715, code: '030506', name: 'Outros Custos Marketing' },
  { id: 4566716, code: '030601', name: 'TOC' },
  { id: 4566717, code: '030602', name: 'ROC' },
  { id: 4566718, code: '030603', name: 'Advogados' },
  { id: 4566719, code: '030604', name: 'Outros custos legais/fiscais' },
  { id: 4566720, code: '030701', name: 'Processamento Salarial' },
  { id: 4566721, code: '030702', name: 'Estimativa Custos com Pessoal' },
  { id: 4566722, code: '030703', name: 'Seguro Acidentes Trabalho' },
  { id: 4566723, code: '030704', name: 'Seguro Vida' },
  { id: 4566724, code: '030705', name: 'Seguro Saude' },
  { id: 4566725, code: '030706', name: 'Medicina no Trabalho' },
  { id: 4566726, code: '030707', name: 'Formação' },
  { id: 4566727, code: '030708', name: 'Capitalização RH' },
  { id: 4566728, code: '030709', name: 'Outros Custos com pessoal' },
  { id: 4566729, code: '030801', name: 'Custos e comissões bancárias' },
  { id: 4566730, code: '030802', name: 'Diferenças cambiais' },
  { id: 4566731, code: '030803', name: 'Outros Custos' },
  // 04 – Imparidades / Depreciações
  { id: 4566732, code: '040101', name: 'De Clientes' },
  { id: 4566733, code: '040102', name: 'De Stocks' },
  { id: 4566734, code: '040103', name: 'Outros' },
  { id: 4566735, code: '040201', name: 'AFTangíveis' },
  { id: 4566736, code: '040202', name: 'AFIntangíveis' },
  // 05 – Gastos financeiros
  { id: 4566737, code: '050101', name: 'Juros financiamentos' },
  { id: 4566738, code: '050102', name: 'Outros Custos financeiros' },
  { id: 4566739, code: '050201', name: 'Juros leasings' },
  // 06 – Imposto
  { id: 4566740, code: '060101', name: 'Estimativa do Imposto' },
]

function AnaliticaModal({
  item, itemType, clientId, onClose,
}: {
  item: TocRow
  itemType: 'product' | 'service'
  clientId: string
  onClose: () => void
}) {
  const qc = useQueryClient()
  const itemId    = String(item.id ?? '')
  const itemLabel = String(getVal(item, ['item_description', 'name']) ?? itemId)

  const { data: saved } = useQuery<SavedAnalytic | null>({
    queryKey: ['toc-analytic', clientId, itemId, itemType],
    queryFn: () =>
      (api.get(`/toconline/${clientId}/analytics/${itemId}?itemType=${itemType}`) as Promise<SavedAnalytic | null>)
        .catch(() => null),
  })

  const saveMutation = useMutation({
    mutationFn: (entries: AnalyticConfig[]) =>
      api.put(`/toconline/${clientId}/analytics/${itemId}`, { itemType, entries }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['toc-analytic', clientId, itemId, itemType] })
      qc.invalidateQueries({ queryKey: ['toc-analytics', clientId] })
      onClose()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      api.delete(`/toconline/${clientId}/analytics/${itemId}?itemType=${itemType}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['toc-analytic', clientId, itemId, itemType] })
      qc.invalidateQueries({ queryKey: ['toc-analytics', clientId] })
      onClose()
    },
  })

  // ── rubrica state (top-level, one per config) ─────────────────────────────
  const [rubricaId,   setRubricaId]   = useState('')
  const [rubricaName, setRubricaName] = useState('')
  const [rubricaTocId, setRubricaTocId] = useState<number | undefined>(undefined)
  const [rubricaSearch, setRubricaSearch] = useState('')
  const [rubricaOpen,   setRubricaOpen]   = useState(false)

  // ── por omissão (top-level, disables all lines when checked) ─────────────
  const [useDefault, setUseDefault] = useState(false)

  // ── cost center lines ─────────────────────────────────────────────────────
  const [lines, setLines] = useState<CostLine[]>([{ centro_custo: '', percentagem: '' }])

  const dropdownRef = useRef<HTMLDivElement>(null)

  // Populate from saved data once loaded
  useEffect(() => {
    if (!saved) return
    const cfg = saved.entries?.[0]
    if (!cfg) return
    setRubricaId(cfg.rubrica_id ?? '')
    setRubricaName(cfg.rubrica_name ?? '')
    setRubricaTocId(cfg.rubrica_toc_id)
    setRubricaSearch(cfg.rubrica_id ? `${cfg.rubrica_id} – ${cfg.rubrica_name}` : '')
    setUseDefault(cfg.use_default ?? false)
    setLines(cfg.lines?.length ? cfg.lines : [{ centro_custo: '', percentagem: '' }])
  }, [saved])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setRubricaOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filteredRubricas = () => {
    const q = rubricaSearch.toLowerCase()
    if (!q) return RUBRICAS_ANALITICAS
    return RUBRICAS_ANALITICAS.filter(c =>
      c.code.includes(q) || c.name.toLowerCase().includes(q)
    )
  }

  function updateLine(i: number, patch: Partial<CostLine>) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }
  function removeLine(i: number) {
    setLines(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev)
  }
  function addLine() {
    setLines(prev => [...prev, { centro_custo: '', percentagem: '' }])
  }

  const linesWithPct  = lines.filter(l => l.percentagem)
  const totalPct      = lines.reduce((s, l) => s + (parseFloat(l.percentagem) || 0), 0)
  const pctOk         = linesWithPct.length === 0 || Math.abs(totalPct - 100) < 0.01

  function handleSave() {
    if (!rubricaId) return
    const config: AnalyticConfig = {
      rubrica_toc_id: rubricaTocId,
      rubrica_id:   rubricaId,
      rubrica_name: rubricaName,
      use_default:  useDefault,
      lines:        lines.filter(l => l.centro_custo || l.percentagem),
    }
    saveMutation.mutate([config])
  }

  const linesDisabled = useDefault || !rubricaId

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg flex flex-col"
        style={{ maxHeight: '90vh' }}
        ref={dropdownRef}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-primary-600" />
            <span className="font-semibold text-gray-900 text-sm">Distribuição por centros de custo</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Item (readonly) */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Item</label>
            <div className="bg-gray-50 text-gray-700 text-sm cursor-default select-none py-2 px-3 rounded-lg border border-gray-200">
              {itemLabel}
            </div>
          </div>

          {/* Rubrica — one per config, top-level */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-500 mb-1">Rubrica</label>
            <input
              className="input text-sm w-full pr-7"
              placeholder="Pesquisar por código ou nome..."
              value={rubricaSearch}
              onFocus={() => setRubricaOpen(true)}
              onBlur={() => {
                // Clear the search text if the user didn't pick from the list
                if (!rubricaId) setRubricaSearch('')
                setTimeout(() => setRubricaOpen(false), 150)
              }}
              onChange={e => {
                setRubricaSearch(e.target.value)
                setRubricaId('')
                setRubricaName('')
                setRubricaTocId(undefined)
                setRubricaOpen(true)
              }}
            />
            {rubricaId && (
              <Check className="absolute right-2 top-[calc(50%+8px)] -translate-y-1/2 w-3.5 h-3.5 text-green-500 pointer-events-none" />
            )}
            {rubricaOpen && (
              <div className="absolute z-20 top-full left-0 right-0 mt-0.5 bg-white border border-gray-200 rounded-lg shadow-xl max-h-52 overflow-y-auto">
                {filteredRubricas().map(c => (
                  <button
                    key={c.code}
                    type="button"
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => {
                      setRubricaTocId(c.id)
                      setRubricaId(c.code)
                      setRubricaName(c.name)
                      setRubricaSearch(`${c.code} – ${c.name}`)
                      setRubricaOpen(false)
                    }}
                    className={`w-full text-left px-3 py-2 text-xs text-gray-700 flex items-baseline gap-2 ${
                      rubricaId === c.code
                        ? 'bg-primary-50 text-primary-700 font-medium'
                        : 'hover:bg-primary-50 hover:text-primary-700'
                    }`}
                  >
                    <span className="font-mono text-gray-400 flex-shrink-0 w-16">{c.code}</span>
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
                {rubricaSearch.trim() && filteredRubricas().length === 0 && (
                  <div className="px-3 py-2 text-xs text-gray-400 italic">
                    Nenhuma rubrica encontrada
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Por omissão — top-level, disables all lines */}
          <label className={`flex items-center gap-2 w-fit ${rubricaId ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'}`}>
            <input
              type="checkbox"
              disabled={!rubricaId}
              checked={useDefault}
              onChange={e => setUseDefault(e.target.checked)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:cursor-not-allowed"
            />
            <span className="text-xs text-gray-700">Por omissão</span>
          </label>

          {/* Cost center lines */}
          <div className={`space-y-2 transition-opacity ${linesDisabled ? 'opacity-40 pointer-events-none' : ''}`}>
            <div className="grid grid-cols-[1fr_7rem_1.5rem] gap-2 px-1">
              <span className="text-xs font-medium text-gray-500">
                Centro de custo
                {!rubricaId && <span className="ml-1 text-gray-400">(escolha uma rubrica primeiro)</span>}
              </span>
              <span className="text-xs font-medium text-gray-500">Percentagem</span>
              <span />
            </div>
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-[1fr_7rem_1.5rem] gap-2 items-center">
                <input
                  className="input text-sm w-full"
                  placeholder="Ex: CC001"
                  disabled={linesDisabled}
                  value={line.centro_custo}
                  onChange={e => updateLine(i, { centro_custo: e.target.value })}
                />
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    disabled={linesDisabled}
                    className="input text-sm w-full pr-6"
                    placeholder="0"
                    value={line.percentagem}
                    onChange={e => updateLine(i, { percentagem: e.target.value })}
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">%</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(i)}
                  disabled={lines.length === 1}
                  className="text-gray-300 hover:text-red-500 disabled:opacity-0 transition-colors"
                  title="Remover linha"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addLine}
            disabled={linesDisabled}
            className="flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors py-1"
          >
            <Plus className="w-3.5 h-3.5" />
            ADICIONAR CENTRO DE CUSTO
          </button>

          {/* Percentage validation */}
          {linesWithPct.length > 0 && !pctOk && (
            <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              Total: {totalPct.toFixed(2)}% — deve somar 100%
            </div>
          )}
          {linesWithPct.length > 0 && pctOk && (
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <Check className="w-3.5 h-3.5 flex-shrink-0" />
              Total: 100%
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button
            type="button"
            onClick={() => deleteMutation.mutate()}
            disabled={!saved?.entries?.length || deleteMutation.isPending}
            className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remover configuração
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-secondary text-sm px-4">CANCELAR</button>
            <button
              onClick={handleSave}
              disabled={!rubricaId || saveMutation.isPending}
              className="btn-primary text-sm px-4 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saveMutation.isPending ? 'A guardar…' : 'GRAVAR'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── filter types ──────────────────────────────────────────────────────────────

type EstadoFilter  = '' | 'ativo' | 'inativo'
type NoticeFilter  = '' | 'today' | 'week' | 'month' | '3months' | 'never'
type Modelo10Filter = '' | 'with' | 'without'

function matchNotice(row: TocRow, f: NoticeFilter): boolean {
  if (f === '') return true
  const raw = row.last_notice_sent_at ?? row.last_warning
  if (f === 'never') return !raw
  if (!raw) return false
  const d = new Date(raw as string)
  const now = new Date()
  const msPerDay = 86400000
  const diff = now.getTime() - d.getTime()
  if (f === 'today')   return diff < msPerDay && d.toDateString() === now.toDateString()
  if (f === 'week')    return diff < 7 * msPerDay
  if (f === 'month')   return diff < 30 * msPerDay
  if (f === '3months') return diff < 90 * msPerDay
  return true
}

function isInativo(row: TocRow): boolean {
  // customers/suppliers use `active`; products/services use `is_active`
  const v = row.active ?? row.is_active
  return v === false || v === 0 || v === '0' || v === 'false'
}

// ── tab table ─────────────────────────────────────────────────────────────────

function TabTable({
  rows, loading, error, tab, search, clientId,
}: {
  rows: TocRow[]
  loading: boolean
  error: boolean
  tab: Tab
  search: string
  clientId: string
}) {
  const isEntity = tab === 'clientes' || tab === 'fornecedores'
  const itemType  = tab === 'produtos' ? 'product' : 'service'
  const defaultSort = isEntity ? 'business_name' : 'item_description'

  const [sortField, setSortField] = useState(defaultSort)
  const [sortDir,   setSortDir]   = useState<SortDir>('asc')

  const [filterEstado,   setFilterEstado]   = useState<EstadoFilter>('ativo')
  const [filterNotice,   setFilterNotice]   = useState<NoticeFilter>('')
  const [filterModelo10, setFilterModelo10] = useState<Modelo10Filter>('')

  const [analiticaItem, setAnaliticaItem] = useState<TocRow | null>(null)

  // Pre-load all analytics for this tab so the column badge works
  const { data: analytics = [] } = useQuery<{ itemId: string; entries: AnalyticConfig[] }[]>({
    queryKey: ['toc-analytics', clientId, itemType],
    queryFn: () => api.get(`/toconline/${clientId}/analytics?itemType=${itemType}`),
    enabled: !isEntity,
    staleTime: 60_000,
  })
  const analyticsMap = new Map(analytics.map(a => [a.itemId, a.entries[0] ?? null]))

  useEffect(() => {
    setSortField(isEntity ? 'business_name' : 'item_description')
    setSortDir('asc')
    setFilterEstado('ativo')
    setFilterNotice('')
    setFilterModelo10('')
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="p-10 flex items-center justify-center">
        <div className="animate-spin rounded-full h-7 w-7 border-2 border-primary-600 border-t-transparent" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-10 flex flex-col items-center gap-3 text-center">
        <AlertTriangle className="w-8 h-8 text-amber-400" />
        <p className="text-sm text-gray-500">
          Não foi possível carregar os dados do TOConline.<br />
          Verifique a ligação em <span className="font-medium">Definições → TOConline</span>.
        </p>
      </div>
    )
  }

  function handleSort(key: string, numeric = false) {
    if (sortField === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(key)
      setSortDir(numeric ? 'desc' : 'asc')
    }
  }

  // filters
  const filtered = rows.filter(r => {
    if (!searchMatch(r, search)) return false
    if (filterEstado === 'ativo'   &&  isInativo(r)) return false
    if (filterEstado === 'inativo' && !isInativo(r)) return false
    if (tab === 'clientes' && !matchNotice(r, filterNotice)) return false
    if (tab === 'fornecedores') {
      const m10 = r.is_independent_worker
      if (filterModelo10 === 'with'    && m10 !== true) return false
      if (filterModelo10 === 'without' && m10 === true) return false
    }
    return true
  })

  // sort
  const sorted = [...filtered].sort((a, b) => {
    const col = COLUMNS[tab].find(c => c.sortKey === sortField)
    const va = a[sortField]
    const vb = b[sortField]
    if (col?.numeric) {
      const diff = Number(va ?? 0) - Number(vb ?? 0)
      return sortDir === 'asc' ? diff : -diff
    }
    const cmp = String(va ?? '').localeCompare(String(vb ?? ''), 'pt')
    return sortDir === 'asc' ? cmp : -cmp
  })

  const hasFilters = filterEstado !== 'ativo' || filterNotice !== '' || filterModelo10 !== ''

  function clearFilters() {
    setFilterEstado('ativo')
    setFilterNotice('')
    setFilterModelo10('')
  }

  const cols = COLUMNS[tab]

  const NOTICE_OPTIONS: { value: NoticeFilter; label: string }[] = [
    { value: '', label: 'Todos' },
    { value: 'today',   label: 'Hoje' },
    { value: 'week',    label: 'Esta semana' },
    { value: 'month',   label: 'Este mês' },
    { value: '3months', label: 'Últimos 3 meses' },
    { value: 'never',   label: 'Nunca' },
  ]

  return (
    <>
      {analiticaItem && (
        <AnaliticaModal
          item={analiticaItem}
          itemType={itemType}
          clientId={clientId}
          onClose={() => setAnaliticaItem(null)}
        />
      )}

      {/* Filter toolbar */}
      <div className="px-5 py-2.5 border-b border-gray-100 flex flex-wrap items-center gap-2">

        {/* Estado */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
          {(['ativo', 'inativo', ''] as EstadoFilter[]).map((v, i) => {
            const label = v === 'ativo' ? 'Ativo' : v === 'inativo' ? 'Inativo' : 'Todos'
            return (
              <button
                key={v || 'all'}
                onClick={() => setFilterEstado(v)}
                className={`px-3 py-1.5 transition-colors ${filterEstado === v ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'}${i > 0 ? ' border-l border-gray-200' : ''}`}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Último aviso (clientes only) */}
        {tab === 'clientes' && (
          <select
            className="input w-auto text-xs py-1.5"
            value={filterNotice}
            onChange={e => setFilterNotice(e.target.value as NoticeFilter)}
          >
            {NOTICE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label === 'Todos' ? 'Último aviso — Todos' : o.label}</option>
            ))}
          </select>
        )}

        {/* Modelo 10 (fornecedores only) */}
        {tab === 'fornecedores' && (
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
            {([
              { value: '' as Modelo10Filter, label: 'Modelo 10 — Todos' },
              { value: 'with' as Modelo10Filter, label: 'Preenchido' },
              { value: 'without' as Modelo10Filter, label: 'Vazio' },
            ]).map(({ value, label }, i) => (
              <button
                key={value || 'all'}
                onClick={() => setFilterModelo10(value)}
                className={`px-3 py-1.5 transition-colors ${filterModelo10 === value ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'}${i > 0 ? ' border-l border-gray-200' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 px-2 py-1.5 hover:bg-gray-50 rounded-lg transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Limpar filtros
          </button>
        )}

        <span className="ml-auto text-xs text-gray-400">
          {sorted.length !== rows.length ? `${sorted.length} de ${rows.length}` : sorted.length}{' '}
          registo{sorted.length !== 1 ? 's' : ''}
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="p-10 text-center text-sm text-gray-400">
          {rows.length === 0 ? 'Sem registos.' : 'Nenhum resultado para os filtros aplicados.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                {cols.map((c) => (
                  <th
                    key={c.header}
                    onClick={() => c.sortKey && handleSort(c.sortKey, c.numeric)}
                    className={`text-left px-5 py-3 whitespace-nowrap font-medium ${c.sortKey ? 'cursor-pointer hover:text-gray-700 select-none' : ''}`}
                  >
                    {c.header}
                    {c.sortKey && <SortIcon field={c.sortKey} sortField={sortField} sortDir={sortDir} />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.map((row, i) => (
                <tr key={(row.id as string | number | undefined) ?? i} className="hover:bg-gray-50">
                  {cols.map((c) => {
                    if (c.special === 'analitica') {
                      const rowId = String(row.id ?? '')
                      const cfg   = analyticsMap.get(rowId)
                      const count = cfg?.lines?.length ?? 0
                      return (
                        <td key="analitica" className="px-5 py-3">
                          <button
                            onClick={() => setAnaliticaItem(row)}
                            className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
                              cfg
                                ? 'text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5 hover:bg-green-100'
                                : 'text-primary-600 hover:text-primary-700 hover:underline'
                            }`}
                          >
                            {cfg ? (
                              <>
                                <Check className="w-3 h-3" />
                                {count > 0 ? `${count} ${count === 1 ? 'centro' : 'centros'}` : cfg.rubrica_id}
                              </>
                            ) : (
                              <>
                                <BarChart2 className="w-3 h-3" />
                                Configurar
                              </>
                            )}
                          </button>
                        </td>
                      )
                    }
                    const val = getVal(row, c.keys)
                    const display = c.format ? c.format(val) : (val != null ? String(val) : '—')
                    return (
                      <td key={c.header} className={`px-5 py-3 text-gray-700 ${c.className ?? ''}`}>
                        {display}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function EmpresaPage() {
  const { selectedClientId } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('clientes')
  const [search, setSearch] = useState('')

  const enabled = !!selectedClientId

  const { data: customers, isLoading: loadingCustomers, isError: errorCustomers } = useQuery<TocRow[]>({
    queryKey: ['toc-customers', selectedClientId],
    queryFn: async () => toRows(await api.get(`/toconline/${selectedClientId}/customers`)),
    enabled, retry: false, throwOnError: false,
  })
  const { data: suppliers, isLoading: loadingSuppliers, isError: errorSuppliers } = useQuery<TocRow[]>({
    queryKey: ['toc-suppliers', selectedClientId],
    queryFn: async () => toRows(await api.get(`/toconline/${selectedClientId}/suppliers`)),
    enabled, retry: false, throwOnError: false,
  })
  const { data: items, isLoading: loadingItems, isError: errorItems } = useQuery<TocRow[]>({
    queryKey: ['toc-items', selectedClientId],
    queryFn: async () => toRows(await api.get(`/toconline/${selectedClientId}/items`)),
    enabled, retry: false, throwOnError: false,
  })
  const { data: services, isLoading: loadingServices, isError: errorServices } = useQuery<TocRow[]>({
    queryKey: ['toc-services', selectedClientId],
    queryFn: async () => toRows(await api.get(`/toconline/${selectedClientId}/services`)),
    enabled, retry: false, throwOnError: false,
  })

  type TabState = { rows: TocRow[]; loading: boolean; error: boolean }
  const tabState: Record<Tab, TabState> = {
    clientes:     { rows: customers ?? [], loading: loadingCustomers, error: errorCustomers },
    fornecedores: { rows: suppliers ?? [], loading: loadingSuppliers, error: errorSuppliers },
    produtos:     { rows: items ?? [],     loading: loadingItems,     error: errorItems },
    servicos:     { rows: services ?? [],  loading: loadingServices,  error: errorServices },
  }

  const counts: Record<Tab, number | undefined> = {
    clientes:     loadingCustomers ? undefined : (customers?.length ?? 0),
    fornecedores: loadingSuppliers ? undefined : (suppliers?.length ?? 0),
    produtos:     loadingItems     ? undefined : (items?.length ?? 0),
    servicos:     loadingServices  ? undefined : (services?.length ?? 0),
  }

  const { rows, loading, error } = tabState[activeTab]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Empresa</h1>
        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">TOConline</span>
      </div>

      <div className="card">
        {/* Tabs */}
        <div className="flex items-center border-b border-gray-100 px-2">
          {TABS.map((tab) => {
            const count = counts[tab.id]
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setSearch('') }}
                className={`flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  activeTab === tab.id
                    ? 'border-primary-600 text-primary-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {count != null && (
                  <span className={`text-xs rounded-full px-1.5 py-0.5 leading-none font-semibold ${
                    activeTab === tab.id ? 'bg-primary-100 text-primary-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
            <input
              className="input pl-8 text-sm py-1.5 w-full"
              placeholder={`Pesquisar ${TABS.find((t) => t.id === activeTab)?.label.toLowerCase()}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <TabTable rows={rows} loading={loading} error={error} tab={activeTab} search={search} clientId={selectedClientId!} />
      </div>
    </div>
  )
}
