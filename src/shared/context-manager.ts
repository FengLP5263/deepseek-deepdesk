import type { ProviderConfig } from './types'

export const DEFAULT_CONTEXT_WINDOW = 256000
export const CONTEXT_COMPRESSION_THRESHOLD = 0.86
export const CONTEXT_OUTPUT_RESERVE_TOKENS = 8192
export const MAX_TOOL_RESULT_CONTEXT_TOKENS = 8000

export type ContextTone = 'system' | 'user' | 'assistant' | 'tool-call' | 'tool-result' | 'input'

export interface ContextUsagePart {
  label: string
  tokens: number
  tone: ContextTone
}

export interface ContextUsage {
  used: number
  parts: ContextUsagePart[]
}

export interface ContextManagementOptions {
  contextWindow?: number
  threshold?: number
  reserveTokens?: number
}

export interface ContextManagementResult {
  messages: Array<Record<string, unknown>>
  before: ContextUsage
  after: ContextUsage
  compressed: boolean
}

export function getModelContextWindow(provider: ProviderConfig | undefined, modelId: string, fallback = DEFAULT_CONTEXT_WINDOW): number {
  const configured = provider?.models.find(model => model.id === modelId)?.contextWindow
  return typeof configured === 'number' && configured > 0 ? configured : fallback
}

export function estimateTextTokens(text: string): number {
  let tokens = 0
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    tokens += (code >= 0x2e80 && code <= 0x9fff) ? 1 : 0.25
  }
  return Math.max(0, Math.round(tokens))
}

function takeTokenPrefix(text: string, budget: number): string {
  if (budget <= 0) return ''
  let used = 0
  let result = ''
  for (const character of text) {
    const code = character.charCodeAt(0)
    const next = code >= 0x2e80 && code <= 0x9fff ? 1 : 0.25
    if (used + next > budget) break
    result += character
    used += next
  }
  return result
}

function takeTokenSuffix(text: string, budget: number): string {
  if (budget <= 0) return ''
  let used = 0
  let result = ''
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const character = text[index]
    const code = character.charCodeAt(0)
    const next = code >= 0x2e80 && code <= 0x9fff ? 1 : 0.25
    if (used + next > budget) break
    result = character + result
    used += next
  }
  return result
}

export function toolResultContextTokenBudget(contextWindow: number): number {
  return Math.max(128, Math.min(MAX_TOOL_RESULT_CONTEXT_TOKENS, Math.floor(contextWindow * 0.06)))
}

export function compactToolResultForContext(content: string, maxTokens = MAX_TOOL_RESULT_CONTEXT_TOKENS): string {
  const originalTokens = estimateTextTokens(content)
  if (originalTokens <= maxTokens) return content

  const marker = `[工具结果已压缩：原始约 ${originalTokens} tokens，仅保留开头、关键状态行和结尾]`
  const usable = Math.max(24, maxTokens - estimateTextTokens(marker) - 16)
  const important = content
    .split(/\r?\n/u)
    .filter(line => /(?:error|warning|failed|failure|exception|exit code|错误|失败|异常|警告|退出码)/iu.test(line))
    .slice(0, 8)
    .join('\n')
  const importantText = takeTokenPrefix(important, Math.floor(usable * 0.16)).trim()
  const remaining = usable - estimateTextTokens(importantText)
  const prefix = takeTokenPrefix(content, Math.floor(remaining * 0.65)).trimEnd()
  const suffix = takeTokenSuffix(content, remaining - estimateTextTokens(prefix)).trimStart()
  const sections = [prefix, marker]
  if (importantText) sections.push('[关键状态行]\n' + importantText)
  sections.push(suffix)
  return sections.join('\n\n')
}

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function roleOf(message: Record<string, unknown>): string {
  return typeof message.role === 'string' ? message.role : ''
}

function toolCallId(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const id = (value as Record<string, unknown>).id
  return typeof id === 'string' ? id.trim() : ''
}

export function repairToolCallHistory(input: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const repaired: Array<Record<string, unknown>> = []
  let index = 0
  while (index < input.length) {
    const message = input[index]
    const role = roleOf(message)
    if (role === 'tool') {
      index += 1
      continue
    }
    if (role !== 'assistant' || !Array.isArray(message.tool_calls)) {
      repaired.push({ ...message })
      index += 1
      continue
    }

    const seenIds = new Set<string>()
    const calls = message.tool_calls.filter(call => {
      const id = toolCallId(call)
      if (!id || seenIds.has(id)) return false
      seenIds.add(id)
      return true
    })
    let nextIndex = index + 1
    const resultsByCallId = new Map<string, Record<string, unknown>>()
    while (nextIndex < input.length && roleOf(input[nextIndex]) === 'tool') {
      const result = input[nextIndex]
      const callId = typeof result.tool_call_id === 'string' ? result.tool_call_id.trim() : ''
      if (seenIds.has(callId) && !resultsByCallId.has(callId)) resultsByCallId.set(callId, result)
      nextIndex += 1
    }

    if (calls.length === 0) {
      const assistant = { ...message }
      delete assistant.tool_calls
      if (stringifyValue(assistant.content).trim()) repaired.push(assistant)
      index = nextIndex
      continue
    }

    repaired.push({ ...message, tool_calls: calls })
    for (const call of calls) {
      const callId = toolCallId(call)
      const result = resultsByCallId.get(callId)
      repaired.push(result
        ? { ...result, role: 'tool', tool_call_id: callId }
        : { role: 'tool', tool_call_id: callId, content: '工具调用结果缺失；DeepDesk 已将其标记为未完成。' })
    }
    index = nextIndex
  }
  return repaired
}

