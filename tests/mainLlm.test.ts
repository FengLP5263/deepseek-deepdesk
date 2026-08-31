import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatChunkPayload, ChatStartRequest, ProviderConfig } from '../src/shared/types'

const mocks = vi.hoisted(() => ({
  responses: [] as Array<{
    content: string
    finishReason: string
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  }>,
  requests: [] as Array<{ messages: Array<{ role: string; content: string }> }>
}))

vi.mock('../src/shared/llm/openai', () => ({
  streamOpenAICompatible: async function* (req: { messages: Array<{ role: string; content: string }> }) {
    mocks.requests.push({ messages: structuredClone(req.messages) })
    const response = mocks.responses.shift()
    if (!response) return
    if (response.content) yield { type: 'content', text: response.content }
    yield { type: 'final', finishReason: response.finishReason, usage: response.usage }
  }
}))

import { startChat } from '../src/main/llm'

const provider: ProviderConfig = {
  id: 'mock',
  name: 'Mock',
  type: 'openai',
  baseUrl: 'https://mock.invalid',
  apiKey: 'test-key',
  models: [{ id: 'mock-model', contextWindow: 256_000 }],
  createdAt: 0
}

const request: ChatStartRequest = {
  runId: 'chat-run',
  conversationId: 'conversation-1',
  providerId: 'mock',
  modelId: 'mock-model',
  temperature: 1,
  messages: [{ role: 'user', content: '请输出完整答案' }]
}

async function waitForTerminalEvent(events: ChatChunkPayload[]): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (events.some(event => event.type === 'done' || event.type === 'error')) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

beforeEach(() => {
  mocks.responses.length = 0
  mocks.requests.length = 0
})

describe('main chat streaming', () => {
  it('输出长度达到上限时自动续写并合并 usage', async () => {
    mocks.responses.push(
      { content: '第一段，', finishReason: 'length', usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 } },
      { content: '第二段。', finishReason: 'stop', usage: { promptTokens: 14, completionTokens: 3, totalTokens: 17 } }
    )
    const events: ChatChunkPayload[] = []
    const win = {
      isDestroyed: () => false,
      webContents: { send: (_channel: string, payload: ChatChunkPayload) => events.push(payload) }
    }

    startChat(win as never, request, provider)
    await waitForTerminalEvent(events)

    expect(events.filter(event => event.type === 'content').map(event => event.text).join('')).toBe('第一段，第二段。')
    expect(events.some(event => event.type === 'error')).toBe(false)
    expect(events.find(event => event.type === 'done')?.usage).toEqual({ promptTokens: 24, completionTokens: 7, totalTokens: 31 })
    expect(mocks.requests).toHaveLength(2)
    expect(mocks.requests[1].messages).toContainEqual({ role: 'assistant', content: '第一段，' })
    expect(mocks.requests[1].messages.at(-1)?.content).toContain('从中断位置继续')
  })

  it('正常结束标记后仍为明显残句时继续请求剩余内容', async () => {
    mocks.responses.push(
      { content: '第一项、', finishReason: 'stop' },
      { content: '第二项。', finishReason: 'stop' }
    )
    const events: ChatChunkPayload[] = []
    const win = {
      isDestroyed: () => false,
      webContents: { send: (_channel: string, payload: ChatChunkPayload) => events.push(payload) }
    }

    startChat(win as never, request, provider)
    await waitForTerminalEvent(events)

    expect(events.filter(event => event.type === 'content').map(event => event.text).join('')).toBe('第一项、第二项。')
    expect(events.some(event => event.type === 'error')).toBe(false)
    expect(mocks.requests).toHaveLength(2)
  })
})
