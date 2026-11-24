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