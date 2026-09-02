import type { MemoryItem, MemoryKind, MemoryScope } from './types'

export interface MemoryCandidate {
  scope: MemoryScope
  kind: MemoryKind
  content: string
  tags: string[]
}

export type MemoryRelationship = 'same' | 'conflict' | 'distinct'

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

function cleanCandidate(text: string): string {
  return text
    .trim()
    .replace(/^[：:，,。；;\s]+/u, '')
    .replace(/[\s。；;]+$/u, '')
    .replace(/\s+/gu, ' ')
    .slice(0, 500)
}

function isSensitive(text: string): boolean {
  return /(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|password|passwd|secret|密码|口令|令牌|身份证|银行卡|信用卡)/iu.test(text)
}

function classifyExplicitMemory(content: string): Omit<MemoryCandidate, 'content'> {
  if (/(?:项目|仓库|代码|提交|合并|发布|版本|测试|架构|组件|文件组织)/u.test(content)) {
    return { scope: 'project', kind: /(?:决定|约定|统一|必须|规范)/u.test(content) ? 'decision' : 'procedure', tags: ['显式记忆', '项目'] }
  }
  if (/(?:喜欢|偏好|习惯|不喜欢|希望你|回答时|称呼我|默认|以后|今后|每次|始终)/u.test(content)) {
    return { scope: 'user', kind: 'preference', tags: ['显式记忆', '偏好'] }
  }
  return { scope: 'user', kind: 'fact', tags: ['显式记忆'] }
}

function pushCandidate(candidates: MemoryCandidate[], candidate: MemoryCandidate): void {
  const content = cleanCandidate(candidate.content)
  if (content.length < 2 || isSensitive(content)) return
  const key = normalize(content)
  if (candidates.some(item => normalize(item.content) === key)) return
  candidates.push({ ...candidate, content })
}

/**
 * Extracts only high-confidence durable facts. This intentionally prefers
 * missing a weak hint over storing ordinary one-off instructions as memory.
 */
export function extractMemoryCandidates(text: string): MemoryCandidate[] {
  const input = cleanCandidate(text)
  if (!input || isSensitive(input)) return []
  const candidates: MemoryCandidate[] = []
  const explicitPatterns = [
    /(?:请|麻烦你)?(?:帮我)?(?:记住|记一下|记得|记录一下|保存到记忆)[：:，,\s]*(.+)$/iu,
    /(?:please\s+)?remember(?:\s+that)?[：:,\s]+(.+)$/iu
  ]
  for (const pattern of explicitPatterns) {
    const match = input.match(pattern)
    if (!match?.[1]) continue
    const classified = classifyExplicitMemory(match[1])
    pushCandidate(candidates, { ...classified, content: match[1] })
    return candidates
  }

  const sentences = input.split(/[。！？!?\n]+/u).map(cleanCandidate).filter(Boolean)
  for (const sentence of sentences) {
    if (/(?:我(?:一直|通常|更)?(?:喜欢|偏好|习惯|不喜欢)|我的偏好是|我希望你以后|以后请|今后请|每次请|请始终|默认请)/u.test(sentence)) {
      pushCandidate(candidates, { scope: 'user', kind: 'preference', content: sentence, tags: ['自动提取', '偏好'] })
      continue
    }
    if (/(?:我叫|我的名字是|请称呼我为|我的职业是|我在.+工作)/u.test(sentence)) {
      pushCandidate(candidates, { scope: 'user', kind: 'fact', content: sentence, tags: ['自动提取', '个人信息'] })
      continue
    }
    if (/(?:我们|本项目|这个项目).*(?:决定|约定|统一|一律|必须)|(?:以后|今后).*(?:提交|合并|发布|版本|测试|代码).*(?:要|必须|统一)/u.test(sentence)) {
      pushCandidate(candidates, { scope: 'project', kind: 'decision', content: sentence, tags: ['自动提取', '项目约定'] })
    }
  }
  return candidates.slice(0, 3)
}

export function normalizeMemoryContent(text: string): string {
  return normalize(cleanCandidate(text)).replace(/[，,。；;！？!?\s]+/gu, '')
}

const oppositeValues = [
  ['中文', '英文'],
  ['简洁', '详细'],
  ['深色', '浅色'],
  ['开启', '关闭'],
  ['自动', '手动']
] as const

function memoryCore(text: string): string {
  return normalizeMemoryContent(text)
    .replace(/^(?:用户|我|我们|本项目|这个项目)/u, '')
    .replace(/(?:以后|今后|一直|通常|默认|请|希望|要求|偏好|回答时|回复时)/gu, '')
    .replace(/(?:不喜欢|喜欢|不要|避免|禁止|需要|必须|使用)/gu, '')
}

function bigrams(text: string): Set<string> {
  if (text.length < 2) return new Set(text ? [text] : [])
  return new Set(Array.from({ length: text.length - 1 }, (_, index) => text.slice(index, index + 2)))
}

function similarity(left: string, right: string): number {
  if (!left || !right) return 0
  if (left === right) return 1
  const a = bigrams(left)
  const b = bigrams(right)
  let overlap = 0
  for (const token of a) if (b.has(token)) overlap += 1
  return (2 * overlap) / (a.size + b.size)
}

function hasOppositeMeaning(left: string, right: string): boolean {
  const negative = (text: string): boolean => /(?:不喜欢|不要|避免|禁止|无需|不需要|关闭)/u.test(text)
  if (negative(left) !== negative(right) && similarity(memoryCore(left), memoryCore(right)) >= 0.68) return true
  return oppositeValues.some(([a, b]) => {
    if (!((left.includes(a) && right.includes(b)) || (left.includes(b) && right.includes(a)))) return false
    const stripValues = (text: string): string => memoryCore(text).replaceAll(a, '').replaceAll(b, '')
    const leftCore = stripValues(left)
    const rightCore = stripValues(right)
    return leftCore === rightCore || similarity(leftCore, rightCore) >= 0.6
  })
}

export function relateMemory(memory: Pick<MemoryItem, 'scope' | 'kind' | 'content'>, candidate: MemoryCandidate): MemoryRelationship {
  if (memory.scope !== candidate.scope || memory.kind !== candidate.kind) return 'distinct'
  if (normalizeMemoryContent(memory.content) === normalizeMemoryContent(candidate.content)) return 'same'
  if (hasOppositeMeaning(memory.content, candidate.content)) return 'conflict'
  return similarity(memoryCore(memory.content), memoryCore(candidate.content)) >= 0.72 ? 'same' : 'distinct'
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
  let score = memory.scope === 'user' && (memory.kind === 'preference' || memory.kind === 'fact') ? 1 : 0
  if (haystack.includes(q)) score += 6
  for (const token of tokens) {
    if (memory.content.toLowerCase().includes(token)) score += 3
    if (memory.tags.some(tag => tag.toLowerCase().includes(token))) score += 2
    if (memory.kind.includes(token) || memory.scope.includes(token)) score += 1
  }
  const semanticScore = similarity(memoryCore(memory.content), memoryCore(query))
  if (semanticScore >= 0.18) score += semanticScore * 4
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
