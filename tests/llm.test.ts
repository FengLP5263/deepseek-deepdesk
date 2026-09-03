import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { streamOpenAICompatible } from '../src/shared/llm/openai'
import { streamChatCompletionWithTools } from '../src/shared/llm/toolcall'
import { DEFAULT_MAX_OUTPUT_TOKENS, MAX_MODE_OUTPUT_TOKENS, isLikelyIncompleteContent, outputTokenBudget, streamNeedsContinuation, streamTerminationError } from '../src/shared/llm/stream'

let server: Server
let base = ''
let lastOpenAIRequestBody: Record<string, unknown> = {}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let rawBody = ''
    for await (const chunk of req) rawBody += String(chunk)
    if (rawBody) lastOpenAIRequestBody = JSON.parse(rawBody) as Record<string, unknown>
    const auth = req.headers['authorization'] ?? ''
    if (auth !== 'Bearer test-key-123') {
      res.statusCode = 401
      res.end(JSON.stringify({ error: { message: 'bad key' } }))
      return
    }
    if (req.url === '/models') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ data: [{ id: 'mock-chat' }, { id: 'mock-reason' }] }))
      return
    }
    if (req.url === '/cut/chat/completions') {
      res.setHeader('Content-Type', 'text/event-stream')
      res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: '未完成的回复' } }] }) + '\n\n')
      res.end()
      return
    }
    if (req.url === '/chat/completions') {
      res.setHeader('Content-Type', 'text/event-stream')
      const sse = (obj: unknown): string => 'data: ' + JSON.stringify(obj) + '\n\n'
      res.write(sse({ id: 'x1', model: 'mock-chat', choices: [{ index: 0, delta: { role: 'assistant' } }] }))
      res.write(sse({ choices: [{ index: 0, delta: { reasoning_content: '让我想想\n' } }] }))
      res.write(sse({ choices: [{ index: 0, delta: { content: '你好，' } }] }))
      res.write(sse({ choices: [{ index: 0, delta: { content: '世界！' } }] }))
      res.write(sse({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 } }))
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port
})

afterAll(() => { server.close() })

describe('streamOpenAICompatible', () => {
  it('流式解析内容、思考、usage 与模型名', async () => {
    let content = ''
    let reasoning = ''
    let usage: { totalTokens?: number } | null = null
    let model = ''
    let finishReason = ''
    for await (const chunk of streamOpenAICompatible({ baseUrl: base, apiKey: 'test-key-123', model: 'mock-chat', messages: [{ role: 'user', content: 'hi' }] })) {
      if (chunk.type === 'content') content += chunk.text
      if (chunk.type === 'reasoning') reasoning += chunk.text
      if (chunk.type === 'final') { usage = chunk.usage ?? null; model = chunk.model ?? ''; finishReason = chunk.finishReason ?? '' }
    }
    expect(content).toBe('你好，世界！')
    expect(reasoning).toContain('让我想想')
    expect(usage?.totalTokens).toBe(18)
    expect(model).toBe('mock-chat')
    expect(finishReason).toBe('stop')
    expect(lastOpenAIRequestBody.max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
  })

  it('没有 finish_reason 或 DONE 的提前断流不会被当作成功', async () => {
    await expect(async () => {
      for await (const _chunk of streamOpenAICompatible({ baseUrl: base + '/cut', apiKey: 'test-key-123', model: 'mock-chat', messages: [] })) { /* noop */ }
    }).rejects.toThrow('模型流式响应提前中断')
  })

  it('错误凭据抛 401 并携带详情', async () => {
    await expect(async () => {
      for await (const _c of streamOpenAICompatible({ baseUrl: base, apiKey: 'wrong', model: 'm', messages: [] })) { /* noop */ }
    }).rejects.toThrow('401')
  })

  it('AbortSignal 可中断流', async () => {
    const slow = createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream')
      res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: '开始' } }] }) + '\n\n')
      // 保持连接，不再写入，模拟长时间生成
    })
    await new Promise<void>(r => slow.listen(0, '127.0.0.1', r))
    const slowBase = 'http://127.0.0.1:' + (slow.address() as { port: number }).port
    const ac = new AbortController()
    let aborted = false
    try {
      for await (const chunk of streamOpenAICompatible({ baseUrl: slowBase, apiKey: 'x', model: 'm', messages: [], signal: ac.signal })) {
        if (chunk.type === 'content') ac.abort()
      }
    } catch (e) {
      aborted = (e as Error).name === 'AbortError'
    } finally {
      slow.close()
    }
    expect(aborted).toBe(true)
  })
})

