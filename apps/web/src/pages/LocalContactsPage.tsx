import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import Modal from '@/components/ui/Modal'
import { Plus, Pencil, Trash2, Search, X, User, Truck, Phone, Mail, MapPin, FileText, AlertTriangle } from 'lucide-react'

type ContactType = 'CUSTOMER' | 'SUPPLIER'

interface LocalContact {
  id: string
  type: ContactType
  name: string
  nif?: string | null
  phone?: string | null
  mobile?: string | null
  email?: string | null
  address?: string | null
  notes?: string | null
  createdAt: string
}

const emptyForm = {
  name: '',
  nif: '',
  phone: '',
  mobile: '',
  email: '',
  address: '',
  notes: '',
}

export default function LocalContactsPage() {
  const { selectedClientId } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()

  const [tab, setTab] = useState<ContactType>('CUSTOMER')
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editItem, setEditItem] = useState<LocalContact | null>(null)
  const [editForm, setEditForm] = useState(emptyForm)
  const [deleteContact, setDeleteContact] = useState<LocalContact | null>(null)

  const qKey = ['local-contacts', selectedClientId, tab]

  const { data: contacts = [], isLoading } = useQuery<LocalContact[]>({
    queryKey: [...qKey, search],
    queryFn: () => {
      const p = new URLSearchParams({ type: tab })
      if (search) p.set('search', search)
      return api.get(`/treasury/${selectedClientId}/local-contacts?${p}`)
    },
    enabled: !!selectedClientId,
  })

  const create = useMutation({
    mutationFn: () => api.post(`/treasury/${selectedClientId}/local-contacts`, { type: tab, ...form }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qKey })
      setShowNew(false)
      setForm(emptyForm)
      toast.success(tab === 'CUSTOMER' ? 'Cliente criado.' : 'Fornecedor criado.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const update = useMutation({
    mutationFn: () => api.patch(`/treasury/${selectedClientId}/local-contacts/${editItem?.id}`, editForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qKey })
      setEditItem(null)
      toast.success('Atualizado com sucesso.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const { data: docCount, isLoading: docCountLoading } = useQuery<{ receivables: number; payables: number; total: number }>({
    queryKey: ['local-contact-doc-count', selectedClientId, deleteContact?.id],
    queryFn: () => api.get(`/treasury/${selectedClientId}/local-contacts/${deleteContact!.id}/doc-count`),
    enabled: !!deleteContact && !!selectedClientId,
  })

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/treasury/${selectedClientId}/local-contacts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qKey })
      qc.invalidateQueries({ queryKey: ['receivables'] })
      qc.invalidateQueries({ queryKey: ['payables'] })
      setDeleteContact(null)
      toast.success('Eliminado.')
    },
    onError: (e) => toast.error((e as Error).message),
  })

  function openEdit(c: LocalContact) {
    setEditItem(c)
    setEditForm({
      name: c.name,
      nif: c.nif ?? '',
      phone: c.phone ?? '',
      mobile: c.mobile ?? '',
      email: c.email ?? '',
      address: c.address ?? '',
      notes: c.notes ?? '',
    })
  }

  const tabLabel = tab === 'CUSTOMER' ? 'Cliente' : 'Fornecedor'
  const TabIcon = tab === 'CUSTOMER' ? User : Truck

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Definições Locais</h1>
        <p className="text-sm text-gray-500 mt-1">Clientes e fornecedores guardados localmente, sem ligação ao TOConline.</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {([['CUSTOMER', 'Clientes', User], ['SUPPLIER', 'Fornecedores', Truck]] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => { setTab(id); setSearch('') }}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === id ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {/* Toolbar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="input pl-9 text-sm"
              placeholder={`Pesquisar ${tab === 'CUSTOMER' ? 'clientes' : 'fornecedores'}...`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button onClick={() => setShowNew(true)} className="btn-primary flex items-center gap-2 whitespace-nowrap">
            <Plus className="w-4 h-4" />
            {tab === 'CUSTOMER' ? 'Novo Cliente' : 'Novo Fornecedor'}
          </button>
        </div>

        {/* List */}
        <div className="card divide-y divide-gray-50">
          {isLoading ? (
            <div className="py-12 text-center text-sm text-gray-400">A carregar...</div>
          ) : contacts.length === 0 ? (
            <div className="py-16 text-center">
              <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <TabIcon className="w-5 h-5 text-gray-400" />
              </div>
              <p className="text-sm font-medium text-gray-500">
                {search ? 'Nenhum resultado encontrado' : `Sem ${tab === 'CUSTOMER' ? 'clientes' : 'fornecedores'} registados`}
              </p>
              {!search && (
                <p className="text-xs text-gray-400 mt-1">Clica em "{tab === 'CUSTOMER' ? 'Novo Cliente' : 'Novo Fornecedor'}" para começar.</p>
              )}
            </div>
          ) : (
            contacts.map((c) => (
              <div key={c.id} className="flex items-start gap-4 px-5 py-4 group hover:bg-gray-50/50 transition-colors">
                <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-primary-700">{c.name.charAt(0).toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{c.name}</span>
                    {c.nif && <span className="text-xs text-gray-400">NIF {c.nif}</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
                    {c.phone && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Phone className="w-3 h-3" />{c.phone}
                      </span>
                    )}
                    {c.email && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Mail className="w-3 h-3" />{c.email}
                      </span>
                    )}
                    {c.address && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <MapPin className="w-3 h-3" />{c.address}
                      </span>
                    )}
                  </div>
                  {c.notes && (
                    <p className="text-xs text-gray-400 mt-1 italic">{c.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => openEdit(c)}
                    className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50 transition-colors"
                    title="Editar"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setDeleteContact(c)}
                    className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                    title="Eliminar"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modal — Criar */}
      <Modal open={showNew} onClose={() => { setShowNew(false); setForm(emptyForm) }} title={`Novo ${tabLabel}`} size="lg">
        <ContactForm form={form} onChange={setForm} />
        {create.isError && (
          <p className="mt-3 text-sm text-red-600 bg-white border border-red-200 rounded-lg px-3 py-2">{(create.error as Error).message}</p>
        )}
        <div className="flex gap-3 mt-6">
          <button onClick={() => { setShowNew(false); setForm(emptyForm) }} className="btn-secondary flex-1">Cancelar</button>
          <button
            onClick={() => create.mutate()}
            className="btn-primary flex-1"
            disabled={create.isPending || !form.name.trim() || form.nif.length !== 9}
          >
            {create.isPending ? 'A guardar...' : 'Criar'}
          </button>
        </div>
      </Modal>

      {/* Modal — Editar */}
      <Modal open={!!editItem} onClose={() => setEditItem(null)} title={`Editar ${tabLabel}`} size="lg">
        <ContactForm form={editForm} onChange={setEditForm} />
        {update.isError && (
          <p className="mt-3 text-sm text-red-600 bg-white border border-red-200 rounded-lg px-3 py-2">{(update.error as Error).message}</p>
        )}
        <div className="flex gap-3 mt-6">
          <button onClick={() => setEditItem(null)} className="btn-secondary flex-1">Cancelar</button>
          <button
            onClick={() => update.mutate()}
            className="btn-primary flex-1"
            disabled={update.isPending || !editForm.name.trim() || editForm.nif.length !== 9}
          >
            {update.isPending ? 'A guardar...' : 'Guardar alterações'}
          </button>
        </div>
      </Modal>

      {/* Modal — Confirmar eliminação */}
      <Modal open={!!deleteContact} onClose={() => setDeleteContact(null)} title="Eliminar registo" size="sm">
        {docCountLoading ? (
          <p className="text-sm text-gray-400">A verificar documentos associados...</p>
        ) : docCount && docCount.total > 0 ? (
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 bg-white border border-red-200 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-red-700">
                <p className="font-semibold mb-1">Este {tabLabel.toLowerCase()} tem documentos associados</p>
                <ul className="text-xs space-y-0.5 mb-2">
                  {docCount.receivables > 0 && <li>• {docCount.receivables} conta{docCount.receivables !== 1 ? 's' : ''} a receber</li>}
                  {docCount.payables > 0 && <li>• {docCount.payables} conta{docCount.payables !== 1 ? 's' : ''} a pagar</li>}
                </ul>
                <p className="text-xs font-medium">Ao eliminar, todos estes documentos serão também eliminados da base de dados. Esta ação não pode ser revertida.</p>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-600">Tens a certeza que queres eliminar este {tabLabel.toLowerCase()}? Esta ação não pode ser revertida.</p>
        )}
        <div className="flex gap-3 mt-6">
          <button onClick={() => setDeleteContact(null)} className="btn-secondary flex-1">Cancelar</button>
          <button
            onClick={() => deleteContact && remove.mutate(deleteContact.id)}
            className="btn-danger flex-1"
            disabled={remove.isPending || docCountLoading}
          >
            {remove.isPending ? 'A eliminar...' : docCount && docCount.total > 0 ? 'Eliminar tudo' : 'Eliminar'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function ContactForm({
  form,
  onChange,
}: {
  form: typeof emptyForm
  onChange: (f: typeof emptyForm) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="col-span-2">
        <label className="label">Nome <span className="text-red-500">*</span></label>
        <input className="input" value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} placeholder="Nome completo ou empresa" autoFocus />
      </div>
      <div>
        <label className="label">NIF <span className="text-red-500">*</span></label>
        <input
          className="input"
          value={form.nif}
          onChange={(e) => { if (/^\d{0,9}$/.test(e.target.value)) onChange({ ...form, nif: e.target.value }) }}
          placeholder="123456789"
          maxLength={9}
          inputMode="numeric"
        />
      </div>
      <div>
        <label className="label flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-gray-400" />Telefone <span className="text-gray-400 font-normal">(opcional)</span></label>
        <input
          className="input"
          value={form.phone}
          onChange={(e) => { if (/^\d{0,9}$/.test(e.target.value)) onChange({ ...form, phone: e.target.value }) }}
          placeholder="210000000"
          maxLength={9}
          inputMode="numeric"
        />
      </div>
      <div>
        <label className="label flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-gray-400" />Telemóvel <span className="text-gray-400 font-normal">(opcional)</span></label>
        <input
          className="input"
          value={form.mobile}
          onChange={(e) => { if (/^\d{0,9}$/.test(e.target.value)) onChange({ ...form, mobile: e.target.value }) }}
          placeholder="910000000"
          maxLength={9}
          inputMode="numeric"
        />
      </div>
      <div className="col-span-2">
        <label className="label flex items-center gap-1.5"><Mail className="w-3.5 h-3.5 text-gray-400" />Email <span className="text-gray-400 font-normal">(opcional)</span></label>
        <input type="email" className="input" value={form.email} onChange={(e) => onChange({ ...form, email: e.target.value })} placeholder="exemplo@email.pt" />
      </div>
      <div className="col-span-2">
        <label className="label flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-gray-400" />Morada <span className="text-gray-400 font-normal">(opcional)</span></label>
        <input className="input" value={form.address} onChange={(e) => onChange({ ...form, address: e.target.value })} placeholder="Rua, Nº, Cidade, Código Postal" />
      </div>
      <div className="col-span-2">
        <label className="label flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 text-gray-400" />Notas <span className="text-gray-400 font-normal">(opcional)</span></label>
        <textarea className="input resize-none" rows={3} value={form.notes} onChange={(e) => onChange({ ...form, notes: e.target.value })} placeholder="Observações ou informações adicionais" />
      </div>
    </div>
  )
}
