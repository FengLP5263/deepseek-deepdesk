import { DEFAULT_MAX_OUTPUT_TOKENS, IncompleteStreamError } from './stream'
import { fetchLlmResponse } from './request'
import type { StreamChunk, ToolCallItem, ToolCallRequest } from './toolcall'

type JsonObject = Record<string, unknown>

interface ResponsesRequestBody {
  model: string
  instructions?: string
  input: JsonObject[]
  tools?: JsonObject[]
  max_output_tokens: number
  include: ['reasoning.encrypted_content']
  store: false
  stream: true
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return JSON.stringify(value)
}

function toolsForResponses(tools: JsonObject[]): JsonObject[] {
  return tools.flatMap(tool => {
    const fn = isObject(tool.function) ? tool.function : undefined
    const name = typeof fn?.name === 'string' ? fn.name : ''
    if (!name) return []
    return [{
      type: 'function',
      name,
      ...(fn && typeof fn.description === 'string' ? { description: fn.description } : {}),
      parameters: fn && isObject(fn.parameters) ? fn.parameters : { type: 'object', properties: {} }
    }]
  })
}

function reasoningItem(message: JsonObject): JsonObject | null {
  if (message.type !== 'reasoning' || typeof message.encrypted_content !== 'string') return null
  return {
    type: 'reasoning',
    ...(typeof message.id === 'string' ? { id: message.id } : {}),
    ...(Array.isArray(message.summary) ? { summary: message.summary } : {}),
    encrypted_content: message.encrypted_content
  }
}

