import { describe, expect, it } from 'vitest'
import type { AgentSession } from '../src/shared/agent-types'
import { searchAgentSessions } from '../src/renderer/src/lib/session-search'

function session(id: string, task: string, updatedAt: number, text = '', connector = false): AgentSession {
  return {
    id,
    task,
    workdir: 'C:\\workspace',
    modelId: 'model',
    createdAt: updatedAt,
    updatedAt,
    steps: text ? [{ kind: 'text', text }] : [],
    history: [],
    source: connector ? { type: 'connector', connectorId: 'wechat', externalThreadId: id } : { type: 'desktop' }
  }
}

describe('session-search', () => {
  const sessions = [
    session('recent', '普通任务', 300, '讨论发布流程'),
    session('title', '浏览器性能优化', 100, '较早内容'),
    session('content', '连接器会话', 200, '已经完成浏览器登录状态检查', true)
  ]

  it('shows recent sessions when the query is empty', () => {
    expect(searchAgentSessions(sessions, '').map(result => result.session.id)).toEqual(['recent', 'content', 'title'])
  })

  it('keeps pinned sessions first in the recent-task view', () => {
    const pinned = { ...sessions[2], pinnedAt: 500 }
    expect(searchAgentSessions([sessions[0], sessions[1], pinned], '').map(result => result.session.id)).toEqual(['content', 'recent', 'title'])
  })

  it('searches both titles and message content and ranks a title match first', () => {
    const results = searchAgentSessions(sessions, '浏览器')
    expect(results.map(result => result.session.id)).toEqual(['title', 'content'])
    expect(results[1].snippet).toContain('浏览器登录状态')
  })

  it('supports multiple whitespace-separated terms and limits results', () => {
    expect(searchAgentSessions(sessions, '浏览器 登录')).toHaveLength(1)
    expect(searchAgentSessions(sessions, '', 2)).toHaveLength(2)
    expect(searchAgentSessions(sessions, '不存在')).toEqual([])
  })
})
