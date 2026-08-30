import type { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc-channels'
import { streamOpenAICompatible } from '../shared/llm/openai'
import { getModelContextWindow, manageContextMessages } from '../shared/context-manager'
import type { ChatChunkPayload, ChatStartRequest, ProviderConfig, Usage } from '../shared/types'

const controllers = new Map<string, AbortController>()

export function startChat(win: BrowserWindow, req: ChatStartRequest, provider: ProviderConfig): void {
  const controller = new AbortController()
  controllers.set(req.runId, controller)
  const send = (payload: ChatChunkPayload): void => {
    if (!win.isDestroyed()) win.webContents.send(IPC.ChatChunk, payload)
  }
  send({ runId: req.runId, conversationId: req.conversationId, type: 'start', model: req.modelId })
  void (async () => {
    try {
      let usage: Usage | undefined
      const managed = manageContextMessages(
        req.messages.map(message => ({ ...message })),
        { contextWindow: getModelContextWindow(provider, req.modelId) }
      )
      const messages = managed.messages.map(message => ({
        role: typeof message.role === 'string' ? message.role : 'user',
        content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '')
      }))
      for await (const chunk of streamOpenAICompatible({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: req.modelId,
        messages,
        temperature: req.temperature,
        signal: controller.signal
      })) {
        if (chunk.type === 'content') {
          send({ runId: req.runId, conversationId: req.conversationId, type: 'content', text: chunk.text })
        } else if (chunk.type === 'reasoning') {
          send({ runId: req.runId, conversationId: req.conversationId, type: 'reasoning', text: chunk.text })
        } else {
          usage = chunk.usage
        }
      }
      send({ runId: req.runId, conversationId: req.conversationId, type: 'done', usage })
    } catch (err) {
      const e = err as Error
      if (e && e.name === 'AbortError') {
        send({ runId: req.runId, conversationId: req.conversationId, type: 'done' })
      } else {
        send({ runId: req.runId, conversationId: req.conversationId, type: 'error', message: e && e.message ? e.message : '未知错误' })
      }
    } finally {
      controllers.delete(req.runId)
    }
  })()
}

export function cancelChat(runId: string): void {
  const c = controllers.get(runId)
  if (c) c.abort()
}

export function cancelAllChats(): void {
  for (const c of controllers.values()) c.abort()
  controllers.clear()
}
