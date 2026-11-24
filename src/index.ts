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
 *   session/event turn/start -> task.acknowledge    (opcional)
 *   session/event turn/end   -> task.complete       (somente reason.kind === 'completed')
 *   agent/error              -> task.error
 *   approval/request         -> input.required      (waterfall: repassa next())
 *   user-questions/request   -> input.required      (waterfall: repassa next())
 *
 * O catálogo do Cordis não expõe `session/start`, `turn/start`, `turn/end` nem
 * `tool/call` como eventos Cordis; `turn/*` e `tool/call` são variantes do
 * evento durável `session/event`, e "aguardando input" é representado pelos
 * eventos explícitos de aprovação/pergunta. Por isso o mapeamento acima difere
 * ligeiramente da tabela nominal, sem perder o significado CESP.
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { AudioPlayer } from './audio-player.js'
import { CespPlayer, type CespLogger } from './cesp-player.js'

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
      player.play('session.start')
    })

    events.on('agent/error', () => {
      player.play('task.error')
    })

    events.on('session/event', (_session, event) => {
      if (event.type === 'turn/start') {
        // Opcional na tabela CESP; pode ser desligado em enabledCategories.
        player.play('task.acknowledge')
        return
      }
      if (event.type === 'turn/end' && event.data?.reason?.kind === 'completed') {
        // Erros são tratados por agent/error; aqui só há conclusão limpa.
        player.play('task.complete')
      }
    })

    // ATENÇÃO: approval/request e user-questions/request são eventos
    // "waterfall". Chamar next() é obrigatório para não vetar a aprovação ou
    // a pergunta; o play é fire-and-forget e não atrasa a cadeia.
    events.on('approval/request', (_request, next) => {
      player.play('input.required')
      return next()
    })

    events.on('user-questions/request', (_request, next) => {
      player.play('input.required')
      return next()
    })
  } catch (error) {
    logger.warn(
      `[cesp-player] falha ao inicializar; plugin permanece inativo: ${describeError(error)}`,
    )
  }
}
