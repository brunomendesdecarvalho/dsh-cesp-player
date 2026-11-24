/**
 * Reprodução de áudio no Linux — fire-and-forget.
 *
 * Este módulo NÃO usa bibliotecas de áudio: apenas o `child_process` nativo.
 * A detecção do backend (`which`) é assíncrona e cacheada; `play()` retorna
 * imediatamente, sem `await` no processo filho, para nunca segurar o loop do
 * agente. Os processos são destacados (`detached`) e têm stdio ignorado, então
 * também não mantêm o processo do Harness vivo.
 */
import { execFile, spawn } from 'node:child_process';
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
/** Converte 0.0–1.0 para a escala linear textual aceita por pw-play/SoX. */
function unitVolume(volume) {
    return String(Math.round(clamp(volume, 0, 1) * 100) / 100);
}
/**
 * Backends na ordem de preferência exigida pela especificação CESP.
 * O primeiro comando encontrado no PATH vence.
 */
export const AUDIO_BACKENDS = [
    {
        command: 'pw-play', // PipeWire
        buildArgs: (file, volume) => [`--volume=${unitVolume(volume)}`, file],
    },
    {
        command: 'paplay', // PulseAudio; escala 0–65536
        buildArgs: (file, volume) => [`--volume=${Math.round(clamp(volume, 0, 1) * 65536)}`, file],
    },
    {
        command: 'ffplay', // FFmpeg; escala 0–100
        buildArgs: (file, volume) => [
            '-nodisp',
            '-autoexit',
            '-volume',
            String(Math.round(clamp(volume, 0, 1) * 100)),
            file,
        ],
    },
    {
        command: 'mpv',
        buildArgs: (file, volume) => [
            '--no-terminal',
            `--volume=${Math.round(clamp(volume, 0, 1) * 100)}`,
            file,
        ],
    },
    {
        command: 'play', // SoX
        buildArgs: (file, volume) => ['-v', unitVolume(volume), file],
    },
    {
        command: 'aplay', // ALSA; não tem controle de volume
        buildArgs: (file) => [file],
    },
];
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
/**
 * `which <command>` assíncrono. Um erro (não encontrado, timeout, `which`
 * ausente) vira `false`; nunca rejeita, para não derrubar a detecção.
 */
function commandExists(command) {
    return new Promise((resolve) => {
        try {
            execFile('which', [command], { timeout: 2_000, windowsHide: true }, (error) => {
                resolve(error === null);
            });
        }
        catch {
            resolve(false);
        }
    });
}
export class AudioPlayer {
    volume;
    logger;
    backendPromise = null;
    children = new Set();
    disposed = false;
    constructor(options) {
        const volume = Number.isFinite(options.volume) ? options.volume : 0.5;
        this.volume = clamp(volume, 0, 1);
        this.logger = options.logger ?? console;
    }
    /** Resolve (uma única vez) o primeiro backend disponível no PATH. */
    resolveBackend() {
        this.backendPromise ??= this.detectBackend();
        return this.backendPromise;
    }
    async detectBackend() {
        const available = await Promise.all(AUDIO_BACKENDS.map((backend) => commandExists(backend.command)));
        const backend = AUDIO_BACKENDS.find((_, index) => available[index] === true) ?? null;
        if (backend === null) {
            this.logger.warn('[cesp-player] nenhum player de áudio encontrado no PATH ' +
                '(pw-play, paplay, ffplay, mpv, play, aplay); sons ficarão desativados.');
        }
        return backend;
    }
    /**
     * Dispara o som e retorna imediatamente. A escolha do backend e o `spawn`
     * acontecem depois, em uma microtask; nenhum erro é propagado ao chamador.
     */
    play(file) {
        if (this.disposed || this.volume <= 0)
            return;
        void this.resolveBackend()
            .then((backend) => {
            if (backend === null || this.disposed)
                return;
            this.spawnPlayback(backend, file);
        })
            .catch((error) => {
            this.logger.warn(`[cesp-player] falha ao resolver o player de áudio: ${describeError(error)}`);
        });
    }
    spawnPlayback(backend, file) {
        let child;
        try {
            child = spawn(backend.command, backend.buildArgs(file, this.volume), {
                detached: true,
                stdio: 'ignore',
            });
        }
        catch (error) {
            this.logger.warn(`[cesp-player] falha ao executar ${backend.command} para ${file}: ${describeError(error)}`);
            return;
        }
        this.children.add(child);
        child.once('error', (error) => {
            this.children.delete(child);
            this.logger.warn(`[cesp-player] ${backend.command} não conseguiu tocar ${file}: ${describeError(error)}`);
        });
        child.once('exit', () => {
            this.children.delete(child);
        });
        // Deixa o processo filho independente do processo do Harness.
        child.unref();
    }
    /**
     * Encerra players ainda em execução. Chamado pelo `ctx.effect` no unload do
     * plugin; sem isso, um unload/HMR poderia deixar um som curto tocando.
     */
    dispose() {
        this.disposed = true;
        for (const child of this.children) {
            try {
                child.kill();
            }
            catch {
                // O processo já pode ter saído; não há o que fazer.
            }
        }
        this.children.clear();
    }
}
//# sourceMappingURL=audio-player.js.map