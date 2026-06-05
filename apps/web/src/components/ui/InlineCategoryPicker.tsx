import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tag, X } from 'lucide-react'

interface PickerCategory {
  id: string
  name: string
  color?: string | null
}

interface Props {
  /** Categoria atualmente atribuída ao documento (ou null/undefined). */
  category?: { id: string; name: string; color?: string | null } | null
  /** Categorias selecionáveis, já filtradas pelo tipo permitido e não arquivadas. */
  categories: PickerCategory[]
  /** Etiqueta do cabeçalho do grupo: 'Despesa' | 'Receita'. */
  typeLabel: string
  /** Classifica (categoryId) ou remove a categoria (null). */
  onSelect: (categoryId: string | null) => void
  /** Quando true mostra apenas o valor em modo leitura, sem picker. */
  disabled?: boolean
}

const MENU_WIDTH = 208 // w-52

/**
 * Atribuição unitária de categoria inline, replicando o picker dos movimentos
 * bancários: célula clicável que abre um dropdown com as categorias do tipo
 * permitido e a opção de remover a categoria atual.
 *
 * O dropdown é renderizado num portal com `position: fixed` para não ser
 * cortado pelo `overflow` das tabelas onde o picker vive.
 */
export default function InlineCategoryPicker({ category, categories, typeLabel, onSelect, disabled }: Props) {
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

  // Posiciona ao abrir e reacompanha scroll (inclui o scroll interno das tabelas,
  // por isso captura na fase de captura) e resize.
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

  // Fecha ao clicar fora (botão ou menu — o menu vive no portal).
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
    return category ? (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: category.color ?? '#9ca3af' }} />
        {category.name}
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
        className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full border transition-colors ${category
          ? 'border-transparent hover:border-gray-200 hover:bg-gray-50 text-gray-600'
          : 'border-dashed border-gray-300 text-gray-400 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50'
          }`}
        title={category ? 'Alterar categoria' : 'Classificar documento'}
      >
        {category
          ? <><span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: category.color ?? '#9ca3af' }} />{category.name}</>
          : <><Tag className="w-3 h-3" />N/C</>
        }
      </button>
      {open && coords && createPortal(
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', top: coords.top, left: coords.left, width: MENU_WIDTH }}
          className="z-50 bg-white border border-gray-200 rounded-xl shadow-lg py-1 max-h-64 overflow-y-auto"
        >
          {category && (
            <>
              <button
                type="button"
                onClick={() => { onSelect(null); setOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 text-left"
              >
                <X className="w-3.5 h-3.5 flex-shrink-0" />
                Remover categoria
              </button>
              <div className="border-t border-gray-100 my-1" />
            </>
          )}
          <div className="px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase">{typeLabel}</div>
          {categories.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400">Sem categorias disponíveis</div>
          )}
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onSelect(c.id); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 text-left"
            >
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color ?? '#9ca3af' }} />
              {c.name}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
