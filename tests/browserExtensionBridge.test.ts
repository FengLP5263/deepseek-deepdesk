import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { BROWSER_EXTENSION_ID, BrowserExtensionBridge } from '../src/main/browser-extension-bridge'

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
}

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('WebSocket message timeout')), 3_000)
    socket.once('message', data => {
      clearTimeout(timer)
      resolve(JSON.parse(data.toString()) as Record<string, unknown>)
    })
  })
}

describe('browser extension bridge', () => {
  let bridge: BrowserExtensionBridge | null = null
  let extensionSocket: WebSocket | null = null
  let pageSocket: WebSocket | null = null

  afterEach(async () => {
    pageSocket?.close()
    extensionSocket?.close()
    await bridge?.stop()
    pageSocket = null
    extensionSocket = null
    bridge = null
  })

  it('bridges current browser tabs and CDP commands through the signed extension origin', async () => {
    bridge = new BrowserExtensionBridge()
    await bridge.start()
    const baseUrl = bridge.baseUrl
    expect(baseUrl).toBeTruthy()
    const address = new URL(baseUrl!)
    extensionSocket = new WebSocket(`ws://${address.host}/extension`, {
      headers: { Origin: `chrome-extension://${BROWSER_EXTENSION_ID}` }
    })
    await waitForOpen(extensionSocket)

    extensionSocket.on('message', data => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>
      if (message.type !== 'request') return
      if (message.action === 'tabs') {
        extensionSocket?.send(JSON.stringify({
          type: 'response',
          id: message.id,
          ok: true,
          result: { tabs: [{ id: 7, title: '已登录页面', url: 'https://example.test/account' }] }
        }))
      } else if (message.action === 'cdp') {
        extensionSocket?.send(JSON.stringify({
          type: 'response',
          id: message.id,
          ok: true,
          result: { result: { type: 'string', value: 'signed-in' } }
        }))
      }
    })

    const unauthorized = await fetch(`${address.protocol}//${address.host}/json/list`)
    expect(unauthorized.status).toBe(404)

    const response = await fetch(baseUrl! + '/json/list')
    expect(response.ok).toBe(true)
    const pages = await response.json() as Array<Record<string, unknown>>
    expect(pages).toHaveLength(1)
    expect(pages[0]).toMatchObject({ id: '7', title: '已登录页面', url: 'https://example.test/account' })

    pageSocket = new WebSocket(String(pages[0]?.webSocketDebuggerUrl))
    await waitForOpen(pageSocket)
    const responseMessage = nextMessage(pageSocket)
    pageSocket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'document.cookie' } }))
    const cdpResponse = await responseMessage
    expect(cdpResponse).toEqual({ id: 1, result: { result: { type: 'string', value: 'signed-in' } } })
  })

  it('ships a fixed extension identity and local-only bridge implementation', () => {
    const manifest = JSON.parse(readFileSync(path.join(process.cwd(), 'browser-extension', 'manifest.json'), 'utf8')) as Record<string, unknown>
    const background = readFileSync(path.join(process.cwd(), 'browser-extension', 'background.js'), 'utf8')
    const popup = readFileSync(path.join(process.cwd(), 'browser-extension', 'popup.js'), 'utf8')
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.permissions).toEqual(expect.arrayContaining(['debugger', 'tabs']))
    expect(background).toContain('ws://127.0.0.1:')
    expect(background).not.toMatch(/https?:\/\//)
    expect(() => new vm.Script(background)).not.toThrow()
    expect(() => new vm.Script(popup)).not.toThrow()
  })
})
