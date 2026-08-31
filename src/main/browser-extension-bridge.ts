import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { WebSocket, WebSocketServer, type RawData } from 'ws'

const BRIDGE_PORT_START = 32180
const BRIDGE_PORT_END = 32189
const REQUEST_TIMEOUT_MS = 8_000

export const BROWSER_EXTENSION_ID = 'ccocggpfjaokakneckhmjpmjelgomgck'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface ExtensionTab {
  id: number
  title: string
  url: string
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) ? value : 0
}

function extensionTab(value: unknown): ExtensionTab | null {
  const item = record(value)
  const id = numberValue(item?.id)
  if (id <= 0) return null
  return { id, title: stringValue(item?.title) || '未命名页面', url: stringValue(item?.url) }
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value))
}

export class BrowserExtensionBridge {
  private server: Server | null = null
  private webSocketServer: WebSocketServer | null = null
  private extensionSocket: WebSocket | null = null
  private port = 0
  private readonly accessToken = randomBytes(24).toString('hex')
  private requestSequence = 0
  private readonly pending = new Map<string, PendingRequest>()
  private readonly pageSockets = new Map<number, Set<WebSocket>>()

  get baseUrl(): string | null {
    return this.port > 0 ? `http://127.0.0.1:${this.port}/${this.accessToken}` : null
  }

  get connected(): boolean {
    return this.extensionSocket?.readyState === WebSocket.OPEN
  }

  async start(): Promise<void> {
    if (this.server) return
    for (let port = BRIDGE_PORT_START; port <= BRIDGE_PORT_END; port += 1) {
      if (await this.tryListen(port)) return
    }
    throw new Error(`浏览器扩展桥接端口 ${BRIDGE_PORT_START}-${BRIDGE_PORT_END} 均不可用`)
  }

  async stop(): Promise<void> {
    this.rejectPending(new Error('浏览器扩展桥接已关闭'))
    this.extensionSocket?.close()
    this.extensionSocket = null
    for (const sockets of this.pageSockets.values()) {
      for (const socket of sockets) socket.close()
    }
    this.pageSockets.clear()
    const webSocketServer = this.webSocketServer
    const server = this.server
    this.webSocketServer = null
    this.server = null
    this.port = 0
    webSocketServer?.close()
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  }

  async detachAll(): Promise<void> {
    if (!this.connected) return
    await this.requestExtension('detach-all')
  }

