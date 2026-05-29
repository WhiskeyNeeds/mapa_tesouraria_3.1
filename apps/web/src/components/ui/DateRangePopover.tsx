import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X, Calendar as CalendarIcon } from 'lucide-react'

interface DateRangePopoverProps {
  label: string
  startDate: string
  endDate: string
  onChange: (start: string, end: string) => void
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

function formatShort(s: string): string {
  if (!s || s.length < 10) return '…'
  return `${s.slice(8, 10)}/${s.slice(5, 7)}`
}

export default function DateRangePopover({ label, startDate, endDate, onChange }: DateRangePopoverProps) {
  const [open, setOpen] = useState(false)
  const [viewDate, setViewDate] = useState<Date>(() => parseYmd(startDate) ?? parseYmd(endDate) ?? new Date())
  const ref = useRef<HTMLDivElement>(null)

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
    const cells: { date: Date; day: number; inMonth: boolean }[] = []
    for (let i = firstWeekday; i > 0; i--) {
      const d = new Date(first); d.setDate(d.getDate() - i)
      cells.push({ date: d, day: d.getDate(), inMonth: false })
    }
    for (let d = 1; d <= lastDayNum; d++) {
      const date = new Date(viewDate.getFullYear(), viewDate.getMonth(), d)
      cells.push({ date, day: d, inMonth: true })
    }
    while (cells.length < 42) {
      const last = cells[cells.length - 1].date
      const next = new Date(last); next.setDate(next.getDate() + 1)
      cells.push({ date: next, day: next.getDate(), inMonth: false })
    }
    return cells.slice(0, 42)
  }, [viewDate])

  const handleClick = (date: Date) => {
    const ymd = formatYmd(date)
    if (!startDate || (startDate && endDate)) {
      onChange(ymd, '')
    } else if (ymd < startDate) {
      onChange(ymd, startDate)
    } else {
      onChange(startDate, ymd)
    }
  }

  const hasRange = !!(startDate || endDate)
  const rangeText = hasRange ? `${startDate ? formatShort(startDate) : '…'} – ${endDate ? formatShort(endDate) : '…'}` : ''

  return (
    <div className="relative" ref={ref}>
      <div
        className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors cursor-pointer ${hasRange ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
        onClick={() => setOpen((v) => !v)}
      >
        <CalendarIcon className="w-3.5 h-3.5" />
        <span className="font-medium whitespace-nowrap">{label}</span>
        {hasRange && <span className="text-gray-600 whitespace-nowrap">{rangeText}</span>}
        {hasRange && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onChange('', '') }}
            className="text-gray-400 hover:text-gray-700"
          >
            <X className="w-3.5 h-3.5" />
          </span>
        )}
      </div>

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
            {WEEKDAY_NAMES.map((d) => (
              <div key={d} className="py-1 text-center">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5 p-1">
            {grid.map((cell, i) => {
              const ymd = formatYmd(cell.date)
              const isStart = ymd === startDate
              const isEnd = ymd === endDate && endDate !== startDate
              const inRange = !!(startDate && endDate && ymd > startDate && ymd < endDate)
              const stateClass = !cell.inMonth
                ? 'text-gray-300'
                : isStart || isEnd
                  ? 'bg-primary-600 text-white font-semibold hover:bg-primary-700'
                  : inRange
                    ? 'bg-primary-100 text-primary-700 hover:bg-primary-200'
                    : 'text-gray-700 hover:bg-gray-100'
              return (
                <button type="button" key={i}
                  onClick={() => handleClick(cell.date)}
                  className={`h-7 text-xs rounded flex items-center justify-center transition-colors ${stateClass}`}>
                  {cell.day}
                </button>
              )
            })}
          </div>

          <div className="flex justify-between items-center px-1 pt-1 border-t border-gray-100">
            <button type="button" onClick={() => onChange('', '')}
              className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">Limpar</button>
            <button type="button" onClick={() => setOpen(false)}
              className="text-xs text-primary-600 hover:text-primary-700 font-medium px-2 py-1">Fechar</button>
          </div>
        </div>
      )}
    </div>
  )
}
