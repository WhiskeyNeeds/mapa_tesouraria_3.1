import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { isAdmin } from '@/lib/auth'
import Modal from './Modal'
import Badge from './Badge'
import { Building2, Plus, Pencil, Trash2, AlertTriangle, ArrowLeft } from 'lucide-react'

interface Client { id: string; name: string; nif: string; isActive: boolean }
type View = 'list' | 'create' | 'edit' | 'delete-confirm'

interface Props {
  open: boolean
  onClose: () => void
}

export default function CompanyManagerModal({ open, onClose }: Props) {
  const { user, selectedClientId, setSelectedClientId, clearSelectedClientId } = useAuth()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const admin = isAdmin(user)

  const [view, setView] = useState<View>('list')
  const [editTarget, setEditTarget] = useState<Client | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null)
  const [createForm, setCreateForm] = useState({ name: '', nif: '' })
  const [editForm, setEditForm] = useState({ name: '' })
  const [error, setError] = useState('')

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ['clients'],
    queryFn: () => api.get('/clients'),
    enabled: open,
  })

  function reset() {
    setView('list')
    setEditTarget(null)
    setDeleteTarget(null)
    setCreateForm({ name: '', nif: '' })
    setEditForm({ name: '' })
    setError('')
  }

  function handleClose() {
    reset()
    onClose()
  }

  const createMutation = useMutation({
    mutationFn: (): Promise<Client> => api.post<Client>('/clients', createForm),
    onSuccess: (newClient) => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      setSelectedClientId(newClient.id)
      navigate('/')
      handleClose()
    },
    onError: (e) => setError((e as Error).message),
  })

  const updateMutation = useMutation({
    mutationFn: () => api.patch(`/clients/${editTarget!.id}`, editForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      reset()
    },
    onError: (e) => setError((e as Error).message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/clients/${deleteTarget!.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      if (deleteTarget?.id === selectedClientId) {
        clearSelectedClientId()
        handleClose()
        navigate('/auth/empresa')
      } else {
        reset()
      }
    },
    onError: (e) => setError((e as Error).message),
  })

  function switchTo(id: string) {
    setSelectedClientId(id)
    navigate('/')
    handleClose()
  }

  function openEdit(c: Client) {
    setEditTarget(c)
    setEditForm({ name: c.name })
    setError('')
    setView('edit')
  }

  function openDeleteConfirm(c: Client) {
    setDeleteTarget(c)
    setError('')
    setView('delete-confirm')
  }

  const modalTitle: Record<View, string> = {
    list: 'Gerir empresas',
    create: 'Nova empresa',
    edit: `Editar — ${editTarget?.name ?? ''}`,
    'delete-confirm': 'Eliminar empresa',
  }

  return (
    <Modal open={open} onClose={handleClose} title={modalTitle[view]} size="md">

      {/* LIST VIEW */}
      {view === 'list' && (
        <div className="space-y-4">
          {isLoading ? (
            <div className="text-center text-gray-500 py-8 text-sm">A carregar...</div>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
              {clients.map((c) => {
                const isSelected = c.id === selectedClientId
                return (
                  <div
                    key={c.id}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors ${
                      isSelected ? 'border-primary-200 bg-primary-50' : 'border-gray-100 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-primary-600' : 'bg-gray-100'}`}>
                      <Building2 className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-gray-500'}`} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-medium truncate ${isSelected ? 'text-primary-700' : 'text-gray-900'}`}>
                          {c.name}
                        </span>
                        {isSelected && <Badge variant="green">Selecionada</Badge>}
                        {!c.isActive && <Badge variant="gray">Inativa</Badge>}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">NIF {c.nif}</div>
                    </div>

                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      {!isSelected && (
                        <button
                          onClick={() => switchTo(c.id)}
                          className="text-xs text-primary-600 hover:text-primary-700 px-2.5 py-1 rounded-md hover:bg-primary-50 font-medium transition-colors"
                        >
                          Selecionar
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(c)}
                        className="p-1.5 text-gray-400 hover:text-gray-700 rounded-md hover:bg-gray-100 transition-colors"
                        title="Editar"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {admin && (
                        <button
                          onClick={() => openDeleteConfirm(c)}
                          className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              {clients.length === 0 && (
                <div className="text-center text-gray-400 py-8 text-sm">Sem empresas disponíveis.</div>
              )}
            </div>
          )}

          {admin && (
            <div className="pt-2 border-t border-gray-100">
              <button
                onClick={() => { setError(''); setView('create') }}
                className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 font-medium px-2 py-1.5 rounded-md hover:bg-primary-50 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Nova empresa
              </button>
            </div>
          )}
        </div>
      )}

      {/* CREATE VIEW */}
      {view === 'create' && (
        <div className="space-y-4">
          <button onClick={reset} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 -mt-1 mb-1">
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </button>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Nome da empresa <span className="text-red-500">*</span>
              </label>
              <input
                className="input w-full"
                placeholder="Ex: Empresa XPTO, Lda."
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                NIF <span className="text-red-500">*</span>
              </label>
              <input
                className="input w-full"
                placeholder="123456789"
                value={createForm.nif}
                onChange={(e) => setCreateForm((f) => ({ ...f, nif: e.target.value.replace(/\D/g, '') }))}
                maxLength={9}
              />
            </div>
          </div>

          {error && <ErrorBanner message={error} />}

          <div className="flex gap-3 pt-1">
            <button onClick={reset} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={!createForm.name.trim() || createForm.nif.length < 9 || createMutation.isPending}
              className="btn-primary flex-1"
            >
              {createMutation.isPending ? 'A criar...' : 'Criar empresa'}
            </button>
          </div>
        </div>
      )}

      {/* EDIT VIEW */}
      {view === 'edit' && editTarget && (
        <div className="space-y-4">
          <button onClick={reset} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 -mt-1 mb-1">
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </button>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nome da empresa</label>
              <input
                className="input w-full"
                value={editForm.name}
                onChange={(e) => setEditForm({ name: e.target.value })}
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">NIF</label>
              <input
                className="input w-full bg-gray-50 cursor-not-allowed text-gray-400"
                value={editTarget.nif}
                disabled
              />
              <p className="text-xs text-gray-400 mt-1">O NIF não pode ser alterado após a criação.</p>
            </div>
          </div>

          {error && <ErrorBanner message={error} />}

          <div className="flex gap-3 pt-1">
            <button onClick={reset} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={() => updateMutation.mutate()}
              disabled={!editForm.name.trim() || editForm.name.trim() === editTarget.name || updateMutation.isPending}
              className="btn-primary flex-1"
            >
              {updateMutation.isPending ? 'A guardar...' : 'Guardar'}
            </button>
          </div>
        </div>
      )}

      {/* DELETE CONFIRM VIEW */}
      {view === 'delete-confirm' && deleteTarget && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-500" />
            <div className="space-y-1">
              <p className="font-medium">
                Tem a certeza que quer eliminar <span className="font-bold">{deleteTarget.name}</span>?
              </p>
              <p className="text-red-700">
                Todos os dados de tesouraria desta empresa serão desativados e deixarão de ser acessíveis.
              </p>
              {deleteTarget.id === selectedClientId && (
                <p className="text-red-700 font-medium mt-1">
                  Esta é a empresa atualmente selecionada. Será redirecionado para escolher outra.
                </p>
              )}
            </div>
          </div>

          {error && <ErrorBanner message={error} />}

          <div className="flex gap-3">
            <button onClick={reset} className="btn-secondary flex-1">Cancelar</button>
            <button
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {deleteMutation.isPending ? 'A eliminar...' : 'Eliminar empresa'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
      <span>{message}</span>
    </div>
  )
}
