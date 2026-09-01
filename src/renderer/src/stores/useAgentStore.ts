import { create } from 'zustand'
import type { AgentEvent, AgentQueuedMessage, AgentSession, AgentSessionSource, AgentStep, McpInstallApproval } from '@shared/agent-types'
import { formatMemoryContext } from '@shared/memory'
import { useSettingsStore } from './useSettingsStore'

interface PendingApprovalState {
  callId: string
  command: string
  cwd: string
  target: string
  reason: string
  mcpInstall?: McpInstallApproval
}

interface RunningAgentSession {
  runId: string
  sessionId: string
  task: string
  input: string
  workdir: string
  providerId: string
  modelId: string
  source?: AgentSessionSource
  createdAt: number
  steps: AgentStep[]
  history: Array<Record<string, unknown>>
  queuedMessages: AgentQueuedMessage[]
}

interface TextBufferState {
  text: string
  timer: number | null
}

interface AgentState {
  initialized: boolean
  workdir: string
  running: boolean
  currentRunId: string | null
  currentTask: string
  currentProviderId: string
  currentModelId: string
  currentSessionId: string
  currentSource?: AgentSessionSource
  draftTask: string
  steps: AgentStep[]
  history: Array<Record<string, unknown>>
  queuedMessages: AgentQueuedMessage[]
  sessions: AgentSession[]
  activeSessionId: string | null
  runningSessions: Record<string, string>
  pendingApprovalsBySessionId: Record<string, PendingApprovalState>
  pendingApproval: PendingApprovalState | null
  error: string | null
  init: () => void
  start: (task: string) => Promise<void>
  enqueueMessage: (text: string) => Promise<void>
  updateQueuedMessage: (id: string, text: string) => void
  removeQueuedMessage: (id: string) => void
  sendQueuedNow: (id: string) => Promise<void>
  stop: () => void
  approve: (approved: boolean) => void
  pickDirectory: () => Promise<void>
  refreshSessions: () => Promise<void>
  processPendingConnectorSession: () => Promise<void>
  loadSession: (id: string) => void
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  updateStep: (index: number, patch: Partial<AgentStep>) => void
  setStepFeedback: (index: number, feedback: 'positive' | 'negative') => void
  regenerateFrom: (index: number) => Promise<void>
  rerunTaskFrom: (index: number, task: string) => Promise<void>
  setCurrentModel: (providerId: string, modelId: string) => void
  setDraftTask: (task: string) => void
  clear: () => void
}

const MAX_BACKGROUND_AGENT_RUNS = 3

const runContexts = new Map<string, RunningAgentSession>()
const runIdBySessionId = new Map<string, string>()
const textBuffers = new Map<string, TextBufferState>()
const connectorStatusTimers = new Map<string, number>()

function makeId(prefix: string): string {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
}

function latestTask(steps: AgentStep[]): string {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (step.kind === 'task') return step.text?.trim() ?? ''
  }
  return ''
}

function replaceUserHistoryAtTaskIndex(history: Array<Record<string, unknown>>, steps: AgentStep[], taskIndex: number, text: string): Array<Record<string, unknown>> {
  let targetUserIndex = -1
  for (let index = 0; index <= taskIndex; index += 1) {
    if (steps[index]?.kind === 'task') targetUserIndex += 1
  }
  if (targetUserIndex < 0) return history

  let userIndex = -1
  let changed = false
  const nextHistory = history.map(item => {
    if (item.role !== 'user') return item
    userIndex += 1
    if (userIndex !== targetUserIndex) return item
    changed = true
    return { ...item, content: text }
  })
  return changed ? nextHistory : history
}

function historyBeforeTaskIndex(history: Array<Record<string, unknown>>, steps: AgentStep[], taskIndex: number): Array<Record<string, unknown>> {
  let targetUserIndex = -1
  for (let index = 0; index <= taskIndex; index += 1) {
    if (steps[index]?.kind === 'task') targetUserIndex += 1
  }
  if (targetUserIndex <= 0) return []

  let userIndex = -1
  for (let index = 0; index < history.length; index += 1) {
    if (history[index].role !== 'user') continue
    userIndex += 1
    if (userIndex === targetUserIndex) return history.slice(0, index)
  }
  return history
}

