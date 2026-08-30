import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { executeBrowserTool, listBrowserPages } from '../src/main/browser-cdp'

interface CdpRequest {
  id: number
  method: string
  params?: Record<string, unknown>
}

describe('browser CDP connector', () => {
  const previousDebugUrl = process.env.DEEPDESK_BROWSER_DEBUG_URL
  let closeServer: (() => Promise<void>) | null = null
  let receivedMethods: string[] = []

  beforeEach(async () => {
    receivedMethods = []
    const server = createServer((request, response) => {
      if (request.url === '/json/list') {
        const address = server.address() as AddressInfo
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify([{
          id: 'page-1',
          type: 'page',
          title: 'DeepDesk 测试页',
          url: 'https://example.test/',
          webSocketDebuggerUrl: `ws://127.0.0.1:${address.port}/devtools/page/page-1`
        }]))
        return
      }
      response.statusCode = 404
      response.end()
    })
    const webSocketServer = new WebSocketServer({ server })
    webSocketServer.on('connection', socket => {
      socket.on('message', raw => {
        const message = JSON.parse(raw.toString()) as CdpRequest
        receivedMethods.push(message.method)
        let result: Record<string, unknown> = {}
        if (message.method === 'Runtime.evaluate') {
          const expression = String(message.params?.expression ?? '')
          const value = expression.includes('querySelectorAll')
            ? {
                title: 'DeepDesk 测试页',
                url: 'https://example.test/',
                readyState: 'complete',
                text: '连接器可以读取当前页面',
                interactive: [{ ref: 1, tag: 'button', selector: '#submit', text: '提交', type: '', disabled: false }]
              }
            : expression === 'document.readyState'
              ? 'complete'
              : expression.includes('document.querySelector')
                ? { ok: true, tag: 'button', text: '提交' }
                : { title: 'DeepDesk 测试页', url: 'https://example.test/', readyState: 'complete' }
          result = { result: { type: 'object', value } }
        }
        socket.send(JSON.stringify({ id: message.id, result }))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as AddressInfo
    process.env.DEEPDESK_BROWSER_DEBUG_URL = `http://127.0.0.1:${address.port}`
    closeServer = async () => {
      for (const client of webSocketServer.clients) client.terminate()
      await new Promise<void>(resolve => webSocketServer.close(() => resolve()))
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  afterEach(async () => {
    await closeServer?.()
    closeServer = null
    if (previousDebugUrl === undefined) delete process.env.DEEPDESK_BROWSER_DEBUG_URL
    else process.env.DEEPDESK_BROWSER_DEBUG_URL = previousDebugUrl
  })

  it('lists real debuggable browser pages', async () => {
    const pages = await listBrowserPages()

    expect(pages).toHaveLength(1)
    expect(pages[0]).toMatchObject({ id: 'page-1', title: 'DeepDesk 测试页', url: 'https://example.test/' })
  })

  it('reads page structure and performs interaction through CDP', async () => {
    const snapshot = await executeBrowserTool({ id: 'call-1', name: 'browser_snapshot', args: { target_id: 'page-1' } })
    const click = await executeBrowserTool({ id: 'call-2', name: 'browser_click', args: { target_id: 'page-1', selector: '#submit' } })

    expect(snapshot.ok).toBe(true)
    expect(snapshot.content).toContain('连接器可以读取当前页面')
    expect(snapshot.content).toContain('#submit')
    expect(click).toMatchObject({ ok: true, summary: '点击 #submit' })
    expect(receivedMethods).toContain('Runtime.enable')
    expect(receivedMethods.filter(method => method === 'Runtime.evaluate')).toHaveLength(2)
  })
})
