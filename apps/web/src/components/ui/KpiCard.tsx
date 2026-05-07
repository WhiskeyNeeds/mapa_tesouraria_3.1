import { cn } from '@/lib/utils'

interface KpiCardProps {
  title: string
  value: string
  valueColor?: 'default' | 'green' | 'red' | 'auto'
  rawValue?: number
  subtitle?: string
  trend?: { value: string; positive: boolean }
  icon?: React.ReactNode
  className?: string
  onClick?: () => void
}

export default function KpiCard({ title, value, valueColor = 'default', rawValue, subtitle, trend, icon, className, onClick }: KpiCardProps) {
  const colorClass =
    valueColor === 'green' ? 'text-emerald-600' :
    valueColor === 'red'   ? 'text-red-600' :
    valueColor === 'auto'  ? ((rawValue ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600') :
    'text-gray-900'

  return (
    <div
      className={cn(
        'card p-5 flex items-start gap-4',
        onClick && 'cursor-pointer hover:shadow-card-md hover:border-gray-200 transition-all duration-200',
        className,
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      {icon && (
        <div className="w-10 h-10 rounded-xl bg-slate-50 border border-gray-100 flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{title}</p>
        <p className={cn('mt-1.5 text-2xl font-bold tracking-tight leading-none', colorClass)}>{value}</p>
        {subtitle && <p className="mt-1.5 text-xs text-gray-400">{subtitle}</p>}
        {trend && (
          <div className={cn(
            'mt-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs font-semibold',
            trend.positive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
          )}>
            <span>{trend.positive ? '↑' : '↓'}</span>
            <span>{trend.value}</span>
          </div>
        )}
      </div>
    </div>
  )
}
