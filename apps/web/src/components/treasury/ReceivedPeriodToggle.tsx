import { memo, useLayoutEffect, useRef, useState } from 'react'

export type ReceivedPeriod = number | 'ALL'

const OPTIONS: { key: ReceivedPeriod; label: string }[] = [
  { key: 'ALL', label: 'Tudo' },
  { key: 30, label: '30d' },
  { key: 60, label: '60d' },
  { key: 90, label: '90d' },
]

/**
 * Segmented control com indicador deslizante (pill) que acompanha o botão
 * activo. A posição/largura são medidas por refs e seguem larguras variáveis;
 * recalculadas ao mudar de opção e em redimensionamento (ResizeObserver).
 */
function ReceivedPeriodToggleBase({ value, onChange }: { value: ReceivedPeriod; onChange: (v: ReceivedPeriod) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [pill, setPill] = useState({ left: 0, width: 0 })
  const [ready, setReady] = useState(false)

  const activeIndex = OPTIONS.findIndex((o) => o.key === value)

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const el = btnRefs.current[activeIndex]
    if (!wrap || !el) return
    const update = () => {
      const cur = btnRefs.current[activeIndex]
      if (cur) setPill({ left: cur.offsetLeft, width: cur.offsetWidth })
    }
    update()
    // Activa a transição só após a primeira medição para evitar o "crescer" inicial.
    const raf = requestAnimationFrame(() => setReady(true))
    const ro = new ResizeObserver(update)
    ro.observe(wrap)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [activeIndex])

  return (
    <div
      ref={wrapRef}
      role="tablist"
      aria-label="Período do recebido"
      className="relative inline-flex items-center rounded-lg bg-black/15 p-0.5 ring-1 ring-inset ring-white/10 backdrop-blur-sm"
    >
      <span
        aria-hidden
        className={`absolute top-0.5 bottom-0.5 rounded-md bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] ${ready ? 'transition-[left,width] duration-300 ease-[cubic-bezier(0.34,1.4,0.5,1)]' : ''}`}
        style={{ left: pill.left, width: pill.width }}
      />
      {OPTIONS.map((o, i) => {
        const active = o.key === value
        return (
          <button
            key={String(o.key)}
            ref={(el) => { btnRefs.current[i] = el }}
            role="tab"
            aria-selected={active}
            onClick={(e) => { e.stopPropagation(); onChange(o.key) }}
            className={`relative z-10 px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60 ${active ? 'text-emerald-700' : 'text-white/65 hover:text-white'}`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export const ReceivedPeriodToggle = memo(ReceivedPeriodToggleBase)
