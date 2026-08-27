import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface MockRegisterAppOptions {
  onQRCodeReady: (info: { url: string; expireIn: number }) => void
  onStatusChange?: (info: { status: string; interval?: number }) => void
}

const registerAppMock = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'deepdesk-app') }
}))

vi.mock('@larksuiteoapi/node-sdk', () => ({
  registerApp: registerAppMock
}))

import { AppStore } from '../src/main/store'
import { closeConnectorAuthSessionsForTest, getConnectorAuthStatus, startConnectorAuth } from '../src/main/connectors'

let dir: string
let stores: AppStore[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'deepdesk-connectors-'))
  stores = []
  registerAppMock.mockReset()
  vi.stubEnv('DEEPDESK_DISABLE_DIRECT_CONNECTORS', '1')
})

afterEach(async () => {
  closeConnectorAuthSessionsForTest()
  await Promise.all(stores.map(store => store.flush()))
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function createStore(): AppStore {
  const store = new AppStore(dir)
  stores.push(store)
  return store
}

function sendJson(res: ServerResponse, value: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(value))
}

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createServer(handler)
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('server address unavailable')
      resolve({
        baseUrl: 'http://127.0.0.1:' + address.port,
        close: () => new Promise<void>(done => server.close(() => done()))
      })
    })
  })
}

describe('connectors auth gateway', () => {
  it('缺少接入服务时不会生成二维码', async () => {
    const store = createStore()
    await store.init()
    const session = await startConnectorAuth(store, 'wechat')
    expect(session.ok).toBe(false)
    expect(session.message).toContain('请先配置微信接入服务')
  })

  it('通过接入服务获取二维码并在授权成功后启用连接器', async () => {
    const seen: string[] = []
    const server = await listen((req, res) => {
      seen.push(req.url ?? '')
      if (req.url === '/connectors/wechat/auth/start') {
        sendJson(res, {
          sessionId: 'sess-1',
          qrUrl: 'https://connect.deepdesk.test/wechat/sess-1',
          message: '请使用微信扫码'
        })
        return
      }
      if (req.url === '/connectors/wechat/auth/status?sessionId=sess-1') {
        sendJson(res, { state: 'connected', message: '已完成接入' })
        return
      }
      res.writeHead(404)
      res.end()
    })
    try {
      const store = createStore()
      await store.init()
      store.upsertConnectorConfig({ id: 'wechat', endpoint: server.baseUrl, token: 'test-token' })

      const session = await startConnectorAuth(store, 'wechat')
      expect(session.ok).toBe(true)
      expect(session.sessionId).toBe('sess-1')
      expect(session.qrDataUrl).toMatch(/^data:image\/png;base64,/)

      const status = await getConnectorAuthStatus(store, 'wechat', 'sess-1')
      expect(status.state).toBe('connected')
      expect(store.getSnapshot().connectors.find(connector => connector.id === 'wechat')?.enabled).toBe(true)
      expect(seen).toEqual(['/connectors/wechat/auth/start', '/connectors/wechat/auth/status?sessionId=sess-1'])
    } finally {
      await server.close()
    }
  })
})

describe('connectors direct auth', () => {
  it('通过微信 iLink 服务生成二维码并在确认后保存连接信息', async () => {
    vi.stubEnv('DEEPDESK_DISABLE_DIRECT_CONNECTORS', '0')
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/ilink/bot/get_bot_qrcode')) {
        return new Response(JSON.stringify({
          qrcode: 'qr-session-1',
          qrcode_img_content: 'https://weixin.qq.com/q/deepdesk-test'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (url.includes('/ilink/bot/get_qrcode_status')) {
        return new Response(JSON.stringify({
          status: 'confirmed',
          bot_token: 'bot-token-1',
          ilink_bot_id: 'bot-account-1',
          baseurl: 'https://ilink-runtime.example.com',
          ilink_user_id: 'user-1'
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const store = createStore()
    await store.init()

    const session = await startConnectorAuth(store, 'wechat')
    expect(session.ok).toBe(true)
    expect(session.sessionId).toBeTruthy()
    expect(session.qrDataUrl).toMatch(/^data:image\/png;base64,/)

    const status = await getConnectorAuthStatus(store, 'wechat', session.sessionId!)
    const config = store.getSnapshot().connectors.find(connector => connector.id === 'wechat')
    expect(status.state).toBe('connected')
    expect(config?.enabled).toBe(true)
    expect(config?.token).toBe('bot-token-1')
    expect(config?.accountId).toBe('bot-account-1')
    expect(config?.endpoint).toBe('https://ilink-runtime.example.com')
  })

  it('通过飞书官方 SDK 生成可扫码二维码并保存应用凭据', async () => {
    vi.stubEnv('DEEPDESK_DISABLE_DIRECT_CONNECTORS', '0')
    registerAppMock.mockImplementation(async (options: unknown) => {
      const typedOptions = options as MockRegisterAppOptions
      typedOptions.onQRCodeReady({
        url: 'https://accounts.feishu.cn/open-apis/authen/device?user_code=DEEPDESK',
        expireIn: 300
      })
      typedOptions.onStatusChange?.({ status: 'polling' })
      return {
        client_id: 'cli_deepdesk_test',
        client_secret: 'secret',
        user_info: { open_id: 'ou_deepdesk_user' }
      }
    })
    const store = createStore()
    await store.init()

    const session = await startConnectorAuth(store, 'lark')
    expect(session.ok).toBe(true)
    expect(session.sessionId).toBeTruthy()
    expect(session.qrDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(session.qrUrl).toContain('https://accounts.feishu.cn/')

    await new Promise(resolve => setTimeout(resolve, 0))
    const status = await getConnectorAuthStatus(store, 'lark', session.sessionId!)
    const config = store.getSnapshot().connectors.find(connector => connector.id === 'lark')
    expect(status.state).toBe('connected')
    expect(config?.enabled).toBe(true)
    expect(config?.appId).toBe('cli_deepdesk_test')
    expect(config?.appSecret).toBe('secret')
    expect(config?.userId).toBe('ou_deepdesk_user')
  })

  it('飞书轮询状态不会被误判为已扫码', async () => {
    vi.stubEnv('DEEPDESK_DISABLE_DIRECT_CONNECTORS', '0')
    let finishRegister: (() => void) | undefined
    registerAppMock.mockImplementation(async (options: unknown) => {
      const typedOptions = options as MockRegisterAppOptions
      typedOptions.onQRCodeReady({
        url: 'https://accounts.feishu.cn/open-apis/authen/device?user_code=WAITING',
        expireIn: 300
      })
      typedOptions.onStatusChange?.({ status: 'polling' })
      await new Promise<void>(resolve => {
        finishRegister = resolve
      })
      return {
        client_id: 'cli_deepdesk_waiting',
        client_secret: 'secret-waiting',
        user_info: { open_id: 'ou_waiting' }
      }
    })
    const store = createStore()
    await store.init()

    const session = await startConnectorAuth(store, 'lark')
    expect(session.ok).toBe(true)
    expect(session.state).toBe('pending')
    expect(session.message).not.toContain('已扫码')

    const status = await getConnectorAuthStatus(store, 'lark', session.sessionId!)
    expect(status.state).toBe('pending')
    expect(status.message).not.toContain('已扫码')

    finishRegister?.()
    await vi.waitFor(() => {
      expect(store.getSnapshot().connectors.find(connector => connector.id === 'lark')?.enabled).toBe(true)
    })
  })
})
