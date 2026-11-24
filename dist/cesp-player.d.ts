/**
 * Núcleo CESP (Coding Event Sound Pack).
 *
 * Responsabilidades:
 *  - carregar e validar `openpeon.json` de um pacote OpenPeon;
 *  - resolver nomes de categoria (diretos e via `category_aliases`);
 *  - escolher um som aleatório sem repetir o último da categoria;
 *  - aplicar debounce por categoria;
 *  - respeitar `mute` e `enabledCategories`.
 *
 * O módulo não conhece o Harness nem áudio: recebe um `CespSoundSink` e um
 * relógio/fonte de aleatoriedade injetáveis, o que o torna testável e mantém a
 * integração com eventos em `index.ts`.
 */
/** Logger mínimo; `console` satisfaz a interface. */
export interface CespLogger {
    warn(message: string): void;
    info?(message: string): void;
}
/** Destino de um som já resolvido (o player de áudio, em produção). */
export interface CespSoundSink {
    play(file: string): void;
}
export interface CespPlayerOptions {
    /** Diretório que contém os pacotes; aceita `~`. */
    packsDir: string;
    /** Nome do pacote ativo dentro de `packsDir`. */
    activePack: string;
    /** Silencia tudo globalmente. */
    mute: boolean;
    /** `false` desabilita uma categoria CESP; ausente/`true` habilita. */
    enabledCategories: Readonly<Record<string, boolean>>;
    sink: CespSoundSink;
    logger?: CespLogger;
    /** Relógio injetável (ms); padrão `Date.now`. */
    now?: () => number;
    /** Aleatoriedade injetável em [0, 1); padrão `Math.random`. */
    random?: () => number;
    /** Janela de debounce por categoria; padrão 500 ms. */
    debounceMs?: number;
}
export interface CespPlayerStatus {
    ready: boolean;
    reason: string | null;
    packDir: string | null;
    categories: number;
    sounds: number;
}
/** Debounce exigido pela especificação CESP. */
export declare const DEFAULT_DEBOUNCE_MS = 500;
/** Expande `~` e `~/...` para o home do usuário. */
export declare function expandHome(input: string): string;
export declare class CespPlayer {
    private readonly packsDir;
    private readonly activePack;
    private readonly mute;
    private readonly enabledCategories;
    private readonly sink;
    private readonly logger;
    private readonly now;
    private readonly random;
    private readonly debounceMs;
    private readonly lastPlayedAt;
    private readonly lastSoundFile;
    private manifest;
    private ready;
    private disabledReason;
    constructor(options: CespPlayerOptions);
    get status(): CespPlayerStatus;
    /**
     * Tenta tocar uma categoria CESP. Nunca lança: qualquer falha inesperada é
     * logada e vira `false`.
     *
     * @returns `true` somente se um som foi efetivamente entregue ao sink.
     */
    play(category: string): boolean;
    private loadPack;
    private parseSound;
    /**
     * Valida formato/tamanho/magic bytes do arquivo (CESP 1.0, Seções 4.1–4.4).
     * Retorna o tamanho em bytes quando o arquivo é aceitável.
     */
    private validateAudioFile;
    private resolveCategory;
    private pickSound;
    private disable;
}
//# sourceMappingURL=cesp-player.d.ts.map