/**
 * Tradução de eventos do Harness para categorias CESP.
 *
 * Funções puras para que o mapeamento seja testável sem Cordis nem áudio.
 * A spec CESP 1.0 define `resource.limit` para rate limit, quota e limite de
 * tokens/contexto; esses erros NÃO devem tocar `task.error`.
 */

/** Categorias CESP usadas por este player (core + as que mapeamos). */
export type CesCategory =
  | 'session.start'
  | 'task.acknowledge'
  | 'task.complete'
  | 'task.error'
  | 'input.required'
  | 'resource.limit'

/**
 * Códigos canônicos do Harness/LLM e aliases comuns de provedores que
 * representam limite de recurso, não uma falha genérica.
 */
const RESOURCE_LIMIT_CODES: ReadonlySet<string> = new Set([
  'RATE_LIMIT',
  'RATE_LIMITED',
  'TOO_MANY_REQUESTS',
  'QUOTA',
  'QUOTA_EXCEEDED',
  'ACCOUNT_QUOTA',
  'ACCOUNT_QUOTA_EXCEEDED',
  'CONTEXT_WINDOW_EXCEEDED',
  'CONTEXT_LENGTH_EXCEEDED',
  'MAX_TOKENS',
])

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')
}

/** Lê `error.code` ou `error.failure.code` sem confiar em `message`. */
function readErrorCode(error: unknown): string | undefined {
  const record = asRecord(error)
  if (record === null) return undefined

  if (typeof record.code === 'string' && record.code.trim().length > 0) {
    return normalizeCode(record.code)
  }

  const failure = asRecord(record.failure)
  if (failure !== null && typeof failure.code === 'string' && failure.code.trim().length > 0) {
    return normalizeCode(failure.code)
  }

  return undefined
}

/**
 * `agent/error` cobre falhas de step/turn. Limite de recurso vira
 * `resource.limit`; qualquer outro erro vira `task.error`.
 */
export function categoryForAgentError(error: unknown): CesCategory {
  const code = readErrorCode(error)
  if (code !== undefined && RESOURCE_LIMIT_CODES.has(code)) return 'resource.limit'
  return 'task.error'
}

/**
 * `turn/end`:
 * - `completed` -> `task.complete`
 * - `max-tokens` -> `resource.limit` (limite de tokens)
 * - `error` -> `null` aqui; `agent/error` é quem toca `task.error`/`resource.limit`
 * - `aborted`/`blocked`/`interrupted`/`forked` -> silencioso
 */
export function categoryForTurnEnd(reason: unknown): CesCategory | null {
  const record = asRecord(reason)
  const kind = record?.kind
  if (kind === 'completed') return 'task.complete'
  if (kind === 'max-tokens') return 'resource.limit'
  return null
}

/**
 * O evento durável `tool/call` de uma pergunta ao usuário é o caminho que
 * sempre chega ao plugin de raiz, mesmo quando o waterfall escopado não chega.
 */
export function isAskUserQuestionTool(name: unknown): boolean {
  return name === 'ask_user_question'
}
