import type { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc-channels'
import { streamOpenAICompatible } from '../shared/llm/openai'
import { getModelContextWindow, manageContextMessages } from '../shared/context-manager'
import { IncompleteStreamError, MAX_STREAM_CONTINUATIONS, mergeTokenUsage, STREAM_CONTINUE_PROMPT, streamNeedsContinuation, streamTerminationError } from '../shared/llm/stream'
import type { ChatChunkPayload, ChatStartRequest, ProviderConfig, Usage } from '../shared/types'
import { createStreamEventBuffer } from './stream-event-buffer'

const controllers = new Map<string, AbortController>()

export function startChat(win: BrowserWindow, req: ChatStartRequest, provider: ProviderConfig): void {
  const controller = new AbortController()
  controllers.set(req.runId, controller)
  const sendNow = (payload: ChatChunkPayload): void => {
    if (!win.isDestroyed()) win.webContents.send(IPC.ChatChunk, payload)
  }
  const streamEvents = createStreamEventBuffer(sendNow, {
    isBufferable: payload => payload.type === 'content' || payload.type === 'reasoning'
  })
  const send = streamEvents.send
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
      let requestMessages = messages
      let content = ''
      let continuations = 0
      while (true) {
        let finalReceived = false
        let finishReason: string | undefined
        try {
          for await (const chunk of streamOpenAICompatible({
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            model: req.modelId,
            messages: requestMessages,
            temperature: req.temperature,
            signal: controller.signal
          })) {
            if (chunk.type === 'content') {
              content += chunk.text
              send({ runId: req.runId, conversationId: req.conversationId, type: 'content', text: chunk.text })
            } else if (chunk.type === 'reasoning') {
              send({ runId: req.runId, conversationId: req.conversationId, type: 'reasoning', text: chunk.text })
            } else {
              finalReceived = true
              finishReason = chunk.finishReason
              usage = mergeTokenUsage(usage, chunk.usage)
            }
          }
          if (!finalReceived) throw new IncompleteStreamError()
        } catch (error) {
          if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
          if (!(error instanceof IncompleteStreamError) || continuations >= MAX_STREAM_CONTINUATIONS) throw error
          continuations += 1
          requestMessages = content
            ? [...messages, { role: 'assistant', content }, { role: 'user', content: STREAM_CONTINUE_PROMPT }]
            : messages
          continue
        }
        const terminationError = streamTerminationError(finishReason)
        if (terminationError) throw new Error(terminationError)
        if (!streamNeedsContinuation(finishReason, content)) break
        if (continuations >= MAX_STREAM_CONTINUATIONS) throw new Error('模型回复多次未完整结束，请缩小问题范围后重试')
        continuations += 1
        requestMessages = [...messages, { role: 'assistant', content }, { role: 'user', content: STREAM_CONTINUE_PROMPT }]
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
      streamEvents.flush()
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
