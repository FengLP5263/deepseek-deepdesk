import type { AgentSession, AgentStep } from '@shared/agent-types'

export interface SessionSearchResult {
  session: AgentSession
  snippet: string
  score: number
}

function searchableStepText(step: AgentStep): string {
  return [step.text, step.message, step.summary, step.result].filter(Boolean).join(' ')
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/gu, '')
}

function findSnippet(session: AgentSession, terms: string[]): string {
  for (let index = session.steps.length - 1; index >= 0; index -= 1) {
    const text = searchableStepText(session.steps[index]).trim()
    const haystack = normalized(text)
    if (text && terms.every(term => haystack.includes(term))) {
      return text.length > 88 ? text.slice(0, 88).trimEnd() + '…' : text
    }
  }
  return session.source?.type === 'connector'
    ? `${session.source.connectorId === 'wechat' ? '微信' : '飞书'}连接器会话`
    : session.workdir || '本地任务'
}

export function searchAgentSessions(sessions: AgentSession[], query: string, limit = 8): SessionSearchResult[] {
  const terms = query.split(/\s+/u).map(normalized).filter(Boolean)
  return sessions
    .map(session => {
      const title = normalized(session.task)
      const stepText = normalized(session.steps.map(searchableStepText).join(' '))
      if (terms.length > 0 && !terms.every(term => title.includes(term) || stepText.includes(term))) return null
      let score = session.updatedAt / 1_000_000_000_000
      const fullQuery = normalized(query)
      if (fullQuery && title === fullQuery) score += 100
      else if (fullQuery && title.startsWith(fullQuery)) score += 60
      else if (fullQuery && title.includes(fullQuery)) score += 40
      score += terms.filter(term => stepText.includes(term)).length * 8
      return { session, snippet: findSnippet(session, terms), score }
    })
    .filter((result): result is SessionSearchResult => result !== null)
    .sort((left, right) => right.score - left.score || right.session.updatedAt - left.session.updatedAt)
    .slice(0, Math.max(1, limit))
}
