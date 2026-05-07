import { cn } from '@/lib/utils'

type Variant = 'green' | 'yellow' | 'red' | 'gray' | 'blue' | 'purple'

const variants: Record<Variant, string> = {
  green:  'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200/70',
  yellow: 'bg-amber-50   text-amber-700   ring-1 ring-amber-200/70',
  red:    'bg-red-50     text-red-700     ring-1 ring-red-200/70',
  gray:   'bg-gray-100   text-gray-600    ring-1 ring-gray-200/70',
  blue:   'bg-blue-50    text-blue-700    ring-1 ring-blue-200/70',
  purple: 'bg-violet-50  text-violet-700  ring-1 ring-violet-200/70',
}

interface BadgeProps {
  variant?: Variant
  children: React.ReactNode
  className?: string
}

export default function Badge({ variant = 'gray', children, className }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', variants[variant], className)}>
      {children}
    </span>
  )
}
