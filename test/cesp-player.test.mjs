import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { AUDIO_BACKENDS } from '../dist/audio-player.js'
import { CespPlayer } from '../dist/cesp-player.js'

const roots = []

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

/** Cria bytes minimamente válidos para os magic bytes exigidos pela CESP. */
function writeValidSound(path, extension = '.ogg') {
  if (extension === '.wav') {
    writeFileSync(
      path,
      Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(16)]),
    )
    return
  }
  if (extension === '.mp3') {
    writeFileSync(path, Buffer.concat([Buffer.from('ID3'), Buffer.alloc(16)]))
    return
  }
  writeFileSync(path, Buffer.concat([Buffer.from('OggS'), Buffer.alloc(16)]))
}

function makePack(manifest, files = ['a.ogg', 'b.ogg', 'c.ogg']) {
  const root = mkdtempSync(join(tmpdir(), 'cesp-player-test-'))
  roots.push(root)
  const packDir = join(root, 'peon')
  mkdirSync(join(packDir, 'sounds'), { recursive: true })
  for (const file of files) {
    writeValidSound(join(packDir, 'sounds', file), file.slice(file.lastIndexOf('.')))
  }
  writeFileSync(join(packDir, 'openpeon.json'), JSON.stringify(manifest))
  return root
}

function defaultManifest() {
  // Formato CESP 1.0 real (como os packs do PeonPing/Cursor): { sounds: [...] }.
  return {
    cesp_version: '1.0',
    name: 'peon',
    display_name: 'Peon',
    version: '1.0.0',
    categories: {
      'task.complete': {
        sounds: [
          { file: 'a.ogg', label: 'A' },
          { file: 'b.ogg', label: 'B' },
        ],
      },
      'session.start': { sounds: [{ file: 'sounds/c.ogg', label: 'C' }] },
      // Referencia um arquivo inexistente de propósito: deve ser descartado.
      'task.error': { sounds: [{ file: 'missing.ogg', label: 'Missing' }] },
    },
    category_aliases: {
      'task.completion': 'task.complete',
    },
  }
}

function makePlayer(root, overrides = {}) {
  const played = []
  const warnings = []
  let clock = 0

  const player = new CespPlayer({
    packsDir: root,
    activePack: 'peon',
    mute: false,
    enabledCategories: {},
    sink: { play: (file) => played.push(file) },
    logger: { warn: (message) => warnings.push(message), info: () => {} },
    now: () => clock,
    random: () => 0,
    ...overrides,
  })

  return {
    player,
    played,
    warnings,
    advance(ms) {
      clock += ms
    },
  }
}

