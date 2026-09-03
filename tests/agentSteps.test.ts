import { describe, expect, it } from 'vitest'
import { completeContextCompaction } from '../src/renderer/src/lib/agent-steps'

describe('agent step transitions', () => {
  it('completes the active context compaction without adding a duplicate notice', () => {
    const startedAt = Date.now()
    const steps = completeContextCompaction([
      { kind: 'task', text: '继续长会话' },
      { kind: 'context', status: 'running', startedAt }
    ], 221500, 150500)

    expect(steps.filter(step => step.kind === 'context')).toHaveLength(1)
    expect(steps.at(-1)).toEqual({
      kind: 'context',
      status: 'ok',
      startedAt,
      beforeTokens: 221500,
      afterTokens: 150500
    })
  })
})
