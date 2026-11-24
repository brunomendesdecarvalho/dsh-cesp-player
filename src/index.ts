/**
 * Plugin Cordis "cesp-player" para o DeepSeek Harness.
 *
 * Escuta eventos de ciclo de vida e traduz cada um para uma categoria CESP,
 * delegando a resolução/seleção de som ao `CespPlayer` e a reprodução ao
 * `AudioPlayer`. Nenhum listener bloqueia: `CespPlayer.play()` é síncrono e o
 * áudio é disparado em background (fire-and-forget).
 *
 * Mapeamento usado (eventos reais do Harness, inspecionados na versão 0.2.2):
 *   agent/created            -> session.start       (equivalente a session/start)
 *   session/event turn/start -> task.acknowledge    (habilitada por padrão)
 *   session/event turn/end   -> task.complete       (reason.kind === 'completed')
 *   session/event turn/end   -> resource.limit      (reason.kind === 'max-tokens')
 *   agent/error              -> task.error / resource.limit (por código)
 *   session/event approval/asked -> input.required  (evento durável, sempre chega)
 *   session/event tool/call ask_user_question -> input.required
 *   approval/request         -> input.required      (waterfall, best-effort)
 *   user-questions/request   -> input.required      (waterfall, best-effort)
 *
 * O catálogo do Cordis não expõe `session/start`, `turn/start`, `turn/end` nem
 * `tool/call` como eventos Cordis; `turn/*`, `tool/call` e os eventos de
 * aprovação são variantes do evento durável `session/event`. O plugin usa
 * esses eventos duráveis como caminho principal; os waterfalls de aprovação e
 * pergunta são um reforço para quando o escopo os entrega à raiz.
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { AudioPlayer } from './audio-player.js'
import { CespPlayer, type CespLogger } from './cesp-player.js'
import { categoryForAgentError, categoryForTurnEnd, isAskUserQuestionTool } from './event-map.js'

export const name = 'cesp-player'

export interface Config {
  /** Diretório dos pacotes OpenPeon; aceita `~`. */
  packsDir: string
  /** Nome do pacote ativo dentro de `packsDir`. */
  activePack: string
  /** Volume master, 0.0–1.0. */
  volume: number
  /** Silencia tudo globalmente. */
  mute: boolean
  /** `false` desabilita uma categoria CESP; ausente/`true` habilita. */
  enabledCategories: Record<string, boolean>
}

export const Config: Schema<Config> = Schema.object({
  packsDir: Schema.string()
    .default('~/.openpeon/packs/')
    .description('Diretório que contém os pacotes OpenPeon (aceita ~).'),
  activePack: Schema.string()
    .default('peon')
    .description('Nome da pasta do pacote ativo, ex.: peon.'),
  volume: Schema.number()
    .min(0)
    .max(1)
    .default(0.5)
    .description('Volume master de 0.0 a 1.0.'),
  mute: Schema.boolean().default(false).description('Silencia todos os sons.'),
  enabledCategories: Schema.dict(Schema.boolean())
    .default({})
    .description('Mapa categoria CESP -> habilitado. Ausente equivale a true.'),
})

const DEFAULT_PACKS_DIR = '~/.openpeon/packs/'
const DEFAULT_ACTIVE_PACK = 'peon'
const DEFAULT_VOLUME = 0.5

/** Contratos mínimos dos eventos que este plugin consome. */
interface SessionEventLike {
  readonly type?: string
  readonly data?: {
    readonly name?: string
    readonly reason?: {
      readonly kind?: string
    }
  }
}

type HarnessEventMap = {
  'agent/created': (payload: { source?: string }) => void
  'agent/error': (payload: { error?: unknown }) => void
  'session/event': (session: unknown, event: SessionEventLike) => void
  'approval/request': (
    request: unknown,
    next: () => Promise<unknown>,
  ) => Promise<unknown>
  'user-questions/request': (
    request: unknown,
    next: () => Promise<unknown>,
  ) => Promise<unknown>
}

