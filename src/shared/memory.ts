import type { MemoryItem, MemoryScope } from './types'

const scopeLabels: Record<MemoryScope, string> = {
  user: '用户',
  project: '项目',
  agent: 'Agent'
}

const kindLabels: Record<MemoryItem['kind'], string> = {
  preference: '偏好',
  fact: '事实',
  procedure: '流程',
  decision: '决策',
  summary: '摘要'
}

function normalize(text: string): string {
  return text.toLowerCase().trim()
}

function tokenize(text: string): string[] {
  const normalized = normalize(text)
  if (!normalized) return []
  const parts = normalized
    .split(/[\s,，。；;、.!?！？/\\|()[\]{}<>:"'`]+/u)
    .map(part => part.trim())
    .filter(Boolean)
  return Array.from(new Set([normalized, ...parts].filter(part => part.length >= 2)))
}

function scoreMemory(memory: MemoryItem, query: string): number {
  const q = normalize(query)
  if (!q) return 1
  const haystack = normalize([
    memory.content,
    memory.scope,
    memory.kind,
    ...memory.tags
  ].join(' '))
  const tokens = tokenize(query)
  let score = 0
  if (haystack.includes(q)) score += 6
  for (const token of tokens) {
    if (memory.content.toLowerCase().includes(token)) score += 3
    if (memory.tags.some(tag => tag.toLowerCase().includes(token))) score += 2
    if (memory.kind.includes(token) || memory.scope.includes(token)) score += 1
  }
  return score
}

export function searchMemories(memories: MemoryItem[], query: string, scopes?: MemoryScope[], limit = 6): MemoryItem[] {
  const scopeSet = scopes && scopes.length > 0 ? new Set(scopes) : null
  return memories
    .filter(memory => memory.enabled)
    .filter(memory => !scopeSet || scopeSet.has(memory.scope))
    .map(memory => ({ memory, score: scoreMemory(memory, query) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.memory.updatedAt - a.memory.updatedAt)
    .slice(0, Math.max(1, limit))
    .map(item => item.memory)
}

export function formatMemoryContext(memories: MemoryItem[]): string {
  const enabled = memories.filter(memory => memory.enabled && memory.content.trim())
  if (enabled.length === 0) return ''
  const lines = enabled.map(memory => {
    const tags = memory.tags.length > 0 ? ` #${memory.tags.join(' #')}` : ''
    return `- [${scopeLabels[memory.scope]}/${kindLabels[memory.kind]}] ${memory.content.trim()}${tags}`
  })
  return [
    '以下是用户允许 DeepDesk 在本地保存并用于本次回答的长期记忆。请把它作为背景信息使用；如果与用户当前明确表达冲突，以当前消息为准。',
    ...lines
  ].join('\n')
}
