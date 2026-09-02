import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createResponsesRequestBody, streamOpenAIResponses } from '../src/shared/llm/openai-responses'
import type { StreamFinalChunk } from '../src/shared/llm/toolcall'

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
    let raw = ''
    for await (const chunk of request) raw += String(chunk)
    receivedBody = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    if (receivedBody.model === 'responses-cut') {
      response.write(sse({ type: 'response.output_text.delta', delta: '未完成' }))
      response.end()
      return
    }
    if (receivedBody.model === 'responses-text') {
      response.write(sse({ type: 'response.reasoning_summary_text.delta', delta: '先分析。' }))
      response.write(sse({ type: 'response.output_text.delta', delta: '回答完成。' }))
      response.write(sse({
        type: 'response.completed',
        response: { status: 'completed', usage: { input_tokens: 6, output_tokens: 3, total_tokens: 9 }, output: [] }
      }))
      response.end()
      return
    }
    response.write(sse({
      type: 'response.output_item.added',
      output_index: 0,
      item: { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '' }
    }))
    response.write(sse({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"path":' }))
    response.write(sse({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '"README.md"}' }))
    response.write(sse({
      type: 'response.output_item.done',
      output_index: 1,
      item: { id: 'rs_1', type: 'reasoning', summary: [{ type: 'summary_text', text: '读取项目说明' }], encrypted_content: 'encrypted-reasoning' }
    }))
    response.write(sse({
      type: 'response.completed',
      response: { status: 'completed', usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 }, output: [] }
    }))
    response.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/v1'
})

afterAll(() => server.close())

describe('OpenAI Responses adapter', () => {
  it('将系统消息、工具历史和加密推理项转换为无状态 Responses 请求', () => {
    const body = createResponsesRequestBody({
      baseUrl,
      apiKey: 'key',
      model: 'responses-tool',
      messages: [
        { role: 'system', content: '系统规则' },
        { role: 'user', content: '继续处理' },
        { type: 'reasoning', id: 'rs_old', encrypted_content: 'encrypted-old', summary: [] },
        { role: 'assistant', content: null, tool_calls: [{ id: 'old-call', type: 'function', function: { name: 'read_file', arguments: '{"path":"old.txt"}' } }] },
        { role: 'tool', tool_call_id: 'old-call', content: '旧内容' }
      ],
      tools: [{ type: 'function', function: { name: 'write_file', description: '写入文件', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }]
    })

    expect(body.instructions).toBe('系统规则')
    expect(body.input).toContainEqual({ type: 'reasoning', id: 'rs_old', encrypted_content: 'encrypted-old', summary: [] })
    expect(body.input).toContainEqual({ type: 'function_call', call_id: 'old-call', name: 'read_file', arguments: '{"path":"old.txt"}' })
    expect(body.input).toContainEqual({ type: 'function_call_output', call_id: 'old-call', output: '旧内容' })
    expect(body.tools).toEqual([{ type: 'function', name: 'write_file', description: '写入文件', parameters: { type: 'object', properties: { path: { type: 'string' } } } }])
    expect(body.include).toEqual(['reasoning.encrypted_content'])
    expect(body.store).toBe(false)
    expect(body).not.toHaveProperty('temperature')
  })

  it('解析工具参数、加密推理历史、用量和终止原因', async () => {
    let final: StreamFinalChunk | undefined
    for await (const chunk of streamOpenAIResponses({
      baseUrl,
      apiKey: 'responses-key',
      model: 'responses-tool',
      messages: [{ role: 'user', content: '读取文件' }],
      tools: []
    })) {
      if (chunk.type === 'final') final = chunk
    }

    expect(final?.finishReason).toBe('tool_calls')
    expect(final?.toolCalls).toEqual([{ id: 'call_1', name: 'read_file', args: { path: 'README.md' } }])
    expect(final?.providerHistory).toEqual([{ id: 'rs_1', type: 'reasoning', summary: [{ type: 'summary_text', text: '读取项目说明' }], encrypted_content: 'encrypted-reasoning' }])
    expect(final?.usage).toEqual({ promptTokens: 9, completionTokens: 4, totalTokens: 13 })
    expect(receivedHeaders.authorization).toBe('Bearer responses-key')
    expect(receivedBody.store).toBe(false)
  })

  it('将推理摘要和正文交给现有流式界面', async () => {
    let reasoning = ''
    let content = ''
    let finishReason = ''
    for await (const chunk of streamOpenAIResponses({
      baseUrl,
      apiKey: 'key',
      model: 'responses-text',
      messages: [{ role: 'user', content: '你好' }],
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

  it('缺少终止事件时视为提前断流', async () => {
    await expect(async () => {
      for await (const _chunk of streamOpenAIResponses({
        baseUrl,
        apiKey: 'key',
        model: 'responses-cut',
        messages: [{ role: 'user', content: '你好' }],
        tools: []
      })) { /* noop */ }
    }).rejects.toThrow('模型流式响应提前中断')
  })
})
