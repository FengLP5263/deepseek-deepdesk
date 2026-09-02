import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createAnthropicRequestBody, streamAnthropicMessages } from '../src/shared/llm/anthropic'
import { testProviderConnection } from '../src/main/provider-models'
import type { ProviderConfig } from '../src/shared/types'

let server: Server
let baseUrl = ''
let receivedHeaders: Record<string, string | string[] | undefined> = {}
let receivedBody: Record<string, unknown> = {}

function sse(payload: unknown): string {
  return 'data: ' + JSON.stringify(payload) + '\n\n'
}

beforeAll(async () => {
  server = createServer(async (request, response) => {
    receivedHeaders = request.headers
    if (request.url === '/v1/models') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({
        data: [{ id: 'claude-sonnet-test', display_name: 'Claude Sonnet Test', max_input_tokens: 200000 }]
      }))
      return
    }

    let raw = ''
    for await (const chunk of request) raw += String(chunk)
    receivedBody = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (receivedBody.model === 'claude-cut') {
      response.write(sse({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '未完成' } }))
      response.end()
      return
    }
    if (receivedBody.model === 'claude-text') {
      response.write(sse({ type: 'message_start', message: { model: 'claude-text', usage: { input_tokens: 4, output_tokens: 1 } } }))
      response.write(sse({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '先分析。' } }))
      response.write(sse({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '回答完成。' } }))
      response.write(sse({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }))
      response.write(sse({ type: 'message_stop' }))
      response.end()
      return
    }
    response.write(sse({ type: 'message_start', message: { model: 'claude-tool', usage: { input_tokens: 2, cache_creation_input_tokens: 4, cache_read_input_tokens: 6, output_tokens: 1 } } }))
    response.write(sse({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'write_file', input: {} } }))
    response.write(sse({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"path":"a.txt"' } }))
    response.write(sse({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: ',"content":"hi"}' } }))
    response.write(sse({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } }))
    response.write(sse({ type: 'message_stop' }))
    response.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1'
})

afterAll(() => server.close())

describe('Anthropic Messages adapter', () => {
  it('将系统消息、工具定义和 OpenAI 工具历史转换为 Anthropic 协议', () => {
    const body = createAnthropicRequestBody({
      baseUrl,
      apiKey: 'key',
      model: 'claude-tool',
      messages: [
        { role: 'system', content: '系统规则' },
        { role: 'user', content: '写文件' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'old-call', type: 'function', function: { name: 'read_file', arguments: '{"path":"old.txt"}' } }] },
        { role: 'tool', tool_call_id: 'old-call', content: '旧内容' }
      ],
      tools: [{ type: 'function', function: { name: 'write_file', description: '写入文件', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }]
    })

    expect(body.system).toBe('系统规则')
    expect(body.messages[1]).toEqual({ role: 'assistant', content: [{ type: 'tool_use', id: 'old-call', name: 'read_file', input: { path: 'old.txt' } }] })
    expect(body.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'old-call', content: '旧内容' }] })
    expect(body.tools).toEqual([{ name: 'write_file', description: '写入文件', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }])
    expect(body.cache_control).toEqual({ type: 'ephemeral' })
    expect(body).not.toHaveProperty('temperature')
  })

  it('解析思考、正文、工具参数、用量和终止原因', async () => {
    let reasoning = ''
    let content = ''
    let final: Extract<Awaited<ReturnType<typeof streamAnthropicMessages> extends AsyncGenerator<infer T> ? T : never>, { type: 'final' }> | undefined
    for await (const chunk of streamAnthropicMessages({
      baseUrl,
      apiKey: 'anthropic-key',
      model: 'claude-tool',
      messages: [{ role: 'user', content: 'go' }],
      tools: []
    })) {
      if (chunk.type === 'reasoning') reasoning += chunk.text
      else if (chunk.type === 'content') content += chunk.text
      else final = chunk
    }

    expect(reasoning).toBe('')
    expect(content).toBe('')
    expect(final?.finishReason).toBe('tool_calls')
    expect(final?.toolCalls).toEqual([{ id: 'toolu_1', name: 'write_file', args: { path: 'a.txt', content: 'hi' } }])
    expect(final?.usage).toEqual({ promptTokens: 12, completionTokens: 8, totalTokens: 20 })
    expect(receivedHeaders['x-api-key']).toBe('anthropic-key')
    expect(receivedHeaders['anthropic-version']).toBe('2023-06-01')
    expect(receivedBody).not.toHaveProperty('temperature')
    expect(receivedBody.cache_control).toEqual({ type: 'ephemeral' })
  })

  it('将文本和 thinking 增量交给现有界面并映射正常结束', async () => {
    let reasoning = ''
    let content = ''
    let finishReason = ''
    for await (const chunk of streamAnthropicMessages({
      baseUrl,
      apiKey: 'key',
      model: 'claude-text',
      messages: [{ role: 'user', content: 'hi' }],
      tools: []
    })) {
      if (chunk.type === 'reasoning') reasoning += chunk.text
      else if (chunk.type === 'content') content += chunk.text
      else finishReason = chunk.finishReason ?? ''
    }
    expect(reasoning).toBe('先分析。')
    expect(content).toBe('回答完成。')
    expect(finishReason).toBe('stop')
  })

  it('缺少 message_stop 时视为提前断流', async () => {
    await expect(async () => {
      for await (const _chunk of streamAnthropicMessages({
        baseUrl,
        apiKey: 'key',
        model: 'claude-cut',
        messages: [{ role: 'user', content: 'hi' }],
        tools: []
      })) { /* noop */ }
    }).rejects.toThrow('模型流式响应提前中断')
  })
})

describe('Anthropic provider discovery', () => {
  it('使用 Anthropic 鉴权头并导入模型名称与上下文窗口', async () => {
    const provider: ProviderConfig = {
      id: 'anthropic',
      name: 'Anthropic',
      type: 'anthropic',
      baseUrl,
      apiKey: 'model-key',
      models: [],
      createdAt: 1
    }
    const result = await testProviderConnection(provider)
    expect(result).toEqual({
      ok: true,
      message: '连接成功，发现 1 个模型',
      models: [{ id: 'claude-sonnet-test', name: 'Claude Sonnet Test', contextWindow: 200000 }]
    })
    expect(receivedHeaders['x-api-key']).toBe('model-key')
    expect(receivedHeaders['authorization']).toBeUndefined()
  })
})
