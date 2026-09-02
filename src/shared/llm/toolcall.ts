import { DEFAULT_MAX_OUTPUT_TOKENS, IncompleteStreamError } from './stream'
import { fetchLlmResponse } from './request'

export interface ToolCallItem {
  id: string
  name: string
  args: Record<string, unknown>
}

export interface ToolCallResult {
  content: string | null
  toolCalls: ToolCallItem[]
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
}

export interface ToolCallRequest {
  baseUrl: string
  apiKey: string
  model: string
  messages: Array<Record<string, unknown>>
  tools: Array<Record<string, unknown>>
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

export async function chatCompletionWithTools(req: ToolCallRequest): Promise<ToolCallResult> {
  let base = req.baseUrl.trim()
  while (base.endsWith('/')) base = base.slice(0, -1)
  const res = await fetchLlmResponse(base + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + req.apiKey
    },
    body: JSON.stringify({
      model: req.model,
      messages: req.messages,
      tools: req.tools,
      temperature: req.temperature ?? 1,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      stream: false
    }),
    signal: req.signal
  }, req.signal)
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  }
  const msg: { content?: unknown; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } = (json.choices && json.choices[0] && json.choices[0].message) || {}
  const rawCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : []
  const toolCalls: ToolCallItem[] = rawCalls.map(c => {
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(c.function && c.function.arguments ? c.function.arguments : '{}')
    } catch {
      args = {}
    }
    return {
      id: c.id ?? ('call-' + Math.random().toString(36).slice(2)),
      name: (c.function && c.function.name) || '',
      args
    }
  })
  const content = typeof msg.content === 'string' ? msg.content : null
  const usage = json.usage ? { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens, totalTokens: json.usage.total_tokens } : undefined
  return { content, toolCalls, usage }
}

export interface StreamContentChunk {
  type: 'content'
  text: string
}

export interface StreamReasoningChunk {
  type: 'reasoning'
  text: string
}

export interface StreamFinalChunk {
  type: 'final'
  toolCalls: ToolCallItem[]
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  finishReason?: string
}

export type StreamChunk = StreamContentChunk | StreamReasoningChunk | StreamFinalChunk

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('请求已取消')
  error.name = 'AbortError'
  throw error
}

export async function* streamChatCompletionWithTools(req: ToolCallRequest): AsyncGenerator<StreamChunk> {
  throwIfAborted(req.signal)
  let base = req.baseUrl.trim()
  while (base.endsWith('/')) base = base.slice(0, -1)
  const res = await fetchLlmResponse(base + '/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + req.apiKey
    },
    body: JSON.stringify({
      model: req.model,
      messages: req.messages,
      tools: req.tools,
      temperature: req.temperature ?? 1,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      stream: true,
      stream_options: { include_usage: true }
    }),
    signal: req.signal
  }, req.signal)
  if (!res.body) throw new Error('响应为空')
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  const tcMap = new Map<number, { id: string; name: string; args: string }>()
  let usage: StreamFinalChunk['usage']
  let finishReason: string | undefined
  let receivedDoneMarker = false
  const abortReader = (): void => { void reader.cancel().catch(() => undefined) }
  req.signal?.addEventListener('abort', abortReader, { once: true })
  try {
    while (true) {
      throwIfAborted(req.signal)
      const r = await reader.read()
      throwIfAborted(req.signal)
      if (r.done) break
      buffer += decoder.decode(r.value, { stream: true })
      const parts = buffer.split(/\r?\n\r?\n/)
      buffer = parts.pop() ?? ''
      for (const part of parts) {
        for (const line of part.split(/\r?\n/)) {
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '') continue
          if (data === '[DONE]') {
            receivedDoneMarker = true
            continue
          }
          try {
            const json = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string; reasoning_content?: string; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string | null }>
              usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
            }
            const delta = json.choices && json.choices[0] && json.choices[0].delta
            const choice = json.choices && json.choices[0]
            if (delta) {
              if (typeof delta.content === 'string' && delta.content !== '') {
                yield { type: 'content', text: delta.content }
              }
              if (typeof delta.reasoning_content === 'string' && delta.reasoning_content !== '') {
                yield { type: 'reasoning', text: delta.reasoning_content }
              }
              if (Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index ?? 0
                  const entry = tcMap.get(idx) ?? { id: '', name: '', args: '' }
                  if (tc.id) entry.id = tc.id
                  if (tc.function && tc.function.name) entry.name += tc.function.name
                  if (tc.function && tc.function.arguments) entry.args += tc.function.arguments
                  tcMap.set(idx, entry)
                }
              }
            }
            if (choice && typeof choice.finish_reason === 'string') finishReason = choice.finish_reason
            if (json.usage) {
              usage = { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens, totalTokens: json.usage.total_tokens }
            }
          } catch {
            // 跳过不完整分片
          }
        }
      }
    }
  } catch (error) {
    throwIfAborted(req.signal)
    throw new IncompleteStreamError(error instanceof Error && error.message
      ? '模型流式响应提前中断：' + error.message
      : undefined)
  } finally {
    req.signal?.removeEventListener('abort', abortReader)
    reader.releaseLock()
  }
  throwIfAborted(req.signal)
  if (!receivedDoneMarker && !finishReason) throw new IncompleteStreamError()
  const toolCalls: ToolCallItem[] = [...tcMap.values()].map(e => {
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(e.args || '{}')
    } catch {
      args = {}
    }
    return { id: e.id || ('call-' + Math.random().toString(36).slice(2)), name: e.name, args }
  })
  yield { type: 'final', toolCalls, usage, finishReason }
}
