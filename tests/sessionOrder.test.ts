import { describe, expect, it } from 'vitest'
import type { AgentSession } from '../src/shared/agent-types'
import { orderSidebarSessions } from '../src/renderer/src/lib/session-order'

function session(id: string, updatedAt: number, pinnedAt?: number): AgentSession {
  return {
    id,
    task: id,
    workdir: '',
    modelId: 'model',
    createdAt: updatedAt,
    updatedAt,
    pinnedAt,
    steps: [],
    history: []
  }
}

describe('session-order', () => {
  it('places pinned sessions first and orders each group by recency', () => {
    const sessions = [session('older', 100), session('pinned-old', 50, 500), session('recent', 300), session('pinned-new', 20, 600)]
    expect(orderSidebarSessions(sessions).map(item => item.id)).toEqual(['pinned-new', 'pinned-old', 'recent', 'older'])
    expect(sessions.map(item => item.id)).toEqual(['older', 'pinned-old', 'recent', 'pinned-new'])
  })

  it('uses creation time and id as deterministic tie breakers', () => {
    const left = session('b', 100)
    const right = session('a', 100)
    left.createdAt = 20
    right.createdAt = 20
    expect(orderSidebarSessions([left, right]).map(item => item.id)).toEqual(['a', 'b'])
  })
})
