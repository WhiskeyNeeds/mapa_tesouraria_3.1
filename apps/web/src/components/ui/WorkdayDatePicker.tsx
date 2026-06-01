import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react'

interface WorkdayDatePickerProps {
  value: string
  onChange: (ymd: string) => void
  /** Datas anteriores a este YYYY-MM-DD ficam desativadas. Opcional. */
  min?: string
  placeholder?: string
  /** Classes extra para o botão de trigger (estilizado como `.input`). */
  className?: string
  id?: string
}

const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const WEEKDAY_NAMES = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

function parseYmd(s: string): Date | null {
  if (!s || s.length < 10) return null
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function formatYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatPt(s: string): string {
  if (!s || s.length < 10) return ''
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`
}

// Seletor de data única em que os fins-de-semana (sábado/domingo) ficam
// desativados e não são clicáveis. Usado nos campos de Data de Vencimento, onde
// as operações de tesouraria só podem cair em dias úteis. Substitui o
// <input type="date"> nativo, que não permite desativar dias da semana.
export default function WorkdayDatePicker({ value, onChange, min, placeholder = 'Selecionar data', className = '', id }: WorkdayDatePickerProps) {
  const [open, setOpen] = useState(false)
  const [viewDate, setViewDate] = useState<Date>(() => parseYmd(value) ?? new Date())
  const ref = useRef<HTMLDivElement>(null)

  // Sincroniza o mês visível com o valor sempre que o calendário é aberto.
  useEffect(() => {
    if (open) setViewDate(parseYmd(value) ?? new Date())
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const grid = useMemo(() => {
    const first = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1)
    const lastDayNum = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate()
    const firstWeekday = (first.getDay() + 6) % 7
    const cells: { date: Date; day: number; weekday: number; inMonth: boolean }[] = []
    for (let i = firstWeekday; i > 0; i--) {
      const d = new Date(first); d.setDate(d.getDate() - i)
      cells.push({ date: d, day: d.getDate(), weekday: (d.getDay() + 6) % 7, inMonth: false })
    }
    for (let d = 1; d <= lastDayNum; d++) {
      const date = new Date(viewDate.getFullYear(), viewDate.getMonth(), d)
      cells.push({ date, day: d, weekday: (date.getDay() + 6) % 7, inMonth: true })
    }
    while (cells.length < 42) {
      const last = cells[cells.length - 1].date
      const next = new Date(last); next.setDate(next.getDate() + 1)
      cells.push({ date: next, day: next.getDate(), weekday: (next.getDay() + 6) % 7, inMonth: false })
    }
    return cells.slice(0, 42)
  }, [viewDate])

  const handleClick = (date: Date) => {
    onChange(formatYmd(date))
    setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        id={id}
        onClick={() => setOpen((v) => !v)}
        className={`input flex items-center justify-between text-left ${className}`}
      >
        <span className={value ? 'text-gray-900' : 'text-gray-400'}>{value ? formatPt(value) : placeholder}</span>
        <CalendarIcon className="w-4 h-4 text-gray-400 flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 bg-white border border-gray-200 rounded-lg shadow-lg p-2 w-72">
          <div className="flex items-center justify-between px-1">
            <button type="button" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}
              className="p-1 text-gray-400 hover:text-gray-700 rounded">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-sm font-semibold text-gray-800">{MONTH_NAMES[viewDate.getMonth()]} {viewDate.getFullYear()}</div>
            <button type="button" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}
              className="p-1 text-gray-400 hover:text-gray-700 rounded">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 px-1 pt-1 text-[10px] font-medium text-gray-400 uppercase">
            {WEEKDAY_NAMES.map((d, i) => (
              <div key={d} className={`py-1 text-center ${i >= 5 ? 'text-gray-300' : ''}`}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5 p-1">
            {grid.map((cell, i) => {
              const ymd = formatYmd(cell.date)
              const isSelected = ymd === value
              const isWeekendCell = cell.weekday >= 5
              const isBeforeMin = !!min && ymd < min
              const isDisabled = isWeekendCell || isBeforeMin
              const clickable = cell.inMonth && !isDisabled
              const stateClass = !cell.inMonth
                ? 'text-gray-300'
                : isDisabled
                  ? `cursor-not-allowed ${isSelected ? 'bg-primary-200 text-white/70' : 'text-gray-300'}`
                  : isSelected
                    ? 'bg-primary-600 text-white font-semibold hover:bg-primary-700'
                    : 'text-gray-700 hover:bg-gray-100'
              const title = isWeekendCell && cell.inMonth
                ? 'Apenas dias úteis (segunda a sexta)'
                : isBeforeMin
                  ? 'Data indisponível'
                  : undefined
              return (
                <button type="button" key={i}
                  disabled={!clickable}
                  onClick={() => { if (clickable) handleClick(cell.date) }}
                  title={title}
                  className={`h-7 text-xs rounded flex items-center justify-center transition-colors ${stateClass}`}>
                  {cell.day}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