  private async tryListen(port: number): Promise<boolean> {
    const server = createServer((request, response) => {
      void this.handleHttp(request, response)
    })
    const webSocketServer = new WebSocketServer({ noServer: true })
    server.on('upgrade', (request, socket, head) => {
      const pathname = new URL(request.url ?? '/', `http://127.0.0.1:${port}`).pathname
      if (pathname === '/extension') {
        const expectedOrigin = `chrome-extension://${BROWSER_EXTENSION_ID}`
        if (request.headers.origin !== expectedOrigin) {
          socket.destroy()
          return
        }
        webSocketServer.handleUpgrade(request, socket, head, upgraded => this.attachExtension(upgraded))
        return
      }
      const match = pathname.match(new RegExp(`^/${this.accessToken}/devtools/page/(\\d+)$`))
      if (!match) {
        socket.destroy()
        return
      }
      const tabId = Number(match[1])
      webSocketServer.handleUpgrade(request, socket, head, upgraded => this.attachPageSocket(tabId, upgraded))
    })
    const listened = await new Promise<boolean>(resolve => {
      const onError = (): void => {
        server.off('listening', onListening)
        resolve(false)
      }
      const onListening = (): void => {
        server.off('error', onError)
        resolve(true)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    })
    if (!listened) {
      webSocketServer.close()
      return false
    }
    this.server = server
    this.webSocketServer = webSocketServer
    this.port = port
    return true
  }

  private async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', this.baseUrl ?? 'http://127.0.0.1')
    const prefix = `/${this.accessToken}`
    if (!url.pathname.startsWith(prefix + '/')) {
      writeJson(response, 404, { error: '未找到浏览器扩展接口' })
      return
    }
    const apiPath = url.pathname.slice(prefix.length)
    if (apiPath === '/json/version') {
      writeJson(response, this.connected ? 200 : 503, {
        Browser: this.connected ? 'DeepDesk Browser Extension' : 'DeepDesk Browser Extension (disconnected)'
      })
      return
    }
    if (!this.connected) {
      writeJson(response, 503, { error: '浏览器扩展尚未连接' })
      return
    }
    try {
      if (apiPath === '/json/list') {
        const result = record(await this.requestExtension('tabs'))
        const tabs = Array.isArray(result?.tabs) ? result.tabs.map(extensionTab).filter((tab): tab is ExtensionTab => tab !== null) : []
        writeJson(response, 200, tabs.map(tab => this.debugTarget(tab)))
        return
      }
      if (apiPath === '/json/new' && request.method === 'PUT') {
        const targetUrl = decodeURIComponent(url.search.slice(1))
        const result = record(await this.requestExtension('create-tab', { url: targetUrl }))
        const tab = extensionTab(result?.tab)
        if (!tab) throw new Error('扩展没有返回新标签页')
        writeJson(response, 200, this.debugTarget(tab))
        return
      }
      writeJson(response, 404, { error: '未找到浏览器扩展接口' })
    } catch (error) {
      writeJson(response, 502, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  private debugTarget(tab: ExtensionTab): Record<string, unknown> {
    const wsUrl = this.baseUrl?.replace(/^http/, 'ws') ?? ''
    return {
      id: String(tab.id),
      type: 'page',
      title: tab.title,
      url: tab.url,
      webSocketDebuggerUrl: `${wsUrl}/devtools/page/${tab.id}`
    }
  }

  private attachExtension(socket: WebSocket): void {
    this.extensionSocket?.close()
    this.extensionSocket = socket
    socket.on('message', data => this.handleExtensionMessage(data))
    socket.on('close', () => {
      if (this.extensionSocket !== socket) return
      this.extensionSocket = null
      this.rejectPending(new Error('浏览器扩展连接已断开'))
    })
    socket.on('error', () => {
      if (this.extensionSocket === socket) this.extensionSocket = null
    })
  }

  private attachPageSocket(tabId: number, socket: WebSocket): void {
    const sockets = this.pageSockets.get(tabId) ?? new Set<WebSocket>()
    sockets.add(socket)
    this.pageSockets.set(tabId, sockets)
    socket.on('message', data => {
      const message = record(this.parseMessage(data))
      const id = message?.id
      const method = stringValue(message?.method)
      if (typeof id !== 'number' || !method) return
      void this.requestExtension('cdp', { tabId, method, params: record(message?.params) ?? {} })
        .then(result => this.send(socket, { id, result }))
        .catch(error => this.send(socket, { id, error: { message: error instanceof Error ? error.message : String(error) } }))
    })
    socket.on('close', () => {
      sockets.delete(socket)
      if (sockets.size === 0) this.pageSockets.delete(tabId)
    })
  }

  private handleExtensionMessage(data: RawData): void {
    const message = record(this.parseMessage(data))
    if (!message) return
    if (message.type === 'response') {
      const id = stringValue(message.id)
      const pending = this.pending.get(id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(id)
      if (message.ok === false) pending.reject(new Error(stringValue(message.error) || '浏览器扩展命令失败'))
      else pending.resolve(message.result)
      return
    }
    if (message.type === 'event') {
      const tabId = numberValue(message.tabId)
      const method = stringValue(message.method)
      if (tabId <= 0 || !method) return
      for (const socket of this.pageSockets.get(tabId) ?? []) {
        this.send(socket, { method, params: record(message.params) ?? {} })
      }
    }
  }

  private requestExtension(action: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    const socket = this.extensionSocket
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('浏览器扩展尚未连接'))
    this.requestSequence += 1
    const id = `bridge-${this.requestSequence}`
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('浏览器扩展响应超时'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.send(socket, { type: 'request', id, action, ...payload })
    })
  }

  private parseMessage(data: RawData): unknown {
    try {
      return JSON.parse(data.toString()) as unknown
    } catch {
      return null
    }
  }

  private send(socket: WebSocket, value: unknown): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value))
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
