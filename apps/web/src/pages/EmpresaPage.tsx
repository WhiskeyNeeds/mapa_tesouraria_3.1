import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ComponentType } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useStickyHScrollbar } from '@/lib/useStickyHScrollbar'
import TocSyncStatus from '@/components/ui/TocSyncStatus'
import {
  Search, Users, Truck, Package, Wrench, AlertTriangle,
  ArrowUp, ArrowDown, ArrowUpDown, X, Eye,
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
  headerClassName?: string
  format?: (val: unknown) => string
  /** special render handled by caller */
  special?: 'stat-open' | 'stat-pending' | 'stat-active'
}

const COLUMNS: Record<Tab, ColDef[]> = {
  clientes: [
    { header: 'NIF',               keys: ['tax_registration_number'], sortKey: 'tax_registration_number', className: 'font-mono text-xs' },
    { header: 'Nome',              keys: ['business_name'],           sortKey: 'business_name' },
    { header: 'Faturas em aberto', keys: [], headerClassName: 'text-right', special: 'stat-open'    as const },
    { header: 'Valor em dívida',   keys: [], headerClassName: 'text-right', special: 'stat-pending' as const },
    { header: 'Ativo',             keys: [], headerClassName: 'text-center', special: 'stat-active'  as const },
  ],
  fornecedores: [
    { header: 'NIF',               keys: ['tax_registration_number'], sortKey: 'tax_registration_number', className: 'font-mono text-xs' },
    { header: 'Nome',              keys: ['business_name'],           sortKey: 'business_name' },
    { header: 'Faturas em aberto', keys: [], headerClassName: 'text-right', special: 'stat-open'    as const },
    { header: 'Valor em dívida',   keys: [], headerClassName: 'text-right', special: 'stat-pending' as const },
    { header: 'Ativo',             keys: [], headerClassName: 'text-center', special: 'stat-active'  as const },
  ],
  produtos: [
    { header: 'Código',               keys: ['item_code'],                sortKey: 'item_code',            className: 'font-mono text-xs text-gray-500' },
    // products API has no family field
    { header: 'Família',              keys: ['service_group', 'family'],  sortKey: 'service_group',        className: 'text-xs text-gray-500' },
    { header: 'Descrição',            keys: ['item_description'],         sortKey: 'item_description' },
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
              <div className="px-6 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
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
              <div className="px-6 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                <Field label="Limite de crédito (valor)" value={d.credit_limit_value} price />
                <Field label="Limite de crédito (dias)"  value={d.credit_limit_days} />
              </div>

              {dHdr('Contacto')}
              <div className="px-6 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
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
                    <div className="px-6 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
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
              <div className="px-6 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
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
              <div className="px-6 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
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
                    <div className="px-6 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
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
            <div className="px-6 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
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
            <div className="px-6 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              <Field label="Preço de compra" value={row.purchase_price} price />
              <Field label="Código de barras (EAN)" value={row.ean_barcode} mono />
            </div>

            {dHdr('Custos')}
            <div className="px-6 py-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
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

interface EntityStat {
  tocId: number
  openCount: number
  pendingAmount: number
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(v)

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
  const navigate = useNavigate()
  const hScroll = useStickyHScrollbar<HTMLDivElement>()
  const isEntity = tab === 'clientes' || tab === 'fornecedores'
  const defaultSort = isEntity ? 'business_name' : 'item_description'

  const [sortField, setSortField] = useState(defaultSort)
  const [sortDir,   setSortDir]   = useState<SortDir>('asc')

  const [filterEstado,   setFilterEstado]   = useState<EstadoFilter>('ativo')
  const [filterNotice,   setFilterNotice]   = useState<NoticeFilter>('')
  const [filterModelo10, setFilterModelo10] = useState<Modelo10Filter>('')

  const [detalheRow,        setDetalheRow]        = useState<TocRow | null>(null)

  const { data: customerStats = [] } = useQuery<EntityStat[]>({
    queryKey: ['toc-customer-stats', clientId],
    queryFn: () => api.get(`/toconline/${clientId}/customer-stats`),
    enabled: isEntity && tab === 'clientes',
    staleTime: 2 * 60 * 1000,
  })

  const { data: supplierStats = [] } = useQuery<EntityStat[]>({
    queryKey: ['toc-supplier-stats', clientId],
    queryFn: () => api.get(`/toconline/${clientId}/supplier-stats`),
    enabled: isEntity && tab === 'fornecedores',
    staleTime: 2 * 60 * 1000,
  })

  const customerStatsMap = new Map(customerStats.map(s => [s.tocId, s]))
  const supplierStatsMap = new Map(supplierStats.map(s => [s.tocId, s]))

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
        <div ref={hScroll} className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px] lg:min-w-0">
            <thead>
              <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                {cols.map((c) => (
                  <th
                    key={c.header || (c.special ?? '')}
                    onClick={() => c.sortKey && handleSort(c.sortKey, c.numeric)}
                    className={`px-5 py-3 whitespace-nowrap font-medium ${c.headerClassName ?? 'text-left'} ${c.sortKey ? 'cursor-pointer hover:text-gray-700 select-none' : ''}`}
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
                  onClick={() => {
                    if ((tab === 'fornecedores' || tab === 'clientes') && row.id != null) {
                      navigate(`/empresa/${tab}/${row.id}`)
                    } else {
                      setDetalheRow(row)
                    }
                  }}
                >
                  {cols.map((c) => {
                    if (c.special === 'stat-open') {
                      const statsMap = tab === 'clientes' ? customerStatsMap : supplierStatsMap
                      const stat = statsMap.get(Number(row.id))
                      return (
                        <td key="stat-open" className="px-5 py-3 text-sm text-gray-700 text-right">
                          {stat ? String(stat.openCount) : '—'}
                        </td>
                      )
                    }
                    if (c.special === 'stat-pending') {
                      const statsMap = tab === 'clientes' ? customerStatsMap : supplierStatsMap
                      const stat = statsMap.get(Number(row.id))
                      return (
                        <td key="stat-pending" className="px-5 py-3 text-sm text-gray-800 font-semibold text-right">
                          {stat ? formatCurrency(stat.pendingAmount) : '—'}
                        </td>
                      )
                    }
                    if (c.special === 'stat-active') {
                      const isActive = row.active !== false && row.active !== 0 && row.active !== '0'
                      return (
                        <td key="stat-active" className="px-5 py-3 text-sm text-center">
                          <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-medium ${isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                            {isActive ? 'Ativo' : 'Inativo'}
                          </span>
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

// â"€â"€ page â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

export default function EmpresaPage() {
  const { selectedClientId, isTocEnabled } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('clientes')
  const [search, setSearch] = useState('')

  const enabled = !!selectedClientId && isTocEnabled

  const { data: customers, isLoading: loadingCustomers, isError: errorCustomers } = useQuery<TocRow[]>({
    queryKey: ['toc-customers', selectedClientId],
    queryFn: async () => toRows(await api.get(`/toconline/${selectedClientId}/customers`)),
    enabled, retry: false, throwOnError: false, staleTime: 5 * 60 * 1000,
  })
  const { data: suppliers, isLoading: loadingSuppliers, isError: errorSuppliers } = useQuery<TocRow[]>({
    queryKey: ['toc-suppliers', selectedClientId],
    queryFn: async () => toRows(await api.get(`/toconline/${selectedClientId}/suppliers`)),
    enabled, retry: false, throwOnError: false, staleTime: 5 * 60 * 1000,
  })
  const { data: items, isLoading: loadingItems, isError: errorItems } = useQuery<TocRow[]>({
    queryKey: ['toc-items', selectedClientId],
    queryFn: async () => toRows(await api.get(`/toconline/${selectedClientId}/items`)),
    enabled, retry: false, throwOnError: false, staleTime: 10 * 60 * 1000,
  })
  const { data: services, isLoading: loadingServices, isError: errorServices } = useQuery<TocRow[]>({
    queryKey: ['toc-services', selectedClientId],
    queryFn: async () => toRows(await api.get(`/toconline/${selectedClientId}/services`)),
    enabled, retry: false, throwOnError: false, staleTime: 10 * 60 * 1000,
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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">Empresa</h1>
        <div className="flex items-center gap-3">
          <TocSyncStatus invalidateKeys={[
            ['toc-customers', selectedClientId ?? ''],
            ['toc-suppliers', selectedClientId ?? ''],
          ]} />
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-full">TOConline</span>
        </div>
      </div>

      <div className="card">
        {/* Tabs */}
        <div className="flex items-center border-b border-gray-100 px-2 overflow-x-auto">
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
