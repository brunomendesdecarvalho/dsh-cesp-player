/**
 * Tradução de eventos do Harness para categorias CESP.
 *
 * Funções puras para que o mapeamento seja testável sem Cordis nem áudio.
 * A spec CESP 1.0 define `resource.limit` para rate limit, quota e limite de
 * tokens/contexto; esses erros NÃO devem tocar `task.error`.
 */
/** Categorias CESP usadas por este player (core + as que mapeamos). */
export type CesCategory = 'session.start' | 'task.acknowledge' | 'task.complete' | 'task.error' | 'input.required' | 'resource.limit';
/**
 * `agent/error` cobre falhas de step/turn. Limite de recurso vira
 * `resource.limit`; qualquer outro erro vira `task.error`.
 */
export declare function categoryForAgentError(error: unknown): CesCategory;
/**
 * `turn/end`:
 * - `completed` -> `task.complete`
 * - `max-tokens` -> `resource.limit` (limite de tokens)
 * - `error` -> `null` aqui; `agent/error` é quem toca `task.error`/`resource.limit`
 * - `aborted`/`blocked`/`interrupted`/`forked` -> silencioso
 */
export declare function categoryForTurnEnd(reason: unknown): CesCategory | null;
/**
 * O evento durável `tool/call` de uma pergunta ao usuário é o caminho que
 * sempre chega ao plugin de raiz, mesmo quando o waterfall escopado não chega.
 */
export declare function isAskUserQuestionTool(name: unknown): boolean;
//# sourceMappingURL=event-map.d.ts.map