describe('CespPlayer', () => {
  it('carrega o manifesto e prefixa sounds/ quando o file não tem barra', () => {
    const root = makePack(defaultManifest())
    const { player, played } = makePlayer(root)

    assert.equal(player.status.ready, true)
    assert.equal(player.status.categories, 2)
    assert.equal(player.status.sounds, 3)

    assert.equal(player.play('session.start'), true)
    assert.equal(played.length, 1)
    assert.match(played[0], /[\\/]sounds[\\/]c\.ogg$/)
  })

  it('resolve categoria por category_aliases', () => {
    const root = makePack(defaultManifest())
    const { player, played } = makePlayer(root)

    assert.equal(player.play('task.completion'), true)
    assert.equal(played.length, 1)
    assert.match(played[0], /[\\/]sounds[\\/]a\.ogg$/)
  })

  it('aceita a variante legada em que a categoria é um array direto', () => {
    const root = makePack({
      categories: {
        'task.complete': [{ file: 'a.ogg', label: 'A' }],
      },
    })
    const { player, played } = makePlayer(root, { random: () => 0 })

    assert.equal(player.status.ready, true)
    assert.equal(player.play('task.complete'), true)
    assert.match(played[0], /[\\/]sounds[\\/]a\.ogg$/)
  })

  it('não repete o último som da mesma categoria quando há mais de um', () => {
    const root = makePack(defaultManifest())
    const { player, played, advance } = makePlayer(root)

    assert.equal(player.play('task.complete'), true)
    advance(1_000)
    assert.equal(player.play('task.complete'), true)
    advance(1_000)
    assert.equal(player.play('task.complete'), true)

    assert.equal(played.length, 3)
    assert.match(played[0], /[\\/]a\.ogg$/)
    assert.match(played[1], /[\\/]b\.ogg$/)
    assert.match(played[2], /[\\/]a\.ogg$/)
  })

  it('aplica debounce de 500 ms por categoria', () => {
    const root = makePack(defaultManifest())
    const { player, played, advance } = makePlayer(root)

    assert.equal(player.play('task.complete'), true)
    advance(499)
    assert.equal(player.play('task.complete'), false)
    assert.equal(played.length, 1)

    advance(1) // 500 ms exatos: já permite.
    assert.equal(player.play('task.complete'), true)
    assert.equal(played.length, 2)
  })

  it('não compartilha debounce entre categorias diferentes', () => {
    const root = makePack(defaultManifest())
    const { player, played } = makePlayer(root)

    assert.equal(player.play('task.complete'), true)
    assert.equal(player.play('session.start'), true)
    assert.equal(played.length, 2)
  })

  it('respeita enabledCategories pelo nome pedido e pelo canônico', () => {
    const root = makePack(defaultManifest())
    const byAlias = makePlayer(root, {
      enabledCategories: { 'task.completion': false },
    })
    assert.equal(byAlias.player.play('task.completion'), false)
    assert.equal(byAlias.played.length, 0)

    const byCanonical = makePlayer(root, {
      enabledCategories: { 'task.complete': false },
    })
    assert.equal(byCanonical.player.play('task.completion'), false)
    assert.equal(byCanonical.played.length, 0)
  })

  it('respeita mute global', () => {
    const root = makePack(defaultManifest())
    const { player, played } = makePlayer(root, { mute: true })

    assert.equal(player.play('task.complete'), false)
    assert.equal(played.length, 0)
  })

  it('ignora categoria desconhecida silenciosamente', () => {
    const root = makePack(defaultManifest())
    const { player, played, warnings } = makePlayer(root)

    assert.equal(player.play('categoria.inexistente'), false)
    assert.equal(played.length, 0)
    assert.equal(
      warnings.some((warning) => warning.includes('categoria.inexistente')),
      false,
    )
  })

  it('descarta sons ausentes no load e desativa a categoria vazia', () => {
    const root = makePack(defaultManifest())
    const { player, played, warnings } = makePlayer(root)

    assert.equal(
      warnings.some((warning) => warning.includes('arquivo(s) de som não encontrado')),
      true,
    )
    assert.equal(player.play('task.error'), false)
    assert.equal(played.length, 0)
  })

  it('não lança quando o pacote não existe e fica desativado', () => {
    const root = makePack(defaultManifest())
    const { player, warnings } = makePlayer(root, { activePack: 'nao-existe' })

    assert.equal(player.status.ready, false)
    assert.match(player.status.reason ?? '', /openpeon\.json/)
    assert.equal(player.play('task.complete'), false)
    assert.equal(warnings.length, 1)
  })
})

