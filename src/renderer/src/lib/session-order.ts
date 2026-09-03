import type { AgentSession } from '@shared/agent-types'

export function orderSidebarSessions(sessions: AgentSession[]): AgentSession[] {
  return [...sessions].sort((left, right) => {
    const leftPinned = left.pinnedAt ?? 0
    const rightPinned = right.pinnedAt ?? 0
    if (leftPinned !== rightPinned) {
      if (!leftPinned) return 1
      if (!rightPinned) return -1
      return rightPinned - leftPinned
    }
    return right.updatedAt - left.updatedAt || right.createdAt - left.createdAt || left.id.localeCompare(right.id)
  })
}
