import { useState, useEffect, useRef } from 'react'
import type { ComponentType, CSSProperties } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import {
  Search, Users, Truck, Package, Wrench, AlertTriangle,
  ArrowUp, ArrowDown, ArrowUpDown, X, Plus, BarChart2, Trash2, Check, FilePlus2, Eye, Pencil, Mail,
} from 'lucide-react'

type Tab = 'clientes' | 'fornecedores' | 'produtos' | 'servicos'
type TocRow = Record<string, unknown>
type Icon = ComponentType<{ className?: string }>
type SortDir = 'asc' | 'desc'

// â"€â"€ helpers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

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

// â"€â"€ tabs â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

const TABS: { id: Tab; label: string; icon: Icon }[] = [
  { id: 'clientes',     label: 'Clientes',     icon: Users   },
  { id: 'fornecedores', label: 'Fornecedores', icon: Truck   },
  { id: 'produtos',     label: 'Produtos',     icon: Package },
  { id: 'servicos',     label: 'Serviços',     icon: Wrench  },
]

// â"€â"€ column definitions â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

interface ColDef {
  header: string
  keys: string[]
  sortKey?: string
  numeric?: boolean
  className?: string
  format?: (val: unknown) => string
  /** special render handled by caller */
  special?: 'analitica' | 'nova-conta'
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
    { header: '',                     keys: [],                           special: 'nova-conta' as const },
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
    { header: '',          keys: [],                           special: 'nova-conta' as const },
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

// â"€â"€ sort icon â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

function SortIcon({ field, sortField, sortDir }: { field: string; sortField: string; sortDir: SortDir }) {
  if (sortField !== field) return <ArrowUpDown className="inline w-3 h-3 ml-1 text-gray-300" />
  return sortDir === 'asc'
    ? <ArrowUp   className="inline w-3 h-3 ml-1 text-primary-500" />
    : <ArrowDown className="inline w-3 h-3 ml-1 text-primary-500" />
}

// â"€â"€ Analítica modal â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

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
  // 01 — Rendimentos
  { id: 4566673, code: '010101', name: 'Vendas A' },
  { id: 4566674, code: '010102', name: 'Vendas B' },
  { id: 4566675, code: '010201', name: 'Serviço A' },
  { id: 4566676, code: '010202', name: 'Serviço B' },
  // 02 — Gastos directos
  { id: 4566677, code: '020101', name: 'Apuramento cmv' },
  { id: 4566678, code: '020102', name: 'Outros custos das vendas' },
  { id: 4566679, code: '020201', name: 'Outros custos dos serviços' },
  // 03 — Gastos indirectos
  { id: 4566680, code: '030101', name: 'Outros Custos do Produto' },
  { id: 4566681, code: '030201', name: 'Electricidade' },
  { id: 4566682, code: '030202', name: 'Ãgua' },
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
  // 04 — Imparidades / Depreciações
  { id: 4566732, code: '040101', name: 'De Clientes' },
  { id: 4566733, code: '040102', name: 'De Stocks' },
  { id: 4566734, code: '040103', name: 'Outros' },
  { id: 4566735, code: '040201', name: 'AFTangíveis' },
  { id: 4566736, code: '040202', name: 'AFIntangíveis' },
  // 05 — Gastos financeiros
  { id: 4566737, code: '050101', name: 'Juros financiamentos' },
  { id: 4566738, code: '050102', name: 'Outros Custos financeiros' },
  { id: 4566739, code: '050201', name: 'Juros leasings' },
  // 06 — Imposto
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

  // â"€â"€ rubrica state (top-level, one per config) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const [rubricaId,   setRubricaId]   = useState('')
  const [rubricaName, setRubricaName] = useState('')
  const [rubricaTocId, setRubricaTocId] = useState<number | undefined>(undefined)
  const [rubricaSearch, setRubricaSearch] = useState('')
  const [rubricaOpen,   setRubricaOpen]   = useState(false)

  // â"€â"€ por omissão (top-level, disables all lines when checked) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const [useDefault, setUseDefault] = useState(false)

  // â"€â"€ cost center lines â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
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
    setRubricaSearch(cfg.rubrica_id ? `${cfg.rubrica_id} — ${cfg.rubrica_name}` : '')
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
                      setRubricaSearch(`${c.code} — ${c.name}`)
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

// â"€â"€ Nova Conta modal â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

interface DocLine {
  descricao: string
  quantidade: string
  preco_unit: string
  iva: string
}

const TAX_RATES = [0, 6, 13, 23]

function NovaContaModal({
  type, entity, clientId, onClose,
}: {
  type: 'receber' | 'pagar'
  entity: TocRow
  clientId: string
  onClose: () => void
}) {
  const isReceber  = type === 'receber'
  const entityName = String(getVal(entity, ['business_name', 'name']) ?? entity.id)

  const today  = new Date().toISOString().slice(0, 10)
  const plus30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)

  const [docType,    setDocType]    = useState(isReceber ? 'FT' : 'FC')
  const [referencia, setReferencia] = useState('')
  const [data,       setData]       = useState(today)
  const [vencimento, setVencimento] = useState(plus30)
  const [lines, setLines] = useState<DocLine[]>([
    { descricao: '', quantidade: '1', preco_unit: '', iva: '23' },
  ])

  const mutation = useMutation({
    mutationFn: (payload: unknown) =>
      isReceber
        ? api.post(`/toconline/${clientId}/sales`, payload)
        : api.post(`/toconline/${clientId}/purchases`, payload),
    onSuccess: onClose,
  })

