// ---------------------------------------------------------------------------
// Logger dedicado ao ciclo de vida dos tokens TOConline (diagnóstico).
//
// Escreve JSON lines em <cwd>/logs/toconline-refresh.log (uma linha por
// evento) para permitir análise offline do ciclo autorização → refresh →
// expiração. Nunca escreve tokens completos — apenas fingerprints
// (4 primeiros + 4 últimos chars + comprimento).
//
// Eventos: auth_ok | auth_exchange_fail | refresh_attempt | refresh_ok |
//          refresh_fail | refresh_impossible_no_rt | refresh_skipped_recent |
//          refresh_waited_inflight | tokens_set_manually
//
// O ficheiro é servido ao admin via GET /api/v1/toconline/refresh-log.
// ---------------------------------------------------------------------------

import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const LOG_DIR = process.env['TOC_REFRESH_LOG_DIR'] ?? join(process.cwd(), 'logs')
export const TOC_REFRESH_LOG_FILE = join(LOG_DIR, 'toconline-refresh.log')
let dirReady = false

/** Fingerprint seguro de um token (nunca o valor completo). */
export function rtFingerprint(token: string | null | undefined): string | null {
  if (!token) return null
  return `${token.slice(0, 4)}…${token.slice(-4)}(len=${token.length})`
}

/** Acrescenta um evento ao log dedicado (e espelha no stdout). Nunca lança. */
export function tocLog(event: string, data: Record<string, unknown>): void {
  try {
    if (!dirReady) {
      mkdirSync(LOG_DIR, { recursive: true })
      dirReady = true
    }
    const line = JSON.stringify({ ts: new Date().toISOString(), event, ...data })
    appendFileSync(TOC_REFRESH_LOG_FILE, line + '\n', 'utf8')
    console.info(`[TOC-LOG] ${line}`)
  } catch (err) {
    console.error('[TOC-LOG] falha ao escrever log:', err)
  }
}
