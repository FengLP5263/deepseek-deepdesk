import type { ProviderConfig } from './types'

export const DEFAULT_CONTEXT_WINDOW = 256000
export const CONTEXT_COMPRESSION_THRESHOLD = 0.86
export const CONTEXT_OUTPUT_RESERVE_TOKENS = 8192

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
  const content = clipped(stringifyValue(message.content), 260)
  const calls: string[] = []
  if (Array.isArray(message.tool_calls)) {
    for (const call of message.tool_calls) {
      if (!call || typeof call !== 'object') continue
      const fn = (call as Record<string, unknown>).function
      if (!fn || typeof fn !== 'object') continue
      const record = fn as Record<string, unknown>
      const name = stringifyValue(record.name) || 'tool'
      const args = clipped(stringifyValue(record.arguments), 160)
      calls.push(args ? `${name}(${args})` : name)
    }
  }
  const suffix = calls.length > 0 ? `；工具调用：${calls.join('；')}` : ''
  return `- ${role}${content ? '：' + content : ''}${suffix}`
}

function buildCompressionSummary(olderMessages: Array<Record<string, unknown>>, originalTokens: number): Record<string, unknown> {
  const head = olderMessages.slice(0, 4)
  const tail = olderMessages.slice(Math.max(4, olderMessages.length - 10))
  const omitted = olderMessages.length - head.length - tail.length
  const lines = [
    '[上下文压缩摘要]',
    `为了避免超过模型上下文窗口，DeepDesk 已压缩较早的 ${olderMessages.length} 条上下文，原始估算约 ${originalTokens} tokens。`,
    '后续回复应把以下内容当作早期对话摘要，不要声称仍持有被压缩内容的完整原文。',
    '',
    ...head.map(messageSummary)
  ]
  if (omitted > 0) lines.push(`- ……中间省略 ${omitted} 条较早上下文……`)
  lines.push(...tail.map(messageSummary))
  return { role: 'system', content: lines.join('\n') }
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
  const summary = buildCompressionSummary(older, older.reduce((sum, message) => sum + messageTokens(message), 0))
  let messages = [...systemMessages, summary, ...cleanedRecent]

  while (messages.length > systemMessages.length + 2 && estimateContextUsage(messages).used > budget) {
    const firstConversationIndex = systemMessages.length + 1
    if (roleOf(messages[firstConversationIndex]) === 'tool') messages.splice(firstConversationIndex, 1)
    else messages.splice(firstConversationIndex, 1)
    messages = [...systemMessages, summary, ...stripLeadingOrphanToolMessages(messages.slice(systemMessages.length + 1))]
  }

  return { messages, before, after: estimateContextUsage(messages), compressed: true }
}
