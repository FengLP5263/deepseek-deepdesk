import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'deepdesk-app') },
  safeStorage: {}
}))

import { AppStore } from '../src/main/store'
import { mapAppStateSecrets, type SecretCodec } from '../src/main/secret-storage'
import type { AppState } from '../src/shared/types'

const codec: SecretCodec = {
  protect: value => value ? `sealed:${Buffer.from(value).toString('base64')}` : '',
  reveal: value => value.startsWith('sealed:') ? Buffer.from(value.slice(7), 'base64').toString('utf8') : value
}

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function stateWithSecrets(): AppState {
  return {
    settings: { version: 1, defaultProviderId: 'p', defaultModelId: 'm', temperature: 1, theme: 'dark', appFont: 'default', appFontScale: 1, enterToSend: true, agentWorkdir: '', agentPermissionMode: 'ask' },
    providers: [{ id: 'p', name: 'P', type: 'openai', baseUrl: 'https://example.com', apiKey: 'provider-key', models: [{ id: 'm' }], createdAt: 1 }],
    mcpServers: [{ id: 'mcp', name: 'MCP', transport: 'http', enabled: true, command: '', args: [], env: { PRIVATE_ENV: 'env-secret' }, cwd: '', url: 'https://example.com/mcp', token: 'mcp-token', headers: { 'X-Secret': 'header-secret' }, createdAt: 1, updatedAt: 1 }],
    connectors: [{ id: 'wechat', enabled: true, endpoint: 'https://example.com', token: 'connector-token', refreshToken: 'refresh-token', messageCursor: '', accountId: '', userId: '', expiresAt: 0, appId: 'app-id', appSecret: 'app-secret', verificationToken: 'verify-token', encryptKey: 'encrypt-key', updatedAt: 1 }],
    connectorActivities: [{ id: 'a', connectorId: 'wechat', direction: 'inbound', sourceName: '用户', sourceId: 'u', text: '消息', replyToken: 'activity-reply', createdAt: 1, status: 'new' }],
    conversations: [],
    agentSessions: [{ id: 's', task: '任务', workdir: '', providerId: 'p', modelId: 'm', createdAt: 1, updatedAt: 1, steps: [], history: [], source: { type: 'connector', connectorId: 'wechat', externalThreadId: 't', externalReplyToken: 'session-reply' } }],
    memories: []
  }
}

describe('系统安全存储映射', () => {
  it('加密所有凭据字段并可无损恢复运行时状态', () => {
    const state = stateWithSecrets()
    const protectedState = mapAppStateSecrets(state, codec, 'protect')
    const serialized = JSON.stringify(protectedState)

    for (const secret of ['provider-key', 'env-secret', 'mcp-token', 'header-secret', 'connector-token', 'refresh-token', 'app-secret', 'verify-token', 'encrypt-key', 'activity-reply', 'session-reply']) {
      expect(serialized).not.toContain(secret)
    }
    expect(mapAppStateSecrets(protectedState, codec, 'reveal')).toEqual(state)
  })

  it('AppStore 只在磁盘快照中保护密钥，内存 API 保持明文可用', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'deepdesk-secret-store-'))
    directories.push(directory)
    const store = new AppStore(directory, codec)
    await store.init()
    store.upsertProvider({ id: 'secure', name: 'Secure', type: 'openai', baseUrl: 'https://example.com', apiKey: 'runtime-key', models: [{ id: 'm' }], createdAt: 1 })
    await store.flush()

    expect(store.getSnapshot().providers.find(provider => provider.id === 'secure')?.apiKey).toBe('runtime-key')
    expect(readFileSync(join(directory, 'deepdesk.json'), 'utf8')).not.toContain('runtime-key')

    const reopened = new AppStore(directory, codec)
    await reopened.init()
    expect(reopened.getSnapshot().providers.find(provider => provider.id === 'secure')?.apiKey).toBe('runtime-key')
  })
})
