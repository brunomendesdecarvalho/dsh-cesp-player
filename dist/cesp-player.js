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
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
/** Debounce exigido pela especificação CESP. */
export const DEFAULT_DEBOUNCE_MS = 500;
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
        const categoriesRaw = asRecord(record.categories);
        if (categoriesRaw === null) {
            this.disable(`manifesto ${manifestPath} não tem um objeto "categories" válido`);
            return;
        }
        const categories = new Map();
        const missingSounds = [];
        let soundCount = 0;
        for (const [category, value] of Object.entries(categoriesRaw)) {
            const entries = extractSoundEntries(value);
            if (entries === null) {
                this.logger.warn(`[cesp-player] categoria "${category}" ignorada: esperado { sounds: [...] } ou um array de sons.`);
                continue;
            }
            const sounds = [];
            for (const entry of entries) {
                const sound = this.parseSound(entry, packDir, missingSounds);
                if (sound !== null)
                    sounds.push(sound);
            }
            if (sounds.length > 0) {
                categories.set(category, sounds);
                soundCount += sounds.length;
            }
        }
        if (missingSounds.length > 0) {
            const preview = missingSounds.slice(0, 5).join(', ');
            const suffix = missingSounds.length > 5 ? ` (+${missingSounds.length - 5})` : '';
            this.logger.warn(`[cesp-player] ${missingSounds.length} arquivo(s) de som não encontrado(s): ${preview}${suffix}`);
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
    parseSound(entry, packDir, missingSounds) {
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
        // Regra CESP: caminho relativo ao manifesto; sem "/" ganha prefixo sounds/.
        const relative = file.includes('/') ? file : `sounds/${file}`;
        const absolute = resolve(packDir, relative);
        let exists = false;
        try {
            exists = existsSync(absolute);
        }
        catch (error) {
            this.logger.warn(`[cesp-player] falha ao verificar ${absolute}: ${describeError(error)}`);
            return null;
        }
        if (!exists) {
            missingSounds.push(absolute);
            return null;
        }
        const label = typeof record.label === 'string' ? record.label : undefined;
        return label === undefined ? { file: absolute } : { file: absolute, label };
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