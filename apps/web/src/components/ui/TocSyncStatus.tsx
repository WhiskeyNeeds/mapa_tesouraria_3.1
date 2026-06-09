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

  // Estado de sincronização apresentado como chip coerente com a linguagem de
  // chips da página: âmbar quando há erro, neutro quando está em dia. A ação
  // "Actualizar" vive dentro do mesmo chip (ícone + texto).
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border pl-2.5 pr-1 py-1 text-xs transition-colors ${
        hasError
          ? 'border-amber-200 bg-amber-50 text-amber-700'
          : 'border-gray-200 bg-white text-gray-500'
      }`}
    >
      <span className="inline-flex items-center gap-1.5 font-medium">
        <span className={`h-1.5 w-1.5 rounded-full ${hasError ? 'bg-amber-500' : 'bg-emerald-500'}`} />
        {hasError
          ? 'Erro no sync'
          : minutesAgo !== null
            ? `Sincronizado há ${minutesAgo < 1 ? '<1' : minutesAgo} min`
            : 'TOConline'}
      </span>
      <button
        onClick={() => triggerSync()}
        disabled={isPending}
        title="Actualizar dados TOConline"
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium transition-colors disabled:opacity-40 ${
          hasError ? 'hover:bg-amber-100 text-amber-700' : 'hover:bg-gray-100 text-gray-600'
        }`}
      >
        <RefreshCw className={`w-3.5 h-3.5 ${isPending ? 'animate-spin' : ''}`} />
        <span>Actualizar</span>
      </button>
    </div>
  )
}
