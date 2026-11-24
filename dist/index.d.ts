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
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export declare const name = "cesp-player";
export interface Config {
    /** Diretório dos pacotes OpenPeon; aceita `~`. */
    packsDir: string;
    /** Nome do pacote ativo dentro de `packsDir`. */
    activePack: string;
    /** Volume master, 0.0–1.0. */
    volume: number;
    /** Silencia tudo globalmente. */
    mute: boolean;
    /** `false` desabilita uma categoria CESP; ausente/`true` habilita. */
    enabledCategories: Record<string, boolean>;
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, rawConfig?: Config): void;
//# sourceMappingURL=index.d.ts.map