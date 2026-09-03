export const MAX_STREAM_CONTINUATIONS = 3
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192
export const MAX_MODE_OUTPUT_TOKENS = 32768

export function outputTokenBudget(contextWindow: number, maxMode = false): number {
  const safeWindow = Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 256000
  const requested = maxMode ? MAX_MODE_OUTPUT_TOKENS : DEFAULT_MAX_OUTPUT_TOKENS
  return Math.max(256, Math.min(requested, Math.floor(safeWindow * 0.25)))
}

export const STREAM_CONTINUE_PROMPT = [
  '上一段回答因输出长度限制或传输中断而未完成。',
  '请从中断位置继续，只输出尚未完成的内容，不要重复已输出部分，也不要解释中断原因。'
].join('')

export class IncompleteStreamError extends Error {
  constructor(message = '模型流式响应提前中断') {
    super(message)
    this.name = 'IncompleteStreamError'
  }
}

const RETRYABLE_FINISH_REASONS = new Set(['length', 'network_error'])
const BLOCKED_FINISH_REASONS = new Set(['content_filter', 'sensitive'])

export function isLikelyIncompleteContent(content: string): boolean {
  const text = content.trimEnd()
  if (!text) return true

  const fenceCount = text.match(/```/g)?.length ?? 0
  if (fenceCount % 2 !== 0) return true

  return /[，、,:：;；/\\—–-]$/.test(text)
}

export function streamNeedsContinuation(
  finishReason: string | undefined,
  content: string,
  hasToolCalls = false
): boolean {
  const reason = finishReason?.trim().toLowerCase() ?? ''
  if (RETRYABLE_FINISH_REASONS.has(reason)) return true
  if (BLOCKED_FINISH_REASONS.has(reason) || reason === 'tool_calls') return false
  if (reason && reason !== 'stop') return true
  return !hasToolCalls && isLikelyIncompleteContent(content)
}

export function streamTerminationError(finishReason: string | undefined): string | undefined {
  const reason = finishReason?.trim().toLowerCase() ?? ''
  if (reason === 'sensitive' || reason === 'content_filter') {
    return '模型服务因内容安全策略提前终止了回复，请调整问题后重试'
  }
  return undefined
}

export function continuationMessages(
  messages: Array<Record<string, unknown>>,
  partialContent: string
): Array<Record<string, unknown>> {
  if (!partialContent) return messages
  return [
    ...messages,
    { role: 'assistant', content: partialContent },
    { role: 'user', content: STREAM_CONTINUE_PROMPT }
  ]
}

export interface TokenUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

export function mergeTokenUsage(current: TokenUsage | undefined, next: TokenUsage | undefined): TokenUsage | undefined {
  if (!current) return next
  if (!next) return current
  const sum = (left: number | undefined, right: number | undefined): number | undefined => {
    if (left === undefined && right === undefined) return undefined
    return (left ?? 0) + (right ?? 0)
  }
  return {
    promptTokens: sum(current.promptTokens, next.promptTokens),
    completionTokens: sum(current.completionTokens, next.completionTokens),
    totalTokens: sum(current.totalTokens, next.totalTokens)
  }
}
