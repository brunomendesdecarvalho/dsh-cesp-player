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
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, extname, isAbsolute, join, resolve, sep } from 'node:path';
/** Debounce exigido pela especificação CESP. */
export const DEFAULT_DEBOUNCE_MS = 500;
/** Limites da CESP 1.0 (Seção 4.2). */
const MAX_AUDIO_BYTES = 1024 * 1024;
const MAX_PACK_BYTES = 50 * 1024 * 1024;
/** Formatos que a CESP 1.0 exige suporte (Seção 4.1). */
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg']);
/** Seção 4.3: nomes de arquivo sem espaços/Unicode. */
const SAFE_FILE_NAME = /^[a-zA-Z0-9._-]+$/;
function describeError(error) {
    return error instanceof Error ? error.message : String(error);
}
/** Expande `~` e `~/...` para o home do usuário. */
export function expandHome(input) {
    const trimmed = input.trim();
    if (trimmed === '~')
        return homedir();
    if (trimmed.startsWith('~/'))
        return join(homedir(), trimmed.slice(2));
    return trimmed;
}
function asRecord(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return null;
    return value;
}
/**
 * Aceita as duas formas encontradas em pacotes reais:
 *   - CESP 1.0: `{ "sounds": [{ file, label }] }`
 *   - variante simples/legada: `[{ file, label }]`
 */
function extractSoundEntries(value) {
    if (Array.isArray(value))
        return value;
    const record = asRecord(value);
    if (record !== null && Array.isArray(record.sounds))
        return record.sounds;
    return null;
}
/**
 * Resolve o caminho do som garantindo a Seção 3.1:
 * relativo ao manifesto, sem `../`, sem caminho absoluto e sem sair do pack.
 */
