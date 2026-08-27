import { create } from 'zustand'
import type { AgentEvent, AgentSession, AgentStep } from '@shared/agent-types'
import { formatMemoryContext } from '@shared/memory'
import { useSettingsStore } from './useSettingsStore'

interface AgentState {
  initialized: boolean
  workdir: string
  running: boolean
  currentRunId: string | null
  currentTask: string
  currentModelId: string
  currentSessionId: string
  draftTask: string
  steps: AgentStep[]
  history: Array<Record<string, unknown>>
  sessions: AgentSession[]
  activeSessionId: string | null
  pendingApproval: { callId: string; command: string; cwd: string; target: string; reason: string } | null
  error: string | null
  init: () => void
  start: (task: string) => Promise<void>
  stop: () => void
  approve: (approved: boolean) => void
  pickDirectory: () => Promise<void>
  loadSession: (id: string) => void
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  updateStep: (index: number, patch: Partial<AgentStep>) => void
  setStepFeedback: (index: number, feedback: 'positive' | 'negative') => void
  regenerateFrom: (index: number) => Promise<void>
  setDraftTask: (task: string) => void
  clear: () => void
}

let textBuffer = ''
let textTimer: number | null = null

function flushTextBuffer(): void {
  if (textTimer !== null) {
    clearTimeout(textTimer)
    textTimer = null
  }
  if (!textBuffer) return
  const delta = textBuffer
  textBuffer = ''
  useAgentStore.setState(s => {
    const steps = [...s.steps]
    if (steps.length > 0 && steps[steps.length - 1].kind === 'thinking') steps.pop()
    const last = steps[steps.length - 1]
    if (last && last.kind === 'text') {
      last.text = (last.text ?? '') + delta
    } else {
      steps.push({ kind: 'text', text: delta })
    }
    return { steps }
  })
}

function scheduleTextFlush(): void {
  if (textTimer !== null) return
  textTimer = window.setTimeout(() => {
    textTimer = null
    flushTextBuffer()
  }, 50)
}

