import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import * as plugin from '../dist/index.js'

const roots = []

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function makePack() {
  const root = mkdtempSync(join(tmpdir(), 'cesp-cordis-test-'))
  roots.push(root)
  const pack = join(root, 'peon')
  mkdirSync(join(pack, 'sounds'), { recursive: true })
  writeFileSync(
    join(pack, 'sounds', 'a.ogg'),
    Buffer.concat([Buffer.from('OggS'), Buffer.alloc(16)]),
  )
  writeFileSync(
    join(pack, 'openpeon.json'),
    JSON.stringify({
      cesp_version: '1.0',
      name: 'peon',
      display_name: 'Peon',
      version: '1.0.0',
      categories: {
        'task.complete': { sounds: [{ file: 'a.ogg', label: 'A' }] },
        'task.error': { sounds: [{ file: 'a.ogg', label: 'A' }] },
        'resource.limit': { sounds: [{ file: 'a.ogg', label: 'A' }] },
        'input.required': { sounds: [{ file: 'a.ogg', label: 'A' }] },
        'session.start': { sounds: [{ file: 'a.ogg', label: 'A' }] },
      },
      category_aliases: {},
    }),
  )
  return root
}

describe('plugin apply no Cordis', () => {
  it('valida Config, registra listeners e repassa next() em approval/request', async () => {
    const root = makePack()
    const ctx = new Context()
    // volume 0 evita disparar áudio real durante o teste.
    const fiber = ctx.plugin(plugin, { packsDir: root, volume: 0 })
    await fiber

    // Não deve lançar com nenhum dos eventos mapeados.
    ctx.emit('agent/created', { source: 'startup' })
    ctx.emit('session/event', {}, { type: 'turn/start', data: { turn: 1 } })
    ctx.emit('session/event', {}, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'completed' } },
    })
    ctx.emit('session/event', {}, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'aborted' } },
    })
    ctx.emit('session/event', {}, {
      type: 'turn/end',
      data: { turn: 1, reason: { kind: 'max-tokens' } },
    })
    ctx.emit('agent/error', { error: new Error('boom') })
    ctx.emit('agent/error', { error: { code: 'RATE_LIMIT' } })
    ctx.emit('session/event', {}, { type: 'approval/asked', data: {} })
    ctx.emit('session/event', {}, {
      type: 'tool/call',
      data: { name: 'ask_user_question' },
    })

    let nextCalls = 0
    const outcome = await ctx.waterfall('approval/request', {}, async () => {
      nextCalls += 1
      return 'allowed-once'
    })
    assert.equal(outcome, 'allowed-once')
    assert.equal(nextCalls, 1)

    await fiber.dispose()
  })

  it('não derruba o Cordis quando o pacote não existe', async () => {
    const root = makePack()
    const ctx = new Context()
    const fiber = ctx.plugin(plugin, {
      packsDir: root,
      activePack: 'pacote-inexistente',
      volume: 0,
    })
    await fiber

    ctx.emit('agent/created', { source: 'startup' })
    ctx.emit('agent/error', { error: new Error('boom') })

    await fiber.dispose()
  })
})