function latestAssistantText(steps: AgentStep[]): string {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (step.kind === 'text' && step.text?.trim()) return step.text.trim()
    if (step.kind === 'task') break
  }
  return ''
}

function canReusePendingTask(steps: AgentStep[], task: string): boolean {
  let lastTaskIndex = -1
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index].kind === 'task') {
      lastTaskIndex = index
      break
    }
  }
  if (lastTaskIndex < 0 || steps[lastTaskIndex].text?.trim() !== task) return false
  return !steps.slice(lastTaskIndex + 1).some(step => step.kind === 'text' || step.kind === 'error')
}

function hasReplyAfterLastTask(session: AgentSession): boolean {
  let lastTaskIndex = -1
  for (let index = session.steps.length - 1; index >= 0; index -= 1) {
    if (session.steps[index].kind === 'task') {
      lastTaskIndex = index
      break
    }
  }
  if (lastTaskIndex < 0) return true
  return session.steps.slice(lastTaskIndex + 1).some(step => step.kind === 'text' || step.kind === 'error')
}

function removeRunFromState(
  runningSessions: Record<string, string>,
  pendingApprovalsBySessionId: Record<string, PendingApprovalState>,
  sessionId: string
): { runningSessions: Record<string, string>; pendingApprovalsBySessionId: Record<string, PendingApprovalState> } {
  const nextRunning = { ...runningSessions }
  const nextApprovals = { ...pendingApprovalsBySessionId }
  delete nextRunning[sessionId]
  delete nextApprovals[sessionId]
  return { runningSessions: nextRunning, pendingApprovalsBySessionId: nextApprovals }
}

function sessionFromContext(ctx: RunningAgentSession): AgentSession {
  return {
    id: ctx.sessionId,
    task: ctx.task,
    workdir: ctx.workdir,
    providerId: ctx.providerId,
    modelId: ctx.modelId,
    createdAt: ctx.createdAt,
    updatedAt: Date.now(),
    steps: ctx.steps,
    history: ctx.history,
    queuedMessages: ctx.queuedMessages,
    source: ctx.source
  }
}

function mergeLiveSessions(sessions: AgentSession[]): AgentSession[] {
  const seen = new Set(sessions.map(session => session.id))
  const merged = sessions.map(session => {
    const runId = runIdBySessionId.get(session.id)
    const ctx = runId ? runContexts.get(runId) : undefined
    return ctx ? { ...session, steps: ctx.steps, history: ctx.history, queuedMessages: ctx.queuedMessages, updatedAt: Date.now() } : session
  })
  for (const ctx of runContexts.values()) {
    if (!seen.has(ctx.sessionId)) merged.unshift(sessionFromContext(ctx))
  }
  return merged
}

function clearTextBuffer(runId: string): void {
  const buffer = textBuffers.get(runId)
  if (!buffer) return
  if (buffer.timer !== null) clearTimeout(buffer.timer)
  textBuffers.delete(runId)
}

function resetRuntimeState(): void {
  for (const runId of textBuffers.keys()) clearTextBuffer(runId)
  for (const timer of connectorStatusTimers.values()) clearTimeout(timer)
  runContexts.clear()
  runIdBySessionId.clear()
  connectorStatusTimers.clear()
}

function activeRunState(sessionId: string | null): { running: boolean; currentRunId: string | null } {
  if (!sessionId) return { running: false, currentRunId: null }
  const runId = runIdBySessionId.get(sessionId) ?? null
  return { running: runId !== null, currentRunId: runId }
}

function stoppedSteps(steps: AgentStep[]): AgentStep[] {
  const next = steps.map(step => step.kind === 'tool' && step.status === 'running'
    ? { ...step, status: 'cancelled' as const }
    : step)
  while (next.at(-1)?.kind === 'thinking') next.pop()
  return next
}

function failedSteps(steps: AgentStep[], message: string): AgentStep[] {
  const next = steps.map(step => step.kind === 'tool' && step.status === 'running'
    ? { ...step, status: 'error' as const, summary: message, result: message }
    : step)
  while (next.at(-1)?.kind === 'thinking') next.pop()
  return next
}

