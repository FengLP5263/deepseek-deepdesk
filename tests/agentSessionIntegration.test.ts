import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'deepdesk-app') } }))

import { AppStore } from '../src/main/store'
import { useAgentStore } from '../src/renderer/src/stores/useAgentStore'
import { useSettingsStore } from '../src/renderer/src/stores/useSettingsStore'
import type { AgentEvent } from '../src/shared/agent-types'

let dir: string
let store: AppStore
let chunkCb: ((ev: AgentEvent) => void) | null = null

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'agent-e2e-'))
  store = new AppStore(dir)
  await store.init()
  chunkCb = null
  // 用真实 AppStore 的方法作为 window.api.agent 的实现，走真实持久化链路
  const api = {
    platform: { id: 'macos', shellName: 'zsh', nativeWindowControls: true },
    settings: {
      get: async () => store.getSnapshot().settings,
      set: async (patch: Record<string, unknown>) => store.updateSettings(patch as never)
    },
    providers: { list: async () => store.getSnapshot().providers, upsert: async () => {}, remove: async () => {}, test: async () => ({ ok: true, message: '' }) },
    conversations: { list: async () => [], get: async () => null, upsert: async () => {}, remove: async () => {} },
    chat: { start: async () => ({ ok: true }), cancel: async () => {}, onChunk: () => () => {} },
    agent: {
      start: async () => ({ ok: true }),
      cancel: async () => {},
      approve: async () => {},
      pickDirectory: async () => null,
      onChunk: (cb: (ev: AgentEvent) => void) => { chunkCb = cb; return () => { chunkCb = null } },
      saveSession: async (s: never) => { store.upsertAgentSession(s) },
      listSessions: async () => store.getSnapshot().agentSessions,
      deleteSession: async (id: string) => store.deleteAgentSession(id)
    },
    window: { minimize: async () => {}, toggleMaximize: async () => {}, close: async () => {}, isMaximized: async () => false, onMaximizedChange: () => () => {} },
    openExternal: async () => {},
    appVersion: async () => '1.0.0'
  }
  ;(globalThis as unknown as { window: unknown }).window = { api, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout }
  useSettingsStore.setState({ loaded: true, providers: [{ id: 'deepseek', name: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: 'sk', models: [], createdAt: 0 }], settings: { ...store.getSnapshot().settings } })
  useAgentStore.setState({ initialized: false, workdir: '', running: false, currentRunId: null, currentTask: '', currentModelId: '', currentSessionId: '', steps: [], sessions: [], pendingApproval: null, error: null })
})

afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('Agent 会话保存真实链路', () => {
  it('done 事件触发 -> 写入真实 store -> 重开仍可读回', async () => {
    useAgentStore.getState().init()
    await useAgentStore.getState().start('帮我写一个冒泡排序')
    chunkCb!({ runId: 'r1', type: 'text', text: '已完成' })
    chunkCb!({ runId: 'r1', type: 'done' })
    await new Promise(r => setTimeout(r, 120))
    // 1) 当前 store 内存里有
    expect(store.getSnapshot().agentSessions.length).toBe(1)
    expect(store.getSnapshot().agentSessions[0].task).toBe('帮我写一个冒泡排序')
    // 2) 重新加载 store，读回磁盘
    const store2 = new AppStore(dir)
    await store2.init()
    expect(store2.getSnapshot().agentSessions.length).toBe(1)
    expect(store2.getSnapshot().agentSessions[0].task).toBe('帮我写一个冒泡排序')
    expect(store2.getSnapshot().agentSessions[0].steps.some(x => x.kind === 'text')).toBe(true)
  })
})
