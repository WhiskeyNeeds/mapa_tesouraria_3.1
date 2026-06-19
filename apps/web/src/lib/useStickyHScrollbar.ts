import { useCallback, useRef } from 'react'

/**
 * Mantém o scroll horizontal de um contentor (tipicamente um wrapper
 * `overflow-x-auto` à volta de uma tabela larga) sempre acessível: esconde a
 * scrollbar nativa (que fica no fundo da tabela, muitas vezes abaixo da dobra)
 * e cria uma scrollbar "fantasma" fixa ao fundo da janela, sincronizada com o
 * contentor. Só aparece quando há overflow horizontal e o contentor está
 * visível no ecrã.
 *
 * Uso: `const ref = useStickyHScrollbar(); <div ref={ref} className="overflow-x-auto">…`
 * Cada tabela precisa da sua própria instância do hook.
 */
function attach(scroller: HTMLElement): () => void {
  scroller.classList.add('hscroll-host')

  const bar = document.createElement('div')
  bar.className = 'hscroll-floating'
  bar.style.display = 'none'
  const spacer = document.createElement('div')
  spacer.className = 'hscroll-floating-spacer'
  bar.appendChild(spacer)
  document.body.appendChild(bar)

  let syncing = false
  let raf = 0

  const align = () => {
    raf = 0
    const overflow = scroller.scrollWidth - scroller.clientWidth
    if (overflow <= 1) { bar.style.display = 'none'; return }
    const rect = scroller.getBoundingClientRect()
    const inView = rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight
    if (!inView) { bar.style.display = 'none'; return }
    const left = Math.max(0, rect.left)
    bar.style.display = 'block'
    bar.style.left = left + 'px'
    bar.style.width = Math.min(rect.width, window.innerWidth - left) + 'px'
    spacer.style.width = scroller.scrollWidth + 'px'
    if (!syncing) { syncing = true; bar.scrollLeft = scroller.scrollLeft; syncing = false }
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(align) }

  const onBar = () => { if (syncing) return; syncing = true; scroller.scrollLeft = bar.scrollLeft; syncing = false }
  const onScroller = () => { if (syncing) return; syncing = true; bar.scrollLeft = scroller.scrollLeft; syncing = false }

  bar.addEventListener('scroll', onBar, { passive: true })
  scroller.addEventListener('scroll', onScroller, { passive: true })
  // Captura também o scroll de contentores internos (ex.: a coluna que rola
  // verticalmente em Contas a Receber/Pagar) para reposicionar a barra.
  window.addEventListener('scroll', schedule, true)
  window.addEventListener('resize', schedule)
  const ro = new ResizeObserver(schedule)
  ro.observe(scroller)
  const mo = new MutationObserver(schedule)
  mo.observe(scroller, { childList: true, subtree: true })

  schedule()

  return () => {
    bar.removeEventListener('scroll', onBar)
    scroller.removeEventListener('scroll', onScroller)
    window.removeEventListener('scroll', schedule, true)
    window.removeEventListener('resize', schedule)
    ro.disconnect()
    mo.disconnect()
    if (raf) cancelAnimationFrame(raf)
    bar.remove()
    scroller.classList.remove('hscroll-host')
  }
}

export function useStickyHScrollbar<T extends HTMLElement = HTMLDivElement>() {
  const cleanup = useRef<(() => void) | null>(null)
  return useCallback((node: T | null) => {
    if (cleanup.current) { cleanup.current(); cleanup.current = null }
    if (node) cleanup.current = attach(node)
  }, [])
}
