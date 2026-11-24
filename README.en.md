# dsh-cesp-player

**English** · [Português](README.md)

[![CI](https://github.com/brunomendesdecarvalho/dsh-cesp-player/actions/workflows/ci.yml/badge.svg)](https://github.com/brunomendesdecarvalho/dsh-cesp-player/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A [Cordis](https://github.com/deepseek-ai/deepseek-harness) plugin for **DeepSeek Harness** that plays [OpenPeon](https://openpeon.com/) sounds for agent lifecycle events. It implements the **CESP** (Coding Event Sound Pack) behavior: `openpeon.json` manifest, `category_aliases`, 500 ms debounce, random selection without repeating the last sound, and Linux **fire-and-forget** playback through native `child_process`.

## Features

- Maps real Harness events to CESP categories, including `resource.limit` for rate/quota/token limits.
- Loads and validates the active pack once during `apply`.
- Honors `mute`, `volume`, and `enabledCategories`.
- 500 ms debounce per category and no-repeat selection.
- Detects the first available player: `pw-play`, `paplay`, `ffplay`, `mpv`, `play`, `aplay`.
- Never blocks the agent loop and never crashes the Harness on I/O errors.

## Requirements

- DeepSeek Harness with Cordis plugin support (tested with `0.2.2-rc.2`).
- Linux.
- Node.js 20+.
- An OpenPeon pack. PeonPing/Cursor packs or a `~/.openpeon/packs/` directory both work.
- At least one audio player on `PATH`.

## Install

```sh
git clone https://github.com/brunomendesdecarvalho/dsh-cesp-player.git
cd dsh-cesp-player
pnpm install --prod
```

`dist/` is committed; install dev dependencies and rebuild only if you change the code:

```sh
pnpm install
pnpm build
```

Then open **Plugins → Add plugin** in DeepSeek Harness and select the `dsh-cesp-player` directory. Reload the page if the list does not update.

The DSH install links this directory, so the production `node_modules` must exist inside it.

## Configuration

Override the installed row in your profile's `cordis.patch.yml`:

```yaml
- id: cesp-player
  name: '@local/cesp-player'
  config:
    packsDir: '~/.claude/hooks/peon-ping/packs'
    activePack: sc_scv
    volume: 0.5
    mute: false
```

`task.acknowledge` is enabled by default. To silence only that category:

```yaml
    enabledCategories:
      task.acknowledge: false
```

| Option | Default | Description |
|---|---|---|
| `packsDir` | `~/.openpeon/packs/` | Directory containing packs. `~` is expanded. |
| `activePack` | `peon` | Folder name of the active pack. |
| `volume` | `0.5` | Master volume, `0.0`–`1.0`. |
| `mute` | `false` | Silences everything. |
| `enabledCategories` | `{}` | Map `CESP category → boolean`. Missing = enabled. |

Reload the plugin after adding or changing a pack: the manifest is read during `apply`.

### Cursor / PeonPing packs

PeonPing installs packs under:

```text
~/.claude/hooks/peon-ping/packs/
├── peon/
├── peasant/
├── sc_scv/
├── sc_battlecruiser/
└── glados/
```

Each pack contains `openpeon.json` and `sounds/`. Typical configuration:

```yaml
config:
  packsDir: '~/.claude/hooks/peon-ping/packs'
  activePack: sc_scv
```

Available packs: `peon`, `peasant`, `sc_scv`, `sc_battlecruiser`, and `glados`. The `peon` pack uses generic lines in `task.complete` (e.g. “Ready to work?”), which can sound like task start; use `sc_scv` (“Job's finished”) or `glados` (“Good news”) for clearer completion cues. This is pack content, not the plugin's mapping.

## Manifest

CESP 1.0 packs use:

```json
{
  "cesp_version": "1.0",
  "name": "my-pack",
  "display_name": "My Sound Pack",
  "version": "1.0.0",
  "categories": {
    "task.complete": {
      "sounds": [
        { "file": "sounds/complete.wav", "label": "Done" }
      ]
    }
  }
}
```

A legacy array-per-category form is also accepted:

```json
{
  "categories": {
    "task.complete": [{ "file": "sounds/complete.wav", "label": "Done" }]
  }
}
```

Path rules:

- `file` is relative to the manifest and uses `/`.
- Without `/`, the plugin prefixes `sounds/`.
- Absolute paths, `../`, and paths outside the pack root are rejected.
- File names must match `[a-zA-Z0-9._-]+`.

Optional aliases:

```json
{
  "category_aliases": {
    "task.completion": "task.complete"
  }
}
```

## CESP 1.0 compliance

At load, the player validates:

- `cesp_version` 1.x (a different major disables the pack);
- `categories` as an object, each category as `{ "sounds": [...] }` (the legacy array form is also accepted);
- relative paths, no `../`, no backslashes, and inside the pack root;
- `.wav`, `.mp3`, and `.ogg` extensions with matching magic bytes (`RIFF/WAVE`, `ID3`/MP3 frame, `OggS`);
- 1 MB per file and a warning when the total exceeds 50 MB;
- a present `label` (warning when missing).

Core categories supported: `session.start`, `task.acknowledge`, `task.complete`, `task.error`, `input.required`, and `resource.limit`. Extended categories `user.spam`, `session.end`, and `task.progress` are optional in the spec and are not mapped.

## Event mapping

Cordis does not expose `session/start`, `turn/start`, `turn/end`, or `tool/call` as Cordis events. Turn events are durable `session/event` variants; “waiting for input” is represented by the explicit approval/question events.

| Real Harness event | CESP category | Notes |
|---|---|---|
| `agent/created` | `session.start` | Closest equivalent to `session/start`. |
| `session/event` with `turn/start` | `task.acknowledge` | Enabled by default; can be disabled. |
| `session/event` with `turn/end` and `reason.kind === 'completed'` | `task.complete` | Clean completion. |
| `session/event` with `turn/end` and `reason.kind === 'max-tokens'` | `resource.limit` | Token/context limit. |
| `session/event` with `approval/asked` | `input.required` | Durable path; always reaches the plugin. |
| `session/event` with `tool/call` and `name === 'ask_user_question'` | `input.required` | Durable path for user questions. |
| `agent/error` with `RATE_LIMIT`, `QUOTA`, `ACCOUNT_QUOTA`, or `CONTEXT_WINDOW_EXCEEDED` | `resource.limit` | Resource limit, not a generic failure. |
| `agent/error` (other errors) | `task.error` | Step/turn errors. |
| `approval/request` | `input.required` | Waterfall; best-effort when the scope delivers it to the root. |
| `user-questions/request` | `input.required` | Waterfall; same. |

`turn/end` with `aborted`, `blocked`, `interrupted`, or `forked` stays silent. `turn/end` with `error` leaves `task.error`/`resource.limit` to `agent/error`, avoiding a duplicate sound.

**Event scope:** `approval/request` and `user-questions/request` are waterfalls dispatched in the agent scope and may not reach a plugin mounted at the root. The primary `input.required` path is therefore the durable `approval/asked` and `tool/call` events; the waterfalls are a best-effort reinforcement, registered with `{ global: true }` and forwarding `next()`.

## Audio backends

First command found with `which` wins:

1. `pw-play --volume=0.5 <file>` (PipeWire)
2. `paplay --volume=32768 <file>` (PulseAudio)
3. `ffplay -nodisp -autoexit -volume 50 <file>` (FFmpeg)
4. `mpv --no-terminal --volume=50 <file>`
5. `play -v 0.5 <file>` (SoX)
6. `aplay <file>` (ALSA, no volume)

Processes are spawned with `{ detached: true, stdio: 'ignore' }` and `unref()`; `play()` returns immediately. On unload/HMR, `ctx.effect` terminates players still running.

## Tests

```sh
pnpm install
pnpm build
pnpm test
```

The suite covers manifests, aliases, debounce, no-repeat, mute, disabled categories, `sounds/` paths, CESP 1.0, the array legacy form, path traversal, magic bytes, size limits, `resource.limit` mapping, and a real Cordis `Context` integration.

## Troubleshooting

**`ERR_MODULE_NOT_FOUND: @deepseek-ai/schemastery`**

The linked checkout has no `node_modules`:

```sh
cd dsh-cesp-player
pnpm install --prod
```

Then toggle the plugin off/on in **Plugins**.

**No sound**

1. Check `packsDir` and `activePack`.
2. Test the file directly: `pw-play ~/.claude/hooks/peon-ping/packs/peon/sounds/PeonReady1.wav`.
3. Look for `[cesp-player] pacote "..." carregado...` in the logs.
4. Toggle the plugin after adding files.

**A “task start” line plays at the end**

- Check that `task.acknowledge` is not disabled.
- The `peon` pack uses generic lines in `task.complete` (“Ready to work?”). Switch to `sc_scv` or `glados` for explicit completion cues. This is pack content, not the plugin's mapping.

## Limitations

- Linux only.
- The manifest is read at load; changes require a plugin reload.
- Subagent sessions also emit events; the plugin does not filter them.
- Extended categories (`user.spam`, `session.end`, `task.progress`) are not mapped; they are optional in CESP 1.0.
- `aplay` ignores volume.
- With no audio backend on `PATH`, sounds are disabled with a single warning.

## License

MIT. See [LICENSE](LICENSE).
