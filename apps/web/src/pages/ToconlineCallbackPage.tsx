import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

export default function ToconlineCallbackPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    const state = params.get('state')
    const errorParam = params.get('error')

    if (errorParam) {
      const desc = params.get('error_description') ?? errorParam
      setError(desc)
      setStatus('error')
      return
    }

    if (!code || !state) {
      setError('Parâmetros OAuth em falta (code ou state).')
      setStatus('error')
      return
    }

    api.post('/toconline/callback', { code, state })
      .then(() => {
        setStatus('success')
        // Signal the opener window (if opened as popup/new tab)
        if (window.opener) {
          window.opener.postMessage({ type: 'toconline-auth-success' }, window.location.origin)
          setTimeout(() => window.close(), 1500)
        } else {
          setTimeout(() => navigate('/definicoes?toconline=success', { replace: true }), 1500)
        }
      })
      .catch((err: Error) => {
        setError(err.message)
        setStatus('error')
      })
  }, [navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="card p-8 max-w-sm w-full text-center space-y-4">
        {status === 'loading' && (
          <>
            <Loader2 className="w-10 h-10 text-primary-600 animate-spin mx-auto" />
            <p className="text-sm text-gray-600">A processar autorização TOConline...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle className="w-10 h-10 text-green-500 mx-auto" />
            <p className="text-sm font-medium text-gray-900">Ligação estabelecida com sucesso!</p>
            <p className="text-xs text-gray-500">{window.opener ? 'A fechar esta janela...' : 'A redirecionar...'}</p>
          </>
        )}
        {status === 'error' && (
          <>
            <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
            <p className="text-sm font-medium text-gray-900">Erro na autorização</p>
            <p className="text-xs text-red-600">{error}</p>
            <button onClick={() => window.close()} className="btn-secondary text-sm w-full">Fechar</button>
          </>
        )}
      </div>
    </div>
  )
}
