/**
 * Reprodução de áudio no Linux — fire-and-forget.
 *
 * Este módulo NÃO usa bibliotecas de áudio: apenas o `child_process` nativo.
 * A detecção do backend (`which`) é assíncrona e cacheada; `play()` retorna
 * imediatamente, sem `await` no processo filho, para nunca segurar o loop do
 * agente. Os processos são destacados (`detached`) e têm stdio ignorado, então
 * também não mantêm o processo do Harness vivo.
 */
/** Logger mínimo aceito pelo player; `console` satisfaz a interface. */
export interface AudioLogger {
    warn(message: string): void;
}
export interface AudioPlayerOptions {
    /** Volume master, 0.0–1.0. Valores fora da faixa são recortados. */
    volume: number;
    logger?: AudioLogger;
}
/** Um backend de áudio e a forma como ele recebe volume e arquivo. */
export interface AudioBackend {
    readonly command: string;
    buildArgs(file: string, volume: number): string[];
}
/**
 * Backends na ordem de preferência exigida pela especificação CESP.
 * O primeiro comando encontrado no PATH vence.
 */
export declare const AUDIO_BACKENDS: readonly AudioBackend[];
export declare class AudioPlayer {
    readonly volume: number;
    private readonly logger;
    private backendPromise;
    private readonly children;
    private disposed;
    constructor(options: AudioPlayerOptions);
    /** Resolve (uma única vez) o primeiro backend disponível no PATH. */
    resolveBackend(): Promise<AudioBackend | null>;
    private detectBackend;
    /**
     * Dispara o som e retorna imediatamente. A escolha do backend e o `spawn`
     * acontecem depois, em uma microtask; nenhum erro é propagado ao chamador.
     */
    play(file: string): void;
    private spawnPlayback;
    /**
     * Encerra players ainda em execução. Chamado pelo `ctx.effect` no unload do
     * plugin; sem isso, um unload/HMR poderia deixar um som curto tocando.
     */
    dispose(): void;
}
//# sourceMappingURL=audio-player.d.ts.map