function isCompressionSummary(message: Record<string, unknown>): boolean {
  return roleOf(message) === 'system' && stringifyValue(message.content).trim().startsWith('[上下文压缩摘要]')
}

function toolCallTokens(message: Record<string, unknown>): number {
  if (!Array.isArray(message.tool_calls)) return 0
  let tokens = 0
  for (const call of message.tool_calls) {
    if (!call || typeof call !== 'object') continue
    const fn = (call as Record<string, unknown>).function
    if (!fn || typeof fn !== 'object') continue
    tokens += estimateTextTokens(stringifyValue((fn as Record<string, unknown>).arguments))
  }
  return tokens
}

function messageTokens(message: Record<string, unknown>): number {
  return 4 + estimateTextTokens(stringifyValue(message.content)) + toolCallTokens(message)
}

export function estimateContextUsage(history: Array<Record<string, unknown>>, currentInput = ''): ContextUsage {
  const buckets = {
    system: 0,
    user: 0,
    assistant: 0,
    toolCalls: 0,
    toolResults: 0,
    currentInput: estimateTextTokens(currentInput)
  }
  for (const message of history) {
    const role = roleOf(message)
    const contentTokens = estimateTextTokens(stringifyValue(message.content))
    if (role === 'system') buckets.system += contentTokens
    else if (role === 'user') buckets.user += contentTokens
    else if (role === 'assistant') buckets.assistant += contentTokens
    else if (role === 'tool') buckets.toolResults += contentTokens
    else buckets.system += contentTokens
    buckets.toolCalls += toolCallTokens(message)
  }

  const allParts: ContextUsagePart[] = [
    { label: '系统指令 / 记忆', tokens: buckets.system, tone: 'system' },
    { label: '用户消息', tokens: buckets.user, tone: 'user' },
    { label: 'AI 回复', tokens: buckets.assistant, tone: 'assistant' },
    { label: '工具调用参数', tokens: buckets.toolCalls, tone: 'tool-call' },
    { label: '工具返回结果', tokens: buckets.toolResults, tone: 'tool-result' },
    { label: '当前输入', tokens: buckets.currentInput, tone: 'input' }
  ]
  const parts = allParts.filter(part => part.tokens > 0)
  return {
    used: parts.reduce((sum, part) => sum + part.tokens, 0),
    parts
  }
}

function clipped(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= maxChars ? normalized : normalized.slice(0, maxChars) + '…'
}

function messageSummary(message: Record<string, unknown>): string {
  const role = roleOf(message) || 'unknown'
  const callId = role === 'tool' && typeof message.tool_call_id === 'string' ? `(${message.tool_call_id})` : ''
  const content = clipped(stringifyValue(message.content), 320)
  const calls: string[] = []
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      if (!call || typeof call !== 'object') continue
      const fn = (call as Record<string, unknown>).function
      if (!fn || typeof fn !== 'object') continue
      const record = fn as Record<string, unknown>
      const name = stringifyValue(record.name) || 'tool'
      const args = clipped(stringifyValue(record.arguments), 180)
      calls.push(args ? `${name}(${args})` : name)
    }
  }
  const suffix = calls.length > 0 ? `；工具调用：${calls.join('；')}` : ''
  return `- ${role}${callId}${content ? '：' + content : ''}${suffix}`
}

function summaryPriority(message: Record<string, unknown>, index: number, total: number): number {
  const role = roleOf(message)
  const content = stringifyValue(message.content)
  let score = index / Math.max(1, total)
  if (index < 3 || index >= total - 6) score += 25
  if (role === 'user') score += 40
  if (role === 'tool') score += 20
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) score += 30
  if (/(?:必须|不要|约定|决定|偏好|目标|阻塞|失败|错误|完成|下一步|路径|文件|版本|commit|branch|url|token|id)/iu.test(content)) score += 100
  return score
}

function clipToTokenBudget(text: string, budget: number): string {
  if (estimateTextTokens(text) <= budget) return text
  let used = 0
  let result = ''
  for (const character of text) {
    const code = character.charCodeAt(0)
    const next = code >= 0x2e80 && code <= 0x9fff ? 1 : 0.25
    if (used + next > budget) break
    result += character
    used += next
  }
  return result.trimEnd() + '…'
}

