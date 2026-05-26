import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface DayOfMonthRangePickerProps {
  startDate: string
  endDate: string
  onStartChange: (date: string) => void
  onEndChange: (date: string) => void
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
  if (!s || s.length < 10) return '—'
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`
}

// Mini calendar with prev/next month navigation. Selection is by full date so the
// billing period can span months (e.g. start = 25 Jan, end = 10 Feb). Weekend cells
// (Sat/Sun) are non-interactive — only working days are pickable. Cells before the
// current start are disabled while editing the end so the range can never invert.
export default function DayOfMonthRangePicker({ startDate, endDate, onStartChange, onEndChange }: DayOfMonthRangePickerProps) {
  const [viewDate, setViewDate] = useState<Date>(() => parseYmd(startDate) ?? new Date())
  const [mode, setMode] = useState<'start' | 'end'>('start')

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
    const ymd = formatYmd(date)
    if (mode === 'start') {
      onStartChange(ymd)
      if (endDate && ymd > endDate) onEndChange(ymd)
      setMode('end')
    } else {
      if (startDate && ymd < startDate) return
      onEndChange(ymd)
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
      <div className="flex gap-2 px-3 pt-3">
        <button type="button" onClick={() => setMode('start')}
          className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors text-left ${mode === 'start' ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
          <span className="block text-[10px] uppercase tracking-wide opacity-70">Dia de início de fatura</span>
          <span className="text-sm font-semibold">{formatPt(startDate)}</span>
        </button>
        <button type="button" onClick={() => setMode('end')}
          className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors text-left ${mode === 'end' ? 'bg-orange-50 border-orange-300 text-orange-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
          <span className="block text-[10px] uppercase tracking-wide opacity-70">Dia de fim de fatura</span>
          <span className="text-sm font-semibold">{formatPt(endDate)}</span>
        </button>
      </div>

      <div className="flex items-center justify-between px-3 py-2">
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

      <div className="grid grid-cols-7 px-2 text-[10px] font-medium text-gray-400 uppercase">
        {WEEKDAY_NAMES.map((d, i) => (
          <div key={d} className={`py-1 text-center ${i >= 5 ? 'text-gray-300' : ''}`}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5 p-2">
        {grid.map((cell, i) => {
          const ymd = formatYmd(cell.date)
          const isStart = ymd === startDate
          const isEnd = ymd === endDate && endDate !== startDate
          const inRange = !!(startDate && endDate && ymd > startDate && ymd < endDate)
          const isWeekendCell = cell.weekday >= 5
          const isBeforeStart = mode === 'end' && !!startDate && ymd < startDate
          const isDisabled = isWeekendCell || isBeforeStart
          const stateClass = !cell.inMonth
            ? isStart
              ? 'bg-primary-300 text-white'
              : isEnd
                ? 'bg-orange-300 text-white'
                : inRange
                  ? 'bg-primary-50 text-primary-300'
                  : 'text-gray-300'
            : isWeekendCell
              ? `cursor-not-allowed ${isStart ? 'bg-primary-200 text-white/70' : isEnd ? 'bg-orange-200 text-white/70' : inRange ? 'bg-primary-50 text-primary-300' : 'text-gray-300'}`
              : isBeforeStart
                ? 'text-gray-300 cursor-not-allowed'
                : isStart
                  ? 'bg-primary-600 text-white font-semibold hover:bg-primary-700'
                  : isEnd
                    ? 'bg-orange-500 text-white font-semibold hover:bg-orange-600'
                    : inRange
                      ? 'bg-primary-100 text-primary-700 hover:bg-primary-200'
                      : 'text-gray-700 hover:bg-gray-100'
          const title = isBeforeStart
            ? 'O dia de fim tem de ser igual ou posterior ao dia de início'
            : isWeekendCell && cell.inMonth
              ? 'Apenas dias úteis (segunda a sexta)'
              : undefined
          const clickable = cell.inMonth && !isDisabled
          return (
            <button type="button" key={i}
              disabled={!clickable}
              onClick={() => { if (clickable) handleClick(cell.date) }}
              title={title}
              className={`h-8 text-xs rounded-md flex items-center justify-center transition-colors ${stateClass}`}>
              {cell.day}
            </button>
          )
        })}
      </div>
    </div>
  )
}
