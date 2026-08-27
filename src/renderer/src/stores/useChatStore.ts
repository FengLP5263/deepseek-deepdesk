import { create } from 'zustand'
import type { ChatChunkPayload, ChatMessage, Conversation } from '@shared/types'
import { formatMemoryContext } from '@shared/memory'
import { useSettingsStore } from './useSettingsStore'
import { makeTitle, uid } from '../lib/utils'

interface StreamHandle {
  runId: string
  conversationId: string
  assistantId: string
  pendingContent: string
  pendingReasoning: string
  timer: number | null
}

const streamHandles = new Map<string, StreamHandle>()

function replaceConv(list: Conversation[], conv: Conversation): Conversation[] {
  return list.map(c => (c.id === conv.id ? conv : c))
}

function scheduleFlush(handle: StreamHandle): void {
  if (handle.timer !== null) return
  handle.timer = window.setTimeout(() => {
    handle.timer = null
    flushHandle(handle)
  }, 50)
}

function flushHandle(handle: StreamHandle): void {
  const state = useChatStore.getState()
  const conv = state.conversations.find(c => c.id === handle.conversationId)
  if (!conv) return
  const msg = conv.messages.find(m => m.id === handle.assistantId)
  if (!msg) return
  let changed = false
  if (handle.pendingContent) {
    msg.content += handle.pendingContent
    handle.pendingContent = ''
    changed = true
  }
  if (handle.pendingReasoning) {
    msg.reasoning = (msg.reasoning ?? '') + handle.pendingReasoning
    handle.pendingReasoning = ''
    changed = true
  }
  if (changed) useChatStore.getState().updateConversation(conv, false)
}

function finishStream(handle: StreamHandle, payload: ChatChunkPayload, error: string | null): void {
  const state = useChatStore.getState()
  const conv = state.conversations.find(c => c.id === handle.conversationId)
  if (handle.timer !== null) {
    clearTimeout(handle.timer)
    handle.timer = null
  }
  streamHandles.delete(handle.runId)
  if (!conv) {
    useChatStore.setState({ streaming: null })
    return
  }
  const msg = conv.messages.find(m => m.id === handle.assistantId)
  if (msg) {
    if (handle.pendingContent) {
      msg.content += handle.pendingContent
      handle.pendingContent = ''
    }
    if (handle.pendingReasoning) {
      msg.reasoning = (msg.reasoning ?? '') + handle.pendingReasoning
      handle.pendingReasoning = ''
    }
    msg.streaming = false
    if (payload.model) msg.model = payload.model
    if (error) {
      msg.error = true
      if (!msg.content) msg.content = '请求失败：' + error
    }
  }
  conv.updatedAt = Date.now()
  void window.api.conversations.upsert(conv)
  useChatStore.setState({ streaming: null, conversations: replaceConv(state.conversations, conv) })
}

function handleChunk(payload: ChatChunkPayload): void {
  const state = useChatStore.getState()
  if (!state.streaming || state.streaming.runId !== payload.runId) return
  const handle = streamHandles.get(payload.runId)
  if (!handle) return
  const conv = state.conversations.find(c => c.id === handle.conversationId)
  if (!conv) return
  const msg = conv.messages.find(m => m.id === handle.assistantId)
  if (!msg) return
  if (payload.type === 'content' && payload.text) {
    handle.pendingContent += payload.text
    scheduleFlush(handle)
  } else if (payload.type === 'reasoning' && payload.text) {
    handle.pendingReasoning += payload.text
    scheduleFlush(handle)
  } else if (payload.type === 'done') {
    finishStream(handle, payload, null)
  } else if (payload.type === 'error') {
    finishStream(handle, payload, payload.message ?? '未知错误')
  }
}

interface ChatState {
  initialized: boolean
  conversations: Conversation[]
  activeId: string | null
  streaming: { runId: string; conversationId: string } | null
  notice: string | null
  pendingModel: { providerId: string; modelId: string } | null
  init: () => Promise<void>
  createConversation: (providerId?: string, modelId?: string) => Conversation | null
  selectConversation: (id: string) => void
  deleteConversation: (id: string) => Promise<void>
  updateConversation: (conv: Conversation, persist?: boolean) => void
  setModel: (providerId: string, modelId: string) => void
  setTemperature: (t: number) => void
  sendMessage: (text: string) => Promise<void>
  stopStreaming: () => void
  regenerate: () => Promise<void>
  editAndResend: (messageId: string, newText: string) => Promise<void>
  setMessageFeedback: (messageId: string, feedback: 'positive' | 'negative') => void
  dismissNotice: () => void
}

