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
}

export default function KpiCard({ title, value, valueColor = 'default', rawValue, subtitle, trend, icon, className }: KpiCardProps) {
  const colorClass =
    valueColor === 'green' ? 'text-green-600' :
    valueColor === 'red'   ? 'text-red-600' :
    valueColor === 'auto'  ? ((rawValue ?? 0) >= 0 ? 'text-green-600' : 'text-red-600') :
    'text-gray-900'

  return (
    <div className={cn('card p-5', className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 font-medium">{title}</p>
          <p className={cn('mt-1.5 text-2xl font-bold', colorClass)}>{value}</p>
          {subtitle && <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>}
          {trend && (
            <p className={`mt-1 text-xs font-medium ${trend.positive ? 'text-green-600' : 'text-red-600'}`}>
              {trend.positive ? '↑' : '↓'} {trend.value}
            </p>
          )}
        </div>
        {icon && <div className="text-gray-400">{icon}</div>}
      </div>
    </div>
  )
}
