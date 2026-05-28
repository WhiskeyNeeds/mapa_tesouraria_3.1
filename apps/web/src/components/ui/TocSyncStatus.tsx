import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

interface SyncStateRow {
  entityType: string
  lastSyncAt: string | null
  lastError: string | null
  recordCount: number | null
}

export default function TocSyncStatus({ invalidateKeys = [] }: { invalidateKeys?: string[][] }) {
  const { selectedClientId } = useAuth()
  const queryClient = useQueryClient()

  const { data: states = [] } = useQuery<SyncStateRow[]>({
    queryKey: ['toc-sync-status', selectedClientId],
    queryFn: () => api.get<SyncStateRow[]>(`/toconline/${selectedClientId}/sync-status`),
    enabled: !!selectedClientId,
    refetchInterval: 60_000,
  })

  const { mutate: triggerSync, isPending } = useMutation({
    mutationFn: () => api.post(`/toconline/${selectedClientId}/sync`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['toc-sync-status', selectedClientId] })
      for (const key of invalidateKeys) {
        queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })

  const hasError = states.some(s => s.lastError)
  const lastSyncDate = states
    .filter(s => s.lastSyncAt)
    .map(s => new Date(s.lastSyncAt!).getTime())
    .sort((a, b) => b - a)[0]

  const minutesAgo = lastSyncDate
    ? Math.round((Date.now() - lastSyncDate) / 60_000)
    : null

  return (
    <div className="flex items-center gap-2">
      {hasError && (
        <span className="text-xs text-amber-600 font-medium">Erro no sync</span>
      )}
      {minutesAgo !== null && !hasError && (
        <span className="text-xs text-gray-400">
          Actualizado há {minutesAgo < 1 ? '<1' : minutesAgo} min
        </span>
      )}
      <button
        onClick={() => triggerSync()}
        disabled={isPending}
        title="Actualizar dados TOConline"
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-40 transition-colors"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isPending ? 'animate-spin' : ''}`} />
        <span>Actualizar</span>
      </button>
    </div>
  )
}
