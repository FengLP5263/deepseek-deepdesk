import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    expect(snap.settings.appFontScale).toBe(1)
    expect(snap.providers.find(p => p.id === 'deepseek')?.models.map(m => m.id).sort()).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
    expect(snap.providers.find(p => p.id === 'deepseek')?.models.every(m => m.contextWindow === 256000)).toBe(true)
    expect(snap.conversations).toEqual([])
    expect(snap.memories).toEqual([])
    expect(snap.connectorActivities).toEqual([])
    expect(snap.mcpServers).toEqual([])
  })

  it('设置持久化并可重新加载', async () => {
    const store = createStore()
    await store.init()
    store.updateSettings({ defaultModelId: 'deepseek-v4-pro', temperature: 0.5, appFont: 'system', appFontScale: 1.3 })
    await store.flush()
    const store2 = createStore()
    await store2.init()
    expect(store2.getSnapshot().settings.defaultModelId).toBe('deepseek-v4-pro')
    expect(store2.getSnapshot().settings.temperature).toBe(0.5)
    expect(store2.getSnapshot().settings.appFont).toBe('system')
    expect(store2.getSnapshot().settings.appFontScale).toBe(1.3)
  })

  it('主存储损坏时从原子写临时文件恢复并重建主文件', async () => {
    writeFileSync(join(dir, 'deepdesk.json'), '{bad json', 'utf8')
    writeFileSync(join(dir, 'deepdesk.json.tmp'), JSON.stringify({
      settings: { version: 1, theme: 'light', defaultProviderId: 'deepseek', defaultModelId: 'deepseek-v4-flash' },
      providers: [],
      conversations: [],
      agentSessions: [],
      memories: []
    }), 'utf8')

    const store = createStore()
    await store.init()

    expect(store.getSnapshot().settings.theme).toBe('light')
    expect(() => JSON.parse(readFileSync(join(dir, 'deepdesk.json'), 'utf8'))).not.toThrow()
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

  it('MCP 服务器配置可持久化、更新并删除', async () => {
    const store = createStore()
    await store.init()
    store.upsertMcpServer({
      id: 'filesystem', name: '文件工具', transport: 'stdio', enabled: true,
      command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'], env: { TEST_KEY: 'value' }, cwd: dir,
      url: '', token: '', headers: {}, createdAt: 1, updatedAt: 1
    })
    await store.flush()

    const store2 = createStore()
    await store2.init()
    expect(store2.getSnapshot().mcpServers[0]).toEqual(expect.objectContaining({
      id: 'filesystem', name: '文件工具', enabled: true, command: 'npx', env: { TEST_KEY: 'value' }
    }))

    const current = store2.getSnapshot().mcpServers[0]
    store2.upsertMcpServer({ ...current, enabled: false, name: '文件系统工具' })
    expect(store2.getSnapshot().mcpServers[0]).toEqual(expect.objectContaining({ enabled: false, name: '文件系统工具' }))
    store2.deleteMcpServer('filesystem')
    expect(store2.getSnapshot().mcpServers).toEqual([])
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
    store.upsertAgentSession({ id: 's1', task: '任务', workdir: dir, modelId: 'deepseek-v4-pro', createdAt: 1, updatedAt: 1, steps: [{ kind: 'task', text: '任务' }], history: [], hasUnread: true })
    expect(store.getSnapshot().agentSessions.length).toBe(1)
    expect(store.getSnapshot().agentSessions[0].task).toBe('任务')
    expect(store.getSnapshot().agentSessions[0].hasUnread).toBe(true)
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

  it('自动捕获显式记忆并去重', async () => {
    const store = new AppStore(dir)
    stores.push(store)
    await store.init()

    const first = store.captureMemories({ text: '帮我记一下：我喜欢先给结论', source: { type: 'agent', id: 's1' } })
    const second = store.captureMemories({ text: '请记住，我喜欢先给结论。', source: { type: 'agent', id: 's2' } })

    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ scope: 'user', kind: 'preference', content: '我喜欢先给结论' })
    expect(second[0].id).toBe(first[0].id)
    expect(store.listMemories()).toHaveLength(1)
  })

  it('相似偏好合并，冲突偏好用最新明确表达更新', async () => {
    const store = createStore()
    await store.init()
    store.captureMemories({ text: '帮我记住：我喜欢回答先给结论再解释', source: { type: 'agent', id: 's1' } })
    store.captureMemories({ text: '请记住，以后回答请先给结论，然后再解释', source: { type: 'agent', id: 's2' } })
    store.captureMemories({ text: '帮我记住：我不喜欢回答先给结论再解释', source: { type: 'agent', id: 's3' } })

    expect(store.listMemories()).toEqual([expect.objectContaining({ content: '我不喜欢回答先给结论再解释', tags: expect.arrayContaining(['已更新']) })])
  })

  it('启动时从已有 Agent 会话回填高置信长期记忆', async () => {
    const first = new AppStore(dir)
    stores.push(first)
    await first.init()
    first.upsertAgentSession({
      id: 'history-session',
      task: '历史会话',
      workdir: '',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      createdAt: 1,
      updatedAt: 1,
      steps: [{ kind: 'task', text: '以后请默认先给结论，再补充细节' }],
      history: []
    })
    await first.flush()

    const reopened = new AppStore(dir)
    stores.push(reopened)
    await reopened.init()

    expect(reopened.listMemories()).toEqual([expect.objectContaining({
      scope: 'user',
      kind: 'preference',
      content: '以后请默认先给结论，再补充细节'
    })])
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
    expect(ds.models.every(m => m.contextWindow === 256000)).toBe(true)
  })

  it('本地旧数据中 DeepSeek 128K 上下文窗口会升级到 256K', async () => {
    writeFileSync(join(dir, 'deepdesk.json'), JSON.stringify({
      settings: { version: 1, defaultProviderId: 'deepseek', defaultModelId: 'deepseek-v4-flash', temperature: 1, theme: 'dark', enterToSend: true },
      providers: [{
        id: 'deepseek', name: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: 'sk-keep-me', isBuiltIn: true, createdAt: 0,
        models: [{ id: 'deepseek-v4-flash', contextWindow: 128000 }, { id: 'deepseek-v4-pro', contextWindow: 128000 }]
      }],
      conversations: [],
      agentSessions: [],
      memories: []
    }))
    const store = createStore()
    await store.init()
    const ds = store.getSnapshot().providers.find(p => p.id === 'deepseek')!
    expect(ds.models.map(m => m.contextWindow)).toEqual([256000, 256000])
  })

  it('迁移旧服务时补齐兼容协议并保留原生协议', async () => {
    writeFileSync(join(dir, 'deepdesk.json'), JSON.stringify({
      settings: { version: 1, defaultProviderId: 'legacy', defaultModelId: 'legacy-model', temperature: 1, theme: 'dark', enterToSend: true },
      providers: [
        { id: 'legacy', name: 'Legacy', baseUrl: 'https://legacy.invalid/v1', apiKey: '', models: [{ id: 'legacy-model' }], createdAt: 1 },
        { id: 'claude', name: 'Claude', type: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: '', models: [{ id: 'claude-test' }], createdAt: 2 },
        { id: 'openai', name: 'OpenAI', type: 'openai-responses', baseUrl: 'https://api.openai.com/v1', apiKey: '', models: [{ id: 'gpt-test' }], createdAt: 3 }
      ],
      conversations: [],
      agentSessions: [],
      memories: []
    }))
    const store = createStore()
    await store.init()
    const providers = store.getSnapshot().providers
    expect(providers.find(provider => provider.id === 'legacy')?.type).toBe('openai')
    expect(providers.find(provider => provider.id === 'claude')?.type).toBe('anthropic')
    expect(providers.find(provider => provider.id === 'openai')?.type).toBe('openai-responses')
  })
})
