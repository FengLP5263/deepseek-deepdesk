import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'deepdesk-app') }
}))

import { AppStore } from '../src/main/store'

let dir: string
let stores: AppStore[]
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'deepdesk-test-'))
  stores = []
})
afterEach(async () => {
  await Promise.all(stores.map(store => store.flush()))
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
})

function createStore(): AppStore {
  const store = new AppStore(dir)
  stores.push(store)
  return store
}

describe('AppStore', () => {
  it('首次启动内置 DeepSeek 与默认模型', async () => {
    const store = createStore()
    await store.init()
    const snap = store.getSnapshot()
    expect(snap.providers.find(p => p.id === 'deepseek')).toBeTruthy()
    expect(snap.settings.defaultModelId).toBe('deepseek-v4-flash')
    expect(snap.settings.appFont).toBe('default')
    expect(snap.providers.find(p => p.id === 'deepseek')?.models.map(m => m.id).sort()).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
    expect(snap.conversations).toEqual([])
    expect(snap.memories).toEqual([])
    expect(snap.connectorActivities).toEqual([])
  })

  it('设置持久化并可重新加载', async () => {
    const store = createStore()
    await store.init()
    store.updateSettings({ defaultModelId: 'deepseek-v4-pro', temperature: 0.5, appFont: 'system' })
    await store.flush()
    const store2 = createStore()
    await store2.init()
    expect(store2.getSnapshot().settings.defaultModelId).toBe('deepseek-v4-pro')
    expect(store2.getSnapshot().settings.temperature).toBe(0.5)
    expect(store2.getSnapshot().settings.appFont).toBe('system')
  })

  it('upsert / delete 提供商', async () => {
    const store = createStore()
    await store.init()
    store.upsertProvider({ id: 'x', name: 'X', type: 'openai', baseUrl: 'https://x.com', apiKey: 'k', models: [], createdAt: 1 })
    expect(store.getSnapshot().providers.some(p => p.id === 'x')).toBe(true)
    store.deleteProvider('x')
    expect(store.getSnapshot().providers.some(p => p.id === 'x')).toBe(false)
  })

  it('连接器配置持久化并可禁用', async () => {
    const store = createStore()
    await store.init()
    store.upsertConnectorConfig({ id: 'wechat', endpoint: 'http://127.0.0.1:3210', token: 'token', enabled: true })
    await store.flush()

    const store2 = createStore()
    await store2.init()
    const wechat = store2.getSnapshot().connectors.find(connector => connector.id === 'wechat')
    expect(wechat?.endpoint).toBe('http://127.0.0.1:3210')
    expect(wechat?.token).toBe('token')
    expect(wechat?.enabled).toBe(true)

    store2.upsertConnectorConfig({ id: 'wechat', enabled: false })
    expect(store2.getSnapshot().connectors.find(connector => connector.id === 'wechat')?.enabled).toBe(false)
  })

  it('连接器活动消息持久化并按时间倒序读取', async () => {
    const store = createStore()
    await store.init()
    store.upsertConnectorActivities([
      { id: 'msg-1', connectorId: 'wechat', direction: 'inbound', sourceName: '张三', sourceId: 'u1', text: '你好', createdAt: 1, status: 'new' },
      { id: 'msg-2', connectorId: 'lark', direction: 'inbound', sourceName: '李四', sourceId: 'u2', text: '收到', createdAt: 2, status: 'handled' }
    ])
    await store.flush()

    const store2 = createStore()
    await store2.init()
    expect(store2.listConnectorActivities().map(item => item.id)).toEqual(['msg-2', 'msg-1'])
    expect(store2.listConnectorActivities('wechat').map(item => item.text)).toEqual(['你好'])
  })

  it('会话增删查', async () => {
    const store = createStore()
    await store.init()
    store.upsertConversation({ id: 'c1', title: 't', createdAt: 1, updatedAt: 1, providerId: 'deepseek', modelId: 'deepseek-chat', temperature: 1, messages: [] })
    expect(store.getConversation('c1')?.title).toBe('t')
    store.deleteConversation('c1')
    expect(store.getConversation('c1')).toBeNull()
  })

  it('Agent 会话增删', async () => {
    const store = createStore()
    await store.init()
    store.upsertAgentSession({ id: 's1', task: '任务', workdir: dir, modelId: 'deepseek-v4-pro', createdAt: 1, updatedAt: 1, steps: [{ kind: 'task', text: '任务' }], history: [] })
    expect(store.getSnapshot().agentSessions.length).toBe(1)
    expect(store.getSnapshot().agentSessions[0].task).toBe('任务')
    store.deleteAgentSession('s1')
    expect(store.getSnapshot().agentSessions.length).toBe(0)
  })

  it('记忆增删查与持久化', async () => {
    const store = createStore()
    await store.init()
    store.upsertMemory({ id: 'm1', scope: 'user', kind: 'preference', content: '用户喜欢先给结论', tags: ['沟通'], enabled: true, createdAt: 1, updatedAt: 1, source: { type: 'manual' } })
    expect(store.searchMemories({ query: '结论', scopes: ['user'], limit: 3 }).map(memory => memory.id)).toEqual(['m1'])
    await store.flush()

    const store2 = createStore()
    await store2.init()
    expect(store2.listMemories()[0].content).toBe('用户喜欢先给结论')
    store2.deleteMemory('m1')
    expect(store2.listMemories()).toEqual([])
  })

  it('删除默认提供商后回退到首个', async () => {
    const store = createStore()
    await store.init()
    store.deleteProvider('deepseek')
    const snap = store.getSnapshot()
    expect(snap.settings.defaultProviderId).not.toBe('deepseek')
    expect(snap.settings.defaultProviderId).toBe(snap.providers[0].id)
  })

  it('将旧模型代码迁移到 V4（保留 API Key 与会话）', async () => {
    writeFileSync(join(dir, 'deepdesk.json'), JSON.stringify({
      settings: { version: 1, defaultProviderId: 'deepseek', defaultModelId: 'deepseek-reasoner', temperature: 1, theme: 'dark', enterToSend: true },
      providers: [{
        id: 'deepseek', name: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: 'sk-keep-me', isBuiltIn: true, createdAt: 0,
        models: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }]
      }],
      conversations: [{ id: 'c1', title: 't', createdAt: 1, updatedAt: 1, providerId: 'deepseek', modelId: 'deepseek-reasoner', temperature: 1, messages: [] }]
    }))
    const store = createStore()
    await store.init()
    const snap = store.getSnapshot()
    const ds = snap.providers.find(p => p.id === 'deepseek')!
    expect(ds.apiKey).toBe('sk-keep-me')
    expect(ds.models.map(m => m.id).sort()).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
    expect(snap.settings.defaultModelId).toBe('deepseek-v4-pro')
    expect(snap.conversations[0].modelId).toBe('deepseek-v4-pro')
    expect(snap.memories).toEqual([])
  })

  it('本地旧数据中 DeepSeek 模型列表为空时自动补回内置模型', async () => {
    writeFileSync(join(dir, 'deepdesk.json'), JSON.stringify({
      settings: { version: 1, defaultProviderId: 'deepseek', defaultModelId: 'deepseek-v4-flash', temperature: 1, theme: 'dark', enterToSend: true },
      providers: [{
        id: 'deepseek', name: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: 'sk-keep-me', isBuiltIn: true, createdAt: 0,
        models: []
      }],
      conversations: [],
      agentSessions: [],
      memories: []
    }))
    const store = createStore()
    await store.init()
    const ds = store.getSnapshot().providers.find(p => p.id === 'deepseek')!
    expect(ds.apiKey).toBe('sk-keep-me')
    expect(ds.models.map(m => m.id).sort()).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
  })
})