interface HarnessEventContext {
  on<K extends keyof HarnessEventMap>(
    name: K,
    listener: HarnessEventMap[K],
    options?: { global?: boolean },
  ): () => boolean
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeConfig(input: Config | undefined): Config {
  const source: Partial<Config> = input ?? {}

  const packsDir =
    typeof source.packsDir === 'string' && source.packsDir.trim().length > 0
      ? source.packsDir
      : DEFAULT_PACKS_DIR
  const activePack =
    typeof source.activePack === 'string' && source.activePack.trim().length > 0
      ? source.activePack.trim()
      : DEFAULT_ACTIVE_PACK
  const volume =
    typeof source.volume === 'number' && Number.isFinite(source.volume)
      ? Math.min(1, Math.max(0, source.volume))
      : DEFAULT_VOLUME
  const mute = typeof source.mute === 'boolean' ? source.mute : false

  const enabledCategories: Record<string, boolean> = {}
  const rawEnabled = source.enabledCategories
  if (typeof rawEnabled === 'object' && rawEnabled !== null && !Array.isArray(rawEnabled)) {
    for (const [category, enabled] of Object.entries(rawEnabled)) {
      if (typeof enabled === 'boolean') enabledCategories[category] = enabled
    }
  }

  return { packsDir, activePack, volume, mute, enabledCategories }
}

export function apply(ctx: Context, rawConfig?: Config): void {
  const logger: CespLogger = console

  try {
    const config = normalizeConfig(rawConfig)
    const audio = new AudioPlayer({ volume: config.volume, logger })
    const player = new CespPlayer({
      packsDir: config.packsDir,
      activePack: config.activePack,
      mute: config.mute,
      enabledCategories: config.enabledCategories,
      sink: audio,
      logger,
    })
    const play = (category: string): void => {
      player.play(category)
    }

    // Recursos externos ao Cordis (processos de áudio) precisam de limpeza
    // explícita no unload/HMR. Os listeners de `ctx.on` já são efeitos.
    ctx.effect(() => () => {
      audio.dispose()
    })

    const status = player.status
    if (!status.ready) {
      // O CespPlayer já registrou o aviso (pacote ausente/JSON inválido/etc.).
      // Sem listeners, o plugin fica inerte em vez de derrubar o Harness.
      return
    }

    // O contexto do Cordis é tipado apenas com os eventos de plugins
    // carregados; estes contratos vêm dos pacotes internos do Harness.
    const events = ctx as unknown as HarnessEventContext

    events.on('agent/created', () => {
      play('session.start')
    }, { global: true })

    events.on('agent/error', (payload) => {
      // Rate limit/quota/contexto -> resource.limit; demais falhas -> task.error.
      play(categoryForAgentError(payload.error))
    }, { global: true })

    events.on('session/event', (_session, event) => {
      if (event.type === 'turn/start') {
        // Categoria core de "aceitou o trabalho"; habilitada por padrão.
        play('task.acknowledge')
        return
      }
      if (event.type === 'turn/end') {
        const category = categoryForTurnEnd(event.data?.reason)
        if (category !== null) play(category)
        return
      }
      // Fallback durável para o pedido de input: o serviço de perguntas roda
      // em um escopo de agente separado, então o waterfall pode não chegar ao
      // plugin de raiz. Estes eventos chegam sempre em `session/event`.
      if (event.type === 'approval/asked') {
        play('input.required')
        return
      }
      if (event.type === 'tool/call' && isAskUserQuestionTool(event.data?.name)) {
        play('input.required')
      }
    }, { global: true })

    // ATENÇÃO: approval/request e user-questions/request são eventos
    // "waterfall" e são despachados com escopo de agente. `global: true` é
    // necessário para um plugin de raiz recebê-los; chamar next() é
    // obrigatório para não vetar a aprovação ou a pergunta.
    events.on('approval/request', (_request, next) => {
      play('input.required')
      return next()
    }, { global: true })

    events.on('user-questions/request', (_request, next) => {
      play('input.required')
      return next()
    }, { global: true })
  } catch (error) {
    logger.warn(
      `[cesp-player] falha ao inicializar; plugin permanece inativo: ${describeError(error)}`,
    )
  }
}
