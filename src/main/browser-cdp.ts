import WebSocket from 'ws'
import type { RawData } from 'ws'
import type { AgentToolCall, AgentToolResult, AgentToolName } from '../shared/agent-types'
import { browserDebugBaseUrl, ensureBrowserAutomation } from './browser-runtime'

const REQUEST_TIMEOUT_MS = 8_000
const MAX_RESULT_LENGTH = 20_000

interface BrowserTarget {
  id: string
  type: string
  title: string
  url: string
  webSocketDebuggerUrl: string
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface BrowserElementPoint {
  x: number
  y: number
  tag: string
  text: string
}

type CdpEventListener = (method: string, params: unknown) => void

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('浏览器操作已取消')
  error.name = 'AbortError'
  throw error
}

function clippedJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2)
  return text.length <= MAX_RESULT_LENGTH ? text : text.slice(0, MAX_RESULT_LENGTH) + '\n…（浏览器结果过长，已截断）'
}

async function fetchCdp(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
  throwIfAborted(signal)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const onAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    return await fetch(browserDebugBaseUrl() + path, { ...init, signal: controller.signal })
  } catch (error) {
    if (signal?.aborted) throwIfAborted(signal)
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

function normalizeTarget(value: unknown): BrowserTarget | null {
  const target = record(value)
  if (!target) return null
  const id = stringValue(target.id)
  const type = stringValue(target.type)
  const webSocketDebuggerUrl = stringValue(target.webSocketDebuggerUrl)
  if (!id || type !== 'page' || !webSocketDebuggerUrl) return null
  return {
    id,
    type,
    title: stringValue(target.title) || '未命名页面',
    url: stringValue(target.url),
    webSocketDebuggerUrl
  }
}

export async function listBrowserPages(signal?: AbortSignal): Promise<BrowserTarget[]> {
  let response: Response
  try {
    response = await fetchCdp('/json/list', {}, signal)
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('浏览器调试会话不可用，请确认浏览器连接器已启用')
  }
  if (!response.ok) throw new Error('浏览器调试服务不可用（HTTP ' + response.status + '）')
  const json = await response.json() as unknown
  if (!Array.isArray(json)) return []
  return json.map(normalizeTarget).filter((target): target is BrowserTarget => target !== null)
}

async function createBrowserPage(url: string, signal?: AbortSignal): Promise<BrowserTarget> {
  const response = await fetchCdp('/json/new?' + encodeURIComponent(url), { method: 'PUT' }, signal)
  if (!response.ok) throw new Error('创建浏览器页面失败（HTTP ' + response.status + '）')
  const target = normalizeTarget(await response.json() as unknown)
  if (!target) throw new Error('浏览器没有返回可调试页面')
  return target
}

async function resolveTarget(targetId?: string, signal?: AbortSignal): Promise<BrowserTarget> {
  const pages = await listBrowserPages(signal)
  if (targetId) {
    const selected = pages.find(page => page.id === targetId)
    if (!selected) throw new Error('未找到浏览器页面：' + targetId)
    return selected
  }
  const selected = pages.find(page => !page.url.startsWith('devtools://')) ?? pages[0]
  if (!selected) throw new Error('浏览器中没有可调试页面')
  return selected
}

class CdpClient {
  private nextId = 1
  private readonly pending = new Map<number, PendingCall>()
  private readonly listeners = new Set<CdpEventListener>()

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', data => this.handleMessage(data))
    socket.on('close', () => this.rejectPending(new Error('浏览器调试连接已关闭')))
    socket.on('error', error => this.rejectPending(error))
  }

  static async connect(url: string, signal?: AbortSignal): Promise<CdpClient> {
    throwIfAborted(signal)
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        socket.off('open', onOpen)
        socket.off('error', onError)
        signal?.removeEventListener('abort', onAbort)
      }
      const onOpen = (): void => { cleanup(); resolve() }
      const onError = (error: Error): void => { cleanup(); reject(error) }
      const onAbort = (): void => {
        cleanup()
        socket.close()
        const error = new Error('浏览器操作已取消')
        error.name = 'AbortError'
        reject(error)
      }
      socket.once('open', onOpen)
      socket.once('error', onError)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
    return new CdpClient(socket)
  }

  onEvent(listener: CdpEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async call(method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> {
    throwIfAborted(signal)
    const id = this.nextId
    this.nextId += 1
    return await new Promise<unknown>((resolve, reject) => {
      const onAbort = (): void => {
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(id)
        const error = new Error('浏览器操作已取消')
        error.name = 'AbortError'
        reject(error)
      }
      const timer = setTimeout(() => {
        this.pending.delete(id)
        signal?.removeEventListener('abort', onAbort)
        reject(new Error('浏览器调试命令超时：' + method))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, {
        resolve: value => {
          signal?.removeEventListener('abort', onAbort)
          resolve(value)
        },
        reject: error => {
          signal?.removeEventListener('abort', onAbort)
          reject(error)
        },
        timer
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      this.socket.send(JSON.stringify({ id, method, params }), error => {
        if (!error) return
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(id)
        pending.reject(error)
      })
    })
  }

  close(): void {
    this.socket.close()
  }

  private handleMessage(data: RawData): void {
    let message: Record<string, unknown> | null = null
    try {
      message = record(JSON.parse(data.toString()))
    } catch {
      return
    }
    if (!message) return
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      const errorRecord = record(message.error)
      if (errorRecord) pending.reject(new Error(stringValue(errorRecord.message) || '浏览器调试命令失败'))
      else pending.resolve(message.result)
      return
    }
    const method = stringValue(message.method)
    if (method) this.listeners.forEach(listener => listener(method, message.params))
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function runtimeValue(response: unknown): unknown {
  const outer = record(response)
  const result = record(outer?.result)
  const exception = record(outer?.exceptionDetails)
  if (exception) throw new Error(stringValue(exception.text) || '页面脚本执行失败')
  return result?.value ?? result?.description ?? null
}

async function evaluate(client: CdpClient, expression: string, signal?: AbortSignal): Promise<unknown> {
  const response = await client.call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true
  }, signal)
  return runtimeValue(response)
}

async function waitForReady(client: CdpClient, signal?: AbortSignal): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    throwIfAborted(signal)
    const state = await evaluate(client, 'document.readyState', signal)
    if (state === 'complete' || state === 'interactive') return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

async function locateBrowserElement(client: CdpClient, selector: string, editable: boolean, signal?: AbortSignal): Promise<BrowserElementPoint> {
  const expression = `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return { ok: false, error: '未找到元素' };
    if (${editable ? 'true' : 'false'} && !(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement) && !element.isContentEditable) {
      return { ok: false, error: '元素不支持输入' };
    }
    if (element.disabled) return { ok: false, error: '元素已禁用' };
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { ok: false, error: '元素当前不可见' };
    return {
      ok: true,
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      tag: element.tagName.toLowerCase(),
      text: String(element.innerText || element.getAttribute('aria-label') || '').trim().slice(0, 200)
    };
  })()`
  const result = record(await evaluate(client, expression, signal))
  if (!result?.ok) throw new Error(stringValue(result?.error) || '无法定位页面元素')
  const x = numberValue(result.x)
  const y = numberValue(result.y)
  if (x <= 0 || y <= 0) throw new Error('页面元素不在可操作区域')
  return { x, y, tag: stringValue(result.tag), text: stringValue(result.text) }
}

async function dispatchBrowserClick(client: CdpClient, point: BrowserElementPoint, signal?: AbortSignal): Promise<void> {
  await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }, signal)
  await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 }, signal)
  await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 }, signal)
}

