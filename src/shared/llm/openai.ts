import { DEFAULT_MAX_OUTPUT_TOKENS, IncompleteStreamError } from './stream'

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
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }
  model?: string
  finishReason?: string
}

export type StreamChunk = StreamContentChunk | StreamReasoningChunk | StreamFinalChunk

export interface StreamRequest {
  baseUrl: string
  apiKey: string
  model: string
  messages: Array<{ role: string; content: string }>
  temperature?: number
  maxTokens?: number
  signal?: AbortSignal
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('请求已取消')
  error.name = 'AbortError'
  throw error
}

export async function* streamOpenAICompatible(req: StreamRequest): AsyncGenerator<StreamChunk> {
  throwIfAborted(req.signal)
  let base = req.baseUrl.trim()
  while (base.endsWith('/')) base = base.slice(0, -1)
  const url = base + '/chat/completions'
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + req.apiKey
    },
    body: JSON.stringify({
      model: req.model,
      messages: req.messages,
      temperature: req.temperature ?? 1,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      stream: true,
      stream_options: { include_usage: true }
    }),
    signal: req.signal
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 600)
    } catch {
      detail = ''
    }
    throwIfAborted(req.signal)
    throw new Error('HTTP ' + res.status + ': ' + (detail || res.statusText))
  }
  if (!res.body) throw new Error('响应为空')
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let usage: StreamFinalChunk['usage']
  let modelName: string | undefined
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
        const lines = part.split(/\r?\n/)
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const data = line.slice(5).trim()
          if (data === '') continue
          if (data === '[DONE]') {
            receivedDoneMarker = true
            continue
          }
          try {
            const json = JSON.parse(data)
            if (json.model && !modelName) modelName = json.model
            const choice = json.choices && json.choices[0]
            if (choice && choice.delta) {
              const d = choice.delta
              if (typeof d.content === 'string' && d.content !== '') {
                yield { type: 'content', text: d.content }
              }
              if (typeof d.reasoning_content === 'string' && d.reasoning_content !== '') {
                yield { type: 'reasoning', text: d.reasoning_content }
              }
            }
            if (choice && typeof choice.finish_reason === 'string') finishReason = choice.finish_reason
            if (json.usage) {
              usage = {
                promptTokens: json.usage.prompt_tokens,
                completionTokens: json.usage.completion_tokens,
                totalTokens: json.usage.total_tokens
              }
            }
          } catch {
            // 不完整的分片，跳过
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
  yield { type: 'final', usage, model: modelName, finishReason }
}
