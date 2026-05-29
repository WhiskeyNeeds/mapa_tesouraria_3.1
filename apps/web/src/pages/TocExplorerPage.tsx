import { useState, useRef, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api'
import { Play, Clock, ChevronRight, ChevronDown, Copy, Check, X, Plus } from 'lucide-react'

// ── Presets ──────────────────────────────────────────────────────────────────

const PRESETS = [
  { label: 'Documentos de Venda', path: '/api/v1/commercial_sales_documents', params: [{ k: 'page[size]', v: '5' }] },
  { label: 'Documentos de Compra', path: '/api/v1/commercial_purchases_documents', params: [{ k: 'page[size]', v: '5' }] },
  { label: 'Recibos de Venda', path: '/api/v1/commercial_sales_receipts', params: [{ k: 'page[size]', v: '5' }] },
  { label: 'Pagamentos de Compra', path: '/api/v1/commercial_purchases_payments', params: [{ k: 'page[size]', v: '5' }] },
  { label: 'Clientes', path: '/api/customers', params: [{ k: 'page[size]', v: '5' }] },
  { label: 'Fornecedores', path: '/api/suppliers', params: [{ k: 'page[size]', v: '5' }] },
  { label: 'Contas Bancárias', path: '/api/company_bank_accounts', params: [] },
  { label: 'Séries Documentos', path: '/api/commercial_document_series', params: [] },
  { label: 'Artigos', path: '/api/items', params: [{ k: 'page[size]', v: '10' }] },
  { label: 'Taxas', path: '/api/taxes', params: [] },
]

// ── JSON Viewer ───────────────────────────────────────────────────────────────

type JsonVal = string | number | boolean | null | JsonVal[] | { [k: string]: JsonVal }

function JsonNode({ value, depth = 0 }: { value: JsonVal; depth?: number }) {
  const [collapsed, setCollapsed] = useState(depth > 2)

  if (value === null) return <span className="text-slate-400">null</span>
  if (typeof value === 'boolean') return <span className="text-amber-400">{String(value)}</span>
  if (typeof value === 'number') return <span className="text-sky-400">{value}</span>
  if (typeof value === 'string') return <span className="text-emerald-400">"{value}"</span>

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-400">[]</span>
    return (
      <span>
        <button onClick={() => setCollapsed(!collapsed)} className="text-slate-400 hover:text-white transition-colors">
          {collapsed ? <ChevronRight className="inline w-3 h-3" /> : <ChevronDown className="inline w-3 h-3" />}
        </button>
        {collapsed ? (
          <span className="text-slate-400 cursor-pointer hover:text-slate-200" onClick={() => setCollapsed(false)}>
            {' '}[{value.length} items]
          </span>
        ) : (
          <span>
            {' ['}
            <div style={{ marginLeft: `${(depth + 1) * 16}px` }}>
              {value.map((v, i) => (
                <div key={i}>
                  <JsonNode value={v as JsonVal} depth={depth + 1} />
                  {i < value.length - 1 && <span className="text-slate-500">,</span>}
                </div>
              ))}
            </div>
            <span style={{ marginLeft: `${depth * 16}px` }}>]</span>
          </span>
        )}
      </span>
    )
  }

  // object
  const entries = Object.entries(value as Record<string, JsonVal>)
  if (entries.length === 0) return <span className="text-slate-400">{'{}'}</span>
  return (
    <span>
      <button onClick={() => setCollapsed(!collapsed)} className="text-slate-400 hover:text-white transition-colors">
        {collapsed ? <ChevronRight className="inline w-3 h-3" /> : <ChevronDown className="inline w-3 h-3" />}
      </button>
      {collapsed ? (
        <span className="text-slate-400 cursor-pointer hover:text-slate-200" onClick={() => setCollapsed(false)}>
          {' {'}{entries.length} {entries.length === 1 ? 'key' : 'keys'}{'}'}
        </span>
      ) : (
        <span>
          {' {'}
          <div style={{ marginLeft: `${(depth + 1) * 16}px` }}>
            {entries.map(([k, v], i) => (
              <div key={k}>
                <span className="text-violet-300">"{k}"</span>
                <span className="text-slate-400">: </span>
                <JsonNode value={v as JsonVal} depth={depth + 1} />
                {i < entries.length - 1 && <span className="text-slate-500">,</span>}
              </div>
            ))}
          </div>
          <span style={{ marginLeft: `${depth * 16}px` }}>{'}'}</span>
        </span>
      )}
    </span>
  )
}

// ── Param row ─────────────────────────────────────────────────────────────────

interface Param { k: string; v: string }