async function selectBrowserInputContent(client: CdpClient, signal?: AbortSignal): Promise<void> {
  const modifiers = process.platform === 'darwin' ? 4 : 2
  await client.call('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'a',
    code: 'KeyA',
    modifiers,
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65
  }, signal)
  await client.call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'a',
    code: 'KeyA',
    modifiers,
    windowsVirtualKeyCode: 65,
    nativeVirtualKeyCode: 65
  }, signal)
}

async function submitBrowserInput(client: CdpClient, signal?: AbortSignal): Promise<void> {
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
  await client.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key }, signal)
  await client.call('Input.dispatchKeyEvent', { type: 'char', text: '\r', unmodifiedText: '\r', ...key }, signal)
  await client.call('Input.dispatchKeyEvent', { type: 'keyUp', ...key }, signal)
}

const SNAPSHOT_EXPRESSION = `(() => {
  const clean = value => String(value || '').replace(/\\s+/g, ' ').trim();
  const esc = value => CSS.escape(String(value));
  const selectorFor = element => {
    if (element.id) return '#' + esc(element.id);
    const testId = element.getAttribute('data-testid');
    if (testId) return '[data-testid="' + String(testId).replace(/"/g, '\\"') + '"]';
    const name = element.getAttribute('name');
    if (name) return element.tagName.toLowerCase() + '[name="' + String(name).replace(/"/g, '\\"') + '"]';
    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && parts.length < 5) {
      let part = current.tagName.toLowerCase();
      const siblings = current.parentElement ? Array.from(current.parentElement.children).filter(item => item.tagName === current.tagName) : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  };
  const interactive = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]'))
    .filter(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    })
    .slice(0, 120)
    .map((element, index) => ({
      ref: index + 1,
      tag: element.tagName.toLowerCase(),
      selector: selectorFor(element),
      text: clean(element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || element.value).slice(0, 180),
      type: element.getAttribute('type') || '',
      disabled: Boolean(element.disabled)
    }));
  return {
    title: document.title,
    url: location.href,
    readyState: document.readyState,
    text: clean(document.body ? document.body.innerText : '').slice(0, 12000),
    interactive
  };
})()`