function buildCompressionSummary(olderMessages: Array<Record<string, unknown>>, originalTokens: number, maxTokens: number): Record<string, unknown> {
  const lines = [
    '[上下文压缩摘要]',
    `为了避免超过模型上下文窗口，DeepDesk 已压缩较早的 ${olderMessages.length} 条上下文，原始估算约 ${originalTokens} tokens。`,
    '以下仅保留早期对话中的目标、约束、关键进展和工具结果；不要声称仍持有被压缩内容的完整原文。'
  ]
  let remaining = Math.max(64, maxTokens - estimateTextTokens(lines.join('\n')) - 1)
  const candidates = olderMessages
    .map((message, index) => ({ index, line: messageSummary(message), score: summaryPriority(message, index, olderMessages.length) }))
    .sort((a, b) => b.score - a.score || b.index - a.index)
  const included: Array<{ index: number; line: string }> = []
  for (const candidate of candidates) {
    if (remaining < 24 || included.length >= 18) break
    const line = clipToTokenBudget(candidate.line, remaining)
    const tokens = estimateTextTokens(line) + 1
    if (!line || tokens > remaining) continue
    included.push({ index: candidate.index, line })
    remaining -= tokens
  }
  included.sort((a, b) => a.index - b.index)
  const omitted = olderMessages.length - included.length
  lines.push('', ...included.map(item => item.line))
  const omittedLine = `- ……另有 ${omitted} 条低优先级上下文已省略……`
  if (omitted > 0 && estimateTextTokens(omittedLine) + 1 <= remaining) lines.push(omittedLine)
  const content = lines.join('\n')
  return { role: 'system', content: clipToTokenBudget(content, maxTokens) }
}

function stripLeadingOrphanToolMessages(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  let first = 0
  while (first < messages.length && roleOf(messages[first]) === 'tool') first += 1
  return messages.slice(first)
}

function targetBudget(contextWindow: number, threshold: number, reserveTokens: number): number {
  const safeWindow = Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : DEFAULT_CONTEXT_WINDOW
  return Math.max(1024, Math.floor(safeWindow * threshold) - reserveTokens)
}

export function manageContextMessages(input: Array<Record<string, unknown>>, options: ContextManagementOptions = {}): ContextManagementResult {
  const repairedInput = repairToolCallHistory(input)
  const threshold = options.threshold ?? CONTEXT_COMPRESSION_THRESHOLD
  const reserveTokens = options.reserveTokens ?? CONTEXT_OUTPUT_RESERVE_TOKENS
  const budget = targetBudget(options.contextWindow ?? DEFAULT_CONTEXT_WINDOW, threshold, reserveTokens)
  const before = estimateContextUsage(repairedInput)
  if (before.used <= budget) {
    return { messages: repairedInput, before, after: before, compressed: false }
  }

  const systemMessages = repairedInput.filter(message => roleOf(message) === 'system' && !isCompressionSummary(message)).map(message => ({ ...message }))
  const conversationMessages = repairedInput.filter(message => roleOf(message) !== 'system' || isCompressionSummary(message))
  const systemTokens = systemMessages.reduce((sum, message) => sum + messageTokens(message), 0)
  const summaryAllowance = Math.min(4096, Math.max(512, Math.floor(budget * 0.12)))
  const recentBudget = Math.max(256, budget - systemTokens - summaryAllowance)
  const recent: Array<Record<string, unknown>> = []
  let recentTokens = 0

  for (let index = conversationMessages.length - 1; index >= 0; index -= 1) {
    const message = conversationMessages[index]
    const tokens = messageTokens(message)
    if (recent.length > 0 && recentTokens + tokens > recentBudget) break
    recent.unshift({ ...message })
    recentTokens += tokens
  }

  const cleanedRecent = stripLeadingOrphanToolMessages(recent)
  const olderCount = conversationMessages.length - cleanedRecent.length
  if (olderCount <= 0) {
    const messages = [...systemMessages, ...cleanedRecent]
    return { messages, before, after: estimateContextUsage(messages), compressed: false }
  }

  const older = conversationMessages.slice(0, olderCount)
  const summary = buildCompressionSummary(older, older.reduce((sum, message) => sum + messageTokens(message), 0), summaryAllowance)
  let messages = [...systemMessages, summary, ...cleanedRecent]

  while (messages.length > systemMessages.length + 2 && estimateContextUsage(messages).used > budget) {
    const firstConversationIndex = systemMessages.length + 1
    if (roleOf(messages[firstConversationIndex]) === 'tool') messages.splice(firstConversationIndex, 1)
    else messages.splice(firstConversationIndex, 1)
    messages = [...systemMessages, summary, ...stripLeadingOrphanToolMessages(messages.slice(systemMessages.length + 1))]
  }

  return { messages, before, after: estimateContextUsage(messages), compressed: true }
}
