import { beforeEach, describe, expect, it } from 'vitest'
import type { AgentEvent, AgentRunRequest, AgentSession } from '../src/shared/agent-types'
import type { MemoryItem } from '../src/shared/types'
import { useAgentStore } from '../src/renderer/src/stores/useAgentStore'
import { useSettingsStore } from '../src/renderer/src/stores/useSettingsStore'

let chunkCb: ((ev: AgentEvent) => void) | null = null
let saved: AgentSession[] = []
let startReqs: AgentRunRequest[] = []
let memoryResults: MemoryItem[] = []
let connectorMessages: Array<{ id: string; sessionId: string; threadId: string; text: string; replyToken?: string }> = []

beforeEach(() => {
  chunkCb = null
  saved = []
  startReqs = []
  memoryResults = []
  connectorMessages = []
  const api = {
    platform: { id: 'macos', shellName: 'zsh', nativeWindowControls: true },
    settings: {
      get: async () => ({ version: 1, defaultProviderId: 'deepseek', defaultModelId: 'deepseek-v4-pro', temperature: 1, theme: 'dark', appFont: 'default', enterToSend: true, agentWorkdir: '', agentPermissionMode: 'ask' }),
      set: async (patch: Record<string, unknown>) => ({ ...patch })
    },
    providers: { list: async () => [], upsert: async () => {}, remove: async () => {}, test: async () => ({ ok: true, message: '' }) },
    conversations: { list: async () => [], get: async () => null, upsert: async () => {}, remove: async () => {} },
    memories: {
      list: async () => memoryResults,
      upsert: async (memory: MemoryItem) => memory,
      remove: async () => {},
      search: async () => memoryResults
    },
    connectors: {
      list: async () => [],
      save: async (config: Record<string, unknown>) => ({ ...config }),
      startAuth: async () => ({ id: 'wechat', ok: false, state: 'failed', message: '' }),
      authStatus: async () => ({ id: 'wechat', ok: false, state: 'failed', message: '' }),
      connect: async () => ({ id: 'wechat', ok: true, message: '' }),
      disconnect: async () => ({ id: 'wechat', ok: true, message: '' }),
      activities: async () => ({ items: [], syncedAt: Date.now() }),
      sendMessage: async (id: string, message: { sessionId: string; threadId: string; text: string; replyToken?: string }) => {
        connectorMessages.push({ id, ...message })
        return { id, ok: true, message: '已发送' }
      }
    },
    chat: { start: async () => ({ ok: true }), cancel: async () => {}, onChunk: () => () => {} },
    agent: {
      start: async (req: AgentRunRequest) => { startReqs.push(req); return { ok: true } },
      cancel: async () => {},
      approve: async () => {},
      pickDirectory: async () => null,
      onChunk: (cb: (ev: AgentEvent) => void) => { chunkCb = cb; return () => { chunkCb = null } },
      listSessions: async () => saved,
      saveSession: async (s: AgentSession) => { const i = saved.findIndex(x => x.id === s.id); if (i >= 0) saved[i] = s; else saved.push(s) },
      deleteSession: async (id: string) => { saved = saved.filter(x => x.id !== id) },
      renameSession: async (id: string, title: string) => { const s = saved.find(x => x.id === id); if (s) s.task = title }
    },
    window: { minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {}, isMaximized: async () => false, onMaximizedChange: () => () => {} },
    openExternal: async () => {},
    appVersion: async () => '1.0.0'
  }
  ;(globalThis as unknown as { window: unknown }).window = { api, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
  useSettingsStore.setState({ loaded: true, providers: [{ id: 'deepseek', name: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: 'sk', models: [], createdAt: 0 }], settings: { version: 1, defaultProviderId: 'deepseek', defaultModelId: 'deepseek-v4-pro', temperature: 1, theme: 'dark', appFont: 'default', enterToSend: true, agentWorkdir: '', agentPermissionMode: 'ask' } })
  useAgentStore.setState({ initialized: false, workdir: '', running: false, currentRunId: null, currentTask: '', currentModelId: '', currentSessionId: '', currentSource: undefined, draftTask: '', steps: [], history: [], sessions: [], activeSessionId: null, runningSessions: {}, pendingApprovalsBySessionId: {}, pendingApproval: null, error: null })
})

describe('useAgentStore 会话持久化', () => {
  it('任务完成后自动保存会话', async () => {
    useAgentStore.getState().init()
    await useAgentStore.getState().start('写一个文件')
    expect(startReqs.length).toBe(1)
    const req = startReqs[0]
    chunkCb!({ runId: req.runId, type: 'done' })
    await new Promise(r => setTimeout(r, 80))
    expect(saved.length).toBe(1)
    expect(saved[0].task).toBe('写一个文件')
    expect(saved[0].steps[0].kind).toBe('task')
    expect(saved[0].modelId).toBe('deepseek-v4-pro')
  })

  it('启动 Agent 时携带命中的长期记忆上下文', async () => {
    memoryResults = [{
      id: 'mem-1',
      scope: 'agent',
      kind: 'procedure',
      content: '提交前先跑 pnpm flow -- check',
      tags: ['工程化'],
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
      source: { type: 'manual' }
    }]
    useAgentStore.getState().init()
    await useAgentStore.getState().start('提交代码')

    expect(startReqs[0].memoryContext).toContain('提交前先跑 pnpm flow -- check')
  })

  it('当前会话选择的模型优先于全局默认模型并随会话保存', async () => {
    useAgentStore.getState().init()
    useAgentStore.getState().setCurrentModel('glm-5.3-flash')
    await useAgentStore.getState().start('用当前模型继续')

    expect(startReqs[0].modelId).toBe('glm-5.3-flash')
    chunkCb!({ runId: startReqs[0].runId, type: 'done' })
    await new Promise(r => setTimeout(r, 80))
    expect(saved[0].modelId).toBe('glm-5.3-flash')
  })

  it('loadSession 载入历史步骤', () => {
    useAgentStore.setState({ sessions: [{ id: 's1', task: '旧任务', workdir: '/w', modelId: 'm', createdAt: 1, updatedAt: 1, steps: [{ kind: 'task', text: '旧任务' }, { kind: 'text', text: '结果' }], history: [] }] })
    useAgentStore.getState().loadSession('s1')
    const s = useAgentStore.getState()
    expect(s.steps.length).toBe(2)
    expect(s.currentTask).toBe('旧任务')
    expect(s.workdir).toBe('/w')
    expect(s.running).toBe(false)
  })

  it('loadSession 后继续对话沿用该会话保存的模型', async () => {
    useAgentStore.setState({ sessions: [{ id: 's1', task: '旧任务', workdir: '/w', modelId: 'deepseek-v4-flash', createdAt: 1, updatedAt: 1, steps: [{ kind: 'task', text: '旧任务' }], history: [] }] })
    useAgentStore.getState().loadSession('s1')
    await useAgentStore.getState().start('继续')

    expect(startReqs[0].modelId).toBe('deepseek-v4-flash')
  })

  it('连接器会话完成回复后同步回外部会话', async () => {
    const seed: AgentSession = {
      id: 'connector-wechat-room-1',
      task: '微信项目群',
      workdir: '/w',
      modelId: 'deepseek-v4-flash',
      createdAt: 1,
      updatedAt: 1,
      steps: [{ kind: 'task', text: '帮我总结今天进展', sourceActivityId: 'wx-1', sourceConnectorId: 'wechat' }],
      history: [{ role: 'user', content: '帮我总结今天进展' }],
      source: { type: 'connector', connectorId: 'wechat', externalThreadId: 'room-1', externalConversationName: '微信项目群', externalReplyToken: 'ctx-1' }
    }
    saved = [seed]
    useAgentStore.getState().init()
    useAgentStore.setState({ sessions: [seed] })
    useAgentStore.getState().loadSession(seed.id)
    await useAgentStore.getState().start('补充：只要三句话')

    chunkCb!({ runId: startReqs[0].runId, type: 'text', text: '第一句。第二句。第三句。' })
    chunkCb!({ runId: startReqs[0].runId, type: 'done', history: [{ role: 'assistant', content: '第一句。第二句。第三句。' }] })
    await new Promise(r => setTimeout(r, 90))

    expect(connectorMessages).toEqual([{
      id: 'wechat',
      sessionId: 'connector-wechat-room-1',
      threadId: 'room-1',
      text: '第一句。第二句。第三句。',
      replyToken: 'ctx-1'
    }])
  })

  it('自动处理待回复的连接器会话并避免重复追加同一条入站消息', async () => {
    const seed: AgentSession = {
      id: 'connector-wechat-room-2',
      task: '微信待回复会话',
      workdir: '/w',
      modelId: 'deepseek-v4-flash',
      createdAt: 1,
      updatedAt: 10,
      steps: [{ kind: 'task', text: '手机消息：现在状态如何', sourceActivityId: 'wx-2', sourceConnectorId: 'wechat' }],
      history: [{ role: 'user', content: '手机消息：现在状态如何' }],
      source: { type: 'connector', connectorId: 'wechat', externalThreadId: 'room-2', externalReplyToken: 'ctx-2' }
    }
    saved = [seed]
    useAgentStore.getState().init()
    await useAgentStore.getState().processPendingConnectorSession()

    expect(startReqs).toHaveLength(1)
    expect(startReqs[0].task).toBe('手机消息：现在状态如何')
    expect(useAgentStore.getState().activeSessionId).toBe(null)
    expect(useAgentStore.getState().runningSessions['connector-wechat-room-2']).toBe(startReqs[0].runId)
    useAgentStore.getState().loadSession('connector-wechat-room-2')
    expect(useAgentStore.getState().steps.filter(step => step.kind === 'task')).toHaveLength(1)
  })

  it('桌面会话运行中仍可后台启动连接器会话回复', async () => {
    const connectorSession: AgentSession = {
      id: 'connector-wechat-room-3',
      task: '微信待回复会话',
      workdir: '/w',
      modelId: 'deepseek-v4-flash',
      createdAt: 1,
      updatedAt: 10,
      steps: [{ kind: 'task', text: '手机消息：帮我看状态', sourceActivityId: 'wx-3', sourceConnectorId: 'wechat' }],
      history: [{ role: 'user', content: '手机消息：帮我看状态' }],
      source: { type: 'connector', connectorId: 'wechat', externalThreadId: 'room-3', externalReplyToken: 'ctx-3' }
    }
    saved = [connectorSession]
    useAgentStore.getState().init()
    await useAgentStore.getState().start('桌面长任务')
    const desktopRunId = startReqs[0].runId

    await useAgentStore.getState().processPendingConnectorSession()

    expect(startReqs).toHaveLength(2)
    expect(startReqs[0].task).toBe('桌面长任务')
    expect(startReqs[1].task).toBe('手机消息：帮我看状态')
    expect(useAgentStore.getState().running).toBe(true)
    expect(useAgentStore.getState().currentRunId).toBe(desktopRunId)
    expect(useAgentStore.getState().runningSessions['connector-wechat-room-3']).toBe(startReqs[1].runId)
  })

  it('多会话并发时按 runId 分流消息并分别保存', async () => {
    const connectorSession: AgentSession = {
      id: 'connector-wechat-room-4',
      task: '微信并发会话',
      workdir: '/w',
      modelId: 'deepseek-v4-flash',
      createdAt: 1,
      updatedAt: 10,
      steps: [{ kind: 'task', text: '手机消息：给我一句话', sourceActivityId: 'wx-4', sourceConnectorId: 'wechat' }],
      history: [{ role: 'user', content: '手机消息：给我一句话' }],
      source: { type: 'connector', connectorId: 'wechat', externalThreadId: 'room-4', externalReplyToken: 'ctx-4' }
    }
    saved = [connectorSession]
    useAgentStore.getState().init()
    await useAgentStore.getState().start('桌面问题')
    await useAgentStore.getState().processPendingConnectorSession()
    const desktopRunId = startReqs[0].runId
    const connectorRunId = startReqs[1].runId

    chunkCb!({ runId: connectorRunId, type: 'text', text: '微信回复' })
    chunkCb!({ runId: desktopRunId, type: 'text', text: '桌面回复' })
    chunkCb!({ runId: connectorRunId, type: 'done', history: [{ role: 'assistant', content: '微信回复' }] })
    chunkCb!({ runId: desktopRunId, type: 'done', history: [{ role: 'assistant', content: '桌面回复' }] })
    await new Promise(r => setTimeout(r, 90))

    const desktop = saved.find(session => session.task === '桌面问题')
    const connector = saved.find(session => session.id === 'connector-wechat-room-4')
    expect(desktop?.steps.some(step => step.kind === 'text' && step.text === '桌面回复')).toBe(true)
    expect(desktop?.steps.some(step => step.kind === 'text' && step.text === '微信回复')).toBe(false)
    expect(connector?.steps.some(step => step.kind === 'text' && step.text === '微信回复')).toBe(true)
    expect(connectorMessages).toContainEqual({
      id: 'wechat',
      sessionId: 'connector-wechat-room-4',
      threadId: 'room-4',
      text: '微信回复',
      replyToken: 'ctx-4'
    })
  })

  it('多轮持续对话：追加步骤、同一会话、携带历史', async () => {
    useAgentStore.getState().init()
    await useAgentStore.getState().start('第一问')
    const req1 = startReqs[0]
    chunkCb!({ runId: req1.runId, type: 'text', text: '回答一' })
    chunkCb!({ runId: req1.runId, type: 'done', history: [{ role: 'user', content: '第一问' }, { role: 'assistant', content: '回答一' }] })
    await new Promise(r => setTimeout(r, 60))
    await useAgentStore.getState().start('第二问')
    const req2 = startReqs[1]
    const tasks = useAgentStore.getState().steps.filter(x => x.kind === 'task').map(x => x.text)
    expect(tasks).toEqual(['第一问', '第二问'])
    expect(req2.history && req2.history.length).toBeGreaterThan(0)
    expect(JSON.stringify(req2.history)).toContain('第一问')
    chunkCb!({ runId: req2.runId, type: 'text', text: '回答二' })
    chunkCb!({ runId: req2.runId, type: 'done', history: [{ role: 'user', content: '第一问' }, { role: 'assistant', content: '回答一' }, { role: 'user', content: '第二问' }, { role: 'assistant', content: '回答二' }] })
    await new Promise(r => setTimeout(r, 60))
    expect(saved.length).toBe(1)
    expect(saved[0].steps.filter(x => x.kind === 'task').length).toBe(2)
  })

  it('renameSession 重命名会话', async () => {
    const seed = { id: 's1', task: '旧标题', workdir: '', modelId: 'm', createdAt: 1, updatedAt: 1, steps: [], history: [] }
    saved = [seed]
    useAgentStore.setState({ sessions: [seed] })
    await useAgentStore.getState().renameSession('s1', '新标题')
    expect(useAgentStore.getState().sessions[0].task).toBe('新标题')
    expect(saved[0].task).toBe('新标题')
  })

  it('deleteSession 删除历史', async () => {
    useAgentStore.setState({ sessions: [{ id: 's1', task: 't', workdir: '', modelId: 'm', createdAt: 1, updatedAt: 1, steps: [], history: [] }] })
    await useAgentStore.getState().deleteSession('s1')
    expect(useAgentStore.getState().sessions.length).toBe(0)
    expect(saved.length).toBe(0)
  })

  it('deleteSession 删除当前会话时清空当前状态', async () => {
    const seed = { id: 's1', task: 't', workdir: '', modelId: 'm', createdAt: 1, updatedAt: 1, steps: [{ kind: 'task' as const, text: 't' }], history: [] }
    saved = [seed]
    useAgentStore.setState({ sessions: [seed], activeSessionId: 's1', currentSessionId: 's1', currentTask: 't', currentModelId: 'm', steps: seed.steps, history: [] })
    await useAgentStore.getState().deleteSession('s1')
    const state = useAgentStore.getState()

    expect(state.sessions.length).toBe(0)
    expect(state.currentSessionId).toBe('')
    expect(state.currentTask).toBe('')
    expect(state.currentModelId).toBe('')
    expect(state.steps.length).toBe(0)
  })
})