function resolveSoundPath(packDir, file) {
    if (isAbsolute(file) || file.includes('\\'))
        return null;
    if (file.split('/').includes('..'))
        return null;
    const relative = file.includes('/') ? file : `sounds/${file}`;
    const absolute = resolve(packDir, relative);
    const root = packDir.endsWith(sep) ? packDir : `${packDir}${sep}`;
    if (!absolute.startsWith(root))
        return null;
    return absolute;
}
/** Seção 4.4 / Appendix C: valida os magic bytes do formato declarado. */
function matchesAudioMagic(extension, header) {
    if (extension === '.wav') {
        return (header.length >= 12 &&
            header.toString('ascii', 0, 4) === 'RIFF' &&
            header.toString('ascii', 8, 12) === 'WAVE');
    }
    if (extension === '.ogg') {
        return header.length >= 4 && header.toString('ascii', 0, 4) === 'OggS';
    }
    if (extension === '.mp3') {
        if (header.length >= 3 && header.toString('ascii', 0, 3) === 'ID3')
            return true;
        return (header.length >= 2 &&
            header[0] === 0xff &&
            (header[1] === 0xfb || header[1] === 0xf3 || header[1] === 0xf2));
    }
    return false;
}
export class CespPlayer {
    packsDir;
    activePack;
    mute;
    enabledCategories;
    sink;
    logger;
    now;
    random;
    debounceMs;
    lastPlayedAt = new Map();
    lastSoundFile = new Map();
    manifest = null;
    ready = false;
    disabledReason = null;
    constructor(options) {
        this.packsDir = options.packsDir;
        this.activePack = options.activePack;
        this.mute = options.mute;
        this.enabledCategories = options.enabledCategories;
        this.sink = options.sink;
        this.logger = options.logger ?? console;
        this.now = options.now ?? Date.now;
        this.random = options.random ?? Math.random;
        this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
        // A leitura é síncrona de propósito: é um único arquivo pequeno no load do
        // plugin, e assim os listeners só existem depois de o pacote estar pronto.
        this.loadPack();
    }
    get status() {
        const manifest = this.manifest;
        let sounds = 0;
        if (manifest) {
            for (const list of manifest.categories.values())
                sounds += list.length;
        }
        return {
            ready: this.ready,
            reason: this.disabledReason,
            packDir: manifest?.packDir ?? null,
            categories: manifest?.categories.size ?? 0,
            sounds,
        };
    }
    /**
     * Tenta tocar uma categoria CESP. Nunca lança: qualquer falha inesperada é
     * logada e vira `false`.
     *
     * @returns `true` somente se um som foi efetivamente entregue ao sink.
     */
    play(category) {
        try {
            if (this.mute)
                return false;
            if (!this.ready || this.manifest === null)
                return false;
            if (typeof category !== 'string' || category.length === 0)
                return false;
            const resolved = this.resolveCategory(category);
            if (resolved === null) {
                // Categoria desconhecida: pule silenciosamente, conforme a spec.
                return false;
            }
            // Aceita tanto o nome pedido quanto o canônico após alias.
            if (this.enabledCategories[category] === false ||
                this.enabledCategories[resolved.key] === false) {
                return false;
            }
            const now = this.now();
            const previous = this.lastPlayedAt.get(resolved.key);
            if (previous !== undefined) {
                const elapsed = now - previous;
                // Relógio para trás não deve bloquear para sempre.
                if (elapsed >= 0 && elapsed < this.debounceMs)
                    return false;
            }
            const sound = this.pickSound(resolved.key, resolved.sounds);
            if (sound === undefined)
                return false;
            // Marca antes de tocar: o sink é fire-and-forget e não pode falhar de
            // forma síncrona sem que o debounce/no-repeat continuem coerentes.
            this.lastPlayedAt.set(resolved.key, now);
            this.lastSoundFile.set(resolved.key, sound.file);
            this.sink.play(sound.file);
            return true;
        }
        catch (error) {
            this.logger.warn(`[cesp-player] falha ao tocar a categoria "${category}": ${describeError(error)}`);
            return false;
        }
    }
    loadPack() {
        const activePack = this.activePack.trim();
        if (activePack.length === 0) {
            this.disable('activePack está vazio');
            return;
        }
        const packDir = resolve(expandHome(this.packsDir), activePack);
        const manifestPath = join(packDir, 'openpeon.json');
        let raw;
        try {
            raw = readFileSync(manifestPath, 'utf8');
        }
        catch (error) {
            this.disable(`não foi possível ler ${manifestPath}: ${describeError(error)}`);
            return;
        }
        let data;
        try {
            data = JSON.parse(raw);
        }
        catch (error) {
            this.disable(`JSON inválido em ${manifestPath}: ${describeError(error)}`);
            return;
        }
        const record = asRecord(data);
        if (record === null) {
            this.disable(`manifesto ${manifestPath} não contém um objeto JSON`);
            return;
        }
        // Seção 2.1/9: o pack declara a versão da spec; este player implementa 1.x.
        const cespVersion = typeof record.cesp_version === 'string' ? record.cesp_version.trim() : '';
        if (cespVersion.length === 0) {
            this.logger.warn('[cesp-player] manifesto sem "cesp_version"; assumindo compatibilidade com CESP 1.x.');
        }
        else if (!/^1(?:\.|$)/.test(cespVersion)) {
            this.disable(`CESP ${cespVersion} incompatível; este player implementa CESP 1.x`);
            return;
        }
        for (const field of ['name', 'display_name', 'version']) {
            const value = record[field];
            if (typeof value !== 'string' || value.trim().length === 0) {
                this.logger.warn(`[cesp-player] manifesto sem campo obrigatório "${field}".`);
            }
        }
        const categoriesRaw = asRecord(record.categories);
        if (categoriesRaw === null) {
            this.disable(`manifesto ${manifestPath} não tem um objeto "categories" válido`);
            return;
        }
        const categories = new Map();
        const stats = { missingSounds: [], totalBytes: 0 };
        let soundCount = 0;
        for (const [category, value] of Object.entries(categoriesRaw)) {
            const entries = extractSoundEntries(value);
            if (entries === null) {
                this.logger.warn(`[cesp-player] categoria "${category}" ignorada: esperado { sounds: [...] } ou um array de sons.`);
                continue;
            }
            const sounds = [];
            for (const entry of entries) {
                const sound = this.parseSound(entry, packDir, stats);
                if (sound !== null)
                    sounds.push(sound);
            }
            if (sounds.length > 0) {
                categories.set(category, sounds);
                soundCount += sounds.length;
            }
        }
        if (stats.missingSounds.length > 0) {
            const preview = stats.missingSounds.slice(0, 5).join(', ');
            const suffix = stats.missingSounds.length > 5 ? ` (+${stats.missingSounds.length - 5})` : '';
            this.logger.warn(`[cesp-player] ${stats.missingSounds.length} arquivo(s) de som não encontrado(s): ${preview}${suffix}`);
        }
        if (stats.totalBytes > MAX_PACK_BYTES) {
            this.logger.warn(`[cesp-player] pacote com ${(stats.totalBytes / (1024 * 1024)).toFixed(1)} MB ` +
                `excede o limite de 50 MB da CESP; considere reduzir os arquivos.`);
        }
        if (categories.size === 0) {
            this.disable(`nenhuma categoria com som válido em ${manifestPath}`);
            return;
        }
        const aliases = new Map();
        const aliasesRaw = asRecord(record.category_aliases);
        if (aliasesRaw !== null) {
            for (const [from, to] of Object.entries(aliasesRaw)) {
                if (typeof to === 'string' && to.trim().length > 0) {
                    aliases.set(from, to.trim());
                }
                else {
                    this.logger.warn(`[cesp-player] alias "${from}" ignorado: o destino deve ser uma string não vazia.`);
                }
            }
        }
        this.manifest = { categories, aliases, packDir };
        this.ready = true;
        this.disabledReason = null;
        this.logger.info?.(`[cesp-player] pacote "${activePack}" carregado de ${packDir} ` +
            `(${categories.size} categorias, ${soundCount} sons).`);
    }
    parseSound(entry, packDir, stats) {
        const record = asRecord(entry);
        if (record === null) {
            this.logger.warn('[cesp-player] entrada de som ignorada: esperado um objeto { file, label }.');
            return null;
        }
        const file = typeof record.file === 'string' ? record.file.trim() : '';
        if (file.length === 0) {
            this.logger.warn('[cesp-player] entrada de som ignorada: campo "file" ausente ou vazio.');
            return null;
        }
        const absolute = resolveSoundPath(packDir, file);
        if (absolute === null) {
            this.logger.warn(`[cesp-player] caminho de som inválido "${file}": ` +
                'a CESP exige caminho relativo, com barras normais, sem ".." e dentro do pack.');
            return null;
        }
        let exists = false;
        try {
            exists = existsSync(absolute);
        }
        catch (error) {
            this.logger.warn(`[cesp-player] falha ao verificar ${absolute}: ${describeError(error)}`);
            return null;
        }
        if (!exists) {
            stats.missingSounds.push(absolute);
            return null;
        }
        const size = this.validateAudioFile(absolute);
        if (size === null)
            return null;
        stats.totalBytes += size;
        const label = typeof record.label === 'string' && record.label.trim().length > 0
            ? record.label.trim()
            : undefined;
        if (label === undefined) {
            this.logger.warn(`[cesp-player] som "${file}" sem "label"; a CESP 1.0 exige label para acessibilidade.`);
        }
        return label === undefined ? { file: absolute } : { file: absolute, label };
    }
    /**
     * Valida formato/tamanho/magic bytes do arquivo (CESP 1.0, Seções 4.1–4.4).
     * Retorna o tamanho em bytes quando o arquivo é aceitável.
     */
    validateAudioFile(file) {
        const name = basename(file);
        if (!SAFE_FILE_NAME.test(name)) {
            this.logger.warn(`[cesp-player] som "${name}" ignorado: o nome deve casar com [a-zA-Z0-9._-]+.`);
            return null;
        }
        const extension = extname(file).toLowerCase();
        if (!AUDIO_EXTENSIONS.has(extension)) {
            this.logger.warn(`[cesp-player] som "${name}" ignorado: formato "${extension || '(sem extensão)'}" ` +
                'não é WAV, MP3 nem OGG.');
            return null;
        }
        let size;
        try {
            const stat = statSync(file);
            if (!stat.isFile()) {
                this.logger.warn(`[cesp-player] som "${name}" ignorado: não é um arquivo regular.`);
                return null;
            }
            size = stat.size;
        }
        catch (error) {
            this.logger.warn(`[cesp-player] falha ao ler ${file}: ${describeError(error)}`);
            return null;
        }
        if (size > MAX_AUDIO_BYTES) {
            this.logger.warn(`[cesp-player] som "${name}" ignorado: ${(size / (1024 * 1024)).toFixed(1)} MB ` +
                'excede o limite de 1 MB da CESP.');
            return null;
        }
        let header;
        try {
            header = readFileSync(file).subarray(0, 12);
        }
        catch (error) {
            this.logger.warn(`[cesp-player] falha ao validar ${file}: ${describeError(error)}`);
            return null;
        }
        if (!matchesAudioMagic(extension, header)) {
            this.logger.warn(`[cesp-player] som "${name}" ignorado: os magic bytes não correspondem a ${extension}.`);
            return null;
        }
        return size;
    }
    resolveCategory(requested) {
        const manifest = this.manifest;
        if (manifest === null)
            return null;
        const direct = manifest.categories.get(requested);
        if (direct !== undefined && direct.length > 0) {
            return { key: requested, sounds: direct };
        }
        // Aliases podem encadear; um conjunto de visitados evita ciclos.
        let alias = manifest.aliases.get(requested);
        const visited = new Set([requested]);
        while (alias !== undefined && !visited.has(alias)) {
            visited.add(alias);
            const sounds = manifest.categories.get(alias);
            if (sounds !== undefined && sounds.length > 0) {
                return { key: alias, sounds };
            }
            alias = manifest.aliases.get(alias);
        }
        return null;
    }
    pickSound(key, sounds) {
        let pool = sounds;
        // No-repeat: com mais de um som, exclui o último tocado nesta categoria.
        if (sounds.length > 1) {
            const last = this.lastSoundFile.get(key);
            if (last !== undefined) {
                const withoutLast = sounds.filter((sound) => sound.file !== last);
                if (withoutLast.length > 0)
                    pool = withoutLast;
            }
        }
        const value = this.random();
        const normalized = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999) : 0;
        const index = Math.floor(normalized * pool.length);
        return pool[index];
    }
    disable(reason) {
        this.ready = false;
        this.disabledReason = reason;
        this.manifest = null;
        this.logger.warn(`[cesp-player] player desativado: ${reason}`);
    }
}
//# sourceMappingURL=cesp-player.js.map