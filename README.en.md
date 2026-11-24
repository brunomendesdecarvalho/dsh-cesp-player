# dsh-cesp-player

**English** · [Português](README.md)

[![CI](https://github.com/brunomendesdecarvalho/dsh-cesp-player/actions/workflows/ci.yml/badge.svg)](https://github.com/brunomendesdecarvalho/dsh-cesp-player/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A [Cordis](https://github.com/deepseek-ai/deepseek-harness) plugin for **DeepSeek Harness** that plays [OpenPeon](https://openpeon.com/) sounds for agent lifecycle events. It implements the **CESP** (Coding Event Sound Pack) behavior: `openpeon.json` manifest, `category_aliases`, 500 ms debounce, random selection without repeating the last sound, and Linux **fire-and-forget** playback through native `child_process`.

## Features

- Maps real Harness events to CESP categories.
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
    activePack: peon
    volume: 0.5
    mute: false
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

Each pack contains `openpeon.json` and `sounds/`. For the `peon` pack:

```yaml
config:
  packsDir: '~/.claude/hooks/peon-ping/packs'
  activePack: peon
```

## Manifest

CESP 1.0 packs use:

```json
{
  "cesp_version": "1.0",
  "name": "peon",
  "categories": {
    "task.complete": {
      "sounds": [
        { "file": "sounds/PeonReady1.wav", "label": "Ready to work?" }
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
- Missing files are dropped at load with a warning.

Optional aliases:

```json
{
  "category_aliases": {
    "task.completion": "task.complete"
  }
}
```

## Event mapping

Cordis does not expose `session/start`, `turn/start`, `turn/end`, or `tool/call` as Cordis events. Turn events are durable `session/event` variants; “waiting for input” is represented by the explicit approval/question events.

| Real Harness event | CESP category | Notes |
|---|---|---|
| `agent/created` | `session.start` | Closest equivalent to `session/start`. |
| `session/event` with `turn/start` | `task.acknowledge` | Optional; disable it if noisy. |
| `session/event` with `turn/end` and `reason.kind === 'completed'` | `task.complete` | Clean completion only. |
| `agent/error` | `task.error` | Step/turn errors. |
| `approval/request` | `input.required` | Waterfall: the listener calls `next()`. |
| `user-questions/request` | `input.required` | Waterfall: same. |

`turn/end` with `aborted`, `blocked`, `max-tokens`, `interrupted`, or `forked` stays silent.

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

The suite covers manifests, aliases, debounce, no-repeat, mute, disabled categories, `sounds/` paths, CESP 1.0, the array legacy form, and a real Cordis `Context` integration.

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
3. Look for `[cesp-player] pacote "peon" carregado...` in the logs.
4. Toggle the plugin after adding files.

## Limitations

- Linux only.
- The manifest is read at load; changes require a plugin reload.
- Subagent sessions also emit events; the plugin does not filter them.
- `aplay` ignores volume.
- With no audio backend on `PATH`, sounds are disabled with a single warning.

## License

MIT. See [LICENSE](LICENSE).
