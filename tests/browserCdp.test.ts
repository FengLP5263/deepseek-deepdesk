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
  let receivedRequests: CdpRequest[] = []

  beforeEach(async () => {
    receivedMethods = []
    receivedRequests = []
    const server = createServer((request, response) => {
      if (request.url === '/json/version') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ Browser: 'DeepDesk Test Browser' }))
        return
      }
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
        receivedRequests.push(message)
        let result: Record<string, unknown> = {}
        if (message.method === 'Runtime.evaluate') {
          const expression = String(message.params?.expression ?? '')
          const value = expression.includes('deepdesk-visible-content-v1')
            ? { ok: true, x: 120, y: 80, target: 'content', tag: expression.includes('元素不支持输入') ? 'input' : 'button', text: '提交' }
            : expression.includes("document.querySelector('[data-deepdesk-browser-cursor=\"v3\"]')")
              ? { x: 400, y: 300 }
            : expression.startsWith('({ x: Math.max')
              ? { x: 400, y: 300 }
              : expression.includes('scrollHeight: document.documentElement.scrollHeight')
                ? { scrollX: 0, scrollY: 500, scrollHeight: 2_400 }
                : expression.includes('querySelectorAll')
            ? {
                title: 'DeepDesk 测试页',
                url: 'https://example.test/',
                readyState: 'complete',
                text: '连接器可以读取当前页面',
                interactive: [{ ref: 1, tag: 'button', selector: '#submit', text: '提交', type: '', disabled: false }]
              }
                : expression === 'document.readyState'
                  ? 'complete'
                  : expression.includes('getBoundingClientRect')
                    ? { ok: true, x: 120, y: 80, target: 'element', tag: expression.includes('元素不支持输入') ? 'input' : 'button', text: '提交' }
                    : expression.includes('element.value ??')
                      ? 'DeepDesk 输入测试'
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
    const toolResult = await executeBrowserTool({ id: 'call-pages', name: 'browser_pages', args: {} })

    expect(pages).toHaveLength(1)
    expect(pages[0]).toMatchObject({ id: 'page-1', title: 'DeepDesk 测试页', url: 'https://example.test/' })
    expect(toolResult).toMatchObject({ ok: true, summary: '浏览器页面 1 个' })
    expect(receivedRequests.some(request => request.method === 'Runtime.evaluate' && String(request.params?.expression ?? '').includes('"state":"idle"'))).toBe(true)
    expect(receivedRequests.some(request => request.method === 'Runtime.evaluate' && String(request.params?.expression ?? '').includes('"state":"move"'))).toBe(true)
    expect(receivedRequests.some(request => request.method === 'Runtime.evaluate' && String(request.params?.expression ?? '').includes("setAttribute('data-deepdesk-browser-cursor', 'v3')"))).toBe(true)
    expect(receivedRequests.some(request => request.method === 'Runtime.evaluate' && String(request.params?.expression ?? '').includes('event.isTrusted'))).toBe(false)
  })

  it('reads page structure and performs interaction through CDP', async () => {
    const navigate = await executeBrowserTool({ id: 'call-0', name: 'browser_navigate', args: { target_id: 'page-1', url: 'https://example.test/next' } })
    const snapshot = await executeBrowserTool({ id: 'call-1', name: 'browser_snapshot', args: { target_id: 'page-1' } })
    const type = await executeBrowserTool({ id: 'call-3', name: 'browser_type', args: { target_id: 'page-1', selector: '#search', text: 'DeepDesk 输入测试', submit: true } })
    const click = await executeBrowserTool({ id: 'call-2', name: 'browser_click', args: { target_id: 'page-1', selector: '#submit' } })
    const hover = await executeBrowserTool({ id: 'call-4', name: 'browser_hover', args: { target_id: 'page-1', selector: '#submit' } })
    const scroll = await executeBrowserTool({ id: 'call-5', name: 'browser_scroll', args: { target_id: 'page-1', direction: 'down', amount: 500 } })

    expect(navigate).toMatchObject({ ok: true, summary: '访问 https://example.test/next' })
    expect(snapshot.ok).toBe(true)
    expect(snapshot.content).toContain('连接器可以读取当前页面')
    expect(snapshot.content).toContain('#submit')
    expect(click).toMatchObject({ ok: true, summary: '点击 #submit' })
    expect(type).toMatchObject({ ok: true, summary: '输入到 #search（尚未提交）' })
    expect(type.content).toContain('DeepDesk 输入测试')
    expect(type.content).toContain('"submitted": false')
    expect(hover).toMatchObject({ ok: true, summary: '悬停 #submit' })
    expect(scroll).toMatchObject({ ok: true, summary: '向下滚动 500 像素' })
    expect(scroll.content).toContain('"scrollY": 500')
    expect(receivedMethods).toContain('Runtime.enable')
    const mouseRequests = receivedRequests.filter(request => request.method === 'Input.dispatchMouseEvent')
    expect(mouseRequests).toHaveLength(13)
    expect(mouseRequests.filter(request => request.params?.type === 'mouseWheel')).toHaveLength(5)
    expect(mouseRequests.filter(request => request.params?.type === 'mouseWheel').every(request => request.params?.deltaY === 100)).toBe(true)
    const cursorRequests = receivedRequests.filter(request => request.method === 'Runtime.evaluate' && String(request.params?.expression ?? '').includes('data-deepdesk-browser-cursor'))
    expect(cursorRequests.some(request => String(request.params?.expression ?? '').includes('"state":"activity"'))).toBe(true)
    expect(cursorRequests.some(request => String(request.params?.expression ?? '').includes('"state":"hover"'))).toBe(true)
    const firstMove = cursorRequests.find(request => String(request.params?.expression ?? '').includes('"x":120,"y":80,"state":"move"'))
    const firstArrive = cursorRequests.find(request => String(request.params?.expression ?? '').includes('"x":120,"y":80,"state":"arrive"'))
    const firstClick = cursorRequests.find(request => String(request.params?.expression ?? '').includes('"x":120,"y":80,"state":"click"'))
    const firstPressedIndex = receivedRequests.findIndex(request => request.method === 'Input.dispatchMouseEvent' && request.params?.type === 'mousePressed')
    expect(firstMove).toBeTruthy()
    expect(firstArrive).toBeTruthy()
    expect(firstClick).toBeTruthy()
    expect(receivedRequests.indexOf(firstMove!)).toBeLessThan(firstPressedIndex)
    expect(receivedRequests.indexOf(firstArrive!)).toBeLessThan(firstPressedIndex)
    expect(receivedRequests.indexOf(firstClick!)).toBeLessThan(firstPressedIndex)
    expect(cursorRequests.every(request => request.params?.awaitPromise === true)).toBe(true)
    expect(receivedMethods).toContain('Input.insertText')
    const keyRequests = receivedRequests.filter(request => request.method === 'Input.dispatchKeyEvent')
    expect(keyRequests).toHaveLength(2)
    expect(keyRequests.every(request => request.params?.key !== 'Enter')).toBe(true)
    const insertIndex = receivedRequests.findIndex(request => request.method === 'Input.insertText')
    const submitClickIndex = receivedRequests.reduce((lastIndex, request, index) => request.method === 'Input.dispatchMouseEvent' && request.params?.type === 'mousePressed' ? index : lastIndex, -1)
    expect(insertIndex).toBeLessThan(submitClickIndex)
    expect(receivedRequests.some(request => request.method === 'Runtime.evaluate' && String(request.params?.expression ?? '').includes("scrollIntoView({ behavior: 'instant'"))).toBe(true)
  })

  it('rejects hidden page interaction through browser evaluation', async () => {
    await expect(executeBrowserTool({
      id: 'call-hidden-click',
      name: 'browser_evaluate',
      args: { target_id: 'page-1', expression: "document.querySelector('#submit')?.click()" }
    })).rejects.toThrow('请改用 browser_click、browser_type、browser_hover、browser_scroll 或 browser_navigate')
    await expect(executeBrowserTool({
      id: 'call-hidden-scroll',
      name: 'browser_evaluate',
      args: { target_id: 'page-1', expression: 'window.scrollTo(0, 500)' }
    })).rejects.toThrow('页面交互不能通过 browser_evaluate 隐藏执行')
    await expect(executeBrowserTool({
      id: 'call-hidden-navigation',
      name: 'browser_evaluate',
      args: { target_id: 'page-1', expression: "location.href = 'https://example.test/hidden'" }
    })).rejects.toThrow('页面交互不能通过 browser_evaluate 隐藏执行')
    expect(receivedMethods).not.toContain('Runtime.evaluate')

    const readOnlyResult = await executeBrowserTool({
      id: 'call-read-value',
      name: 'browser_evaluate',
      args: { target_id: 'page-1', expression: "document.querySelector('#search')?.value === 'DeepDesk'" }
    })
    expect(readOnlyResult.ok).toBe(true)
    expect(receivedMethods).toContain('Runtime.evaluate')
  })
})
