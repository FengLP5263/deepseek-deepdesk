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
import { closeConnectorAuthSessionsForTest, getConnectorActivityFeed, getConnectorAuthStatus, sendConnectorMessage, startConnectorAuth } from '../src/main/connectors'

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

describe('connectors activity feed', () => {
  it('从接入服务拉取微信消息并写入本地活动流', async () => {
    const seen: Array<{ url: string; authorization?: string }> = []
    const server = await listen((req, res) => {
      seen.push({ url: req.url ?? '', authorization: req.headers.authorization })
      if (req.url === '/connectors/wechat/events?limit=20') {
        sendJson(res, {
          events: [{
            id: 'wx-msg-1',
            text: '请帮我总结这个文件',
            fromName: '王小明',
            fromId: 'wx-user-1',
            chatId: 'wx-room-1',
            chatName: '项目群',
            createdAt: 10
          }]
        })
        return
      }
      res.writeHead(404)
      res.end()
    })
    try {
      const store = createStore()
      await store.init()
      store.upsertConnectorConfig({ id: 'wechat', enabled: true, endpoint: server.baseUrl, token: 'token-1' })

      const feed = await getConnectorActivityFeed(store, 'wechat')
      expect(feed.items).toHaveLength(1)
      expect(feed.items[0]).toMatchObject({
        id: 'wx-msg-1',
        connectorId: 'wechat',
        sourceName: '王小明',
        conversationName: '项目群',
        threadId: 'wx-room-1',
        text: '请帮我总结这个文件',
        status: 'new'
      })
      expect(store.listConnectorActivities('wechat')[0].id).toBe('wx-msg-1')
      const session = store.getSnapshot().agentSessions.find(item => item.id === 'connector-wechat-wx-room-1')
      expect(session?.task).toBe('项目群')
      expect(session?.source).toMatchObject({ type: 'connector', connectorId: 'wechat', externalThreadId: 'wx-room-1' })
      expect(session?.steps[0]).toMatchObject({ kind: 'task', text: '请帮我总结这个文件', sourceActivityId: 'wx-msg-1' })
      expect(seen).toEqual([{ url: '/connectors/wechat/events?limit=20', authorization: 'Bearer token-1' }])
    } finally {
      await server.close()
    }
  })

  it('向接入服务发送桌面端回复并记录出站活动', async () => {
    const seen: Array<{ url: string; body: string }> = []
    const server = await listen((req, res) => {
      if (req.url === '/connectors/lark/messages' && req.method === 'POST') {
        let body = ''
        req.on('data', chunk => { body += String(chunk) })
        req.on('end', () => {
          seen.push({ url: req.url ?? '', body })
          sendJson(res, { ok: true, messageId: 'lark-out-1', message: '已发送' })
        })
        return
      }
      res.writeHead(404)
      res.end()
    })
    try {
      const store = createStore()
      await store.init()
      store.upsertConnectorConfig({ id: 'lark', enabled: true, endpoint: server.baseUrl, token: 'token-1' })

      const result = await sendConnectorMessage(store, 'lark', {
        sessionId: 'connector-lark-chat-1',
        threadId: 'chat-1',
        text: '这是 DeepDesk 的回复'
      })

      expect(result.ok).toBe(true)
      expect(seen).toHaveLength(1)
      expect(JSON.parse(seen[0].body) as Record<string, unknown>).toMatchObject({
        sessionId: 'connector-lark-chat-1',
        threadId: 'chat-1',
        text: '这是 DeepDesk 的回复'
      })
      expect(store.listConnectorActivities('lark')[0]).toMatchObject({
        id: 'lark-out-1',
        direction: 'outbound',
        threadId: 'chat-1',
        text: '这是 DeepDesk 的回复',
        status: 'handled',
        taskId: 'connector-lark-chat-1'
      })
    } finally {
      await server.close()
    }
  })

  it('直连微信 iLink 时通过 getupdates 拉取手机消息并生成连接器会话', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://ilinkai.weixin.qq.com/ilink/bot/getupdates') {
        expect(init?.method).toBe('POST')
        const headers = init?.headers as Record<string, string> | undefined
        expect(headers?.['AuthorizationType']).toBe('ilink_bot_token')
        expect(JSON.parse(String(init?.body)) as Record<string, unknown>).toMatchObject({ get_updates_buf: 'cursor-1' })
        return new Response(JSON.stringify({
          ret: 0,
          get_updates_buf: 'cursor-2',
          msgs: [{
            message_type: 1,
            message_id: 'wx-in-1',
            from_user_id: 'wx-user-1',
            context_token: 'ctx-1',
            create_time_ms: 1234,
            item_list: [{ type: 1, text_item: { text: '手机上发来的消息' } }]
          }]
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = createStore()
    await store.init()
    store.upsertConnectorConfig({ id: 'wechat', enabled: true, endpoint: 'https://ilinkai.weixin.qq.com', token: 'bot-token-1', messageCursor: 'cursor-1' })

    const feed = await getConnectorActivityFeed(store, 'wechat')

    expect(feed.items[0]).toMatchObject({
      id: 'wx-in-1',
      connectorId: 'wechat',
      text: '手机上发来的消息',
      threadId: 'wx-user-1',
      replyToken: 'ctx-1'
    })
    expect(store.getSnapshot().connectors.find(connector => connector.id === 'wechat')?.messageCursor).toBe('cursor-2')
    expect(store.getSnapshot().agentSessions[0].source).toMatchObject({
      type: 'connector',
      connectorId: 'wechat',
      externalThreadId: 'wx-user-1',
      externalReplyToken: 'ctx-1'
    })
  })

  it('直连微信 iLink 时通过 sendmessage 携带 context_token 回复', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === 'https://ilinkai.weixin.qq.com/ilink/bot/sendmessage') {
        const body = JSON.parse(String(init?.body)) as { msg?: Record<string, unknown> }
        expect(body.msg).toMatchObject({
          to_user_id: 'wx-user-1',
          message_type: 2,
          message_state: 2,
          context_token: 'ctx-1'
        })
        expect(JSON.stringify(body)).toContain('桌面端回复')
        return new Response(JSON.stringify({ ret: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = createStore()
    await store.init()
    store.upsertConnectorConfig({ id: 'wechat', enabled: true, endpoint: 'https://ilinkai.weixin.qq.com', token: 'bot-token-1' })

    const result = await sendConnectorMessage(store, 'wechat', {
      sessionId: 'connector-wechat-wx-user-1',
      threadId: 'wx-user-1',
      replyToken: 'ctx-1',
      text: '桌面端回复'
    })

    expect(result.ok).toBe(true)
    expect(store.listConnectorActivities('wechat')[0]).toMatchObject({
      direction: 'outbound',
      threadId: 'wx-user-1',
      replyToken: 'ctx-1',
      text: '桌面端回复',
      status: 'handled'
    })
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