export const useChatStore = create<ChatState>()((set, get) => ({
  initialized: false,
  conversations: [],
  activeId: null,
  streaming: null,
  notice: null,
  pendingModel: null,
  init: async () => {
    if (get().initialized) return
    const conversations = await window.api.conversations.list()
    conversations.sort((a, b) => b.updatedAt - a.updatedAt)
    window.api.chat.onChunk(handleChunk)
    set({ initialized: true, conversations, activeId: conversations.length > 0 ? conversations[0].id : null })
  },
  createConversation: (providerId, modelId) => {
    const settingsState = useSettingsStore.getState()
    const pending = get().pendingModel
    const provider = providerId ?? pending?.providerId ?? settingsState.settings?.defaultProviderId ?? 'deepseek'
    const model = modelId ?? pending?.modelId ?? settingsState.settings?.defaultModelId ?? 'deepseek-v4-flash'
    const conv: Conversation = {
      id: uid(),
      title: '新对话',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      providerId: provider,
      modelId: model,
      temperature: settingsState.settings?.temperature ?? 1,
      messages: []
    }
    set(s => ({ conversations: [conv, ...s.conversations], activeId: conv.id, pendingModel: null }))
    void window.api.conversations.upsert(conv)
    return conv
  },
  selectConversation: (id) => set({ activeId: id }),
  deleteConversation: async (id) => {
    await window.api.conversations.remove(id)
    const { conversations, activeId } = get()
    const next = conversations.filter(c => c.id !== id)
    let active = activeId
    if (active === id) active = next.length > 0 ? next[0].id : null
    set({ conversations: next, activeId: active })
  },
  updateConversation: (conv, persist = true) => {
    conv.updatedAt = Date.now()
    set({ conversations: replaceConv(get().conversations, conv) })
    if (persist) void window.api.conversations.upsert(conv)
  },
  setModel: (providerId, modelId) => {
    const { activeId, conversations } = get()
    const conv = conversations.find(c => c.id === activeId)
    if (!conv) {
      set({ pendingModel: { providerId, modelId } })
      return
    }
    conv.providerId = providerId
    conv.modelId = modelId
    set({ conversations: replaceConv(conversations, conv) })
    void window.api.conversations.upsert(conv)
  },
  setTemperature: (t) => {
    const { activeId, conversations } = get()
    const conv = conversations.find(c => c.id === activeId)
    if (!conv) return
    conv.temperature = t
    set({ conversations: replaceConv(conversations, conv) })
    void window.api.conversations.upsert(conv)
  },
  sendMessage: async (text) => {
    const trimmed = text.trim()
    if (!trimmed || get().streaming) return
    const settingsState = useSettingsStore.getState()
    let conv = get().conversations.find(c => c.id === get().activeId)
    if (!conv) {
      const created = get().createConversation()
      if (!created) return
      conv = created
    }
    const provider = settingsState.providers.find(p => p.id === conv.providerId)
    if (!provider) {
      set({ notice: '未找到该模型服务，请在「设置 → 模型服务」中添加' })
      return
    }
    if (!provider.apiKey) {
      set({ notice: '请先在「设置 → 模型服务」中配置 ' + provider.name + ' 的 API Key' })
      return
    }
    const userMsg: ChatMessage = { id: uid(), role: 'user', content: trimmed, createdAt: Date.now() }
    const assistantMsg: ChatMessage = { id: uid(), role: 'assistant', content: '', createdAt: Date.now(), streaming: true }
    conv.messages.push(userMsg, assistantMsg)
    if (!conv.title || conv.title === '新对话') conv.title = makeTitle(trimmed)
    conv.updatedAt = Date.now()
    const runId = uid()
    streamHandles.set(runId, { runId, conversationId: conv.id, assistantId: assistantMsg.id, pendingContent: '', pendingReasoning: '', timer: null })
    set({ conversations: replaceConv(get().conversations, conv), streaming: { runId, conversationId: conv.id }, notice: null })
    const payload = conv.messages
      .filter(m => !m.streaming)
      .map(m => ({ role: m.role, content: m.content }))
    const memories = await window.api.memories.search({ query: trimmed, scopes: ['user', 'project'], limit: 6 })
    const memoryContext = formatMemoryContext(memories)
    const messages = memoryContext
      ? [{ role: 'system', content: memoryContext }, ...payload]
      : payload
    const res = await window.api.chat.start({
      runId,
      conversationId: conv.id,
      providerId: conv.providerId,
      modelId: conv.modelId,
      temperature: conv.temperature,
      messages
    })
    if (!res.ok) {
      const handle = streamHandles.get(runId)
      if (handle) {
        finishStream(handle, { runId, conversationId: conv.id, type: 'error', message: res.message }, res.message ?? '发送失败')
      }
    }
  },
  stopStreaming: () => {
    const s = get().streaming
    if (!s) return
    void window.api.chat.cancel(s.runId)
  },
  regenerate: async () => {
    const conv = get().conversations.find(c => c.id === get().activeId)
    if (!conv || get().streaming) return
    while (conv.messages.length > 0) {
      const last = conv.messages[conv.messages.length - 1]
      if (last.role === 'assistant') conv.messages.pop()
      else break
    }
    const lastUser = conv.messages.pop()
    if (!lastUser) return
    set({ conversations: replaceConv(get().conversations, conv) })
    await get().sendMessage(lastUser.content)
  },
  editAndResend: async (messageId, newText) => {
    const conv = get().conversations.find(c => c.id === get().activeId)
    if (!conv || get().streaming) return
    const idx = conv.messages.findIndex(m => m.id === messageId)
    if (idx < 0) return
    const msg = conv.messages[idx]
    if (msg.role !== 'user') return
    msg.content = newText.trim()
    conv.messages = conv.messages.slice(0, idx)
    set({ conversations: replaceConv(get().conversations, conv) })
    await get().sendMessage(newText)
  },
  setMessageFeedback: (messageId, feedback) => {
    const conv = get().conversations.find(c => c.id === get().activeId)
    const message = conv?.messages.find(item => item.id === messageId)
    if (!conv || !message || message.role !== 'assistant') return
    message.feedback = message.feedback === feedback ? undefined : feedback
    get().updateConversation(conv)
  },
  dismissNotice: () => set({ notice: null })
}))
