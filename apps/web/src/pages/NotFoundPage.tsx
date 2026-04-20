import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-8xl font-bold text-gray-200">404</h1>
        <p className="text-xl text-gray-600 mt-4">Página não encontrada</p>
        <Link to="/" className="btn-primary inline-block mt-6">Voltar ao início</Link>
      </div>
    </div>
  )
}