export const useAgentStore = create<AgentState>()((set, get) => {
  function append(step: AgentStep): void {
    set(s => {
      const steps = [...s.steps]
      if (step.kind !== 'thinking' && steps.length > 0 && steps[steps.length - 1].kind === 'thinking') {
        steps.pop()
      }
      if (step.kind === 'thinking' && steps.length > 0 && steps[steps.length - 1].kind === 'thinking') {
        return { steps }
      }
      steps.push(step)
      return { steps }
    })
  }
  function updateTool(callId: string, patch: Partial<AgentStep>): void {
    set(s => ({ steps: s.steps.map(st => (st.callId === callId ? { ...st, ...patch } : st)) }))
  }
  function saveCurrentSession(): void {
    const s = get()
    if (!s.currentTask || s.steps.length === 0) return
    const session: AgentSession = {
      id: s.currentSessionId,
      task: s.currentTask,
      workdir: s.workdir,
      modelId: s.currentModelId,
      createdAt: s.sessions.find(item => item.id === s.currentSessionId)?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      steps: s.steps,
      history: s.history
    }
    void window.api.agent.saveSession(session).then(() => {
      void window.api.agent.listSessions().then(sessions => set({ sessions }))
    })
  }
  function handleEvent(ev: AgentEvent): void {
    switch (ev.type) {
      case 'thinking': flushTextBuffer(); append({ kind: 'thinking' }); break
      case 'text': textBuffer += ev.text ?? ''; scheduleTextFlush(); break
      case 'tool_call': flushTextBuffer(); append({ kind: 'tool', callId: ev.call?.id, name: ev.call?.name, args: JSON.stringify(ev.call?.args ?? {}, null, 2), status: 'running' }); break
      case 'approval_request': flushTextBuffer(); set({ pendingApproval: { callId: ev.callId ?? '', command: ev.command ?? '', cwd: ev.cwd ?? '', target: ev.target ?? '', reason: ev.reason ?? '' } }); break
      case 'tool_result': updateTool(ev.callId ?? '', { status: ev.ok ? 'ok' : 'error', summary: ev.summary ?? '', result: ev.output ?? '' }); break
      case 'done': flushTextBuffer(); set({ running: false, currentRunId: null, pendingApproval: null, history: ev.history ?? get().history }); saveCurrentSession(); break
      case 'error': flushTextBuffer(); append({ kind: 'error', message: ev.message ?? '未知错误' }); set({ running: false, currentRunId: null, pendingApproval: null, history: ev.history ?? get().history }); saveCurrentSession(); break
    }
  }
  return {
    initialized: false,
    workdir: '',
    running: false,
    currentRunId: null,
    currentTask: '',
    currentModelId: '',
    currentSessionId: '',
    draftTask: '',
    steps: [],
    history: [],
    sessions: [],
    activeSessionId: null,
    pendingApproval: null,
    error: null,
    init: () => {
      if (get().initialized) return
      window.api.agent.onChunk(handleEvent)
      const settings = useSettingsStore.getState().settings
      set({ initialized: true, workdir: settings?.agentWorkdir ?? '' })
      void window.api.agent.listSessions().then(sessions => set({ sessions }))
    },
    start: async (task) => {
      const t = task.trim()
      if (!t || get().running) return
      const ss = useSettingsStore.getState()
      const providerId = ss.settings?.defaultProviderId ?? 'deepseek'
      const modelId = ss.settings?.defaultModelId ?? 'deepseek-v4-pro'
      const provider = ss.providers.find(p => p.id === providerId)
      if (!provider || !provider.apiKey) {
        set({ error: '请先在「设置 → 模型服务」中配置 API Key' })
        return
      }
      let sessionId = get().currentSessionId
      if (!sessionId) sessionId = 'sess-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
      const runId = 'agent-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
      const prevSteps = get().steps
      const prevHistory = get().history
      const title = get().currentTask || t
      set({ running: true, currentRunId: runId, currentTask: title, currentModelId: modelId, currentSessionId: sessionId, activeSessionId: sessionId, error: null, steps: [...prevSteps, { kind: 'task', text: t }], pendingApproval: null })
      const memories = await window.api.memories.search({ query: [t, get().workdir].filter(Boolean).join(' '), scopes: ['user', 'project', 'agent'], limit: 8 })
      const memoryContext = formatMemoryContext(memories)
      const res = await window.api.agent.start({ runId, providerId, modelId, workdir: get().workdir, task: t, temperature: ss.settings?.temperature ?? 1, history: prevHistory, memoryContext })
      if (!res.ok) {
        append({ kind: 'error', message: res.message ?? '启动失败' })
        set({ running: false, currentRunId: null })
      }
    },
    stop: () => {
      const id = get().currentRunId
      if (id) void window.api.agent.cancel(id)
    },
    approve: (approved) => {
      const p = get().pendingApproval
      if (!p) return
      void window.api.agent.approve(p.callId, approved)
      set({ pendingApproval: null })
    },
    pickDirectory: async () => {
      const dir = await window.api.agent.pickDirectory()
      if (dir) {
        set({ workdir: dir })
        await useSettingsStore.getState().updateSettings({ agentWorkdir: dir })
      }
    },
    loadSession: (id) => {
      const s = get().sessions.find(x => x.id === id)
      if (!s) return
      set({ steps: s.steps, currentTask: s.task, currentModelId: s.modelId, workdir: s.workdir, history: s.history ?? [], currentSessionId: id, activeSessionId: id, running: false, currentRunId: null, pendingApproval: null, error: null })
    },
    deleteSession: async (id) => {
      await window.api.agent.deleteSession(id)
      set({ sessions: get().sessions.filter(x => x.id !== id) })
    },
    renameSession: async (id, title) => {
      const t = title.trim()
      if (!t) return
      await window.api.agent.renameSession(id, t)
      set({ sessions: get().sessions.map(s => (s.id === id ? { ...s, task: t } : s)) })
    },
    updateStep: (index, patch) => {
      set(s => ({ steps: s.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step) }))
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
      set({ steps: steps.slice(0, taskIndex), history: [] })
      await get().start(task)
    },
    setDraftTask: (task) => {
      set({ draftTask: task })
    },
    clear: () => {
      if (get().running) get().stop()
      set({ steps: [], history: [], error: null, pendingApproval: null, currentTask: '', currentSessionId: '', activeSessionId: null })
    }
  }
})