  function updateLine(i: number, patch: Partial<DocLine>) {
    setLines(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }
  function removeLine(i: number) {
    if (lines.length > 1) setLines(prev => prev.filter((_, idx) => idx !== i))
  }
  function addLine() {
    setLines(prev => [...prev, { descricao: '', quantidade: '1', preco_unit: '', iva: '23' }])
  }

  const subtotal = lines.reduce((s, l) => s + (parseFloat(l.quantidade) || 0) * (parseFloat(l.preco_unit) || 0), 0)
  const ivaTotal = lines.reduce((s, l) => s + (parseFloat(l.quantidade) || 0) * (parseFloat(l.preco_unit) || 0) * ((parseFloat(l.iva) || 0) / 100), 0)

  function handleSubmit() {
    const mappedLines = lines
      .filter(l => l.descricao || l.preco_unit)
      .map(l => ({
        description:     l.descricao,
        quantity:        parseFloat(l.quantidade) || 1,
        unit_price:      parseFloat(l.preco_unit) || 0,
        tax_percentage:  parseFloat(l.iva) || 0,
      }))

    const payload = isReceber
      ? {
          document_type:          docType,
          date:                   data,
          due_date:               vencimento,
          customer_id:            entity.id,
          customer_business_name: entityName,
          lines:                  mappedLines,
        }
      : {
          document_type:           docType,
          date:                    data,
          due_date:                vencimento,
          supplier_id:             entity.id,
          supplier_business_name:  entityName,
          external_reference:      referencia || undefined,
          lines:                   mappedLines,
        }

    mutation.mutate(payload)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: '90vh' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <FilePlus2 className="w-4 h-4 text-primary-600" />
            <span className="font-semibold text-gray-900 text-sm">
              {isReceber ? 'Nova Conta a Receber' : 'Nova Conta a Pagar'}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* Entity + tipo de documento */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {isReceber ? 'Cliente' : 'Fornecedor'}
              </label>
              <div className="bg-gray-50 text-gray-700 text-sm py-2 px-3 rounded-lg border border-gray-200 truncate">
                {entityName}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Tipo de documento</label>
              <select
                className="input text-sm w-full"
                value={docType}
                onChange={e => setDocType(e.target.value)}
              >
                {isReceber ? (
                  <>
                    <option value="FT">FT — Fatura</option>
                    <option value="FS">FS — Fatura Simplificada</option>
                    <option value="FR">FR — Fatura-Recibo</option>
                  </>
                ) : (
                  <option value="FC">FC — Fatura de Compra</option>
                )}
              </select>
            </div>
          </div>

          {/* Referência (pagar) */}
          {!isReceber && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Referência externa <span className="text-gray-400">(nº da fatura do fornecedor)</span>
              </label>
              <input
                className="input text-sm w-full"
                placeholder="Ex: FT 2024/123"
                value={referencia}
                onChange={e => setReferencia(e.target.value)}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Data do documento</label>
              <input type="date" className="input text-sm w-full" value={data} onChange={e => setData(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Data de vencimento</label>
              <input type="date" className="input text-sm w-full" value={vencimento} onChange={e => setVencimento(e.target.value)} />
            </div>
          </div>

          {/* Lines */}
          <div>
            <div className="grid grid-cols-[1fr_4.5rem_6.5rem_5rem_1.5rem] gap-2 px-1 mb-1">
              <span className="text-xs font-medium text-gray-500">Descrição</span>
              <span className="text-xs font-medium text-gray-500 text-center">Qtd</span>
              <span className="text-xs font-medium text-gray-500 text-right">Preço unit.</span>
              <span className="text-xs font-medium text-gray-500 text-center">IVA</span>
              <span />
            </div>
            <div className="space-y-2">
              {lines.map((line, i) => (
                <div key={i} className="grid grid-cols-[1fr_4.5rem_6.5rem_5rem_1.5rem] gap-2 items-center">
                  <input
                    className="input text-sm w-full"
                    placeholder="Descrição do item"
                    value={line.descricao}
                    onChange={e => updateLine(i, { descricao: e.target.value })}
                  />
                  <input
                    type="number" min="0" step="0.001"
                    className="input text-sm w-full text-center"
                    placeholder="1"
                    value={line.quantidade}
                    onChange={e => updateLine(i, { quantidade: e.target.value })}
                  />
                  <div className="relative">
                    <input
                      type="number" min="0" step="0.01"
                      className="input text-sm w-full pr-5"
                      placeholder="0.00"
                      value={line.preco_unit}
                      onChange={e => updateLine(i, { preco_unit: e.target.value })}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">€</span>
                  </div>
                  <select
                    className="input text-sm w-full text-center"
                    value={line.iva}
                    onChange={e => updateLine(i, { iva: e.target.value })}
                  >
                    {TAX_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    disabled={lines.length === 1}
                    className="text-gray-300 hover:text-red-500 disabled:opacity-0 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addLine}
              className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:text-primary-700 transition-colors py-1"
            >
              <Plus className="w-3.5 h-3.5" />
              ADICIONAR LINHA
            </button>
          </div>

          {/* Totals */}
          <div className="border-t border-gray-100 pt-3 space-y-1">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Subtotal (s/ IVA)</span>
              <span className="font-mono">{subtotal.toFixed(2)} €</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>IVA</span>
              <span className="font-mono">{ivaTotal.toFixed(2)} €</span>
            </div>
            <div className="flex justify-between text-sm font-semibold text-gray-900">
              <span>Total</span>
              <span className="font-mono">{(subtotal + ivaTotal).toFixed(2)} €</span>
            </div>
          </div>

          {mutation.isError && (
            <div className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
              {(mutation.error as Error).message}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} className="btn-secondary text-sm px-4">CANCELAR</button>
          <button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="btn-primary text-sm px-4"
          >
            {mutation.isPending ? 'A criar…' : 'CRIAR DOCUMENTO'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── NIF validation (módulo 11) ────────────────────────────────────────────────

function validarNIF(nif: string): boolean {
  if (!/^\d{9}$/.test(nif)) return false
  if (![1, 2, 3, 5, 6, 7, 8, 9].includes(parseInt(nif[0]))) return false
  let soma = 0
  for (let i = 0; i < 8; i++) soma += parseInt(nif[i]) * (9 - i)
  const resto = soma % 11
  const digito = resto < 2 ? 0 : 11 - resto
  return digito === parseInt(nif[8])
}

// ── Novo registo modal ────────────────────────────────────────────────────────

const TAX_CODES = [
  { code: 'NOR', label: 'NOR — Normal (23%)' },
  { code: 'INT', label: 'INT — Intermédio (13%)' },
  { code: 'RED', label: 'RED — Reduzido (6%)' },
  { code: 'ISE', label: 'ISE — Isento (0%)' },
]

function NovoRegistoModal({ tab, clientId, onClose, editRow }: { tab: Tab; clientId: string; onClose: () => void; editRow?: TocRow | null }) {
  const qc = useQueryClient()

  // helpers used for initial state only
  const sv = (v: unknown) => (v != null ? String(v) : '')
  const bv = (v: unknown) => v === true
  const cli  = editRow && tab === 'clientes'                          ? editRow : null
  const forn = editRow && tab === 'fornecedores'                      ? editRow : null
  const item = editRow && (tab === 'produtos' || tab === 'servicos')  ? editRow : null

  // ── cliente — geral ──
  const [cli_nif,          setCli_nif]          = useState(() => cli ? sv(cli.tax_registration_number) : '')
  const [cli_nome,         setCli_nome]         = useState(() => cli ? sv(cli.business_name) : '')
  const [cli_subconta,     setCli_subconta]     = useState('')
  const [cli_contacto,     setCli_contacto]     = useState(() => cli ? sv(cli.contact_name) : '')
  const [cli_email,        setCli_email]        = useState(() => cli ? sv(cli.email) : '')
  const [cli_tel,          setCli_tel]          = useState(() => cli ? sv(cli.phone_number) : '')
  const [cli_telem,        setCli_telem]        = useState(() => cli ? sv(cli.mobile_number) : '')
  const [cli_website,      setCli_website]      = useState(() => cli ? sv(cli.website) : '')
  const [cli_sp,           setCli_sp]           = useState(() => cli ? bv(cli.not_final_customer) : false)
  const [cli_ivaC,         setCli_ivaC]         = useState(() => cli ? bv(cli.cashed_vat) : false)
  const [cli_isentoIva,    setCli_isentoIva]    = useState(() => cli ? bv(cli.is_tax_exempt) : false)
  const [cli_ativo,        setCli_ativo]        = useState(true)
  // ── cliente — morada ──
  const [cli_moradaDesig,  setCli_moradaDesig]  = useState('Sede')
  const [cli_morada,       setCli_morada]       = useState('')
  const [cli_codPostal,    setCli_codPostal]    = useState('')
  const [cli_localidade,   setCli_localidade]   = useState('')
  const [cli_localidadeLoading, setCli_localidadeLoading] = useState(false)
  const [cli_pais,         setCli_pais]         = useState('1')
  const [cli_moradaDesc,   setCli_moradaDesc]   = useState(false)
  // ── cliente — observações ──
  const [cli_obsDoc,       setCli_obsDoc]       = useState(() => cli ? sv(cli.observations) : '')
  const [cli_obsInt,       setCli_obsInt]       = useState(() => cli ? sv(cli.internal_observations) : '')
  // ── cliente — fiscal e crédito ──
  const [cli_isentoRazao,  setCli_isentoRazao]  = useState('')
  const [cli_regiaoFiscal, setCli_regiaoFiscal] = useState(() => cli ? (sv(cli.tax_country_region) || 'PT') : 'PT')
  const [cli_contaContab,  setCli_contaContab]  = useState(() => cli ? sv(cli.accounting_number) : '')
  const [cli_limCredValor, setCli_limCredValor] = useState(() => cli && cli.credit_limit_value != null ? sv(cli.credit_limit_value) : '')
  const [cli_limCredDias,  setCli_limCredDias]  = useState(() => cli && cli.credit_limit_days  != null ? sv(cli.credit_limit_days)  : '')
  // ── cliente — informações adicionais ──
  const [cli_prazoVenc,    setCli_prazoVenc]    = useState('')
  const [cli_retencao,     setCli_retencao]     = useState('')
  const [cli_percRet,      setCli_percRet]      = useState('')
  const [cli_moeda,        setCli_moeda]        = useState('EUR')
  const [cli_precoVenda,   setCli_precoVenda]   = useState('1')
  const [cli_modeloImp,    setCli_modeloImp]    = useState('')
  const [cli_metodoPag,    setCli_metodoPag]    = useState('')
  const [cli_debitoDireto, setCli_debitoDireto] = useState(false)
  const [cli_ibanCred,     setCli_ibanCred]     = useState('')
  const [cli_emails,       setCli_emails]       = useState<string[]>([])
  // ── flip state ──
  const [flipped,          setFlipped]          = useState(false)

  // ── fornecedor ──
  const [forn_nif,          setForn_nif]          = useState(() => forn ? sv(forn.tax_registration_number) : '')
  const [forn_nome,         setForn_nome]         = useState(() => forn ? sv(forn.business_name) : '')
  const [forn_subconta,     _setForn_subconta]     = useState('')
  const [forn_contacto,     setForn_contacto]     = useState('')
  const [forn_cargo,        setForn_cargo]        = useState('')
  const [forn_email,        setForn_email]        = useState('')
  const [forn_telefone,     setForn_telefone]     = useState('')
  const [forn_telem,        setForn_telem]        = useState('')
  const [forn_website,      setForn_website]      = useState(() => forn ? sv(forn.website) : '')
  const [forn_tipoContacto, setForn_tipoContacto] = useState<string[]>(['others'])
  const [forn_tipoOpen,     setForn_tipoOpen]     = useState(false)
  const [forn_ativoIva,       setForn_ativoIva]       = useState(() => forn ? bv(forn.is_tax_exempt) : false)
  const [forn_isentoIvaRazao, setForn_isentoIvaRazao] = useState('')
  const [forn_sp,           setForn_sp]           = useState(() => forn ? bv(forn.is_taxable) : false)
  const [forn_af,           setForn_af]           = useState(() => forn ? bv(forn.self_billing) : false)
  const [forn_m10,          setForn_m10]          = useState(() => forn ? bv(forn.is_independent_worker) : false)
  const [forn_aceitarAd,    setForn_aceitarAd]    = useState(() => forn ? bv(forn.trusted_email_source) : false)
  const [forn_ativo,        setForn_ativo]        = useState(true)
  // ── morada ──
  const [forn_moradaDesig,  setForn_moradaDesig]  = useState('Sede')
  const [forn_morada,       setForn_morada]       = useState('')
  const [forn_codPostal,    setForn_codPostal]    = useState('')
  const [forn_localidade,   setForn_localidade]   = useState('')
  const [forn_localidadeLoading, setForn_localidadeLoading] = useState(false)
  const [forn_pais,         setForn_pais]         = useState('1')
  const [forn_moradaCarga,  setForn_moradaCarga]  = useState(false)
  // ── observações ──
  const [forn_obs,          setForn_obs]          = useState(() => forn ? sv(forn.internal_observations) : '')
  // ── informações adicionais ──
  const [forn_prazoVenc,    setForn_prazoVenc]    = useState('')
  const [forn_moeda,        setForn_moeda]        = useState('EUR')
  const [forn_modeloImp,    setForn_modeloImp]    = useState('')
  const [forn_metodoPag,    setForn_metodoPag]    = useState('')
  const [forn_banco,        setForn_banco]        = useState('')
  const [forn_iban,         setForn_iban]         = useState('')
  const [forn_swift,        setForn_swift]        = useState('')
  // ── flip state ──
  const [forn_flipped,      setForn_flipped]      = useState(false)

  // ── produto / serviço ──
  const [item_codigo,       setItem_codigo]       = useState(() => item ? sv(item.item_code) : '')
  const [item_desc,         setItem_desc]         = useState(() => item ? sv(item.item_description) : '')
  const [item_preco,        setItem_preco]        = useState(() => item && item.sales_price   != null ? sv(item.sales_price)   : '')
  const [item_preco2,       setItem_preco2]       = useState(() => item && item.sales_price_2 != null ? sv(item.sales_price_2) : '')
  const [item_preco3,       setItem_preco3]       = useState(() => item && item.sales_price_3 != null ? sv(item.sales_price_3) : '')
  const [item_precoCompra,  setItem_precoCompra]  = useState(() => item && item.purchase_price != null ? sv(item.purchase_price) : '')
  const [item_ivaInc,       setItem_ivaInc]       = useState(() => item ? bv(item.sales_price_includes_vat) : false)
  const [item_taxa,         setItem_taxa]         = useState(() => item ? (sv(item.tax_code) || 'NOR') : 'NOR')
  const [item_ativo,        setItem_ativo]        = useState(() => item ? item.is_active !== false : true)
  const [item_barcode,      setItem_barcode]      = useState(() => item ? sv(item.ean_barcode) : '')
  const [item_notas,        setItem_notas]        = useState(() => item ? sv(item.notes) : '')
  const [item_locArmazem,   setItem_locArmazem]   = useState(() => item ? sv(item.location_in_warehouse) : '')
  const [item_isMercadoria, setItem_isMercadoria] = useState(() => item ? bv(item.is_merchandise) : false)
  const [item_tipoInv,      setItem_tipoInv]      = useState(() => item ? sv(item.product_inventory_type) : '')
  const [item_grupoServico, setItem_grupoServico] = useState(() => item ? sv(item.service_group) : '')
  const [item_numContab,    setItem_numContab]    = useState(() => item ? sv(item.accounting_number) : '')
  const [item_custoFin,     setItem_custoFin]     = useState(() => item && item.financial_cost  != null ? sv(item.financial_cost)  : '')
  const [item_custoTrans,   setItem_custoTrans]   = useState(() => item && item.transport_cost  != null ? sv(item.transport_cost)  : '')
  const [item_custoOutros,  setItem_custoOutros]  = useState(() => item && item.other_cost      != null ? sv(item.other_cost)      : '')
  const [item_custoAlf,     setItem_custoAlf]     = useState(() => item && item.customs_cost    != null ? sv(item.customs_cost)    : '')
  const [item_flipped,      setItem_flipped]      = useState(false)

  const { data: countries = [] } = useQuery<TocRow[]>({
    queryKey: ['toc-countries', clientId],
    queryFn: () => api.get(`/toconline/${clientId}/countries`),
    staleTime: 24 * 60 * 60 * 1000,
    enabled: tab === 'clientes' || tab === 'fornecedores',
  })

  const { data: cliDetail } = useQuery<TocRow>({
    queryKey: ['toc-customer-detail', clientId, editRow?.id],
    queryFn: () => api.get(`/toconline/${clientId}/customers/${String(editRow!.id)}`),
    enabled: tab === 'clientes' && !!editRow?.id,
    staleTime: 60_000,
  })

  // Emails enviados ao cliente via regras de cobrança automáticas (kind: EMAIL_SENT).
  const { data: cliEmails = [] } = useQuery<Array<{
    id: string
    title: string
    description: string | null
    completedAt: string | null
    createdAt: string
    receivable: { id: string; reference: string | null; entityName: string | null; totalAmount: string } | null
    payload: unknown
  }>>({
    queryKey: ['customer-emails', clientId, editRow?.id],
    queryFn: () => api.get(`/treasury/${clientId}/followups?tocCustomerId=${String(editRow!.id)}&kind=EMAIL_SENT&direction=RECEIVABLE`),
    enabled: tab === 'clientes' && !!editRow?.id,
    staleTime: 30_000,
  })

  const { data: fornDetail } = useQuery<TocRow>({
    queryKey: ['toc-supplier-detail', clientId, editRow?.id],
    queryFn: () => api.get(`/toconline/${clientId}/suppliers/${String(editRow!.id)}`),
    enabled: tab === 'fornecedores' && !!editRow?.id,
    staleTime: 60_000,
  })

  const cliAddrPrefilled  = useRef(false)
  const fornAddrPrefilled = useRef(false)

  useEffect(() => {
    if (!cliDetail || !cli) return
    const detail = cliDetail as Record<string, unknown>
    const addr = detail._address as Record<string, unknown> | null | undefined
    if (addr) {
      cliAddrPrefilled.current = true
      if (addr.address_detail) setCli_morada(String(addr.address_detail))
      if (addr.postcode)       setCli_codPostal(String(addr.postcode))
      if (addr.city)           setCli_localidade(String(addr.city))
    }
    // Email principal vem como `_mainEmail` (resolvido via /email_addresses) ou
    // como `email` inline. Só preenche se o campo ainda estiver vazio para não
    // sobrescrever edições em curso.
    const resolvedEmail = (detail._mainEmail as string | undefined) ?? (detail.email as string | undefined)
    if (resolvedEmail && !cli_email) setCli_email(String(resolvedEmail))
  }, [cliDetail]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!fornDetail || !forn) return
    const detail = fornDetail as Record<string, unknown>
    const addr = detail._address as Record<string, unknown> | null | undefined
    if (addr) {
      fornAddrPrefilled.current = true
      if (addr.address_detail) setForn_morada(String(addr.address_detail))
      if (addr.postcode)       setForn_codPostal(String(addr.postcode))
      if (addr.city)           setForn_localidade(String(addr.city))
    }
    const resolvedEmail = (detail._mainEmail as string | undefined) ?? (detail.email as string | undefined)
    if (resolvedEmail && !forn_email) setForn_email(String(resolvedEmail))
  }, [fornDetail]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (cliAddrPrefilled.current) { cliAddrPrefilled.current = false; return }
    if (cli_codPostal.length < 8) { setCli_localidade(''); return }
    let cancelled = false
    setCli_localidadeLoading(true)
    ;(api.get(`/postal/${cli_codPostal}`) as Promise<{ localidade: string | null }>)
      .then(data => { if (!cancelled && data.localidade) setCli_localidade(data.localidade) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setCli_localidadeLoading(false) })
    return () => { cancelled = true }
  }, [cli_codPostal])

  useEffect(() => {
    if (fornAddrPrefilled.current) { fornAddrPrefilled.current = false; return }
    if (forn_codPostal.length < 8) { setForn_localidade(''); return }
    let cancelled = false
    setForn_localidadeLoading(true)
    ;(api.get(`/postal/${forn_codPostal}`) as Promise<{ localidade: string | null }>)
      .then(data => { if (!cancelled && data.localidade) setForn_localidade(data.localidade) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setForn_localidadeLoading(false) })
    return () => { cancelled = true }
  }, [forn_codPostal])

  const queryKeyMap: Record<Tab, string[]> = {
    clientes:     ['toc-customers', clientId],
    fornecedores: ['toc-suppliers', clientId],
    produtos:     ['toc-items',     clientId],
    servicos:     ['toc-services',  clientId],
  }

  const endpointMap: Record<Tab, string> = {
    clientes:     `/toconline/${clientId}/customers`,
    fornecedores: `/toconline/${clientId}/suppliers`,
    produtos:     `/toconline/${clientId}/items`,
    servicos:     `/toconline/${clientId}/services`,
  }

  const mutation = useMutation({
    mutationFn: async ({ attrs, address }: { attrs: Record<string, unknown>; address?: Record<string, unknown> }) => {
      if (editRow) {
        const id = String(editRow.id)
        let result: Record<string, unknown>
        if (tab === 'clientes')          result = await api.patch(`/toconline/${clientId}/customers/${id}`, attrs) as Record<string, unknown>
        else if (tab === 'fornecedores') result = await api.patch(`/toconline/${clientId}/suppliers/${id}`, attrs) as Record<string, unknown>
        else if (tab === 'produtos')     result = await api.patch(`/toconline/${clientId}/items/${id}`,     attrs) as Record<string, unknown>
        else                             result = await api.patch(`/toconline/${clientId}/services/${id}`,  attrs) as Record<string, unknown>

        // Also patch address when editing a client or supplier
        if (address && (tab === 'clientes' || tab === 'fornecedores')) {
          const detail = tab === 'clientes' ? cliDetail : fornDetail
          const addrId = ((detail as Record<string, unknown> | undefined)?._address as Record<string, unknown> | undefined)?.id as string | undefined
          if (addrId) {
            await api.patch(`/toconline/${clientId}/addresses/${addrId}`, address)
          }
        }

        return result
      }
      const body = (tab === 'clientes' || tab === 'fornecedores')
        ? { attrs, address }
        : attrs
      return api.post(endpointMap[tab], body) as Promise<Record<string, unknown>>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeyMap[tab] })
      onClose()
    },
  })

  function buildAttrs(): Record<string, unknown> {
    if (tab === 'clientes') {
      const attrs: Record<string, unknown> = {
        tax_registration_number: cli_nif ? parseInt(cli_nif, 10) : undefined,
        business_name:           cli_nome,
      }

      if (cli_subconta)  attrs.sub_account          = cli_subconta
      if (cli_contacto)  attrs.contact_name         = cli_contacto
      if (cli_email)     attrs.email                = cli_email
      if (cli_tel)       attrs.phone_number         = cli_tel
      if (cli_telem)     attrs.mobile_number        = cli_telem
      if (cli_website)   attrs.website              = cli_website
      if (cli_sp)        attrs.not_final_customer   = true
      if (cli_ivaC)      attrs.cashed_vat           = true
      if (cli_isentoIva) {
        attrs.is_tax_exempt = true
        if (cli_isentoRazao) attrs.tax_exemption_reason_id = parseInt(cli_isentoRazao, 10)
      }
      if (cli_regiaoFiscal && cli_regiaoFiscal !== 'PT') attrs.tax_country_region = cli_regiaoFiscal
      if (cli_contaContab)  attrs.accounting_number  = cli_contaContab
      if (cli_limCredValor) attrs.credit_limit_value = parseFloat(cli_limCredValor)
      if (cli_limCredDias)  attrs.credit_limit_days  = parseInt(cli_limCredDias, 10)
      if (cli_obsDoc)    attrs.observations          = cli_obsDoc
      if (cli_obsInt)    attrs.internal_observations = cli_obsInt

      return attrs
    }

    if (tab === 'fornecedores') {
      const attrs: Record<string, unknown> = {
        tax_registration_number: forn_nif ? parseInt(forn_nif, 10) : undefined,
        business_name:           forn_nome,
        active:                  forn_ativo,
      }
      if (forn_website)    attrs.website               = forn_website
      if (forn_ativoIva) {
        attrs.is_tax_exempt = true
        if (forn_isentoIvaRazao) attrs.tax_exemption_reason_id = parseInt(forn_isentoIvaRazao, 10)
      }
      if (forn_sp)         attrs.is_taxable            = true
      if (forn_af)         attrs.self_billing          = true
      if (forn_m10)        attrs.is_independent_worker = true
      if (forn_aceitarAd)  attrs.trusted_email_source  = true
      if (forn_obs)        attrs.internal_observations = forn_obs
      return attrs
    }

    const itemAttrs: Record<string, unknown> = {
      item_code:                item_codigo,
      item_description:         item_desc,
      tax_code:                 item_taxa,
      sales_price_includes_vat: item_ivaInc,
      is_active:                item_ativo,
      ...(item_preco        ? { sales_price:             parseFloat(item_preco) }        : {}),
      ...(item_preco2       ? { sales_price_2:           parseFloat(item_preco2) }       : {}),
      ...(item_preco3       ? { sales_price_3:           parseFloat(item_preco3) }       : {}),
      ...(item_precoCompra  ? { purchase_price:          parseFloat(item_precoCompra) }  : {}),
      ...(item_barcode      ? { ean_barcode:             item_barcode }                  : {}),
      ...(item_notas        ? { notes:                   item_notas }                    : {}),
      ...(item_locArmazem   ? { location_in_warehouse:   item_locArmazem }               : {}),
      ...(item_numContab    ? { accounting_number:       item_numContab }                : {}),
      ...(item_custoFin     ? { financial_cost:          parseFloat(item_custoFin) }     : {}),
      ...(item_custoTrans   ? { transport_cost:          parseFloat(item_custoTrans) }   : {}),
      ...(item_custoOutros  ? { other_cost:              parseFloat(item_custoOutros) }  : {}),
      ...(item_custoAlf     ? { customs_cost:            parseFloat(item_custoAlf) }     : {}),
      ...(item_isMercadoria ? { is_merchandise:          true }                          : {}),
      ...(tab === 'produtos' && item_tipoInv      ? { product_inventory_type: item_tipoInv }      : {}),
      ...(tab === 'servicos' && item_grupoServico ? { service_group:          item_grupoServico } : {}),
    }
    return itemAttrs
  }

  const nifInvalido = (nif: string) => nif.length > 0 && !validarNIF(nif)

  function canSubmit() {
    if (tab === 'clientes')     return !!cli_nif.trim()  && validarNIF(cli_nif)  && !!cli_nome.trim()
    if (tab === 'fornecedores') return !!forn_nif.trim() && validarNIF(forn_nif) && !!forn_nome.trim()
    return !!item_codigo.trim() && !!item_desc.trim()
  }

  const titles: Record<Tab, string> = editRow
    ? { clientes: 'Editar Cliente', fornecedores: 'Editar Fornecedor', produtos: 'Editar Produto', servicos: 'Editar Serviço' }
    : { clientes: 'Novo Cliente',   fornecedores: 'Novo Fornecedor',   produtos: 'Novo Produto',   servicos: 'Novo Serviço' }

  const sHdr = (label: string) => (
    <div className="px-6 py-1.5 bg-white text-gray-400 text-xs font-semibold uppercase tracking-wide border-y border-gray-100">
      {label}
    </div>
  )

  const faceStyle = (back = false): CSSProperties => ({
    position: 'absolute',
    inset: 0,
    overflowY: 'auto',
    backfaceVisibility: 'hidden',
    transition: 'transform 0.55s cubic-bezier(0.4,0,0.2,1)',
    transform: back
      ? (flipped ? 'rotateY(0deg)'    : 'rotateY(180deg)')
      : (flipped ? 'rotateY(-180deg)' : 'rotateY(0deg)'),
    pointerEvents: back
      ? (flipped ? 'auto' : 'none')
      : (flipped ? 'none' : 'auto'),
  })

  const forn_faceStyle = (back = false): CSSProperties => ({
    position: 'absolute',
    inset: 0,
    overflowY: 'auto',
    backfaceVisibility: 'hidden',
    transition: 'transform 0.55s cubic-bezier(0.4,0,0.2,1)',
    transform: back
      ? (forn_flipped ? 'rotateY(0deg)'    : 'rotateY(180deg)')
      : (forn_flipped ? 'rotateY(-180deg)' : 'rotateY(0deg)'),
    pointerEvents: back
      ? (forn_flipped ? 'auto' : 'none')
      : (forn_flipped ? 'none' : 'auto'),
  })

  const item_faceStyle = (back = false): CSSProperties => ({
    position: 'absolute',
    inset: 0,
    overflowY: 'auto',
    backfaceVisibility: 'hidden',
    transition: 'transform 0.55s cubic-bezier(0.4,0,0.2,1)',
    transform: back
      ? (item_flipped ? 'rotateY(0deg)'    : 'rotateY(180deg)')
      : (item_flipped ? 'rotateY(-180deg)' : 'rotateY(0deg)'),
    pointerEvents: back
      ? (item_flipped ? 'auto' : 'none')
      : (item_flipped ? 'none' : 'auto'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        className="bg-white rounded-xl shadow-2xl w-full flex flex-col max-w-xl"
        style={{ height: 'min(90vh, 700px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            {editRow ? <Pencil className="w-4 h-4 text-primary-600" /> : <Plus className="w-4 h-4 text-primary-600" />}
            <span className="font-semibold text-gray-900 text-sm">
              {titles[tab]}
              {tab === 'clientes' && flipped ? ' — Informações Adicionais' : ''}
              {tab === 'fornecedores' && forn_flipped ? ' — Informações Adicionais' : ''}
              {(tab === 'produtos' || tab === 'servicos') && item_flipped ? ' — Informações Adicionais' : ''}
            </span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Flip card (clientes) ── */}
        {tab === 'clientes' ? (
          <div className="flex-1 min-h-0 relative overflow-hidden" style={{ perspective: '1200px' }}>

            {/* FRENTE — Geral / Morada / Observações */}
            <div style={faceStyle()}>

              {sHdr('Geral')}
              <div className="px-6 py-3 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">NIF <span className="text-red-400">*</span></label>
                    <input
                      className={`input text-sm w-full ${nifInvalido(cli_nif) ? 'border-red-400 focus:ring-red-400' : ''}`}
                      placeholder="123456789"
                      value={cli_nif}
                      onChange={e => setCli_nif(e.target.value.replace(/\D/g, '').slice(0, 9))}
                    />
                    {nifInvalido(cli_nif) && <p className="text-xs text-red-500 mt-1">NIF inválido</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Nome <span className="text-red-400">*</span></label>
                    <input className="input text-sm w-full" placeholder="Nome ou empresa" value={cli_nome} onChange={e => setCli_nome(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Sub-conta</label>
                    <input className="input text-sm w-full" placeholder="Sub-conta" value={cli_subconta} onChange={e => setCli_subconta(e.target.value)} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Nome de contacto</label>
                    <input className="input text-sm w-full" placeholder="João Silva" value={cli_contacto} onChange={e => setCli_contacto(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">E-mail</label>
                    <input type="email" className="input text-sm w-full" placeholder="email@exemplo.pt" value={cli_email} onChange={e => setCli_email(e.target.value)} />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Telefone</label>
                    <input className="input text-sm w-full" placeholder="210000000" maxLength={9} value={cli_tel} onChange={e => setCli_tel(e.target.value.replace(/\D/g, '').slice(0, 9))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Telemóvel</label>
                    <input className="input text-sm w-full" placeholder="910000000" maxLength={9} value={cli_telem} onChange={e => setCli_telem(e.target.value.replace(/\D/g, '').slice(0, 9))} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Site web</label>
                    <input className="input text-sm w-full" placeholder="https://..." value={cli_website} onChange={e => setCli_website(e.target.value)} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                  {([
                    { label: 'Sujeito passivo?',       val: cli_sp,        set: setCli_sp        },
                    { label: 'Regime de IVA de Caixa', val: cli_ivaC,      set: setCli_ivaC      },
                    { label: 'Está isento de IVA?',    val: cli_isentoIva, set: setCli_isentoIva },
                    { label: 'Ativo?',                 val: cli_ativo,     set: setCli_ativo     },
                  ] as { label: string; val: boolean; set: (v: boolean) => void }[]).map(({ label, val, set }) => (
                    <label key={label} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={val} onChange={e => set(e.target.checked)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                      <span className="text-xs text-gray-700">{label}</span>
                    </label>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Região fiscal</label>
                    <select className="input text-sm w-full" value={cli_regiaoFiscal} onChange={e => setCli_regiaoFiscal(e.target.value)}>
                      <option value="PT">PT — Portugal Continental</option>
                      <option value="PT_MA">PT_MA — Madeira</option>
                      <option value="PT_AC">PT_AC — Açores</option>
                    </select>
                  </div>
                  {cli_isentoIva && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Razão de isenção de IVA</label>
                      <select className="input text-sm w-full" value={cli_isentoRazao} onChange={e => setCli_isentoRazao(e.target.value)}>
                        <option value="">—</option>
                        {([
                          [1,  'M01 — Artigo 16.º, n.º 6, Código do IVA'],
                          [2,  'M02 — Artigo 6.º, Decreto-Lei n.º 198/90'],
                          [6,  'M04 — Isento artigo 13.º, Código do IVA'],
                          [7,  'M05 — Isento artigo 14.º, Código do IVA'],
                          [8,  'M06 — Isento artigo 15.º, Código do IVA'],
                          [9,  'M07 — Isento artigo 9.º, Código do IVA'],
                          [10, 'M09 — IVA — Não confere direito a dedução'],
                          [11, 'M10 — IVA — Regime de isenção'],
                          [12, 'M11 — Regime particular — Tabaco'],
                          [13, 'M12 — Regime da margem de lucro — Agências de viagens'],
                          [14, 'M13 — Regime da margem de lucro — Bens em 2.ª mão'],
                          [15, 'M14 — Regime da margem de lucro — Objetos de arte'],
                          [16, 'M15 — Regime da margem de lucro — Objetos de coleção e antiguidades'],
                          [17, 'M16 — Isento artigo 14.º, RITI'],
                          [18, 'M19 — Outras isenções'],
                          [28, 'M99 — Não sujeito / não tributado'],
                        ] as [number, string][]).map(([id, label]) => (
                          <option key={id} value={String(id)}>{label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              </div>

              {sHdr('Morada')}
              <div className="px-6 py-3 space-y-2">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Designação</label>
                  <input className="input text-sm w-full" value={cli_moradaDesig} onChange={e => setCli_moradaDesig(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Morada</label>
                  <textarea className="input text-sm w-full resize-none" rows={2} placeholder="Rua, nº, andar..." value={cli_morada} onChange={e => setCli_morada(e.target.value)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Código postal</label>
                    <input className="input text-sm w-full" placeholder="0000-000" value={cli_codPostal} maxLength={8}
                      onChange={e => {
                        const digits = e.target.value.replace(/\D/g, '').slice(0, 7)
                        setCli_codPostal(digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits)
                      }} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Localidade</label>
                    <input
                      className="input text-sm w-full"
                      placeholder={cli_localidadeLoading ? 'A pesquisar…' : 'Localidade'}
                      value={cli_localidade}
                      onChange={e => setCli_localidade(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">País/Região</label>
                    <select className="input text-sm w-full" value={cli_pais} onChange={e => setCli_pais(e.target.value)}>
                      {countries.length === 0
                        ? <option value="1">Portugal - Continente</option>
                        : countries.map(c => (
                            <option key={String(c.id)} value={String(c.id)}>
                              {(c.default_name as string) || String(c.id)}
                            </option>
                          ))
                      }
                    </select>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={cli_moradaDesc} onChange={e => setCli_moradaDesc(e.target.checked)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  <span className="text-xs text-gray-700">Morada de Descarga?</span>
                </label>
              </div>

              {sHdr('Observações')}
              <div className="px-6 py-3 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Observações para documento</label>
                  <textarea className="input text-sm w-full resize-none" rows={2} placeholder="Observações para documento..." value={cli_obsDoc} onChange={e => setCli_obsDoc(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Observações internas</label>
                  <textarea className="input text-sm w-full resize-none" rows={2} placeholder="Observações internas..." value={cli_obsInt} onChange={e => setCli_obsInt(e.target.value)} />
                </div>
              </div>

              {editRow?.id && (
                <>
                  {sHdr('Emails Enviados')}
                  <div className="px-6 py-3 pb-4">
                    {cliEmails.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">Sem emails enviados a este cliente.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {cliEmails.map((e) => {
                          const when = e.completedAt ?? e.createdAt
                          const dateStr = new Date(when).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' })
                          const ref = e.receivable?.reference
                          return (
                            <li key={e.id} className="flex items-start gap-2 text-xs border border-gray-100 rounded-md px-3 py-2">
                              <Mail className="w-3.5 h-3.5 text-gray-400 mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-800 truncate" title={e.title}>{e.title}</div>
                                <div className="text-gray-500 mt-0.5">
                                  {dateStr}
                                  {ref && <span> · Fatura {ref}</span>}
                                </div>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* VERSO — Informações Adicionais */}
            <div style={faceStyle(true)}>

              {sHdr('Identificação Fiscal e Crédito')}
              <div className="px-6 py-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Conta contabilística</label>
                    <input className="input text-sm w-full font-mono" placeholder="Ex: 21111" value={cli_contaContab} onChange={e => setCli_contaContab(e.target.value)} />
                  </div>
                  <div /> {/* spacer */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Limite de crédito (valor)</label>
                    <div className="relative">
                      <input type="number" min="0" step="0.01" className="input text-sm w-full pr-5" placeholder="0.00"
                        value={cli_limCredValor} onChange={e => setCli_limCredValor(e.target.value)} />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">€</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Limite de crédito (dias)</label>
                    <input type="number" min="0" step="1" className="input text-sm w-full" placeholder="Ex: 30"
                      value={cli_limCredDias} onChange={e => setCli_limCredDias(e.target.value)} />
                  </div>
                </div>
              </div>

              {sHdr('Valores por omissão para documentos')}
              <div className="px-6 py-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Prazo de vencimento</label>
                    <select className="input text-sm w-full" value={cli_prazoVenc} onChange={e => setCli_prazoVenc(e.target.value)}>
                      <option value="">—</option>
                      {[['Pronto pagamento','0'],['8 dias','8'],['15 dias','15'],['21 dias','21'],['30 dias','30'],['45 dias','45'],['60 dias','60'],['75 dias','75'],['90 dias','90'],['120 dias','120'],['150 dias','150'],['180 dias','180']].map(([l,v]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Retenção na fonte</label>
                    <select className="input text-sm w-full" value={cli_retencao} onChange={e => setCli_retencao(e.target.value)}>
                      <option value="">Não aplicável</option>
                      <option value="IRS_D">IRS — Trab. Dependente</option>
                      <option value="IRS_I">IRS — Trab. Independente</option>
                      <option value="IRC">IRC</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">% retenção</label>
                    <input type="number" min="0" max="100" step="0.01" className="input text-sm w-full" placeholder="%" value={cli_percRet} onChange={e => setCli_percRet(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Moeda</label>
                    <select className="input text-sm w-full" value={cli_moeda} onChange={e => setCli_moeda(e.target.value)}>
                      {([
                        ['EUR','Euro'],['USD','Dólar americano'],['GBP','Libra esterlina'],
                        ['CHF','Franco suíço'],['JPY','Iene japonês'],['CAD','Dólar canadiano'],
                        ['AUD','Dólar australiano'],['NZD','Dólar neozelandês'],
                        ['DKK','Coroa dinamarquesa'],['NOK','Coroa norueguesa'],['SEK','Coroa sueca'],
                        ['PLN','Złoty polaco'],['CZK','Coroa checa'],['HUF','Forinto húngaro'],
                        ['RON','Leu romeno'],['BGN','Lev búlgaro'],['HRK','Kuna croata'],
                        ['TRY','Lira turca'],['RUB','Rublo russo'],
                        ['BRL','Real brasileiro'],['MXN','Peso mexicano'],['ARS','Peso argentino'],
                        ['CLP','Peso chileno'],['COP','Peso colombiano'],['PEN','Sol peruano'],
                        ['UYU','Peso uruguaio'],
                        ['AOA','Kwanza angolano'],['MZN','Metical moçambicano'],
                        ['CVE','Escudo caboverdiano'],['STN','Dobra são-tomense'],
                        ['ZAR','Rand sul-africano'],['MAD','Dirham marroquino'],
                        ['EGP','Libra egípcia'],['NGN','Naira nigeriana'],['KES','Xelim queniano'],
                        ['CNY','Yuan chinês (Renminbi)'],['HKD','Dólar de Hong Kong'],
                        ['SGD','Dólar de Singapura'],['INR','Rupia indiana'],
                        ['KRW','Won sul-coreano'],['THB','Baht tailandês'],['MYR','Ringgit malaio'],
                        ['AED','Dirham dos EAU'],['SAR','Riyal saudita'],['KWD','Dinar kuwaitiano'],
                        ['QAR','Riyal do Qatar'],['ILS','Shekel israelita'],
                      ] as [string,string][]).map(([code,name]) => (
                        <option key={code} value={code}>{code} — {name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Preço de venda</label>
                    <select className="input text-sm w-full" value={cli_precoVenda} onChange={e => setCli_precoVenda(e.target.value)}>
                      {[['PVP1','1'],['PVP2','2'],['PVP3','3'],['PVP4','4'],['PVP5','5']].map(([l,v]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Modelo de impressão</label>
                  <select className="input text-sm w-full" value={cli_modeloImp} onChange={e => setCli_modeloImp(e.target.value)}>
                    <option value="">—</option>
                    {[['Clássico','1'],['Profissional','2'],['Internacional','3'],['A5','4'],['Talões 80mm','5'],['Talões 75mm','6'],['Talões 60mm','7'],['Empresarial','8'],['A4 (A5 + A5)','9']].map(([l,v]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>

              {sHdr('Valores por omissão para recibos')}
              <div className="px-6 py-3">
                <label className="block text-xs font-medium text-gray-500 mb-1">Método de pagamento</label>
                <select className="input text-sm w-full" value={cli_metodoPag} onChange={e => setCli_metodoPag(e.target.value)}>
                  <option value="">—</option>
                  {([
                    ['Numerário','NU'],['Cheque','CH'],['Cartão de débito','CD'],
                    ['Cartão de crédito','CC'],['Transferência bancária','TB'],
                    ['Débito direto autorizado','DD'],['Referências Multibanco','MB'],
                    ['Ticket restaurante','TR'],['Cheque ou cartão oferta','CO'],
                    ['Colaborador','CL'],['Outra entidade','OE'],['Cliente','CI'],
                    ['Fornecedor','FO'],['Outros meios','OU'],['Dinheiro eletrónico','DE'],
                    ['Letra comercial','LC'],
                  ] as [string,string][]).map(([l,v]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>

              {sHdr('Débito Direto SEPA')}
              <div className="px-6 py-3 space-y-3 pb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={cli_debitoDireto} onChange={e => setCli_debitoDireto(e.target.checked)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                  <span className="text-xs text-gray-700">Débito direto?</span>
                </label>
                {cli_debitoDireto && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Conta a creditar (IBAN da empresa)</label>
                    <input className="input text-sm w-full font-mono" placeholder="Conta bancária da empresa" value={cli_ibanCred} onChange={e => setCli_ibanCred(e.target.value)} />
                  </div>
                )}
              </div>

              {sHdr('Outros endereços de e-mail')}
              <div className="px-6 py-3 space-y-2 pb-4">
                {cli_emails.map((em, i) => (
                  <div key={i} className="flex gap-2">
                    <input type="email" className="input text-sm flex-1" placeholder="email@exemplo.pt"
                      value={em} onChange={e => { const a = [...cli_emails]; a[i] = e.target.value; setCli_emails(a) }} />
                    <button onClick={() => setCli_emails(cli_emails.filter((_, j) => j !== i))}
                      className="text-gray-400 hover:text-red-500 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                <button onClick={() => setCli_emails([...cli_emails, ''])}
                  className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-800 font-medium">
                  <Plus className="w-3.5 h-3.5" /> ADICIONAR E-MAIL
                </button>
              </div>
            </div>
          </div>
        ) : tab === 'fornecedores' ? (
          <div className="flex-1 min-h-0 relative overflow-hidden" style={{ perspective: '1200px' }}>
                {/* FRENTE — Geral / Morada / Observações */}
            <div style={forn_faceStyle()}>
                  {sHdr('Geral')}
                  <div className="px-6 py-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">NIF <span className="text-red-400">*</span></label>
                        <input
                          className={`input text-sm w-full ${nifInvalido(forn_nif) ? 'border-red-400 focus:ring-red-400' : ''}`}
                          placeholder="123456789"
                          value={forn_nif}
                          onChange={e => setForn_nif(e.target.value.replace(/\D/g, '').slice(0, 9))}
                        />
                        {nifInvalido(forn_nif) && <p className="text-xs text-red-500 mt-1">NIF inválido</p>}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Nome <span className="text-red-400">*</span></label>
                        <input className="input text-sm w-full" placeholder="Nome ou empresa" value={forn_nome} onChange={e => setForn_nome(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Sub-conta</label>
                        <input className="input text-sm w-full bg-gray-50 cursor-not-allowed" placeholder="Gerado automaticamente" value={forn_subconta} readOnly />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Nome de contacto</label>
                        <input className="input text-sm w-full" placeholder="João Silva" value={forn_contacto} onChange={e => setForn_contacto(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Cargo</label>
                        <input className="input text-sm w-full" placeholder="Gerente" value={forn_cargo} onChange={e => setForn_cargo(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">E-mail</label>
                        <input type="email" className="input text-sm w-full" placeholder="email@exemplo.pt" value={forn_email} onChange={e => setForn_email(e.target.value)} />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Telefone</label>
                        <input className="input text-sm w-full" placeholder="210000000" maxLength={9} value={forn_telefone} onChange={e => setForn_telefone(e.target.value.replace(/\D/g, '').slice(0, 9))} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Telemóvel</label>
                        <input className="input text-sm w-full" placeholder="910000000" maxLength={9} value={forn_telem} onChange={e => setForn_telem(e.target.value.replace(/\D/g, '').slice(0, 9))} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Site web</label>
                        <input className="input text-sm w-full" placeholder="https://..." value={forn_website} onChange={e => setForn_website(e.target.value)} />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Tipo de contacto</label>
                      <div className="relative">
                        <div
                          className="input text-sm min-h-[38px] flex flex-wrap gap-1 items-center cursor-text"
                          onClick={() => setForn_tipoOpen(true)}
                        >
                          {forn_tipoContacto.map(v => {
                            const opt = [
                              { label: 'Direção',                          value: 'management' },
                              { label: 'Financeiro (Troca de documentos)', value: 'finance'    },
                              { label: 'Comercial',                        value: 'comercial'  },
                              { label: 'Geral',                            value: 'general'    },
                              { label: 'Outros',                           value: 'others'     },
                            ].find(o => o.value === v)
                            return (
                              <span key={v} className="flex items-center gap-1 bg-primary-100 text-primary-700 text-xs px-2 py-0.5 rounded">
                                <X className="w-3 h-3 cursor-pointer flex-shrink-0"
                                  onMouseDown={e => e.preventDefault()}
                                  onClick={e => { e.stopPropagation(); setForn_tipoContacto(p => p.filter(t => t !== v)) }}
                                />
                                {opt?.label ?? v}
                              </span>
                            )
                          })}
                          <input
                            className="flex-1 min-w-[2rem] outline-none bg-transparent text-sm cursor-pointer"
                            readOnly
                            onFocus={() => setForn_tipoOpen(true)}
                            onBlur={() => setTimeout(() => setForn_tipoOpen(false), 150)}
                          />
                        </div>
                        {forn_tipoOpen && (() => {
                          const remaining = [
                            { label: 'Direção',                          value: 'management' },
                            { label: 'Financeiro (Troca de documentos)', value: 'financial'  },
                            { label: 'Comercial',                        value: 'commercial' },
                            { label: 'Geral',                            value: 'general'    },
                            { label: 'Outros',                           value: 'others'     },
                          ].filter(o => !forn_tipoContacto.includes(o.value))
                          if (!remaining.length) return null
                          return (
                            <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                              {remaining.map(o => (
                                <button
                                  key={o.value}
                                  type="button"
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-primary-600 hover:text-white transition-colors"
                                  onMouseDown={e => e.preventDefault()}
                                  onClick={() => { setForn_tipoContacto(p => [...p, o.value]); setForn_tipoOpen(false) }}
                                >
                                  {o.label}
                                </button>
                              ))}
                            </div>
                          )
                        })()}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                      {([
                        { label: 'Está isento de IVA?',     val: forn_ativoIva,  set: setForn_ativoIva  },
                        { label: 'Sujeito Passivo (S.P.)',  val: forn_sp,        set: setForn_sp       },
                        { label: 'Auto-faturação (A.F.)',   val: forn_af,        set: setForn_af       },
                        { label: 'Modelo 10',               val: forn_m10,       set: setForn_m10      },
                        { label: 'Aceitar e-mails AD',      val: forn_aceitarAd, set: setForn_aceitarAd },
                        { label: 'Ativo?',                  val: forn_ativo,     set: setForn_ativo    },
                      ] as { label: string; val: boolean; set: (v: boolean) => void }[]).map(({ label, val, set }) => (
                        <label key={label} className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={val} onChange={e => set(e.target.checked)}
                            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                          <span className="text-xs text-gray-700">{label}</span>
                        </label>
                      ))}
                    </div>

                    {forn_ativoIva && (
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Razão de isenção de IVA</label>
                        <select className="input text-sm w-full" value={forn_isentoIvaRazao} onChange={e => setForn_isentoIvaRazao(e.target.value)}>
                          <option value="">—</option>
                          {([
                            [1,  'M01 — Artigo 16.º, n.º 6, Código do IVA'],
                            [2,  'M02 — Artigo 6.º, Decreto-Lei n.º 198/90, de 19 de junho'],
                            [6,  'M04 — Isento artigo 13.º, Código do IVA'],
                            [7,  'M05 — Isento artigo 14.º, Código do IVA'],
                            [8,  'M06 — Isento artigo 15.º, Código do IVA'],
                            [66, 'M06 — Lei n.º 82-D/2014 de 31 de dezembro'],
                            [9,  'M07 — Isento artigo 9.º, Código do IVA'],
                            [17, 'M09 — IVA — Regime de caixa (artigo 35.º-A, Código do IVA)'],
                            [18, 'M10 — IVA — Regime de caixa (Decreto-Lei n.º 71/2013)'],
                            [19, 'M11 — Regime especial do tabaco (Decreto-Lei n.º 346/85)'],
                            [20, 'M12 — Regime de margem de lucro — Agências de viagens'],
                            [21, 'M13 — Regime de margem de lucro — Bens em segunda mão'],
                            [22, 'M14 — Regime de margem de lucro — Objetos de arte'],
                            [23, 'M15 — Regime de margem de lucro — Objetos de coleção e antiguidades'],
                            [26, 'M16 — Isento artigo 14.º, Regime do IVA nas transações intracomunitárias'],
                            [119,'M19 — Outras isenções'],
                            [63, 'M20 — IVA — Regime forfetário'],
                            [121,'M21 — IVA não dedutível (artigo 21.º, Código do IVA)'],
                            [125,'M25 — Mercadorias à consignação (artigo 38.º, Código do IVA)'],
                            [151,'M26 — Cabaz alimentar (Lei n.º 17/2023 de 14 de abril)'],
                            [130,'M30 — IVA — Autoliquidação (artigo 2.º, n.º 1, alínea i), Código do IVA)'],
                            [131,'M31 — IVA — Autoliquidação (artigo 2.º, n.º 1, alínea j), Código do IVA)'],
                            [132,'M32 — IVA — Autoliquidação (artigo 2.º, n.º 1, alínea l), Código do IVA)'],
                            [133,'M33 — IVA — Autoliquidação (artigo 2.º, n.º 1, alínea m), Código do IVA)'],
                            [152,'M34 — IVA — Autoliquidação (artigo 2.º, n.º 1, alínea n), Código do IVA)'],
                            [140,'M40 — IVA — Autoliquidação (artigo 6.º, n.º 6, alínea a), Código do IVA)'],
                            [141,'M41 — IVA — Autoliquidação (Decreto-Lei n.º 21/2007 de 29 de janeiro)'],
                            [142,'M42 — IVA — Autoliquidação (Decreto-Lei n.º 362/99 de 16 de setembro)'],
                            [143,'M43 — IVA — Autoliquidação (outras situações)'],
                            [160,'M44 — IVA — Autoliquidação (artigo 3.º, Decreto-Lei n.º 362/99)'],
                            [161,'M45 — IVA — Autoliquidação (artigo 4.º, Decreto-Lei n.º 362/99)'],
                            [162,'M46 — IVA — Autoliquidação (artigo 5.º, Decreto-Lei n.º 362/99)'],
                            [28, 'M99 — Não sujeito / não tributado'],
                          ] as [number, string][]).map(([id, label]) => (
                            <option key={id} value={String(id)}>{label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {sHdr('Morada')}
                  <div className="px-6 py-3 space-y-2">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Designação</label>
                      <input className="input text-sm w-full" value={forn_moradaDesig} onChange={e => setForn_moradaDesig(e.target.value)} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Morada</label>
                      <textarea className="input text-sm w-full resize-none" rows={2} placeholder="Rua, nº, andar..." value={forn_morada} onChange={e => setForn_morada(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Código postal</label>
                        <input className="input text-sm w-full" placeholder="0000-000" value={forn_codPostal} maxLength={8}
                          onChange={e => {
                            const digits = e.target.value.replace(/\D/g, '').slice(0, 7)
                            setForn_codPostal(digits.length > 4 ? `${digits.slice(0, 4)}-${digits.slice(4)}` : digits)
                          }} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Localidade</label>
                        <input
                          className="input text-sm w-full"
                          placeholder={forn_localidadeLoading ? 'A pesquisar…' : 'Localidade'}
                          value={forn_localidade}
                          onChange={e => setForn_localidade(e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">País/Região</label>
                        <select className="input text-sm w-full" value={forn_pais} onChange={e => setForn_pais(e.target.value)}>
                          {countries.length === 0
                            ? <option value="1">Portugal - Continente</option>
                            : countries.map(c => (
                                <option key={String(c.id)} value={String(c.id)}>
                                  {(c.default_name as string) || String(c.id)}
                                </option>
                              ))
                          }
                        </select>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={forn_moradaCarga} onChange={e => setForn_moradaCarga(e.target.checked)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                      <span className="text-xs text-gray-700">Morada de Carga?</span>
                    </label>
                  </div>

                  {sHdr('Observações')}
                  <div className="px-6 py-3 space-y-3 pb-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Observações internas</label>
                      <textarea className="input text-sm w-full resize-none" rows={2} placeholder="Notas internas..." value={forn_obs} onChange={e => setForn_obs(e.target.value)} />
                    </div>
                  </div>
                </div>

                {/* VERSO — Informações Adicionais */}
            <div style={forn_faceStyle(true)}>
                  {sHdr('Valores por omissão para documentos')}
                  <div className="px-6 py-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Prazo de pagamento</label>
                        <select className="input text-sm w-full" value={forn_prazoVenc} onChange={e => setForn_prazoVenc(e.target.value)}>
                          <option value="">—</option>
                          {[0,8,15,21,30,45,60,75,90,120,150,180].map(d => (
                            <option key={d} value={String(d)}>{d} dias</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Moeda</label>
                        <select className="input text-sm w-full" value={forn_moeda} onChange={e => setForn_moeda(e.target.value)}>
                          <option value="EUR">EUR — Euro</option>
                          <option value="GBP">GBP — Libra</option>
                          <option value="USD">USD — Dólar</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Modelo de impressão</label>
                      <select className="input text-sm w-full" value={forn_modeloImp} onChange={e => setForn_modeloImp(e.target.value)}>
                        <option value="">—</option>
                        {[['Clássico','1'],['Profissional','2'],['Internacional','3'],['A5','4'],['Talões 80mm','5'],['Talões 75mm','6'],['Talões 60mm','7'],['Empresarial','8'],['A4 (A5 + A5)','9']].map(([l,v]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {sHdr('Valores por omissão para recibos')}
                  <div className="px-6 py-3">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Método de pagamento</label>
                    <select className="input text-sm w-full" value={forn_metodoPag} onChange={e => setForn_metodoPag(e.target.value)}>
                      <option value="">—</option>
                      {([
                        ['Numerário','MO'],
                        ['Cartão de débito','DC'],
                        ['Transferência bancária','TR'],
                        ['Débito direto autorizado','DDA'],
                        ['Ticket restaurante','RT'],
                        ['Colaborador','PCO'],
                        ['Outra entidade','POE'],
                        ['Cliente','PCL'],
                        ['Fornecedor','PF'],
                      ] as [string,string][]).map(([l,v]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>

                  {sHdr('Conta bancária do fornecedor')}
                  <div className="px-6 py-3 space-y-3 pb-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Banco</label>
                      <input className="input text-sm w-full" placeholder="BANCO DE PORTUGAL, EP" value={forn_banco} onChange={e => setForn_banco(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">IBAN</label>
                        <input className="input text-sm w-full font-mono" placeholder="PT50..." value={forn_iban} onChange={e => setForn_iban(e.target.value)} />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">SWIFT</label>
                        <input className="input text-sm w-full font-mono" placeholder="BGALPTTG" value={forn_swift} onChange={e => setForn_swift(e.target.value)} />
                      </div>
                    </div>
                  </div>
                </div>
          </div>
        ) : (
          /* ── Flip card (produtos / serviços) ── */
          <div className="flex-1 min-h-0 relative overflow-hidden" style={{ perspective: '1200px' }}>

            {/* FRENTE — Identificação / Preços / Extras */}
            <div style={item_faceStyle()}>
              {sHdr('Identificação')}
              <div className="px-6 py-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Código <span className="text-red-400">*</span></label>
                    <input className="input text-sm w-full font-mono" placeholder="PROD001" value={item_codigo} onChange={e => setItem_codigo(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Taxa de IVA</label>
                    <select className="input text-sm w-full" value={item_taxa} onChange={e => setItem_taxa(e.target.value)}>
                      {TAX_CODES.map(t => <option key={t.code} value={t.code}>{t.label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Descrição <span className="text-red-400">*</span></label>
                  <input className="input text-sm w-full" placeholder="Nome do produto ou serviço" value={item_desc} onChange={e => setItem_desc(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={item_ivaInc} onChange={e => setItem_ivaInc(e.target.checked)}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    <span className="text-xs text-gray-700">Preço inclui IVA</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={item_ativo} onChange={e => setItem_ativo(e.target.checked)}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    <span className="text-xs text-gray-700">Ativo</span>
                  </label>
                </div>
              </div>

              {sHdr('Preços de Venda')}
              <div className="px-6 py-3 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {([
                    { label: 'Preço 1', val: item_preco,  set: setItem_preco  },
                    { label: 'Preço 2', val: item_preco2, set: setItem_preco2 },
                    { label: 'Preço 3', val: item_preco3, set: setItem_preco3 },
                  ] as { label: string; val: string; set: (v: string) => void }[]).map(({ label, val, set }) => (
                    <div key={label}>
                      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                      <div className="relative">
                        <input type="number" min="0" step="0.01" className="input text-sm w-full pr-5" placeholder="0.00"
                          value={val} onChange={e => set(e.target.value)} />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">€</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {sHdr('Compra')}
              <div className="px-6 py-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Preço de compra</label>
                    <div className="relative">
                      <input type="number" min="0" step="0.01" className="input text-sm w-full pr-5" placeholder="0.00"
                        value={item_precoCompra} onChange={e => setItem_precoCompra(e.target.value)} />
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">€</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Código de barras (EAN)</label>
                    <input className="input text-sm w-full font-mono" placeholder="5601234567890" value={item_barcode} onChange={e => setItem_barcode(e.target.value)} />
                  </div>
                </div>
              </div>

              {sHdr('Notas')}
              <div className="px-6 py-3 pb-4">
                <textarea className="input text-sm w-full resize-none" rows={2} placeholder="Notas internas visíveis no produto"
                  value={item_notas} onChange={e => setItem_notas(e.target.value)} />
              </div>

              {mutation.isError && (
                <div className="mx-6 mb-3 flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  {(mutation.error as Error).message}
                </div>
              )}
            </div>

            {/* VERSO — Informações Adicionais */}
            <div style={item_faceStyle(true)}>
              {tab === 'produtos' && (<>
                {sHdr('Armazém')}
                <div className="px-6 py-3 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Localização em armazém</label>
                    <input className="input text-sm w-full" placeholder="Ex: Corredor A, Prateleira 3" value={item_locArmazem} onChange={e => setItem_locArmazem(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Tipo de inventário</label>
                    <select className="input text-sm w-full" value={item_tipoInv} onChange={e => setItem_tipoInv(e.target.value)}>
                      <option value="">—</option>
                      <option value="P">P — Produto</option>
                      <option value="M">M — Matéria-prima</option>
                      <option value="A">A — Acabado</option>
                    </select>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={item_isMercadoria} onChange={e => setItem_isMercadoria(e.target.checked)}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    <span className="text-xs text-gray-700">É mercadoria?</span>
                  </label>
                </div>
              </>)}

              {tab === 'servicos' && (<>
                {sHdr('Serviço')}
                <div className="px-6 py-3 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Grupo de serviço</label>
                    <input className="input text-sm w-full" placeholder="Ex: G1" value={item_grupoServico} onChange={e => setItem_grupoServico(e.target.value)} />
                  </div>
                </div>
              </>)}

              {sHdr('Custos')}
              <div className="px-6 py-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { label: 'Custo financeiro',   val: item_custoFin,    set: setItem_custoFin    },
                    { label: 'Custo de transporte', val: item_custoTrans,  set: setItem_custoTrans  },
                    { label: 'Outros custos',       val: item_custoOutros, set: setItem_custoOutros },
                    { label: 'Custo alfandegário',  val: item_custoAlf,   set: setItem_custoAlf    },
                  ] as { label: string; val: string; set: (v: string) => void }[]).map(({ label, val, set }) => (
                    <div key={label}>
                      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
                      <div className="relative">
                        <input type="number" min="0" step="0.01" className="input text-sm w-full pr-5" placeholder="0.00"
                          value={val} onChange={e => set(e.target.value)} />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">€</span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400">O custo total estimado é calculado automaticamente pelo TOConline.</p>
              </div>

              {sHdr('Contabilidade')}
              <div className="px-6 py-3 pb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Número de conta contabilística</label>
                  <input className="input text-sm w-full font-mono" placeholder="Ex: 31111" value={item_numContab} onChange={e => setItem_numContab(e.target.value)} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Erro de mutation para clientes/fornecedores (fora do flip) */}
        {(tab === 'clientes' || tab === 'fornecedores') && mutation.isError && (
          <div className="mx-6 mb-2 flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex-shrink-0">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
            {(mutation.error as Error).message}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-2 px-6 py-4 border-t border-gray-100 flex-shrink-0">
          {(tab === 'clientes' || tab === 'fornecedores' || tab === 'produtos' || tab === 'servicos') && (
            <button
              onClick={() => {
                if (tab === 'clientes')     setFlipped(f => !f)
                else if (tab === 'fornecedores') setForn_flipped(f => !f)
                else setItem_flipped(f => !f)
              }}
              className="btn-secondary text-sm px-4 mr-auto"
            >
              {(tab === 'clientes' ? flipped : tab === 'fornecedores' ? forn_flipped : item_flipped) ? '← VOLTAR' : 'INFORMAÇÕES ADICIONAIS →'}
            </button>
          )}
          <button onClick={onClose} className="btn-secondary text-sm px-4">CANCELAR</button>
          <button
            onClick={() => {
              const address = (tab === 'clientes' && (cli_morada || cli_codPostal || cli_localidade || cli_moradaDesig))
                ? {
                    name:           cli_moradaDesig || 'Sede',
                    address_detail: cli_morada     || undefined,
                    postcode:       cli_codPostal  || undefined,
                    city:           cli_localidade || undefined,
                    region:         cli_localidade || undefined,
                    country_id:     cli_pais       || '1',
                    is_primary:     true,
                    for_discharge:  cli_moradaDesc,
                    for_charge:     false,
                  }
                : (tab === 'fornecedores' && (forn_morada || forn_codPostal || forn_localidade || forn_moradaDesig))
                ? {
                    name:           forn_moradaDesig || 'Sede',
                    address_detail: forn_morada     || undefined,
                    postcode:       forn_codPostal  || undefined,
                    city:           forn_localidade || undefined,
                    region:         forn_localidade || undefined,
                    country_id:     forn_pais       || '1',
                    is_primary:     true,
                    for_discharge:  false,
                    for_charge:     forn_moradaCarga,
                  }
                : undefined
              mutation.mutate({ attrs: buildAttrs(), address })
            }}
            disabled={!canSubmit() || mutation.isPending}
            className="btn-primary text-sm px-4 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? (editRow ? 'A guardar…' : 'A criar…') : (editRow ? 'GUARDAR' : 'CRIAR')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── detalhe modal ─────────────────────────────────────────────────────────────

function DetalheModal({ tab, row, clientId, onClose }: { tab: Tab; row: TocRow; clientId: string; onClose: () => void }) {
  const { data: customerDetail, isLoading: loadingDetail } = useQuery<TocRow>({
    queryKey: ['toc-customer-detail', clientId, row.id],
    queryFn: () => api.get(`/toconline/${clientId}/customers/${row.id}`),
    enabled: tab === 'clientes' && !!row.id,
    staleTime: 60_000,
  })
  const { data: supplierDetail, isLoading: loadingSupplierDetail } = useQuery<TocRow>({
    queryKey: ['toc-supplier-detail', clientId, row.id],
    queryFn: () => api.get(`/toconline/${clientId}/suppliers/${row.id}`),
    enabled: tab === 'fornecedores' && !!row.id,
    staleTime: 60_000,
  })
  const dHdr = (label: string) => (
    <div className="px-6 py-1.5 bg-white text-gray-400 text-xs font-semibold uppercase tracking-wide border-y border-gray-100">
      {label}
    </div>
  )

  const Field = ({
    label, value, price = false, bool = false, date = false, mono = false, full = false,
  }: {
    label: string; value: unknown
    price?: boolean; bool?: boolean; date?: boolean; mono?: boolean; full?: boolean
  }) => {
    let display: string
    if (price) display = fmtPrice(value)
    else if (bool) display = fmtBool(value)
    else if (date) display = fmtDate(value)
    else display = value != null && value !== '' ? String(value) : '—'
    return (
      <div className={full ? 'col-span-2' : ''}>
        <p className="text-xs font-medium text-gray-400 mb-0.5">{label}</p>
        <p className={`text-sm text-gray-900 break-all ${mono ? 'font-mono' : ''}`}>{display}</p>
      </div>
    )
  }

  const titles: Record<Tab, string> = {
    clientes:     'Detalhe de Cliente',
    fornecedores: 'Detalhe de Fornecedor',
    produtos:     'Detalhe de Produto',
    servicos:     'Detalhe de Serviço',
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-xl flex flex-col" style={{ height: 'min(90vh, 700px)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-primary-600" />
            <span className="font-semibold text-gray-900 text-sm">{titles[tab]}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">

          {/* ── CLIENTES ── */}
          {tab === 'clientes' && (() => {
            // Prefer fresh individual-GET data; fall back to list row
            const d = customerDetail ?? row
            const COUNTRY: Record<string, string> = {
              '1': 'Portugal Continental', '2': 'Madeira', '3': 'Açores',
            }
            const addresses = (customerDetail?._addresses ?? []) as Record<string, unknown>[]

            return (<>
              {dHdr('Identificação')}
              <div className="px-6 py-3 grid grid-cols-2 gap-x-6 gap-y-3">
                <Field label="NIF"                   value={d.tax_registration_number} mono />
                <Field label="Nome"                  value={d.business_name} />
                <Field label="Sub-conta"             value={d.sub_account} mono />
                <Field label="Conta contabilística"  value={d.accounting_number} mono />
                <Field label="Sujeito Passivo"       value={d.not_final_customer} bool />
                <Field label="Regime IVA de Caixa"   value={d.cashed_vat} bool />
                <Field label="Isento de IVA"         value={d.is_tax_exempt} bool />
                <Field label="Ativo"                 value={row.active} bool />
                <Field label="Região fiscal"         value={d.tax_country_region} />
                <Field label="País"                  value={d.country_iso_alpha_2} />
                <Field label="Último aviso enviado"  value={row.last_notice_sent_at} date />
              </div>

              {dHdr('Crédito')}
              <div className="px-6 py-3 grid grid-cols-2 gap-x-6 gap-y-3">
                <Field label="Limite de crédito (valor)" value={d.credit_limit_value} price />
                <Field label="Limite de crédito (dias)"  value={d.credit_limit_days} />
              </div>

              {dHdr('Contacto')}
              <div className="px-6 py-3 grid grid-cols-2 gap-x-6 gap-y-3">
                <Field label="Nome de contacto" value={d.contact_name} />
                <Field label="E-mail"           value={d.email} />
                <Field label="Telefone"         value={d.phone_number} />
                <Field label="Telemóvel"        value={d.mobile_number} />
                <Field label="Website"          value={d.website} full />
              </div>

              {/* Moradas */}
              {loadingDetail ? (
                <div className="px-6 py-3 flex items-center gap-2 text-xs text-gray-400">
                  <div className="animate-spin rounded-full h-3 w-3 border border-gray-300 border-t-primary-500" />
                  A carregar moradas…
                </div>
              ) : addresses.length === 0 ? (
                <>
                  {dHdr('Morada')}
                  <div className="px-6 py-3 text-xs text-gray-400 italic">Sem morada registada</div>
                </>
              ) : addresses.map((addr, i) => {
                const isMain    = addr._isMain as boolean | undefined
                const countryId = addr._countryId as string | undefined
                const heading   = addresses.length > 1
                  ? `Morada ${i + 1}${isMain ? ' (principal)' : ''}`
                  : 'Morada'
                return (
                  <div key={i}>
                    {dHdr(heading)}
                    <div className="px-6 py-3 grid grid-cols-2 gap-x-6 gap-y-3">
                      <Field label="Designação"       value={addr.name} />
                      <Field label="Código postal"    value={addr.postcode} mono />
                      <Field label="Morada"           value={addr.address_detail} full />
                      <Field label="Localidade"       value={addr.city} />
                      <Field label="Região"           value={addr.region} />
                      {countryId && <Field label="País" value={COUNTRY[countryId] ?? `ID ${countryId}`} />}
                      <Field label="Morada principal" value={isMain}          bool />
                      <Field label="Descarga"         value={addr.for_discharge} bool />
                      <Field label="Carga"            value={addr.for_charge}    bool />
                      {(!!addr.is_saturday_workday || !!addr.is_sunday_workday || !!addr.is_national_holidays_workday) && (<>
                        <Field label="Trabalha ao sábado"   value={addr.is_saturday_workday}          bool />
                        <Field label="Trabalha ao domingo"  value={addr.is_sunday_workday}            bool />
                        <Field label="Trabalha em feriados" value={addr.is_national_holidays_workday} bool />
                      </>)}
                    </div>
                  </div>
                )
              })}

              {(!!d.observations || !!d.internal_observations) && (<>
                {dHdr('Observações')}
                <div className="px-6 py-3 grid grid-cols-1 gap-3 pb-4">
                  {!!d.observations          && <Field label="Observações ao documento" value={d.observations} />}
                  {!!d.internal_observations && <Field label="Observações internas"     value={d.internal_observations} />}
                </div>
              </>)}
            </>)
          })()}

          {/* ── FORNECEDORES ── */}
          {tab === 'fornecedores' && (() => {
            const d = supplierDetail ?? row
            const COUNTRY: Record<string, string> = {
              '1': 'Portugal Continental', '2': 'Madeira', '3': 'Açores',
            }
            const addresses = (supplierDetail?._addresses ?? []) as Record<string, unknown>[]
            return (<>
              {dHdr('Identificação')}
              <div className="px-6 py-3 grid grid-cols-2 gap-x-6 gap-y-3">
                <Field label="NIF" value={d.tax_registration_number} mono />
                <Field label="Nome" value={d.business_name} />
                <Field label="Sub-conta" value={d.sub_account} mono />
                <Field label="Ativo" value={d.active} bool />
                <Field label="Sujeito Passivo" value={d.is_taxable} bool />
                <Field label="Auto-faturação" value={d.self_billing} bool />
                <Field label="Modelo 10 (trabalhador independente)" value={d.is_independent_worker} bool />
                <Field label="Isento de IVA" value={d.is_tax_exempt} bool />
                <Field label="Aceitar documentos por e-mail" value={d.trusted_email_source} bool />
              </div>

              {dHdr('Contacto')}
              <div className="px-6 py-3 grid grid-cols-2 gap-x-6 gap-y-3">
                <Field label="E-mail" value={d.email} />
                <Field label="Website" value={d.website} />
              </div>

              {/* Moradas */}
              {loadingSupplierDetail ? (
                <div className="px-6 py-3 flex items-center gap-2 text-xs text-gray-400">
                  <div className="animate-spin rounded-full h-3 w-3 border border-gray-300 border-t-primary-500" />
                  A carregar moradas…
                </div>
              ) : addresses.length === 0 ? (
                <>
                  {dHdr('Morada')}
                  <div className="px-6 py-3 text-xs text-gray-400 italic">Sem morada registada</div>
                </>
              ) : addresses.map((addr, i) => {
                const isMain    = addr._isMain as boolean | undefined
                const countryId = addr._countryId as string | undefined
                const heading   = addresses.length > 1
                  ? `Morada ${i + 1}${isMain ? ' (principal)' : ''}`
                  : 'Morada'
                return (
                  <div key={i}>
                    {dHdr(heading)}
                    <div className="px-6 py-3 grid grid-cols-2 gap-x-6 gap-y-3">
                      <Field label="Designação"       value={addr.name} />
                      <Field label="Código postal"    value={addr.postcode} mono />
                      <Field label="Morada"           value={addr.address_detail} full />
                      <Field label="Localidade"       value={addr.city} />
                      <Field label="Região"           value={addr.region} />
                      {countryId && <Field label="País" value={COUNTRY[countryId] ?? `ID ${countryId}`} />}
                      <Field label="Morada principal" value={isMain}          bool />
                      <Field label="Descarga"         value={addr.for_discharge} bool />
                      <Field label="Carga"            value={addr.for_charge}    bool />
                    </div>
                  </div>
                )
              })}

              {!!d.internal_observations && (<>
                {dHdr('Observações Internas')}
                <div className="px-6 py-3">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{String(d.internal_observations)}</p>
                </div>
              </>)}
            </>)
          })()}

          {/* ── PRODUTOS / SERVIÇOS ── */}
          {(tab === 'produtos' || tab === 'servicos') && (<>
            {dHdr('Identificação')}
            <div className="px-6 py-3 grid grid-cols-2 gap-x-6 gap-y-3">
              <Field label="Código" value={row.item_code} mono />
              <Field label="Taxa de IVA" value={row.tax_code} />
              <Field label="Descrição" value={row.item_description} full />
              <Field label="Ativo" value={row.is_active} bool />
              <Field label="Conta contabilística" value={row.accounting_number} mono />
              {tab === 'produtos' && <Field label="Tipo de inventário" value={row.product_inventory_type} />}
              {tab === 'produtos' && <Field label="É mercadoria" value={row.is_merchandise} bool />}
              {tab === 'produtos' && !!row.location_in_warehouse &&
                <Field label="Localização em armazém" value={row.location_in_warehouse} full />}
              {tab === 'servicos' && <Field label="Grupo de serviço" value={row.service_group} />}
            </div>

            {dHdr('Preços de Venda')}
            <div className="px-6 py-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
              <Field label="Preço 1" value={row.sales_price} price />
              <Field label="Preço 2" value={row.sales_price_2} price />
              <Field label="Preço 3" value={row.sales_price_3} price />
              <Field label="Preço 1 c/ IVA" value={row.sales_price_vat_display} price />
              <Field label="Preço 2 c/ IVA" value={row.sales_price_2_vat_display} price />
              <Field label="Preço 3 c/ IVA" value={row.sales_price_3_vat_display} price />
              <Field label="Preço inclui IVA" value={row.sales_price_includes_vat} bool />
            </div>

            {dHdr('Compra e Stock')}
            <div className="px-6 py-3 grid grid-cols-2 gap-x-6 gap-y-3">
              <Field label="Preço de compra" value={row.purchase_price} price />
              <Field label="Código de barras (EAN)" value={row.ean_barcode} mono />
            </div>

            {dHdr('Custos')}
            <div className="px-6 py-3 grid grid-cols-2 gap-x-6 gap-y-3">
              <Field label="Custo financeiro" value={row.financial_cost} price />
              <Field label="Custo de transporte" value={row.transport_cost} price />
              <Field label="Outros custos" value={row.other_cost} price />
              <Field label="Custo alfandegário" value={row.customs_cost} price />
              <div className="col-span-2 pt-2 border-t border-gray-100">
                <Field label="Custo total estimado" value={row.estimated_total_cost} price />
              </div>
            </div>

            {!!row.notes && (<>
              {dHdr('Notas')}
              <div className="px-6 py-3 pb-4">
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{String(row.notes)}</p>
              </div>
            </>)}
          </>)}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} className="btn-secondary text-sm px-4">FECHAR</button>
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

// â"€â"€ tab table â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

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

  const [analiticaItem,     setAnaliticaItem]     = useState<TocRow | null>(null)
  const [novaContaItem,     setNovaContaItem]     = useState<TocRow | null>(null)
  const [novoRegisto,       setNovoRegisto]       = useState(false)
  const [detalheRow,        setDetalheRow]        = useState<TocRow | null>(null)
  const [editingRow,        setEditingRow]        = useState<TocRow | null>(null)
  const [deleteConfirm,     setDeleteConfirm]     = useState<TocRow | null>(null)
  const [linkedDocsCount,   setLinkedDocsCount]   = useState<number | null>(null)
  const [linkedDocsLoading, setLinkedDocsLoading] = useState(false)

  const qc = useQueryClient()
  const queryKeyMap: Record<Tab, string[]> = {
    clientes:     ['toc-customers', clientId],
    fornecedores: ['toc-suppliers', clientId],
    produtos:     ['toc-items',     clientId],
    servicos:     ['toc-services',  clientId],
  }

  useEffect(() => {
    if (!deleteConfirm) { setLinkedDocsCount(null); return }
    if (tab !== 'clientes' && tab !== 'fornecedores') { setLinkedDocsCount(0); return }
    setLinkedDocsLoading(true)
    const tocId = String(deleteConfirm.id)
    const url = tab === 'clientes'
      ? `/treasury/${clientId}/receivables?tocCustomerId=${tocId}&limit=1`
      : `/treasury/${clientId}/payables?tocSupplierId=${tocId}&limit=1`
    ;(api.get(url) as Promise<{ total: number }>)
      .then(data => setLinkedDocsCount(data.total ?? 0))
      .catch(() => setLinkedDocsCount(0))
      .finally(() => setLinkedDocsLoading(false))
  }, [deleteConfirm]) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteMutation = useMutation({
    mutationFn: async (row: TocRow) => {
      const id = String(row.id)
      if (tab === 'clientes')     await api.delete(`/treasury/${clientId}/receivables/by-customer/${id}`)
      if (tab === 'fornecedores') await api.delete(`/treasury/${clientId}/payables/by-supplier/${id}`)
      if (tab === 'clientes')     return api.delete(`/toconline/${clientId}/customers/${id}`)
      if (tab === 'fornecedores') return api.delete(`/toconline/${clientId}/suppliers/${id}`)
      if (tab === 'produtos')     return api.delete(`/toconline/${clientId}/items/${id}`)
      return api.delete(`/toconline/${clientId}/services/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeyMap[tab] })
      if (tab === 'clientes')     qc.invalidateQueries({ queryKey: ['receivables', clientId] })
      if (tab === 'fornecedores') qc.invalidateQueries({ queryKey: ['payables',    clientId] })
      setDeleteConfirm(null)
    },
  })

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

  const { isTocEnabled } = useAuth()

  if (!isTocEnabled) {
    return (
      <div className="p-10 flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-gray-400">Integração TOConline desativada. Ative em <span className="font-medium">Definições → TOConline</span>.</p>
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
      {novaContaItem && (
        <NovaContaModal
          type={tab === 'clientes' ? 'receber' : 'pagar'}
          entity={novaContaItem}
          clientId={clientId}
          onClose={() => setNovaContaItem(null)}
        />
      )}
      {(novoRegisto || editingRow) && (
        <NovoRegistoModal
          tab={tab}
          clientId={clientId}
          editRow={editingRow}
          onClose={() => { setNovoRegisto(false); setEditingRow(null) }}
        />
      )}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-sm font-semibold text-gray-900">Eliminar registo?</p>
            </div>
            <p className="text-sm text-gray-600">
              <span className="font-medium">{String(deleteConfirm.business_name ?? deleteConfirm.item_description ?? deleteConfirm.id)}</span> será permanentemente eliminado no TOConline. Esta acção não pode ser revertida.
            </p>
            {(tab === 'clientes' || tab === 'fornecedores') && (
              linkedDocsLoading ? (
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <div className="animate-spin rounded-full h-3 w-3 border border-gray-300 border-t-primary-500" />
                  A verificar registos associados…
                </div>
              ) : linkedDocsCount != null && linkedDocsCount > 0 ? (
                <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>
                    Este {tab === 'clientes' ? 'cliente' : 'fornecedor'} tem{' '}
                    <span className="font-semibold">{linkedDocsCount} {linkedDocsCount === 1 ? (tab === 'clientes' ? 'conta a receber' : 'conta a pagar') : (tab === 'clientes' ? 'contas a receber' : 'contas a pagar')}</span>{' '}
                    associadas nesta plataforma. Ao confirmar, esses registos também serão eliminados permanentemente.
                  </span>
                </div>
              ) : null
            )}
            {deleteMutation.isError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {(deleteMutation.error as Error).message}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="btn-secondary text-sm px-4">CANCELAR</button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm)}
                disabled={deleteMutation.isPending || linkedDocsLoading}
                className="text-sm px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-50 transition-colors"
              >
                {deleteMutation.isPending ? 'A eliminar…' : 'ELIMINAR'}
              </button>
            </div>
          </div>
        </div>
      )}
      {detalheRow && (
        <DetalheModal tab={tab} row={detalheRow} clientId={clientId} onClose={() => setDetalheRow(null)} />
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

        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setNovoRegisto(true)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-lg px-3 py-1.5 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {tab === 'clientes' ? 'Novo Cliente' : tab === 'fornecedores' ? 'Novo Fornecedor' : tab === 'produtos' ? 'Novo Produto' : 'Novo Serviço'}
          </button>
          <span className="text-xs text-gray-400">
            {sorted.length !== rows.length ? `${sorted.length} de ${rows.length}` : sorted.length}{' '}
            registo{sorted.length !== 1 ? 's' : ''}
          </span>
        </div>
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
                <th className="w-16" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {sorted.map((row, i) => (
                <tr
                  key={(row.id as string | number | undefined) ?? i}
                  className="hover:bg-gray-50 cursor-pointer group"
                  onClick={() => setDetalheRow(row)}
                >
                  {cols.map((c) => {
                    if (c.special === 'analitica') {
                      const rowId = String(row.id ?? '')
                      const cfg   = analyticsMap.get(rowId)
                      const count = cfg?.lines?.length ?? 0
                      return (
                        <td key="analitica" className="px-5 py-3" onClick={e => e.stopPropagation()}>
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
                    if (c.special === 'nova-conta') {
                      const label = tab === 'clientes' ? 'Conta a Receber' : 'Conta a Pagar'
                      return (
                        <td key="nova-conta" className="px-3 py-3 text-right" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => setNovaContaItem(row)}
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-white hover:bg-primary-600 border border-primary-200 hover:border-primary-600 rounded-lg px-2.5 py-1 transition-all"
                          >
                            <FilePlus2 className="w-3 h-3" />
                            {label}
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
                  <td className="px-3 py-3 text-right" onClick={e => e.stopPropagation()}>
                    <div className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setEditingRow(row)}
                        className="p-1 text-gray-400 hover:text-primary-600 rounded transition-colors"
                        title="Editar"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(row)}
                        className="p-1 text-gray-400 hover:text-red-600 rounded transition-colors"
                        title="Eliminar"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

// â"€â"€ page â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

export default function EmpresaPage() {
  const { selectedClientId, isTocEnabled } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('clientes')
  const [search, setSearch] = useState('')

  const enabled = !!selectedClientId && isTocEnabled

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