describe('CESP 1.0 compliance', () => {
  function singleSoundManifest(file, extra = {}) {
    return {
      ...defaultManifest(),
      categories: {
        'task.complete': { sounds: [{ file, label: 'Test' }] },
      },
      ...extra,
    }
  }

  it('rejeita path traversal (../) exigido pela Seção 3.1', () => {
    const root = makePack(singleSoundManifest('../outside.ogg'))
    const { player, warnings } = makePlayer(root)

    assert.equal(player.status.ready, false)
    assert.equal(
      warnings.some((warning) => warning.includes('caminho de som inválido')),
      true,
    )
  })

  it('rejeita caminho absoluto', () => {
    const root = makePack(singleSoundManifest('/tmp/outside.ogg'))
    const { player, warnings } = makePlayer(root)

    assert.equal(player.status.ready, false)
    assert.equal(
      warnings.some((warning) => warning.includes('caminho de som inválido')),
      true,
    )
  })

  it('rejeita magic bytes que não correspondem à extensão', () => {
    const root = makePack(singleSoundManifest('bad.ogg'), ['bad.ogg'])
    writeFileSync(join(root, 'peon', 'sounds', 'bad.ogg'), Buffer.from('not an audio file'))

    const { player, warnings } = makePlayer(root)
    assert.equal(player.status.ready, false)
    assert.equal(
      warnings.some((warning) => warning.includes('magic bytes')),
      true,
    )
  })

  it('rejeita áudio acima de 1 MB', () => {
    const root = makePack(singleSoundManifest('big.ogg'), ['big.ogg'])
    writeFileSync(
      join(root, 'peon', 'sounds', 'big.ogg'),
      Buffer.concat([Buffer.from('OggS'), Buffer.alloc(1024 * 1024)]),
    )

    const { player, warnings } = makePlayer(root)
    assert.equal(player.status.ready, false)
    assert.equal(
      warnings.some((warning) => warning.includes('excede o limite de 1 MB')),
      true,
    )
  })

  it('rejeita formato fora de WAV/MP3/OGG', () => {
    const root = makePack(singleSoundManifest('a.flac'), ['a.flac'])
    const { player, warnings } = makePlayer(root)

    assert.equal(player.status.ready, false)
    assert.equal(
      warnings.some((warning) => warning.includes('não é WAV, MP3 nem OGG')),
      true,
    )
  })

  it('aceita WAV e MP3 com headers válidos', () => {
    for (const [file, bytes] of [
      [
        'a.wav',
        Buffer.concat([
          Buffer.from('RIFF'),
          Buffer.alloc(4),
          Buffer.from('WAVE'),
          Buffer.alloc(16),
        ]),
      ],
      ['a.mp3', Buffer.concat([Buffer.from('ID3'), Buffer.alloc(16)])],
    ]) {
      const root = makePack(singleSoundManifest(file), [file])
      writeFileSync(join(root, 'peon', 'sounds', file), bytes)
      const { player, played } = makePlayer(root, { random: () => 0 })
      assert.equal(player.status.ready, true)
      assert.equal(player.play('task.complete'), true)
      assert.equal(played.length, 1)
    }
  })

  it('desativa pack com major de CESP incompatível', () => {
    const root = makePack(singleSoundManifest('a.ogg', { cesp_version: '2.0' }))
    const { player, warnings } = makePlayer(root)

    assert.equal(player.status.ready, false)
    assert.match(player.status.reason ?? '', /CESP 2\.0 incompatível/)
    assert.equal(
      warnings.some((warning) => warning.includes('CESP 2.0 incompatível')),
      true,
    )
  })

  it('aceita pack antigo sem cesp_version, mas avisa', () => {
    const { cesp_version: _ignored, ...legacy } = defaultManifest()
    const root = makePack(legacy)
    const { player, warnings } = makePlayer(root)

    assert.equal(player.status.ready, true)
    assert.equal(
      warnings.some((warning) => warning.includes('sem "cesp_version"')),
      true,
    )
  })

  it('avisa quando o som não tem label, mas ainda carrega', () => {
    const root = makePack({
      ...defaultManifest(),
      categories: { 'task.complete': { sounds: [{ file: 'a.ogg' }] } },
    })
    const { player, warnings } = makePlayer(root)

    assert.equal(player.status.ready, true)
    assert.equal(
      warnings.some((warning) => warning.includes('sem "label"')),
      true,
    )
  })
})

describe('AudioPlayer backends', () => {
  it('mantém a ordem de preferência exigida', () => {
    assert.deepEqual(
      AUDIO_BACKENDS.map((backend) => backend.command),
      ['pw-play', 'paplay', 'ffplay', 'mpv', 'play', 'aplay'],
    )
  })

  it('monta argumentos de volume na escala de cada backend', () => {
    const byCommand = new Map(AUDIO_BACKENDS.map((backend) => [backend.command, backend]))
    const file = '/tmp/sound.ogg'

    assert.deepEqual(byCommand.get('pw-play').buildArgs(file, 0.5), ['--volume=0.5', file])
    assert.deepEqual(byCommand.get('paplay').buildArgs(file, 0.5), ['--volume=32768', file])
    assert.deepEqual(byCommand.get('ffplay').buildArgs(file, 0.5), [
      '-nodisp',
      '-autoexit',
      '-volume',
      '50',
      file,
    ])
    assert.deepEqual(byCommand.get('mpv').buildArgs(file, 0.5), [
      '--no-terminal',
      '--volume=50',
      file,
    ])
    assert.deepEqual(byCommand.get('play').buildArgs(file, 0.5), ['-v', '0.5', file])
    assert.deepEqual(byCommand.get('aplay').buildArgs(file, 0.5), [file])
  })

  it('recorta volume para 0.0–1.0', () => {
    const byCommand = new Map(AUDIO_BACKENDS.map((backend) => [backend.command, backend]))
    assert.deepEqual(byCommand.get('paplay').buildArgs('/x.ogg', 2), ['--volume=65536', '/x.ogg'])
    assert.deepEqual(byCommand.get('ffplay').buildArgs('/x.ogg', -1), [
      '-nodisp',
      '-autoexit',
      '-volume',
      '0',
      '/x.ogg',
    ])
  })
})
