import type { BrowserCursorClient, BrowserCursorPoint } from './browser-cursor'
import { showBrowserActivityCue, showBrowserHoverCue } from './browser-cursor'

export type BrowserScrollDirection = 'up' | 'down'

export interface BrowserScrollResult {
  x: number
  y: number
  scrollX: number
  scrollY: number
  scrollHeight: number
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
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

function waitForDelay(durationMs: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, durationMs)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      const error = new Error('浏览器操作已取消')
      error.name = 'AbortError'
      reject(error)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

async function evaluate(client: BrowserCursorClient, expression: string, signal?: AbortSignal): Promise<unknown> {
  const outer = record(await client.call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: false
  }, signal))
  const exception = record(outer?.exceptionDetails)
  if (exception) throw new Error(String(exception.text ?? '页面脚本执行失败'))
  return record(outer?.result)?.value ?? null
}

async function viewportPoint(client: BrowserCursorClient, purpose: 'navigate' | 'read' | 'scroll', signal?: AbortSignal): Promise<BrowserCursorPoint> {
  const expression = purpose === 'read'
    ? `(() => {
        const cursor = document.querySelector('[data-deepdesk-browser-cursor="v3"]');
        const rect = cursor instanceof HTMLElement ? cursor.getBoundingClientRect() : null;
        const currentX = rect?.left ?? window.innerWidth / 2;
        const currentY = rect?.top ?? window.innerHeight / 2;
        return {
          x: Math.max(28, Math.round(window.innerWidth * (currentX < window.innerWidth / 2 ? .72 : .28))),
          y: Math.max(28, Math.round(window.innerHeight * (currentY < window.innerHeight * .45 ? .62 : .32)))
        };
      })()`
    : (() => {
        const ratios = purpose === 'navigate' ? { x: 0.5, y: 0.08 } : { x: 0.84, y: 0.54 }
        return `({ x: Math.max(28, Math.round(window.innerWidth * ${ratios.x})), y: Math.max(28, Math.round(window.innerHeight * ${ratios.y})) })`
      })()
  const value = record(await evaluate(client, expression, signal))
  const x = numberValue(value?.x)
  const y = numberValue(value?.y)
  if (x <= 0 || y <= 0) throw new Error('无法获取浏览器可视区域')
  return { x, y }
}

export async function showBrowserReadActivity(client: BrowserCursorClient, signal?: AbortSignal): Promise<void> {
  await showBrowserHoverCue(client, await viewportPoint(client, 'read', signal), signal)
}

export async function showBrowserNavigationCue(client: BrowserCursorClient, afterNavigation: boolean, signal?: AbortSignal): Promise<void> {
  const point = await viewportPoint(client, 'navigate', signal)
  if (afterNavigation) await showBrowserActivityCue(client, point, signal)
  else await showBrowserHoverCue(client, point, signal)
}

export async function dispatchBrowserHover(client: BrowserCursorClient, point: BrowserCursorPoint, signal?: AbortSignal): Promise<void> {
  await showBrowserHoverCue(client, point, signal)
  await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y }, signal)
}

export async function dispatchBrowserScroll(client: BrowserCursorClient, direction: BrowserScrollDirection, amount: number, signal?: AbortSignal): Promise<BrowserScrollResult> {
  const point = await viewportPoint(client, 'scroll', signal)
  await dispatchBrowserHover(client, point, signal)
  const deltaY = (direction === 'up' ? -1 : 1) * amount / 5
  for (let step = 0; step < 5; step += 1) {
    throwIfAborted(signal)
    await client.call('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: point.x,
      y: point.y,
      deltaX: 0,
      deltaY
    }, signal)
    if (step < 4) await waitForDelay(55, signal)
  }
  await showBrowserActivityCue(client, point, signal)
  const state = record(await evaluate(client, '({ scrollX: window.scrollX, scrollY: window.scrollY, scrollHeight: document.documentElement.scrollHeight })', signal))
  return {
    ...point,
    scrollX: numberValue(state?.scrollX),
    scrollY: numberValue(state?.scrollY),
    scrollHeight: numberValue(state?.scrollHeight)
  }
}
