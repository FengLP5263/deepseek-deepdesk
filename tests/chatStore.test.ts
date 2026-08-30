import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatChunkPayload, ChatStartRequest, Conversation, ProviderConfig, MemoryItem } from '../src/shared/types'
import { useChatStore } from '../src/renderer/src/stores/useChatStore'
import { useSettingsStore } from '../src/renderer/src/stores/useSettingsStore'

function makeProviders(): ProviderConfig[] {
  return [
    { id: 'deepseek', name: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test', isBuiltIn: true, createdAt: 0, models: [{ id: 'deepseek-chat', name: 'V3' }, { id: 'deepseek-reasoner', name: 'R1' }] },
    { id: 'other', name: 'Other', type: 'openai', baseUrl: 'https://x.com', apiKey: '', isBuiltIn: false, createdAt: 0, models: [{ id: 'gpt-4' }] }
  ]
}

let startRequests: ChatStartRequest[] = []
let chunkCb: ((p: ChatChunkPayload) => void) | null = null
let saved: Map<string, Conversation>
let memoryResults: MemoryItem[] = []
let cancelledRunIds: string[] = []

beforeEach(() => {
  startRequests = []
  chunkCb = null
  saved = new Map()
  memoryResults = []
  cancelledRunIds = []
  const api = {
    settings: {
      get: async () => ({ version: 1, defaultProviderId: 'deepseek', defaultModelId: 'deepseek-chat', temperature: 1, theme: 'dark', appFont: 'default', enterToSend: true }),
      set: async (patch: Record<string, unknown>) => ({ ...patch })
    },
    providers: { list: async () => makeProviders(), upsert: async () => {}, remove: async () => {}, test: async () => ({ ok: true, message: '' }) },
    conversations: {
      list: async () => Array.from(saved.values()),
      get: async (id: string) => saved.get(id) ?? null,
      upsert: async (c: Conversation) => { saved.set(c.id, structuredClone(c)) },
      remove: async (id: string) => { saved.delete(id) }
    },
    memories: {
      list: async () => memoryResults,
      upsert: async (memory: MemoryItem) => memory,
      remove: async () => {},
      search: async () => memoryResults
    },
    chat: {
      start: async (req: ChatStartRequest) => { startRequests.push(req); return { ok: true } },
      cancel: async (runId: string) => { cancelledRunIds.push(runId) },
      onChunk: (cb: (p: ChatChunkPayload) => void) => { chunkCb = cb; return () => { chunkCb = null } }
    }
  }
  ;(globalThis as unknown as { window: unknown }).window = { api, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
  useSettingsStore.setState({ loaded: true, providers: makeProviders(), settings: { version: 1, defaultProviderId: 'deepseek', defaultModelId: 'deepseek-chat', temperature: 1, theme: 'dark', appFont: 'default', enterToSend: true } })
  useChatStore.setState({ initialized: false, conversations: [], activeId: null, streaming: null, notice: null, pendingModel: null })
})

async function boot(): Promise<void> {
  await useChatStore.getState().init()
}

describe('useChatStore', () => {
  it('停止生成时立即保留已有内容并忽略后续分片', async () => {
    await boot()
    useChatStore.getState().createConversation('deepseek', 'deepseek-chat')
    await useChatStore.getState().sendMessage('开始生成长回答')
    const req = startRequests[0]
    chunkCb!({ runId: req.runId, conversationId: req.conversationId, type: 'content', text: '已经生成的部分' })

    useChatStore.getState().stopStreaming()

    const stopped = useChatStore.getState()
    const assistant = stopped.conversations[0].messages[1]
    expect(cancelledRunIds).toEqual([req.runId])
    expect(stopped.streaming).toBeNull()
    expect(assistant.streaming).toBe(false)
    expect(assistant.content).toBe('已经生成的部分')

    chunkCb!({ runId: req.runId, conversationId: req.conversationId, type: 'content', text: '迟到内容' })
    expect(useChatStore.getState().conversations[0].messages[1].content).toBe('已经生成的部分')
  })

  it('init 加载会话并设置 activeId 为最近会话', async () => {
    saved.set('c1', { id: 'c1', title: '旧', createdAt: 1, updatedAt: 1, providerId: 'deepseek', modelId: 'deepseek-chat', temperature: 1, messages: [] })
    saved.set('c2', { id: 'c2', title: '新', createdAt: 2, updatedAt: 2, providerId: 'deepseek', modelId: 'deepseek-chat', temperature: 1, messages: [] })
    await boot()
    const s = useChatStore.getState()
    expect(s.activeId).toBe('c2')
    expect(s.conversations[0].id).toBe('c2')
  })

  it('setModel 更新当前会话模型并持久化', async () => {
    await boot()
    useChatStore.getState().createConversation('deepseek', 'deepseek-chat')
    const convId = useChatStore.getState().activeId!
    useChatStore.getState().setModel('deepseek', 'deepseek-reasoner')
    const conv = useChatStore.getState().conversations.find(c => c.id === convId)
    expect(conv?.modelId).toBe('deepseek-reasoner')
    expect(saved.get(convId)?.modelId).toBe('deepseek-reasoner')
  })

  it('setModel 无会话时写入 pendingModel 而不新建会话', async () => {
    await boot()
    useChatStore.getState().setModel('deepseek', 'deepseek-reasoner')
    const s = useChatStore.getState()
    expect(s.pendingModel).toEqual({ providerId: 'deepseek', modelId: 'deepseek-reasoner' })
    expect(s.conversations.length).toBe(0)
  })

  it('无会话发送消息时采用 pendingModel 创建会话', async () => {
    await boot()
    useChatStore.getState().setModel('deepseek', 'deepseek-reasoner')
    await useChatStore.getState().sendMessage('你好')
    expect(startRequests[0].modelId).toBe('deepseek-reasoner')
    const conv = useChatStore.getState().conversations[0]
    expect(conv.modelId).toBe('deepseek-reasoner')
    expect(useChatStore.getState().pendingModel).toBeNull()
  })

  it('未配置 API Key 时不发送并提示', async () => {
    await boot()
    useChatStore.getState().createConversation('other', 'gpt-4')
    await useChatStore.getState().sendMessage('你好')
    expect(startRequests.length).toBe(0)
    expect(useChatStore.getState().notice).toContain('API Key')
  })

  it('sendMessage 走完整流式归并并持久化', async () => {
    await boot()
    useChatStore.getState().createConversation('deepseek', 'deepseek-chat')
    await useChatStore.getState().sendMessage('你好，世界')
    expect(startRequests.length).toBe(1)
    const req = startRequests[0]
    expect(req.modelId).toBe('deepseek-chat')
    expect(req.messages.map(m => m.content)).toEqual(['你好，世界'])
    const cb = chunkCb!
    cb({ runId: req.runId, conversationId: req.conversationId, type: 'content', text: '嗨' })
    cb({ runId: req.runId, conversationId: req.conversationId, type: 'reasoning', text: '思考中' })
    cb({ runId: req.runId, conversationId: req.conversationId, type: 'done', model: 'deepseek-chat' })
    const conv = useChatStore.getState().conversations.find(c => c.id === req.conversationId)!
    const assistant = conv.messages[1]
    expect(assistant.content).toBe('嗨')
    expect(assistant.reasoning).toBe('思考中')
    expect(assistant.streaming).toBe(false)
    expect(assistant.model).toBe('deepseek-chat')
    expect(useChatStore.getState().streaming).toBeNull()
    expect(saved.get(req.conversationId)?.messages[1].content).toBe('嗨')
  })

  it('发送时注入命中的长期记忆但不写入会话消息', async () => {
    memoryResults = [{
      id: 'mem-1',
      scope: 'user',
      kind: 'preference',
      content: '用户偏好：回答先给结论',
      tags: ['沟通'],
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
      source: { type: 'manual' }
    }]
    await boot()
    useChatStore.getState().createConversation('deepseek', 'deepseek-chat')
    await useChatStore.getState().sendMessage('怎么优化 UI')
    const req = startRequests[0]
    expect(req.messages[0]).toEqual(expect.objectContaining({ role: 'system' }))
    expect(req.messages[0].content).toContain('用户偏好：回答先给结论')
    expect(req.messages[1]).toEqual({ role: 'user', content: '怎么优化 UI' })
    expect(useChatStore.getState().conversations[0].messages.map(message => message.role)).toEqual(['user', 'assistant'])
  })

  it('流式错误标记 error 并填充错误文案', async () => {
    await boot()
    useChatStore.getState().createConversation('deepseek', 'deepseek-chat')
    await useChatStore.getState().sendMessage('你好')
    const req = startRequests[0]
    chunkCb!({ runId: req.runId, conversationId: req.conversationId, type: 'error', message: '网络错误' })
    const conv = useChatStore.getState().conversations.find(c => c.id === req.conversationId)!
    const assistant = conv.messages[1]
    expect(assistant.error).toBe(true)
    expect(assistant.content).toBe('请求失败：网络错误')
    expect(useChatStore.getState().streaming).toBeNull()
  })

  it('首条消息自动生成标题', async () => {
    await boot()
    useChatStore.getState().createConversation()
    await useChatStore.getState().sendMessage('帮我写一个冒泡排序')
    expect(useChatStore.getState().conversations[0].title).toBe('帮我写一个冒泡排序')
  })

  it('删除当前会话后 activeId 回退', async () => {
    await boot()
    const a = useChatStore.getState().createConversation()!
    const b = useChatStore.getState().createConversation()!
    useChatStore.getState().selectConversation(a.id)
    await useChatStore.getState().deleteConversation(a.id)
    const s = useChatStore.getState()
    expect(s.conversations.length).toBe(1)
    expect(s.activeId).toBe(b.id)
  })

  it('regenerate 移除旧助手回复并重发', async () => {
    await boot()
    useChatStore.getState().createConversation('deepseek', 'deepseek-chat')
    await useChatStore.getState().sendMessage('你好')
    const req1 = startRequests[0]
    chunkCb!({ runId: req1.runId, conversationId: req1.conversationId, type: 'done' })
    await useChatStore.getState().regenerate()
    expect(startRequests.length).toBe(2)
    expect(startRequests[1].messages.length).toBe(1)
    expect(startRequests[1].messages[0].content).toBe('你好')
  })

  it('updateMessage 保存用户消息且不触发重发', async () => {
    await boot()
    useChatStore.getState().createConversation('deepseek', 'deepseek-chat')
    await useChatStore.getState().sendMessage('原始问题')
    const req = startRequests[0]
    chunkCb!({ runId: req.runId, conversationId: req.conversationId, type: 'done' })
    const userMsgId = useChatStore.getState().conversations[0].messages[0].id

    useChatStore.getState().updateMessage(userMsgId, '保存后的问题')

    const conv = useChatStore.getState().conversations[0]
    expect(startRequests).toHaveLength(1)
    expect(conv.messages[0].content).toBe('保存后的问题')
    expect(saved.get(conv.id)?.messages[0].content).toBe('保存后的问题')
  })

  it('editAndResend 截断并重发', async () => {
    await boot()
    useChatStore.getState().createConversation('deepseek', 'deepseek-chat')
    await useChatStore.getState().sendMessage('第一问')
    const req1 = startRequests[0]
    chunkCb!({ runId: req1.runId, conversationId: req1.conversationId, type: 'done' })
    const userMsgId = useChatStore.getState().conversations[0].messages[0].id
    await useChatStore.getState().editAndResend(userMsgId, '修改后的问题')
    expect(startRequests[1].messages.length).toBe(1)
    expect(startRequests[1].messages[0].content).toBe('修改后的问题')
    expect(useChatStore.getState().conversations[0].messages[0].content).toBe('修改后的问题')
  })

  it('setMessageFeedback 切换助手消息反馈并持久化', async () => {
    await boot()
    useChatStore.getState().createConversation('deepseek', 'deepseek-chat')
    await useChatStore.getState().sendMessage('你好')
    const req = startRequests[0]
    chunkCb!({ runId: req.runId, conversationId: req.conversationId, type: 'done' })
    const assistant = useChatStore.getState().conversations[0].messages[1]

    useChatStore.getState().setMessageFeedback(assistant.id, 'positive')
    expect(useChatStore.getState().conversations[0].messages[1].feedback).toBe('positive')
    expect(saved.get(req.conversationId)?.messages[1].feedback).toBe('positive')

    useChatStore.getState().setMessageFeedback(assistant.id, 'positive')
    expect(useChatStore.getState().conversations[0].messages[1].feedback).toBeUndefined()
  })
})