function validateUrl(url: string): string {
  const value = url.trim()
  if (value === 'about:blank') return value
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('请输入完整的 http:// 或 https:// 地址')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('仅允许访问 HTTP 或 HTTPS 页面')
  return parsed.toString()
}

async function withTarget<T>(targetId: string | undefined, signal: AbortSignal | undefined, action: (client: CdpClient, target: BrowserTarget) => Promise<T>): Promise<T> {
  const target = await resolveTarget(targetId, signal)
  const client = await CdpClient.connect(target.webSocketDebuggerUrl, signal)
  try {
    return await action(client, target)
  } finally {
    client.close()
  }
}

const BROWSER_TOOL_NAMES = new Set<AgentToolName>([
  'browser_pages',
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_debug',
  'browser_evaluate'
])

export function isBrowserToolName(name: AgentToolName): boolean {
  return BROWSER_TOOL_NAMES.has(name)
}

export async function executeBrowserTool(call: AgentToolCall, signal?: AbortSignal): Promise<AgentToolResult> {
  await ensureBrowserAutomation(signal)
  const targetId = stringValue(call.args.target_id) || undefined
  if (call.name === 'browser_pages') {
    const pages = await listBrowserPages(signal)
    return {
      ok: true,
      content: clippedJson(pages.map(page => ({ id: page.id, title: page.title, url: page.url }))),
      summary: '浏览器页面 ' + pages.length + ' 个'
    }
  }
  if (call.name === 'browser_navigate') {
    const url = validateUrl(stringValue(call.args.url))
    if (!targetId && call.args.new_page === true) {
      const target = await createBrowserPage(url, signal)
      return { ok: true, content: clippedJson({ id: target.id, title: target.title, url }), summary: '打开 ' + url }
    }
    return await withTarget(targetId, signal, async (client, target) => {
      await client.call('Page.enable', {}, signal)
      await client.call('Page.navigate', { url }, signal)
      await waitForReady(client, signal)
      const snapshot = await evaluate(client, '({ title: document.title, url: location.href, readyState: document.readyState })', signal)
      return { ok: true, content: clippedJson({ targetId: target.id, ...record(snapshot) }), summary: '访问 ' + url }
    })
  }
  if (call.name === 'browser_snapshot') {
    return await withTarget(targetId, signal, async (client, target) => {
      await client.call('Runtime.enable', {}, signal)
      const snapshot = await evaluate(client, SNAPSHOT_EXPRESSION, signal)
      return { ok: true, content: clippedJson({ targetId: target.id, ...record(snapshot) }), summary: '读取页面 ' + target.title }
    })
  }
  if (call.name === 'browser_click') {
    const selector = stringValue(call.args.selector).trim()
    if (!selector) throw new Error('缺少 selector')
    return await withTarget(targetId, signal, async (client, target) => {
      try {
        const point = await locateBrowserElement(client, selector, false, signal)
        await dispatchBrowserClick(client, point, signal)
        return { ok: true, content: clippedJson({ targetId: target.id, ok: true, tag: point.tag, text: point.text }), summary: '点击 ' + selector }
      } catch (error) {
        throwIfAborted(signal)
        const message = error instanceof Error ? error.message : '点击失败'
        return { ok: false, content: message, summary: '点击失败 ' + selector }
      }
    })
  }
  if (call.name === 'browser_type') {
    const selector = stringValue(call.args.selector).trim()
    const text = stringValue(call.args.text)
    if (!selector) throw new Error('缺少 selector')
    return await withTarget(targetId, signal, async (client, target) => {
      try {
        const point = await locateBrowserElement(client, selector, true, signal)
        await dispatchBrowserClick(client, point, signal)
        await selectBrowserInputContent(client, signal)
        await client.call('Input.insertText', { text }, signal)
        if (call.args.submit === true) await submitBrowserInput(client, signal)
        const value = await evaluate(client, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); return element ? (element.value ?? element.textContent ?? '') : ''; })()`, signal)
        return { ok: true, content: clippedJson({ targetId: target.id, ok: true, value }), summary: '输入到 ' + selector }
      } catch (error) {
        throwIfAborted(signal)
        const message = error instanceof Error ? error.message : '输入失败'
        return { ok: false, content: message, summary: '输入失败 ' + selector }
      }
    })
  }
  if (call.name === 'browser_debug') {
    const duration = Math.min(2_000, Math.max(100, Number(call.args.duration_ms) || 500))
    return await withTarget(targetId, signal, async (client, target) => {
      const events: Array<{ method: string; params: unknown }> = []
      const removeListener = client.onEvent((method, params) => {
        if (method === 'Runtime.consoleAPICalled' || method === 'Runtime.exceptionThrown' || method === 'Log.entryAdded' || method === 'Network.loadingFailed') {
          events.push({ method, params })
        }
      })
      await Promise.all([
        client.call('Runtime.enable', {}, signal),
        client.call('Log.enable', {}, signal),
        client.call('Network.enable', {}, signal)
      ])
      await new Promise<void>((resolve, reject) => {
        const finish = (): void => {
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }
        const timer = setTimeout(finish, duration)
        const onAbort = (): void => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          const error = new Error('浏览器操作已取消')
          error.name = 'AbortError'
          reject(error)
        }
        signal?.addEventListener('abort', onAbort, { once: true })
      })
      removeListener()
      const pageInfo = await evaluate(client, `({ title: document.title, url: location.href, readyState: document.readyState, resources: performance.getEntriesByType('resource').slice(-40).map(item => ({ name: item.name, type: item.initiatorType, duration: Math.round(item.duration), transferSize: item.transferSize || 0 })) })`, signal)
      return { ok: true, content: clippedJson({ targetId: target.id, page: pageInfo, events: events.slice(-80) }), summary: '调试页面 ' + target.title }
    })
  }
  if (call.name === 'browser_evaluate') {
    const expression = stringValue(call.args.expression).trim()
    if (!expression) throw new Error('缺少 expression')
    return await withTarget(targetId, signal, async (client, target) => {
      const result = await evaluate(client, expression, signal)
      return { ok: true, content: clippedJson({ targetId: target.id, result }), summary: '执行页面调试脚本' }
    })
  }
  return { ok: false, content: '未知浏览器工具：' + call.name, summary: '未知浏览器工具' }
}
