import { DEFAULT_MAX_OUTPUT_TOKENS, IncompleteStreamError } from './stream'
import { fetchLlmResponse } from './request'
import type { StreamChunk, ToolCallItem, ToolCallRequest } from './toolcall'

type JsonObject = Record<string, unknown>

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | JsonObject[]
}

interface AnthropicRequestBody {
  model: string
  max_tokens: number
  system?: string
  messages: AnthropicMessage[]
  tools?: JsonObject[]
  cache_control: { type: 'ephemeral' }
  stream: true
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return JSON.stringify(value)
}

function parseToolInput(value: unknown): JsonObject {
  if (isObject(value)) return value
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return isObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function convertTools(tools: JsonObject[]): JsonObject[] {
  return tools.flatMap(tool => {
    const fn = isObject(tool.function) ? tool.function : undefined
    const name = typeof fn?.name === 'string' ? fn.name : ''
    if (!name) return []
    return [{
      name,
      ...(fn && typeof fn.description === 'string' ? { description: fn.description } : {}),
      input_schema: fn && isObject(fn.parameters) ? fn.parameters : { type: 'object', properties: {} }
    }]
  })
}

function appendToolResult(messages: AnthropicMessage[], block: JsonObject): void {
  const previous = messages.at(-1)
  if (previous?.role === 'user' && Array.isArray(previous.content)
    && previous.content.every(item => item.type === 'tool_result')) {
    previous.content.push(block)
    return
  }
  messages.push({ role: 'user', content: [block] })
}

export function createAnthropicRequestBody(req: ToolCallRequest): AnthropicRequestBody {
  const systems: string[] = []
  const messages: AnthropicMessage[] = []

  for (const message of req.messages) {
    const role = message.role
    if (role === 'system') {
      const content = textContent(message.content).trim()
      if (content) systems.push(content)
      continue
    }
    if (role === 'tool') {
      const toolUseId = typeof message.tool_call_id === 'string' ? message.tool_call_id : ''
      if (!toolUseId) continue
      appendToolResult(messages, {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: textContent(message.content)
      })
      continue
    }
    if (role === 'assistant') {
      const blocks: JsonObject[] = []
      const content = textContent(message.content)
      if (content) blocks.push({ type: 'text', text: content })
      const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : []
      for (const item of toolCalls) {
        if (!isObject(item)) continue
        const fn = isObject(item.function) ? item.function : undefined
        const name = typeof fn?.name === 'string' ? fn.name : ''
        if (!name) continue
        blocks.push({
          type: 'tool_use',
          id: typeof item.id === 'string' ? item.id : `call-${Math.random().toString(36).slice(2)}`,
          name,
          input: parseToolInput(fn?.arguments)
        })
      }
      if (blocks.length > 0) messages.push({ role: 'assistant', content: blocks })
      continue
    }
    if (role === 'user') messages.push({ role: 'user', content: textContent(message.content) })
  }

  const tools = convertTools(req.tools)
  return {
    model: req.model,
    max_tokens: req.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    ...(systems.length > 0 ? { system: systems.join('\n\n') } : {}),
    messages,
    ...(tools.length > 0 ? { tools } : {}),
    cache_control: { type: 'ephemeral' },
    stream: true
  }
}

function inputTokenCount(usage: JsonObject | undefined): number | undefined {
  if (!usage) return undefined
  const parts = [usage.input_tokens, usage.cache_creation_input_tokens, usage.cache_read_input_tokens]
    .filter((value): value is number => typeof value === 'number')
  return parts.length > 0 ? parts.reduce((sum, value) => sum + value, 0) : undefined
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('请求已取消')
  error.name = 'AbortError'
  throw error
}

function finishReason(reason: unknown): string | undefined {
  if (reason === 'tool_use') return 'tool_calls'
  if (reason === 'end_turn' || reason === 'stop_sequence') return 'stop'
  if (reason === 'max_tokens' || reason === 'pause_turn') return 'length'
  if (reason === 'refusal') return 'content_filter'
  return typeof reason === 'string' ? reason : undefined
}

export async function* streamAnthropicMessages(req: ToolCallRequest): AsyncGenerator<StreamChunk> {
  throwIfAborted(req.signal)
  let base = req.baseUrl.trim()
  while (base.endsWith('/')) base = base.slice(0, -1)
  const response = await fetchLlmResponse(base + '/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': req.apiKey
    },
    body: JSON.stringify(createAnthropicRequestBody(req)),
    signal: req.signal
  }, req.signal)
  if (!response.body) throw new Error('响应为空')

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  const calls = new Map<number, { id: string; name: string; input: JsonObject; json: string }>()
  let buffer = ''
  let promptTokens: number | undefined
  let completionTokens: number | undefined
  let reason: string | undefined
  let completed = false
  const abortReader = (): void => { void reader.cancel().catch(() => undefined) }
  req.signal?.addEventListener('abort', abortReader, { once: true })

  const processEvent = function* (part: string): Generator<StreamChunk> {
    for (const line of part.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data) continue
      let event: JsonObject
      try {
        const parsed: unknown = JSON.parse(data)
        if (!isObject(parsed)) continue
        event = parsed
      } catch {
        continue
      }
      if (event.type === 'error') {
        const error = isObject(event.error) ? event.error : undefined
        throw new Error('Anthropic API: ' + (typeof error?.message === 'string' ? error.message : '流式请求失败'))
      }
      if (event.type === 'message_start') {
        const message = isObject(event.message) ? event.message : undefined
        const usage = isObject(message?.usage) ? message.usage : undefined
        promptTokens = inputTokenCount(usage)
      } else if (event.type === 'content_block_start') {
        const index = typeof event.index === 'number' ? event.index : 0
        const block = isObject(event.content_block) ? event.content_block : undefined
        if (block?.type === 'tool_use') {
          calls.set(index, {
            id: typeof block.id === 'string' ? block.id : '',
            name: typeof block.name === 'string' ? block.name : '',
            input: parseToolInput(block.input),
            json: ''
          })
        }
      } else if (event.type === 'content_block_delta') {
        const index = typeof event.index === 'number' ? event.index : 0
        const delta = isObject(event.delta) ? event.delta : undefined
        if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text) {
          yield { type: 'content', text: delta.text }
        } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking) {
          yield { type: 'reasoning', text: delta.thinking }
        } else if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
          const call = calls.get(index)
          if (call) call.json += delta.partial_json
        }
      } else if (event.type === 'message_delta') {
        const delta = isObject(event.delta) ? event.delta : undefined
        const usage = isObject(event.usage) ? event.usage : undefined
        reason = finishReason(delta?.stop_reason)
        if (typeof usage?.output_tokens === 'number') completionTokens = usage.output_tokens
      } else if (event.type === 'message_stop') {
        completed = true
      }
    }
  }

  try {
    while (true) {
      throwIfAborted(req.signal)
      const chunk = await reader.read()
      throwIfAborted(req.signal)
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      const parts = buffer.split(/\r?\n\r?\n/)
      buffer = parts.pop() ?? ''
      for (const part of parts) yield* processEvent(part)
    }
    buffer += decoder.decode()
    if (buffer.trim()) yield* processEvent(buffer)
  } catch (error) {
    throwIfAborted(req.signal)
    if (error instanceof Error && error.message.startsWith('Anthropic ')) throw error
    throw new IncompleteStreamError(error instanceof Error && error.message
      ? '模型流式响应提前中断：' + error.message
      : undefined)
  } finally {
    req.signal?.removeEventListener('abort', abortReader)
    reader.releaseLock()
  }

  throwIfAborted(req.signal)
  if (!completed) throw new IncompleteStreamError()
  const toolCalls: ToolCallItem[] = [...calls.values()].map(call => ({
    id: call.id || `call-${Math.random().toString(36).slice(2)}`,
    name: call.name,
    args: call.json ? parseToolInput(call.json) : call.input
  }))
  const usage = promptTokens === undefined && completionTokens === undefined
    ? undefined
    : {
        promptTokens,
        completionTokens,
        totalTokens: (promptTokens ?? 0) + (completionTokens ?? 0)
      }
  yield { type: 'final', toolCalls, usage, finishReason: reason }
}