function stoppedHistory(ctx: RunningAgentSession): Array<Record<string, unknown>> {
  const history = [...ctx.history]
  const last = history.at(-1)
  if (last?.role !== 'user' || last.content !== ctx.input) {
    history.push({ role: 'user', content: ctx.input })
  }
  let taskIndex = -1
  for (let index = ctx.steps.length - 1; index >= 0; index -= 1) {
    if (ctx.steps[index].kind === 'task') {
      taskIndex = index
      break
    }
  }
  const partialReply = ctx.steps
    .slice(taskIndex + 1)
    .filter(step => step.kind === 'text' && step.text)
    .map(step => step.text)
    .join('')
    .trim()
  if (partialReply) history.push({ role: 'assistant', content: partialReply })
  return history
}

export const useAgentStore = create<AgentState>()((set, get) => {
  function commitContext(ctx: RunningAgentSession): void {
    set(s => {
      const exists = s.sessions.some(item => item.id === ctx.sessionId)
      const liveSession: AgentSession = {
        id: ctx.sessionId,
        task: ctx.task,
        workdir: ctx.workdir,
        providerId: ctx.providerId,
        modelId: ctx.modelId,
        createdAt: ctx.createdAt,
        updatedAt: Date.now(),
        steps: ctx.steps,
        history: ctx.history,
        queuedMessages: ctx.queuedMessages,
        source: ctx.source
      }
      const sessions = exists
        ? s.sessions.map(item => (item.id === ctx.sessionId ? { ...item, ...liveSession } : item))
        : [liveSession, ...s.sessions]
      const active = s.activeSessionId === ctx.sessionId
      return {
        sessions,
        steps: active ? ctx.steps : s.steps,
        history: active ? ctx.history : s.history,
        queuedMessages: active ? ctx.queuedMessages : s.queuedMessages,
        currentTask: active ? ctx.task : s.currentTask,
        currentProviderId: active ? ctx.providerId : s.currentProviderId,
        currentModelId: active ? ctx.modelId : s.currentModelId,
        currentSource: active ? ctx.source : s.currentSource,
        workdir: active ? ctx.workdir : s.workdir
      }
    })
  }

  function flushTextBuffer(runId: string): void {
    const buffer = textBuffers.get(runId)
    if (!buffer) return
    if (buffer.timer !== null) {
      clearTimeout(buffer.timer)
      buffer.timer = null
    }
    if (!buffer.text) return
    const delta = buffer.text
    buffer.text = ''
    const ctx = runContexts.get(runId)
    if (!ctx) return
    const steps = [...ctx.steps]
    if (steps.length > 0 && steps[steps.length - 1].kind === 'thinking') steps.pop()
    const last = steps[steps.length - 1]
    if (last && last.kind === 'text') {
      last.text = (last.text ?? '') + delta
    } else {
      steps.push({ kind: 'text', text: delta })
    }
    ctx.steps = steps
    commitContext(ctx)
  }

  function scheduleTextFlush(runId: string): void {
    const existing = textBuffers.get(runId)
    if (existing?.timer !== null && existing?.timer !== undefined) return
    const buffer = existing ?? { text: '', timer: null }
    buffer.timer = window.setTimeout(() => {
      buffer.timer = null
      flushTextBuffer(runId)
    }, 50)
    textBuffers.set(runId, buffer)
  }

  function append(ctx: RunningAgentSession, step: AgentStep): void {
    const steps = [...ctx.steps]
    if (step.kind !== 'thinking' && steps.length > 0 && steps[steps.length - 1].kind === 'thinking') {
      steps.pop()
    }
    if (step.kind === 'thinking' && steps.length > 0 && steps[steps.length - 1].kind === 'thinking') return
    steps.push(step)
    ctx.steps = steps
    commitContext(ctx)
  }

  function updateTool(ctx: RunningAgentSession, callId: string, patch: Partial<AgentStep>): void {
    ctx.steps = ctx.steps.map(st => (st.callId === callId ? { ...st, ...patch } : st))
    commitContext(ctx)
  }

  function saveSession(session: AgentSession): void {
    void window.api.agent.saveSession(session).then(() => {
      void window.api.agent.listSessions().then(sessions => set({ sessions: mergeLiveSessions(sessions) }))
    })
  }

  function saveCurrentSession(): void {
    const s = get()
    if (!s.currentTask || s.steps.length === 0) return
    const settings = useSettingsStore.getState().settings
    const defaultProviderId = settings?.defaultProviderId ?? 'deepseek'
    const defaultModelId = settings?.defaultModelId ?? 'deepseek-v4-pro'
    const session: AgentSession = {
      id: s.currentSessionId,
      task: s.currentTask,
      workdir: s.workdir,
      providerId: s.currentProviderId || defaultProviderId,
      modelId: s.currentModelId || defaultModelId,
      createdAt: s.sessions.find(item => item.id === s.currentSessionId)?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      steps: s.steps,
      history: s.history,
      queuedMessages: s.queuedMessages,
      source: s.currentSource
    }
    saveSession(session)
  }

  function syncConnectorReply(session: AgentSession): void {
    const source = session.source
    if (source?.type !== 'connector') return
    const text = latestAssistantText(session.steps)
    if (!text) return
    void window.api.connectors.sendMessage(source.connectorId, {
      sessionId: session.id,
      threadId: source.externalThreadId,
      text,
      replyToken: source.externalReplyToken
    }).then(() => {
      void get().refreshSessions()
    }).catch(error => {
      console.warn('Failed to sync connector reply', error)
    })
  }

  function scheduleConnectorStatusMessage(ctx: RunningAgentSession): void {
    const source = ctx.source
    if (source?.type !== 'connector') return
    const timer = window.setTimeout(() => {
      connectorStatusTimers.delete(ctx.runId)
      if (!runContexts.has(ctx.runId)) return
      void window.api.connectors.sendMessage(source.connectorId, {
        sessionId: ctx.sessionId,
        threadId: source.externalThreadId,
        text: '收到，我正在处理。',
        replyToken: source.externalReplyToken
      }).catch(error => {
        console.warn('Failed to send connector status message', error)
      })
    }, 3000)
    connectorStatusTimers.set(ctx.runId, timer)
  }

  async function startSession(session: AgentSession | null, task: string, activate: boolean): Promise<boolean> {
    const t = task.trim()
    if (!t) return false

    const ss = useSettingsStore.getState()
    const activeState = get()
    const defaultProviderId = ss.settings?.defaultProviderId ?? 'deepseek'
    const providerId = session?.providerId || activeState.currentProviderId || defaultProviderId
    const provider = ss.providers.find(p => p.id === providerId)
    if (!provider || !provider.apiKey) {
      if (activate) set({ error: '请先在「设置 → 模型服务」中配置 API Key' })
      return false
    }

    const defaultModelId = providerId === defaultProviderId
      ? (ss.settings?.defaultModelId ?? provider.models[0]?.id ?? '')
      : (provider.models[0]?.id ?? '')
    const sessionId = session?.id || activeState.currentSessionId || makeId('sess')
    if (runIdBySessionId.has(sessionId)) return false

    const workdir = session?.workdir ?? activeState.workdir
    const selectedModelId = activeState.currentProviderId === providerId ? activeState.currentModelId : ''
    const modelId = session?.modelId || selectedModelId || defaultModelId
    if (!modelId) {
      if (activate) set({ error: `模型服务“${provider.name}”还没有可用模型` })
      return false
    }
    const source = session?.source ?? activeState.currentSource
    const previousSteps = session?.steps ?? activeState.steps
    const previousHistory = session?.history ?? activeState.history
    const queuedMessages = session?.queuedMessages ?? (activeState.currentSessionId === sessionId ? activeState.queuedMessages : [])
    const title = session?.task || activeState.currentTask || t
    const createdAt = session?.createdAt ?? activeState.sessions.find(item => item.id === sessionId)?.createdAt ?? Date.now()
    const nextTaskStep: AgentStep = { kind: 'task', text: t }
    const steps = source?.type === 'connector' && canReusePendingTask(previousSteps, t) ? previousSteps : [...previousSteps, nextTaskStep]
    const runId = makeId('agent')
    const ctx: RunningAgentSession = {
      runId,
      sessionId,
      task: title,
      input: t,
      workdir,
      providerId,
      modelId,
      source,
      createdAt,
      steps,
      history: previousHistory,
      queuedMessages
    }

    runContexts.set(runId, ctx)
    runIdBySessionId.set(sessionId, runId)
    set(s => ({
      runningSessions: { ...s.runningSessions, [sessionId]: runId },
      activeSessionId: activate ? sessionId : s.activeSessionId,
      currentSessionId: activate ? sessionId : s.currentSessionId,
      currentTask: activate ? title : s.currentTask,
      currentProviderId: activate ? providerId : s.currentProviderId,
      currentModelId: activate ? modelId : s.currentModelId,
      currentSource: activate ? source : s.currentSource,
      workdir: activate ? workdir : s.workdir,
      steps: activate ? steps : s.steps,
      history: activate ? previousHistory : s.history,
      queuedMessages: activate ? queuedMessages : s.queuedMessages,
      pendingApproval: activate ? null : s.pendingApproval,
      error: activate ? null : s.error,
      ...activeRunState(activate ? sessionId : s.activeSessionId)
    }))
    commitContext(ctx)

    await window.api.memories.capture({ text: t, source: { type: 'agent', id: sessionId } }).catch(error => console.warn('Failed to capture Agent memory', error))
    const memories = await window.api.memories.search({ query: [t, workdir].filter(Boolean).join(' '), scopes: ['user', 'project', 'agent'], limit: 8 })
    const memoryContext = formatMemoryContext(memories)
    const res = await window.api.agent.start({ runId, providerId, modelId, workdir, task: t, temperature: ss.settings?.temperature ?? 1, history: previousHistory, memoryContext })
    if (!res.ok) {
      append(ctx, { kind: 'error', message: res.message ?? '启动失败' })
      finishRun(ctx, ctx.history, false, true)
      return false
    }
    if (!activate) scheduleConnectorStatusMessage(ctx)
    return true
  }

  function finishRun(
    ctx: RunningAgentSession,
    history: Array<Record<string, unknown>> | undefined,
    shouldSyncReply: boolean,
    processQueue: boolean
  ): AgentSession {
    flushTextBuffer(ctx.runId)
    ctx.history = history ?? ctx.history
    const nextQueuedMessage = processQueue ? ctx.queuedMessages.shift() : undefined
    const session = sessionFromContext(ctx)
    const activateNextRun = get().activeSessionId === ctx.sessionId
    runContexts.delete(ctx.runId)
    runIdBySessionId.delete(ctx.sessionId)
    clearTextBuffer(ctx.runId)
    const statusTimer = connectorStatusTimers.get(ctx.runId)
    if (statusTimer !== undefined) {
      clearTimeout(statusTimer)
      connectorStatusTimers.delete(ctx.runId)
    }
    set(s => {
      const cleared = removeRunFromState(s.runningSessions, s.pendingApprovalsBySessionId, ctx.sessionId)
      const active = s.activeSessionId === ctx.sessionId
      return {
        ...cleared,
        ...activeRunState(s.activeSessionId),
        pendingApproval: active ? null : s.pendingApproval,
        history: active ? ctx.history : s.history,
        steps: active ? ctx.steps : s.steps,
        queuedMessages: active ? ctx.queuedMessages : s.queuedMessages
      }
    })
    saveSession(session)
    if (shouldSyncReply) syncConnectorReply(session)
    if (nextQueuedMessage) void startSession(session, nextQueuedMessage.text, activateNextRun)
    return session
  }

  function handleEvent(ev: AgentEvent): void {
    const ctx = runContexts.get(ev.runId)
    if (!ctx) return
    switch (ev.type) {
      case 'thinking':
        flushTextBuffer(ev.runId)
        append(ctx, { kind: 'thinking' })
        break
      case 'text': {
        const buffer = textBuffers.get(ev.runId) ?? { text: '', timer: null }
        buffer.text += ev.text ?? ''
        textBuffers.set(ev.runId, buffer)
        scheduleTextFlush(ev.runId)
        break
      }
      case 'tool_call':
        flushTextBuffer(ev.runId)
        append(ctx, { kind: 'tool', callId: ev.call?.id, name: ev.call?.name, args: JSON.stringify(ev.call?.args ?? {}, null, 2), status: 'running' })
        break
      case 'approval_request': {
        flushTextBuffer(ev.runId)
        const pendingApproval = { callId: ev.callId ?? '', command: ev.command ?? '', cwd: ev.cwd ?? '', target: ev.target ?? '', reason: ev.reason ?? '', mcpInstall: ev.mcpInstall }
        set(s => ({
          pendingApprovalsBySessionId: { ...s.pendingApprovalsBySessionId, [ctx.sessionId]: pendingApproval },
          pendingApproval: s.activeSessionId === ctx.sessionId ? pendingApproval : s.pendingApproval
        }))
        break
      }
      case 'tool_result':
        flushTextBuffer(ev.runId)
        updateTool(ctx, ev.callId ?? '', { status: ev.ok ? 'ok' : 'error', summary: ev.summary ?? '', result: ev.output ?? '' })
        break
      case 'done':
        ctx.steps = failedSteps(ctx.steps, '工具未能在本轮结束前返回结果')
        finishRun(ctx, ev.history, true, true)
        break
      case 'error': {
        flushTextBuffer(ev.runId)
        const message = ev.message ?? '未知错误'
        const hasRunningTool = ctx.steps.some(step => step.kind === 'tool' && step.status === 'running')
        ctx.steps = failedSteps(ctx.steps, message)
        if (hasRunningTool) commitContext(ctx)
        else append(ctx, { kind: 'error', message })
        finishRun(ctx, ev.history, false, true)
        break
      }
    }
  }

  return {
    initialized: false,
    workdir: '',
    running: false,
    currentRunId: null,
    currentTask: '',
    currentProviderId: '',
    currentModelId: '',
    currentSessionId: '',
    currentSource: undefined,
    draftTask: '',
    steps: [],
    history: [],
    queuedMessages: [],
    sessions: [],
    activeSessionId: null,
    runningSessions: {},
    pendingApprovalsBySessionId: {},
    pendingApproval: null,
    error: null,
    init: () => {
      if (get().initialized) return
      resetRuntimeState()
      window.api.agent.onChunk(handleEvent)
      const settings = useSettingsStore.getState().settings
      set({ initialized: true, workdir: settings?.agentWorkdir ?? '', runningSessions: {}, pendingApprovalsBySessionId: {}, running: false, currentRunId: null, pendingApproval: null })
      void window.api.agent.listSessions().then(sessions => set({ sessions }))
    },
    start: async (task) => {
      await startSession(null, task, true)
    },
    enqueueMessage: async (text) => {
      const task = text.trim()
      if (!task) return
      if (!get().running) {
        await startSession(null, task, true)
        return
      }
      const message: AgentQueuedMessage = { id: makeId('queued'), text: task, createdAt: Date.now() }
      const runId = get().currentRunId
      const ctx = runId ? runContexts.get(runId) : undefined
      if (!ctx) return
      ctx.queuedMessages = [...ctx.queuedMessages, message]
      commitContext(ctx)
      saveCurrentSession()
    },
    updateQueuedMessage: (id, text) => {
      const value = text.trim()
      if (!value) return
      const runId = get().currentRunId
      const ctx = runId ? runContexts.get(runId) : undefined
      const queuedMessages = get().queuedMessages.map(message => message.id === id ? { ...message, text: value } : message)
      if (ctx) ctx.queuedMessages = queuedMessages
      set(s => ({
        queuedMessages,
        sessions: s.sessions.map(session => session.id === s.currentSessionId
          ? { ...session, queuedMessages, updatedAt: Date.now() }
          : session)
      }))
      saveCurrentSession()
    },
    removeQueuedMessage: (id) => {
      const runId = get().currentRunId
      const ctx = runId ? runContexts.get(runId) : undefined
      const queuedMessages = get().queuedMessages.filter(message => message.id !== id)
      if (ctx) ctx.queuedMessages = queuedMessages
      set(s => ({
        queuedMessages,
        sessions: s.sessions.map(session => session.id === s.currentSessionId
          ? { ...session, queuedMessages, updatedAt: Date.now() }
          : session)
      }))
      saveCurrentSession()
    },
    sendQueuedNow: async (id) => {
      const message = get().queuedMessages.find(item => item.id === id)
      if (!message) return
      const queuedMessages = get().queuedMessages.filter(item => item.id !== id)
      const runId = get().currentRunId
      const ctx = runId ? runContexts.get(runId) : undefined
      if (ctx && runId) {
        void window.api.agent.cancel(runId)
        flushTextBuffer(runId)
        ctx.steps = stoppedSteps(ctx.steps)
        ctx.history = stoppedHistory(ctx)
        ctx.queuedMessages = queuedMessages
        const session = finishRun(ctx, ctx.history, false, false)
        await startSession(session, message.text, true)
        return
      }
      const current = get()
      const session = current.sessions.find(item => item.id === current.currentSessionId)
      if (!session) return
      const nextSession = { ...session, queuedMessages, updatedAt: Date.now() }
      set(s => ({
        queuedMessages,
        sessions: s.sessions.map(item => item.id === nextSession.id ? nextSession : item)
      }))
      saveSession(nextSession)
      await startSession(nextSession, message.text, true)
    },
    stop: () => {
      const id = get().currentRunId
      if (!id) {
        set({ running: false, currentRunId: null, pendingApproval: null })
        return
      }
      void window.api.agent.cancel(id)
      const ctx = runContexts.get(id)
      if (!ctx) {
        const sessionId = get().currentSessionId
        runIdBySessionId.delete(sessionId)
        clearTextBuffer(id)
        set(s => ({
          ...removeRunFromState(s.runningSessions, s.pendingApprovalsBySessionId, sessionId),
          running: false,
          currentRunId: null,
          pendingApproval: null,
          steps: stoppedSteps(s.steps)
        }))
        return
      }
      flushTextBuffer(id)
      ctx.steps = stoppedSteps(ctx.steps)
      ctx.history = stoppedHistory(ctx)
      finishRun(ctx, ctx.history, false, false)
    },
    approve: (approved) => {
      const p = get().pendingApproval
      if (!p) return
      void window.api.agent.approve(p.callId, approved)
      set(s => {
        const nextApprovals = { ...s.pendingApprovalsBySessionId }
        if (s.activeSessionId) delete nextApprovals[s.activeSessionId]
        return { pendingApprovalsBySessionId: nextApprovals, pendingApproval: null }
      })
    },
    pickDirectory: async () => {
      const dir = await window.api.agent.pickDirectory()
      if (dir) {
        set({ workdir: dir })
        await useSettingsStore.getState().updateSettings({ agentWorkdir: dir })
      }
    },
    refreshSessions: async () => {
      const sessions = await window.api.agent.listSessions()
      set({ sessions: mergeLiveSessions(sessions) })
    },
    processPendingConnectorSession: async () => {
      const sessions = await window.api.agent.listSessions()
      set({ sessions: mergeLiveSessions(sessions) })
      const runningCount = Object.keys(get().runningSessions).length
      const capacity = Math.max(0, MAX_BACKGROUND_AGENT_RUNS - runningCount)
      if (capacity <= 0) return
      const pending = sessions
        .filter(session => session.source?.type === 'connector' && !runIdBySessionId.has(session.id) && !hasReplyAfterLastTask(session))
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .slice(0, capacity)
      for (const session of pending) {
        const task = latestTask(session.steps)
        if (task) await startSession(session, task, false)
      }
    },
    loadSession: (id) => {
      const s = get().sessions.find(x => x.id === id)
      if (!s) return
      const defaultProviderId = useSettingsStore.getState().settings?.defaultProviderId ?? 'deepseek'
      const runId = runIdBySessionId.get(id)
      const ctx = runId ? runContexts.get(runId) : undefined
      const active = activeRunState(id)
      set(state => ({
        steps: ctx?.steps ?? stoppedSteps(s.steps),
        currentTask: ctx?.task ?? s.task,
        currentProviderId: ctx?.providerId ?? s.providerId ?? defaultProviderId,
        currentModelId: ctx?.modelId ?? s.modelId,
        currentSource: ctx?.source ?? s.source,
        workdir: ctx?.workdir ?? s.workdir,
        history: ctx?.history ?? s.history ?? [],
        queuedMessages: ctx?.queuedMessages ?? s.queuedMessages ?? [],
        currentSessionId: id,
        activeSessionId: id,
        running: active.running,
        currentRunId: active.currentRunId,
        pendingApproval: state.pendingApprovalsBySessionId[id] ?? null,
        error: null
      }))
    },
    deleteSession: async (id) => {
      const runId = runIdBySessionId.get(id)
      if (runId) {
        void window.api.agent.cancel(runId)
        runContexts.delete(runId)
        runIdBySessionId.delete(id)
        clearTextBuffer(runId)
      }
      await window.api.agent.deleteSession(id)
      set(s => {
        const nextSessions = s.sessions.filter(x => x.id !== id)
        const cleared = removeRunFromState(s.runningSessions, s.pendingApprovalsBySessionId, id)
        if (s.activeSessionId !== id && s.currentSessionId !== id) return { sessions: nextSessions, ...cleared }
        return {
          sessions: nextSessions,
          ...cleared,
          activeSessionId: null,
          currentSessionId: '',
          currentSource: undefined,
          currentTask: '',
          currentProviderId: '',
          currentModelId: '',
          steps: [],
          history: [],
          queuedMessages: [],
          running: false,
          currentRunId: null,
          pendingApproval: null,
          error: null
        }
      })
    },
    renameSession: async (id, title) => {
      const t = title.trim()
      if (!t) return
      await window.api.agent.renameSession(id, t)
      const runId = runIdBySessionId.get(id)
      const ctx = runId ? runContexts.get(runId) : undefined
      if (ctx) ctx.task = t
      set(s => ({
        sessions: s.sessions.map(item => (item.id === id ? { ...item, task: t } : item)),
        currentTask: s.currentSessionId === id ? t : s.currentTask
      }))
    },
    updateStep: (index, patch) => {
      set(s => {
        const currentStep = s.steps[index]
        const nextSteps = s.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step)
        const nextHistory = currentStep?.kind === 'task' && typeof patch.text === 'string'
          ? replaceUserHistoryAtTaskIndex(s.history, s.steps, index, patch.text)
          : s.history
        return { steps: nextSteps, history: nextHistory }
      })
      const runId = get().currentRunId
      const ctx = runId ? runContexts.get(runId) : undefined
      if (ctx) {
        ctx.steps = get().steps
        ctx.history = get().history
      }
      saveCurrentSession()
    },
    setStepFeedback: (index, feedback) => {
      const step = get().steps[index]
      if (!step || step.kind !== 'text') return
      get().updateStep(index, { feedback: step.feedback === feedback ? undefined : feedback })
    },
    regenerateFrom: async (index) => {
      if (get().running) return
      const steps = get().steps
      let taskIndex = -1
      for (let current = index - 1; current >= 0; current -= 1) {
        if (steps[current].kind === 'task') {
          taskIndex = current
          break
        }
      }
      const task = taskIndex >= 0 ? steps[taskIndex].text?.trim() : ''
      if (!task) return
      const history = historyBeforeTaskIndex(get().history, steps, taskIndex)
      set({ steps: steps.slice(0, taskIndex), history })
      await get().start(task)
    },
    rerunTaskFrom: async (index, task) => {
      if (get().running) return
      const text = task.trim()
      if (!text) return
      const steps = get().steps
      if (steps[index]?.kind !== 'task') return
      const history = historyBeforeTaskIndex(get().history, steps, index)
      set({ steps: steps.slice(0, index), history })
      await get().start(text)
    },
    setCurrentModel: (providerId, modelId) => {
      set({ currentProviderId: providerId, currentModelId: modelId })
      saveCurrentSession()
    },
    setDraftTask: (task) => {
      set({ draftTask: task })
    },
    clear: () => {
      if (get().running) get().stop()
      set({ steps: [], history: [], queuedMessages: [], error: null, pendingApproval: null, currentTask: '', currentProviderId: '', currentModelId: '', currentSessionId: '', currentSource: undefined, activeSessionId: null, running: false, currentRunId: null })
    }
  }
})
