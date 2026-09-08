import type { AgentEvent, AgentRunRequest, AgentStep } from '../shared/agent-types'
import type { ChatChunkPayload, ChatStartRequest } from '../shared/types'
import { persistableAgentHistory } from '../shared/agent-context'
import { compactToolResultForContext } from '../shared/context-manager'
import type { AppStore } from './store'
import { OBJECT_THRESHOLD, storageKey } from './session-objects'

export interface AgentPersistence {
  event(event: AgentEvent): void
  history(messages: Array<Record<string, unknown>>): void
  archive(content: string, tokenBudget: number): Promise<string>
  read(args: Record<string, unknown>): Promise<string>
}

const pendingCheckpoints = new Set<() => void>()
const ownersByStore = new WeakMap<AppStore, Map<string, string>>()
function runOwnership(store: AppStore): Map<string, string> {
  let owners = ownersByStore.get(store)
  if (!owners) { owners = new Map(); ownersByStore.set(store, owners) }
  return owners
}
export function flushRunCheckpoints(): void { for (const flush of pendingCheckpoints) flush() }

function checkpointScheduler(save: () => void): { schedule(): void; flush(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = (): void => {
    if (timer) clearTimeout(timer)
    timer = undefined
    pendingCheckpoints.delete(flush)
    save()
  }
  return {
    schedule() { pendingCheckpoints.add(flush); timer ??= setTimeout(flush, 500) },
    flush
  }
}

/** Renderer owns presentation; main owns recovery checkpoints, including buffered streaming text. */
export function createAgentPersistence(store: AppStore, req: AgentRunRequest): AgentPersistence | undefined {
  if (!req.sessionId) return undefined
  const sessionId = req.sessionId
  const initial = store.getAgentSession(sessionId)
  if (!initial) throw new Error('请先保存会话再启动任务')
  const owners = runOwnership(store)
  const ownerKey = `agent:${sessionId}`
  owners.set(ownerKey, req.runId)
  let steps = initial.steps
  let history = req.history ?? []
  let pendingText = ''
  let contextUsage = initial.contextUsage
  let completed = false
  const save = (): void => {
    if (owners.get(ownerKey) !== req.runId) return
    const current = store.getAgentSession(sessionId)
    if (!current) return // Deleted while running: do not resurrect the session.
    store.upsertAgentSession({ ...current, steps, contextUsage, updatedAt: Date.now(), hasUnread: completed || current.hasUnread,
      history: pendingText ? [...history, { role: 'assistant', content: pendingText }] : history })
  }
  const scheduler = checkpointScheduler(save)
  const key = storageKey('agent', sessionId)
  const settleThinking = (): void => {
    const last = steps.at(-1)
    if (last?.kind !== 'thinking') return
    steps = last.text?.trim() ? [...steps.slice(0, -1), { ...last, status: 'ok' }] : steps.slice(0, -1)
  }
  const append = (step: AgentStep): void => { settleThinking(); steps = [...steps, step] }
  return {
    history(messages) {
      history = structuredClone(persistableAgentHistory(messages))
      pendingText = ''
      scheduler.flush()
    },
    event(event) {
      switch (event.type) {
        case 'text': {
          settleThinking()
          pendingText += event.text ?? ''
          const last = steps.at(-1)
          steps = last?.kind === 'text'
            ? [...steps.slice(0, -1), { ...last, text: (last.text ?? '') + (event.text ?? '') }]
            : [...steps, { kind: 'text', text: event.text ?? '' }]
          break
        }
        case 'thinking': {
          const last = steps.at(-1)
          steps = last?.kind === 'thinking'
            ? [...steps.slice(0, -1), { ...last, text: (last.text ?? '') + (event.text ?? '') }]
            : [...steps, { kind: 'thinking', text: event.text, status: 'running', startedAt: Date.now() }]
          break
        }
        case 'tool_call':
          if (event.call) append({ kind: 'tool', callId: event.call.id, name: event.call.name, args: JSON.stringify(event.call.args), status: 'running' })
          break
        case 'tool_result':
          steps = steps.map(step => step.kind === 'tool' && step.callId === event.callId
            ? { ...step, status: event.ok ? 'ok' : 'error', summary: event.summary, result: event.output } : step)
          break
        case 'context_usage': contextUsage = event.contextUsage; break
        case 'context_compacting': append({ kind: 'context', status: 'running', startedAt: Date.now() }); break
        case 'context_compacted':
          steps = steps.map(step => step.kind === 'context' && step.status === 'running'
            ? { ...step, status: 'ok', beforeTokens: event.beforeTokens, afterTokens: event.afterTokens } : step)
          break
        case 'done':
        case 'error':
          completed = true
          settleThinking()
          steps = steps.map(step => step.status === 'running' ? { ...step, status: 'cancelled' } : step)
          if (event.type === 'error') append({ kind: 'error', message: event.message })
          history = event.history ?? history
          pendingText = ''
          scheduler.flush()
          if (owners.get(ownerKey) === req.runId) owners.delete(ownerKey)
          return
      }
      if (event.type === 'text' || event.type === 'thinking') scheduler.schedule()
      else scheduler.flush()
    },
    async archive(content, tokenBudget) {
      const compacted = compactToolResultForContext(content, tokenBudget)
      if (content.length <= OBJECT_THRESHOLD && compacted === content) return content
      const reference = await store.sessions.objects.put(key, content)
      return `[DeepDesk 上下文原文 reference=${reference}，共 ${content.length} 字符；可用 read_context 分段读取]\n` +
        compactToolResultForContext(content, Math.max(256, tokenBudget - 150))
    },
    async read(args) {
      if (!store.getAgentSession(sessionId)) throw new Error('会话已删除，无法读取原文')
      if (!args.reference) return JSON.stringify(await store.sessions.objects.list(key,
        args.offset === undefined ? 0 : Number(args.offset), args.limit === undefined ? 20 : Number(args.limit)))
      return JSON.stringify(await store.sessions.objects.read(key, String(args.reference),
        args.offset === undefined ? 0 : Number(args.offset), args.limit === undefined ? 8000 : Number(args.limit)))
    }
  }
}

export function createChatPersistence(store: AppStore, req: ChatStartRequest): (event: ChatChunkPayload) => void {
  const initial = store.getConversation(req.conversationId)
  const assistant = initial?.messages.at(-1)
  if (!initial || assistant?.role !== 'assistant' || !assistant.streaming) return () => {}
  const owners = runOwnership(store)
  const ownerKey = `chat:${req.conversationId}`
  owners.set(ownerKey, req.runId)
  let message = { ...assistant }
  const scheduler = checkpointScheduler(() => {
    if (owners.get(ownerKey) !== req.runId) return
    const current = store.getConversation(req.conversationId)
    if (!current) return
    store.upsertConversation({ ...current, updatedAt: Date.now(), messages: current.messages.map(item => item.id === message.id ? message : item) })
  })
  return event => {
    if (event.type === 'content') message = { ...message, content: message.content + (event.text ?? '') }
    if (event.type === 'reasoning') message = { ...message, reasoning: (message.reasoning ?? '') + (event.text ?? '') }
    if (event.type === 'done' || event.type === 'error') {
      message = { ...message, streaming: false, error: event.type === 'error' }
      scheduler.flush()
      if (owners.get(ownerKey) === req.runId) owners.delete(ownerKey)
    } else scheduler.schedule()
  }
}