export function createResponsesRequestBody(req: ToolCallRequest): ResponsesRequestBody {
  const systems: string[] = []
  const input: JsonObject[] = []
  for (const message of req.messages) {
    if (message.role === 'system') {
      const content = asText(message.content).trim()
      if (content) systems.push(content)
      continue
    }
    const reasoning = reasoningItem(message)
    if (reasoning) {
      input.push(reasoning)
      continue
    }
    if (message.role === 'tool') {
      const callId = typeof message.tool_call_id === 'string' ? message.tool_call_id : ''
      if (callId) input.push({ type: 'function_call_output', call_id: callId, output: asText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      const content = asText(message.content)
      if (content) input.push({ role: 'assistant', content })
      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
      for (const raw of calls) {
        if (!isObject(raw)) continue
        const fn = isObject(raw.function) ? raw.function : undefined
        const callId = typeof raw.id === 'string' ? raw.id : ''
        const name = typeof fn?.name === 'string' ? fn.name : ''
        if (callId && name) input.push({
          type: 'function_call',
          call_id: callId,
          name,
          arguments: typeof fn?.arguments === 'string' ? fn.arguments : '{}'
        })
      }
      continue
    }
    if (message.role === 'user') input.push({ role: 'user', content: asText(message.content) })
  }
  const tools = toolsForResponses(req.tools)
  return {
    model: req.model,
    ...(systems.length > 0 ? { instructions: systems.join('\n\n') } : {}),
    input,
    ...(tools.length > 0 ? { tools } : {}),
    max_output_tokens: req.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    include: ['reasoning.encrypted_content'],
    store: false,
    stream: true
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('请求已取消')
  error.name = 'AbortError'
  throw error
}

function parseArguments(value: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(value || '{}')
    return isObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function terminalReason(response: JsonObject, hasTools: boolean): string | undefined {
  if (response.status === 'completed') return hasTools ? 'tool_calls' : 'stop'
  const details = isObject(response.incomplete_details) ? response.incomplete_details : undefined
  if (details?.reason === 'max_output_tokens') return 'length'
  if (details?.reason === 'content_filter') return 'content_filter'
  return typeof details?.reason === 'string' ? details.reason : response.status === 'incomplete' ? 'network_error' : undefined
}

function savedReasoningItem(value: unknown): JsonObject | null {
  if (!isObject(value) || value.type !== 'reasoning' || typeof value.encrypted_content !== 'string') return null
  return {
    type: 'reasoning',
    ...(typeof value.id === 'string' ? { id: value.id } : {}),
    ...(Array.isArray(value.summary) ? { summary: value.summary } : {}),
    encrypted_content: value.encrypted_content
  }
}

function mergeFunctionCall(
  calls: Map<string, { itemId: string; callId: string; name: string; args: string }>,
  value: unknown,
  fallbackId: string
): void {
  if (!isObject(value) || value.type !== 'function_call') return
  const itemId = typeof value.id === 'string' ? value.id : fallbackId
  const current = calls.get(itemId)
  calls.set(itemId, {
    itemId,
    callId: typeof value.call_id === 'string' ? value.call_id : current?.callId ?? '',
    name: typeof value.name === 'string' ? value.name : current?.name ?? '',
    args: typeof value.arguments === 'string' ? value.arguments : current?.args ?? ''
  })
}

export async function* streamOpenAIResponses(req: ToolCallRequest): AsyncGenerator<StreamChunk> {
  throwIfAborted(req.signal)
  let base = req.baseUrl.trim()
  while (base.endsWith('/')) base = base.slice(0, -1)
  const response = await fetchLlmResponse(base + '/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + req.apiKey },
    body: JSON.stringify(createResponsesRequestBody(req)),
    signal: req.signal
  }, req.signal)
  if (!response.body) throw new Error('响应为空')

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  const calls = new Map<string, { itemId: string; callId: string; name: string; args: string }>()
  const history = new Map<string, JsonObject>()
  let buffer = ''
  let usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined
  let reason: string | undefined
  let completed = false
  const abortReader = (): void => { void reader.cancel().catch(() => undefined) }
  req.signal?.addEventListener('abort', abortReader, { once: true })

  const processEvent = function* (part: string): Generator<StreamChunk> {
    for (const line of part.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      let event: JsonObject
      try {
        const parsed: unknown = JSON.parse(data)
        if (!isObject(parsed)) continue
        event = parsed
      } catch {
        continue
      }
      if (event.type === 'error') throw new Error('OpenAI Responses API: ' + (typeof event.message === 'string' ? event.message : '流式请求失败'))
      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string' && event.delta) {
        yield { type: 'content', text: event.delta }
      } else if ((event.type === 'response.reasoning_summary_text.delta' || event.type === 'response.reasoning_text.delta')
        && typeof event.delta === 'string' && event.delta) {
        yield { type: 'reasoning', text: event.delta }
      } else if (event.type === 'response.output_item.added') {
        mergeFunctionCall(calls, event.item, `item-${event.output_index ?? calls.size}`)
      } else if (event.type === 'response.function_call_arguments.delta') {
        const itemId = typeof event.item_id === 'string' ? event.item_id : ''
        const call = calls.get(itemId)
        if (call && typeof event.delta === 'string') call.args += event.delta
      } else if (event.type === 'response.function_call_arguments.done') {
        const itemId = typeof event.item_id === 'string' ? event.item_id : `item-${event.output_index ?? calls.size}`
        const call = calls.get(itemId) ?? { itemId, callId: '', name: '', args: '' }
        if (typeof event.call_id === 'string') call.callId = event.call_id
        if (typeof event.name === 'string') call.name = event.name
        if (typeof event.arguments === 'string') call.args = event.arguments
        calls.set(itemId, call)
      } else if (event.type === 'response.output_item.done') {
        const item = savedReasoningItem(event.item)
        if (item) history.set(typeof item.id === 'string' ? item.id : `reasoning-${history.size}`, item)
        mergeFunctionCall(calls, event.item, `item-${event.output_index ?? calls.size}`)
      } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
        const result = isObject(event.response) ? event.response : {}
        const rawUsage = isObject(result.usage) ? result.usage : undefined
        if (rawUsage) {
          usage = {
            promptTokens: typeof rawUsage.input_tokens === 'number' ? rawUsage.input_tokens : undefined,
            completionTokens: typeof rawUsage.output_tokens === 'number' ? rawUsage.output_tokens : undefined,
            totalTokens: typeof rawUsage.total_tokens === 'number' ? rawUsage.total_tokens : undefined
          }
        }
        if (Array.isArray(result.output)) {
          for (const output of result.output) {
            const item = savedReasoningItem(output)
            if (item) history.set(typeof item.id === 'string' ? item.id : `reasoning-${history.size}`, item)
            mergeFunctionCall(calls, output, `item-${calls.size}`)
          }
        }
        reason = terminalReason(result, calls.size > 0)
        completed = true
      } else if (event.type === 'response.failed') {
        const result = isObject(event.response) ? event.response : undefined
        const error = isObject(result?.error) ? result.error : undefined
        throw new Error('OpenAI Responses API: ' + (typeof error?.message === 'string' ? error.message : '请求失败'))
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
    if (error instanceof Error && error.message.startsWith('OpenAI Responses API:')) throw error
    throw new IncompleteStreamError(error instanceof Error && error.message ? '模型流式响应提前中断：' + error.message : undefined)
  } finally {
    req.signal?.removeEventListener('abort', abortReader)
    reader.releaseLock()
  }
  throwIfAborted(req.signal)
  if (!completed) throw new IncompleteStreamError()

  const toolCalls: ToolCallItem[] = [...calls.values()].map(call => ({
    id: call.callId || call.itemId,
    name: call.name,
    args: parseArguments(call.args)
  }))
  yield { type: 'final', toolCalls, usage, finishReason: reason, providerHistory: [...history.values()] }
}