function ParamRow({ param, onChange, onRemove }: {
  param: Param
  onChange: (p: Param) => void
  onRemove: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-500"
        placeholder="key"
        value={param.k}
        onChange={e => onChange({ ...param, k: e.target.value })}
      />
      <span className="text-slate-600 text-xs">=</span>
      <input
        className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-500"
        placeholder="value"
        value={param.v}
        onChange={e => onChange({ ...param, v: e.target.value })}
      />
      <button onClick={onRemove} className="text-slate-600 hover:text-slate-400 transition-colors">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TocExplorerPage() {
  const { selectedClientId } = useAuth()
  const [path, setPath] = useState('/api/v1/commercial_sales_documents')
  const [params, setParams] = useState<Param[]>([{ k: 'page[size]', v: '5' }])
  const [result, setResult] = useState<{ data: JsonVal; meta: { durationMs: number; path: string } } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const pathRef = useRef<HTMLInputElement>(null)

  const execute = useCallback(async () => {
    if (!selectedClientId || !path.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const qs = params
        .filter(p => p.k.trim())
        .map(p => `${encodeURIComponent(p.k)}=${encodeURIComponent(p.v)}`)
        .join('&')
      const url = `/toconline/${selectedClientId}/raw?path=${encodeURIComponent(path.trim())}${qs ? '&' + qs : ''}`
      const res = await api.get<{ _meta: { durationMs: number; path: string }; data: JsonVal }>(url)
      setResult({ data: res.data, meta: res._meta })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedClientId, path, params])

  const applyPreset = (preset: typeof PRESETS[0]) => {
    setPath(preset.path)
    setParams(preset.params.map(p => ({ ...p })))
    setResult(null)
    setError(null)
  }

  const copyJson = () => {
    if (!result) return
    navigator.clipboard.writeText(JSON.stringify(result.data, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const builtUrl = (() => {
    const qs = params.filter(p => p.k.trim()).map(p => `${p.k}=${p.v}`).join('&')
    return path.trim() + (qs ? '?' + qs : '')
  })()

  return (
    <div className="flex flex-col gap-6 h-full" style={{ maxHeight: 'calc(100vh - 112px)' }}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">TOConline API Explorer</h1>
          <p className="text-sm text-gray-500 mt-0.5">Consulta directa à API TOConline via proxy autenticado</p>
        </div>
      </div>

      <div className="flex gap-4 flex-1 min-h-0">

        {/* Left column: presets + params */}
        <div className="flex flex-col gap-4 w-72 flex-shrink-0">

          {/* Presets */}
          <div className="card p-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Presets</p>
            <div className="space-y-1">
              {PRESETS.map(p => (
                <button
                  key={p.path}
                  onClick={() => applyPreset(p)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    path === p.path
                      ? 'bg-primary-50 text-primary-700 border border-primary-200'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Params */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Query Params</p>
              <button
                onClick={() => setParams(ps => [...ps, { k: '', v: '' }])}
                className="text-primary-600 hover:text-primary-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-2">
              {params.length === 0 && (
                <p className="text-xs text-gray-400 italic">Sem parâmetros</p>
              )}
              {params.map((p, i) => (
                <ParamRow
                  key={i}
                  param={p}
                  onChange={updated => setParams(ps => ps.map((x, j) => j === i ? updated : x))}
                  onRemove={() => setParams(ps => ps.filter((_, j) => j !== i))}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Right column: URL bar + response */}
        <div className="flex flex-col gap-4 flex-1 min-w-0">

          {/* URL bar */}
          <div className="card p-4">
            <div className="flex gap-3">
              <div className="flex items-center px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                <span className="text-xs font-bold text-emerald-700 tracking-wide">GET</span>
              </div>
              <input
                ref={pathRef}
                className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono text-gray-800 focus:outline-none focus:border-primary-400 focus:bg-white transition-colors"
                value={path}
                onChange={e => { setPath(e.target.value); setResult(null); setError(null) }}
                onKeyDown={e => e.key === 'Enter' && execute()}
                placeholder="/api/v1/..."
              />
              <button
                onClick={execute}
                disabled={loading || !selectedClientId}
                className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Play className="w-3.5 h-3.5" />
                {loading ? 'A enviar…' : 'Enviar'}
              </button>
            </div>

            {/* Full URL preview */}
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-gray-400 font-mono truncate">{builtUrl}</span>
            </div>
          </div>

          {/* Response */}
          <div className="card flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Response header */}
            <div
              className="flex items-center justify-between px-4 py-3 border-b border-gray-100"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Resposta</span>
                {result?.meta && (
                  <span className="flex items-center gap-1 text-xs text-gray-400">
                    <Clock className="w-3 h-3" />
                    {result.meta.durationMs}ms
                  </span>
                )}
                {error && (
                  <span className="text-xs text-red-500 font-medium">Erro</span>
                )}
              </div>
              {result && (
                <button
                  onClick={copyJson}
                  className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copiado' : 'Copiar JSON'}
                </button>
              )}
            </div>

            {/* Response body */}
            <div className="flex-1 overflow-auto p-4" style={{ background: '#0f172a' }}>
              {!result && !error && !loading && (
                <p className="text-slate-500 text-sm font-mono italic">
                  Escolhe um preset ou introduz um path e clica em Enviar.
                </p>
              )}
              {loading && (
                <p className="text-slate-400 text-sm font-mono animate-pulse">A aguardar resposta…</p>
              )}
              {error && (
                <pre className="text-red-400 text-xs font-mono whitespace-pre-wrap">{error}</pre>
              )}
              {result && (
                <div className="text-xs font-mono leading-relaxed text-slate-200">
                  <JsonNode value={result.data} depth={0} />
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