describe('stream completion policy', () => {
  it('识别模型误报正常结束后的明显残句', () => {
    expect(isLikelyIncompleteContent('停用账号多为 7/')).toBe(true)
    expect(isLikelyIncompleteContent('第一项、')).toBe(true)
    expect(isLikelyIncompleteContent('```ts\nconst value = 1')).toBe(true)
    expect(isLikelyIncompleteContent('统计已经完成。')).toBe(false)
    expect(streamNeedsContinuation('stop', '停用账号多为 7/')).toBe(true)
    expect(streamNeedsContinuation('stop', '统计已经完成。')).toBe(false)
    expect(streamNeedsContinuation('network_error', '已收到部分内容')).toBe(true)
  })

  it('内容审核终止不会被自动续写掩盖', () => {
    expect(streamTerminationError('sensitive')).toContain('内容安全策略')
    expect(streamNeedsContinuation('sensitive', '部分内容，')).toBe(false)
  })

  it('兼容模型请求默认预留足够的输出预算', () => {
    expect(DEFAULT_MAX_OUTPUT_TOKENS).toBe(8192)
  })

  it('Max 模式扩大输出预算并按上下文窗口安全封顶', () => {
    expect(outputTokenBudget(256000, false)).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
    expect(outputTokenBudget(256000, true)).toBe(MAX_MODE_OUTPUT_TOKENS)
    expect(outputTokenBudget(32000, true)).toBe(8000)
  })
})

describe('streamChatCompletionWithTools', () => {
  let s2: Server
  let base2 = ''
  let lastToolRequestBody: Record<string, unknown> = {}

  beforeAll(async () => {
    const sse = (obj: unknown): string => 'data: ' + JSON.stringify(obj) + '\n\n'
    s2 = createServer(async (req, res) => {
      let rawBody = ''
      for await (const chunk of req) rawBody += String(chunk)
      if (rawBody) lastToolRequestBody = JSON.parse(rawBody) as Record<string, unknown>
      res.setHeader('Content-Type', 'text/event-stream')
      if (req.url === '/tools/chat/completions') {
        res.write(sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'write_file', arguments: '' } }] } }] }))
        res.write(sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"a.txt"' } }] } }] }))
        res.write(sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: ',"content":"hi"}' } }] } }] }))
        res.write(sse({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 12, total_tokens: 17 } }))
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      if (req.url === '/plain/chat/completions') {
        res.write(sse({ choices: [{ index: 0, delta: { reasoning_content: '先分析，' } }] }))
        res.write(sse({ choices: [{ index: 0, delta: { reasoning_content: '再回答。' } }] }))
        res.write(sse({ choices: [{ index: 0, delta: { content: '流式' } }] }))
        res.write(sse({ choices: [{ index: 0, delta: { content: '输出' } }] }))
        res.write(sse({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }))
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }
      if (req.url === '/cut/chat/completions') {
        res.write(sse({ choices: [{ index: 0, delta: { content: '工具流未完成' } }] }))
        res.end()
        return
      }
      res.statusCode = 404
      res.end()
    })
    await new Promise<void>(r => s2.listen(0, '127.0.0.1', r))
    base2 = 'http://127.0.0.1:' + (s2.address() as { port: number }).port
  })

  afterAll(() => { s2.close() })

  it('按 index 累积 tool_calls 增量并解析参数', async () => {
    let content = ''
    let toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = []
    let usage: { totalTokens?: number } | undefined
    let finishReason = ''
    for await (const chunk of streamChatCompletionWithTools({ baseUrl: base2 + '/tools', apiKey: 'k', model: 'm', messages: [], tools: [] })) {
      if (chunk.type === 'content') content += chunk.text
      else if (chunk.type === 'final') { toolCalls = chunk.toolCalls; usage = chunk.usage; finishReason = chunk.finishReason ?? '' }
    }
    expect(content).toBe('')
    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]).toMatchObject({ id: 'call_1', name: 'write_file', args: { path: 'a.txt', content: 'hi' } })
    expect(usage?.totalTokens).toBe(17)
    expect(finishReason).toBe('tool_calls')
    expect(lastToolRequestBody.max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
  })

  it('纯文本流式增量并返回空工具调用', async () => {
    let content = ''
    let reasoning = ''
    let toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = []
    for await (const chunk of streamChatCompletionWithTools({ baseUrl: base2 + '/plain', apiKey: 'k', model: 'm', messages: [], tools: [] })) {
      if (chunk.type === 'content') content += chunk.text
      else if (chunk.type === 'reasoning') reasoning += chunk.text
      else toolCalls = chunk.toolCalls
    }
    expect(content).toBe('流式输出')
    expect(reasoning).toBe('先分析，再回答。')
    expect(toolCalls).toHaveLength(0)
  })

  it('工具流提前断开时抛出可恢复的中断错误', async () => {
    await expect(async () => {
      for await (const _chunk of streamChatCompletionWithTools({ baseUrl: base2 + '/cut', apiKey: 'k', model: 'm', messages: [], tools: [] })) { /* noop */ }
    }).rejects.toThrow('模型流式响应提前中断')
  })
})
