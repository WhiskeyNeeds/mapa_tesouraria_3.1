/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Domínio base da API (ex.: https://api.mapa.ricardodomingos.eu). Vazio em dev (usa proxy do Vite). */
  readonly VITE_API_URL?: string
}
