import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { categoryForAgentError, categoryForTurnEnd, isAskUserQuestionTool } from '../dist/event-map.js'

describe('event-map CESP', () => {
  for (const code of [
    'RATE_LIMIT',
    'QUOTA',
    'ACCOUNT_QUOTA',
    'CONTEXT_WINDOW_EXCEEDED',
    'too many requests',
  ]) {
    it(`mapeia "${code}" para resource.limit`, () => {
      assert.equal(categoryForAgentError({ code }), 'resource.limit')
    })
  }

  it('mapeia falha aninhada em error.failure.code', () => {
    assert.equal(categoryForAgentError({ failure: { code: 'QUOTA' } }), 'resource.limit')
  })

  it('mapeia erros comuns para task.error', () => {
    assert.equal(categoryForAgentError({ code: 'AUTH' }), 'task.error')
    assert.equal(categoryForAgentError(new Error('boom')), 'task.error')
    assert.equal(categoryForAgentError(undefined), 'task.error')
  })

  it('turn/end completed -> task.complete', () => {
    assert.equal(categoryForTurnEnd({ kind: 'completed' }), 'task.complete')
  })

  it('turn/end max-tokens -> resource.limit', () => {
    assert.equal(categoryForTurnEnd({ kind: 'max-tokens' }), 'resource.limit')
  })

  it('turn/end aborted/blocked/error ficam sem som local', () => {
    assert.equal(categoryForTurnEnd({ kind: 'aborted' }), null)
    assert.equal(categoryForTurnEnd({ kind: 'blocked' }), null)
    assert.equal(categoryForTurnEnd({ kind: 'error' }), null)
    assert.equal(categoryForTurnEnd(undefined), null)
  })

  it('reconhece o tool/call durável de pergunta ao usuário', () => {
    assert.equal(isAskUserQuestionTool('ask_user_question'), true)
    assert.equal(isAskUserQuestionTool('bash'), false)
    assert.equal(isAskUserQuestionTool(undefined), false)
  })
})
