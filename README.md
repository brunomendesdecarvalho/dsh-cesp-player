# dsh-cesp-player

[English](README.en.md) · **Português**

[![CI](https://github.com/brunomendesdecarvalho/dsh-cesp-player/actions/workflows/ci.yml/badge.svg)](https://github.com/brunomendesdecarvalho/dsh-cesp-player/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Plugin [Cordis](https://github.com/deepseek-ai/deepseek-harness) para o **DeepSeek Harness** que toca sons de pacotes [OpenPeon](https://openpeon.com/) a cada evento do agente. Implementa o padrão **CESP** (Coding Event Sound Pack): manifesto `openpeon.json`, `category_aliases`, debounce de 500 ms, seleção aleatória sem repetir o último som e reprodução Linux **fire-and-forget** via `child_process`.

## O que ele faz

- Traduz eventos reais do Harness em categorias CESP, incluindo `resource.limit` para rate limit/quota/limite de tokens.
- Lê o pacote ativo uma vez no `apply` e valida o manifesto.
- Respeita `mute`, `volume` e `enabledCategories`.
- Aplica debounce de 500 ms por categoria e evita repetir o último som.
- Detecta o primeiro player disponível (`pw-play`, `paplay`, `ffplay`, `mpv`, `play`, `aplay`).
- Nunca bloqueia o loop do agente e nunca derruba o Harness por erro de I/O.

## Requisitos

- DeepSeek Harness com suporte a plugins Cordis (testado com `0.2.2-rc.2`).
- Linux.
- Node.js 20+.
- Um pacote OpenPeon. Você pode usar os packs do PeonPing/Cursor ou um diretório `~/.openpeon/packs/`.
- Pelo menos um player de áudio no `PATH`: `pw-play`, `paplay`, `ffplay`, `mpv`, `play` ou `aplay`.

## Instalação

### 1. Clone e instale a dependência de runtime

```sh
git clone https://github.com/brunomendesdecarvalho/dsh-cesp-player.git
cd dsh-cesp-player
pnpm install --prod
```

O `dist/` já vem compilado no repositório. Se for alterar o código:

```sh
pnpm install
pnpm build
```

> A instalação do DSH usa um link para esta pasta. O `node_modules` de produção precisa existir dentro dela; por isso o `pnpm install --prod` é necessário antes de adicionar o plugin.

### 2. Adicione o plugin

No DeepSeek Harness, abra **Plugins → Add plugin** e selecione a pasta `dsh-cesp-player` (ou instale pelo Plugin Manager usando o caminho absoluto). Se a lista não atualizar, recarregue a página.

### 3. Aponte para seus packs

O plugin aceita configuração pelo schema do Cordis. No `cordis.patch.yml` do seu perfil (`~/.dsh/profiles/<perfil>/cordis.patch.yml`), sobrescreva a linha instalada:

```yaml
- id: cesp-player
  name: '@local/cesp-player'
  config:
    packsDir: '~/.claude/hooks/peon-ping/packs'
    activePack: sc_scv
    volume: 0.5
    mute: false
```

Também é possível editar os mesmos valores na tela de configuração do plugin, quando disponível. `task.acknowledge` vem habilitada por padrão; para silenciar só ela:

```yaml
    enabledCategories:
      task.acknowledge: false
```

#### Opções

| Opção | Default | Descrição |
|---|---|---|
| `packsDir` | `~/.openpeon/packs/` | Diretório que contém os pacotes. Aceita `~`. |
| `activePack` | `peon` | Nome da pasta do pacote ativo. |
| `volume` | `0.5` | Volume master de `0.0` a `1.0`. |
| `mute` | `false` | Silencia tudo globalmente. |
| `enabledCategories` | `{}` | Mapa `categoria CESP → boolean`. Ausente = habilitada. |

Depois de adicionar ou trocar um pack, **desligue e ligue o plugin** (ou reinicie o DSH): o manifesto é lido no `apply`.

## Packs do Cursor / PeonPing

O PeonPing instala os packs em:

```text
~/.claude/hooks/peon-ping/packs/
├── peon/
├── peasant/
├── sc_scv/
├── sc_battlecruiser/
└── glados/
```

Cada pack tem `openpeon.json` e `sounds/`. Uma configuração típica:

```yaml
config:
  packsDir: '~/.claude/hooks/peon-ping/packs'
  activePack: sc_scv
```

Packs disponíveis: `peon`, `peasant`, `sc_scv`, `sc_battlecruiser` e `glados`. O pack `peon` usa falas genéricas em `task.complete` (ex.: “Ready to work?”, “Something need doing?”), que podem soar como início de tarefa; para falas de conclusão mais claras, use `sc_scv` (“Job's finished”) ou `glados` (“Good news”). Isso é conteúdo do pack, não mapeamento do plugin.

Se o PeonPing estiver em outro caminho, ajuste `packsDir`. Para pacotes OpenPeon soltos, o default `~/.openpeon/packs/` funciona sem configuração.

## Formato do manifesto

O formato CESP 1.0 usado pelos packs reais é:

```json
{
  "cesp_version": "1.0",
  "name": "my-pack",
  "display_name": "My Sound Pack",
  "version": "1.0.0",
  "categories": {
    "task.complete": {
      "sounds": [
        { "file": "sounds/complete.wav", "label": "Done" },
        { "file": "sounds/finished.mp3", "label": "Finished" }
      ]
    }
  }
}
```

O plugin também aceita a variante legada em que a categoria é um array direto:

```json
{
  "categories": {
    "task.complete": [
      { "file": "sounds/complete.wav", "label": "Done" }
    ]
  }
}
```

Regras de caminho:

- `file` é relativo ao manifesto e usa barras normais (`/`).
- Se `file` não contiver `/`, o plugin prefixa `sounds/`.
- Caminhos absolutos, `../` e caminhos que saem do pack são rejeitados.
- Nomes de arquivo devem casar com `[a-zA-Z0-9._-]+`.

`category_aliases` é opcional:

```json
{
  "category_aliases": {
    "task.completion": "task.complete"
  }
}
```

## Conformidade CESP 1.0

O player valida, no load:

- `cesp_version` 1.x (um major diferente desativa o pack);
- `categories` como objeto e cada categoria como `{ "sounds": [...] }` (a variante legada em array também é aceita);
- caminhos relativos, sem `../`, sem barras invertidas e dentro da raiz do pack;
- extensões `.wav`, `.mp3` e `.ogg`, conferindo os magic bytes (`RIFF/WAVE`, `ID3`/frame MP3, `OggS`);
- limite de 1 MB por arquivo e aviso se o total passar de 50 MB;
- `label` presente (aviso quando ausente).

Categorias core suportadas: `session.start`, `task.acknowledge`, `task.complete`, `task.error`, `input.required` e `resource.limit`. As categorias estendidas `user.spam`, `session.end` e `task.progress` são opcionais na spec e não estão mapeadas.

## Mapeamento de eventos

O catálogo do Cordis não expõe `session/start`, `turn/start`, `turn/end` nem `tool/call` como eventos Cordis. Os eventos de turno são variantes duráveis de `session/event`; “aguardando input” é representado pelos eventos explícitos de aprovação e pergunta.

| Evento real do Harness | Categoria CESP | Observação |
|---|---|---|
| `agent/created` | `session.start` | Equivalente mais próximo de `session/start`. |
| `session/event` com `event.type === 'turn/start'` | `task.acknowledge` | Habilitada por padrão; pode ser desligada em `enabledCategories`. |
| `session/event` com `event.type === 'turn/end'` e `reason.kind === 'completed'` | `task.complete` | Conclusão limpa. |
| `session/event` com `event.type === 'turn/end'` e `reason.kind === 'max-tokens'` | `resource.limit` | Limite de tokens/contexto. |
| `session/event` com `event.type === 'approval/asked'` | `input.required` | Caminho durável; sempre chega ao plugin. |
| `session/event` com `event.type === 'tool/call'` e `name === 'ask_user_question'` | `input.required` | Caminho durável para perguntas ao usuário. |
| `agent/error` com `RATE_LIMIT`, `QUOTA`, `ACCOUNT_QUOTA` ou `CONTEXT_WINDOW_EXCEEDED` | `resource.limit` | Limite de recurso, não falha genérica. |
| `agent/error` (demais erros) | `task.error` | Erros de step/turn. |
| `approval/request` | `input.required` | Waterfall; reforço quando o escopo o entrega à raiz. |
| `user-questions/request` | `input.required` | Waterfall; reforço quando o escopo o entrega à raiz. |

`turn/end` com `aborted`, `blocked`, `interrupted` ou `forked` não toca som. `turn/end` com `error` deixa `agent/error` tocar `task.error`/`resource.limit`, evitando som duplicado.

**Escopo dos eventos:** `approval/request` e `user-questions/request` são waterfalls despachados no escopo do agente e podem não chegar a um plugin montado na raiz. Por isso o caminho principal de `input.required` são os eventos duráveis `approval/asked` e `tool/call`; os waterfalls ficam como reforço, registrados com `{ global: true }` e repassando `next()`.

## Backends de áudio

O primeiro comando encontrado com `which` vence:

1. `pw-play --volume=0.5 <file>` (PipeWire)
2. `paplay --volume=32768 <file>` (PulseAudio)
3. `ffplay -nodisp -autoexit -volume 50 <file>` (FFmpeg)
4. `mpv --no-terminal --volume=50 <file>`
5. `play -v 0.5 <file>` (SoX)
6. `aplay <file>` (ALSA, sem volume)

O processo é criado com `{ detached: true, stdio: 'ignore' }`, recebe `unref()` e o `play()` retorna imediatamente. No unload/HMR, o `ctx.effect` encerra players ainda em execução.

## Testes

```sh
pnpm install
pnpm build
pnpm test
```

A suíte cobre manifesto, aliases, debounce, no-repeat, mute, categorias desabilitadas, paths `sounds/`, formato CESP 1.0, variante em array, path traversal, magic bytes, limites de tamanho, mapeamento de `resource.limit` e a integração com um `Context` real do Cordis. Também há um teste ponta a ponta manual com um pack real do PeonPing e `pw-play`.

## Solução de problemas

**`ERR_MODULE_NOT_FOUND: @deepseek-ai/schemastery`**

A pasta linkada não tem `node_modules`. Rode:

```sh
cd dsh-cesp-player
pnpm install --prod
```

Depois desligue/ligue o plugin em **Plugins**.

**Nenhum som toca**

1. Confira `packsDir` e `activePack`.
2. Teste o arquivo direto: `pw-play ~/.claude/hooks/peon-ping/packs/peon/sounds/PeonReady1.wav`.
3. Confira se o pack aparece no log do plugin (`[cesp-player] pacote "..." carregado...`).
4. Desligue/ligue o plugin depois de adicionar arquivos.

**Som de “iniciar tarefa” aparece no fim**

- Verifique se `task.acknowledge` não está desabilitada.
- O pack `peon` usa falas genéricas em `task.complete` (“Ready to work?”). Troque para `sc_scv` ou `glados` se quiser uma fala de conclusão explícita. Isso é conteúdo do pack, não mapeamento do plugin.

**`aplay` não respeita o volume**

É uma limitação do ALSA; o plugin usa `pw-play`/`paplay` primeiro quando disponíveis.

## Limitações

- Apenas Linux (depende de `which` e dos players acima).
- O manifesto é lido no load; trocar `activePack`/`packsDir` ou adicionar arquivos exige recarregar o plugin.
- Sessões de subagentes também emitem os eventos; o plugin não as filtra.
- Categorias estendidas (`user.spam`, `session.end`, `task.progress`) não estão mapeadas; são opcionais na CESP 1.0.
- Se nenhum backend existir no `PATH`, os sons ficam desativados com um aviso único no console.

## Licença

MIT. Veja [LICENSE](LICENSE).
