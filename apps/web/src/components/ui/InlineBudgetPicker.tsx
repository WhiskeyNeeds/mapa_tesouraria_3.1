import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Wallet, X } from 'lucide-react'

interface PickerBudget {
  id: string
  name: string
  color?: string | null
}

interface Props {
  /** Budget atualmente atribuído ao documento (ou null/undefined). */
  budget?: { id: string; name: string; color?: string | null } | null
  /** Budgets selecionáveis, já filtrados pelo tipo permitido e estado ativo. */
  budgets: PickerBudget[]
  /** Atribui (budgetId) ou remove o budget (null). */
  onSelect: (budgetId: string | null) => void
  /** Quando true mostra apenas o valor em modo leitura, sem picker. */
  disabled?: boolean
}

const MENU_WIDTH = 208 // w-52

/**
 * Atribuição unitária de budget inline, gémea do `InlineCategoryPicker`:
 * célula clicável que abre um dropdown com os budgets do tipo permitido e a
 * opção de remover o budget atual. O dropdown vive num portal `position: fixed`
 * para não ser cortado pelo `overflow` das tabelas.
 */
export default function InlineBudgetPicker({ budget, budgets, onSelect, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const updatePosition = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8))
    setCoords({ top: r.bottom + 4, left })
  }

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    const onMove = () => updatePosition()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (disabled) {
    return budget ? (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: budget.color ?? '#9ca3af' }} />
        {budget.name}
      </span>
    ) : (
      <span className="text-xs text-gray-300">—</span>
    )
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border transition-colors ${budget
          ? 'border-transparent hover:border-gray-200 hover:bg-gray-50 text-gray-600'
          : 'border-dashed border-gray-300 text-gray-400 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50'
          }`}
        title={budget ? 'Alterar budget' : 'Atribuir budget'}
      >
        {budget
          ? <><span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: budget.color ?? '#9ca3af' }} />{budget.name}</>
          : <><Wallet className="w-3 h-3" />S/B</>
        }
      </button>
      {open && coords && createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: MENU_WIDTH }}
          className="z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1 max-h-64 overflow-y-auto"
        >
          {budget && (
            <>
              <button
                type="button"
                onClick={() => { onSelect(null); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 text-left"
              >
                <X className="w-3.5 h-3.5 flex-shrink-0" />
                Remover budget
              </button>
              <div className="border-t border-gray-100 my-1" />
            </>
          )}
          <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase">Budget</div>
          {budgets.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400">Sem budgets disponíveis</div>
          )}
          {budgets.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => { onSelect(b.id); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 text-left"
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: b.color ?? '#9ca3af' }} />
              {b.name}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
