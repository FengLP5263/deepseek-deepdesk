import { expect, test } from '@playwright/test'
import { buildBrowserCursorExpression, showBrowserActivityCue, showBrowserClickCue, showBrowserCursorPresence } from '../src/main/browser-cursor'
import { buildBrowserElementLocatorExpression } from '../src/main/browser-element-locator'
import { showBrowserReadActivity } from '../src/main/browser-visible-actions'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, launchDeepDesk } from './helpers'

let ctx: DeepDeskE2EApp | null = null

test.beforeEach(async () => {
  ctx = await launchDeepDesk()
})

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  ctx = null
})

test('shows a non-blocking pointer at the browser action target', async () => {
  if (!ctx) throw new Error('DeepDesk E2E app is not running')

  const cursorClient = {
    call: async (_method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
      return await ctx!.page.evaluate(String(params.expression ?? ''))
    }
  }
  await ctx.page.evaluate(() => {
    const legacyCursor = document.createElement('div')
    legacyCursor.setAttribute('data-deepdesk-browser-cursor', 'true')
    document.documentElement.appendChild(legacyCursor)
    const versionTwoCursor = document.createElement('div')
    versionTwoCursor.setAttribute('data-deepdesk-browser-cursor', 'v2')
    document.documentElement.appendChild(versionTwoCursor)
  })
  const cursor = ctx.page.locator('[data-deepdesk-browser-cursor="v3"]')
  await showBrowserCursorPresence(cursorClient)
  await expect(cursor).toBeVisible()
  await expect(cursor).toHaveAttribute('data-state', 'idle')
  await expect(ctx.page.locator('[data-deepdesk-browser-cursor="true"]')).toHaveCount(0)
  await expect(ctx.page.locator('[data-deepdesk-browser-cursor="v2"]')).toHaveCount(0)
  await cursor.evaluate(element => {
    const cursorElement = element as HTMLElement
    cursorElement.dataset.stateHistory = cursorElement.dataset.state ?? ''
    new MutationObserver(() => {
      cursorElement.dataset.stateHistory += ',' + (cursorElement.dataset.state ?? '')
    }).observe(cursorElement, { attributes: true, attributeFilter: ['data-state'] })
  })

  await ctx.page.evaluate(buildBrowserCursorExpression({ x: 120, y: 120 }, 'idle'))
  await cursor.evaluate(element => { (element as HTMLElement).dataset.stateHistory = '' })
  const readTarget = await ctx.page.evaluate(() => ({
    left: Math.round(window.innerWidth * .72),
    top: Math.round(window.innerHeight * .62)
  }))
  const readCue = showBrowserReadActivity({
    call: async (_method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
      const value = await ctx!.page.evaluate(String(params.expression ?? ''))
      return { result: { value } }
    }
  })
  await expect(cursor).toHaveAttribute('data-state', 'move')
  await ctx.page.waitForTimeout(180)
  const readMoveMidpoint = await cursor.evaluate(element => ({
    left: element.getBoundingClientRect().left,
    top: element.getBoundingClientRect().top
  }))
  expect(readMoveMidpoint.left).toBeGreaterThan(120)
  expect(readMoveMidpoint.left).toBeLessThan(readTarget.left)
  expect(readMoveMidpoint.top).toBeGreaterThan(120)
  expect(readMoveMidpoint.top).toBeLessThan(readTarget.top)
  await readCue
  await expect(cursor).toHaveAttribute('data-state', 'hover')
  await expect(cursor).toHaveAttribute('data-state-history', /arrive/)
  await expect.poll(() => cursor.evaluate(element => ({
    left: Math.round(element.getBoundingClientRect().left),
    top: Math.round(element.getBoundingClientRect().top)
  }))).toEqual(readTarget)

  await ctx.page.mouse.click(100, 100)
  await expect.poll(() => cursor.evaluate(element => ({
    left: Math.round(element.getBoundingClientRect().left),
    top: Math.round(element.getBoundingClientRect().top)
  }))).toEqual(readTarget)

  const activityCue = showBrowserActivityCue(cursorClient)
  await expect(cursor).toHaveAttribute('data-state', 'activity')
  await ctx.page.waitForTimeout(100)
  expect(await cursor.evaluate(element => getComputedStyle(element).transform)).not.toBe('none')
  await activityCue
  await expect.poll(() => cursor.evaluate(element => getComputedStyle(element).transform)).toBe('none')

  await ctx.page.evaluate(buildBrowserCursorExpression({ x: 420, y: 260 }, 'idle'))
  await cursor.evaluate(element => { (element as HTMLElement).dataset.stateHistory = '' })
  const clickCue = showBrowserClickCue(cursorClient, { x: 680, y: 390 })
  await expect(cursor).toHaveAttribute('data-state', 'move')
  await ctx.page.waitForTimeout(180)
  const explicitMoveMidpoint = await cursor.evaluate(element => ({
    left: element.getBoundingClientRect().left,
    top: element.getBoundingClientRect().top
  }))
  expect(explicitMoveMidpoint.left).toBeGreaterThan(420)
  expect(explicitMoveMidpoint.left).toBeLessThan(680)
  expect(explicitMoveMidpoint.top).toBeGreaterThan(260)
  expect(explicitMoveMidpoint.top).toBeLessThan(390)
  await clickCue
  await expect(cursor).toHaveAttribute('data-state', 'click')
  await expect(cursor).toHaveAttribute('data-state-history', /arrive/)
  await expect.poll(() => cursor.evaluate(element => ({
    left: element.getBoundingClientRect().left,
    top: element.getBoundingClientRect().top,
    pointerEvents: getComputedStyle(element).pointerEvents,
    zIndex: getComputedStyle(element).zIndex
  }))).toEqual({ left: 680, top: 390, pointerEvents: 'none', zIndex: '2147483647' })

  const cursorInterceptsPointer = await ctx.page.evaluate(() => {
    const cursorElement = document.querySelector('[data-deepdesk-browser-cursor="v3"]')
    return document.elementFromPoint(680, 390) === cursorElement
  })
  expect(cursorInterceptsPointer).toBe(false)

  const iconPath = cursor.locator('[data-deepdesk-browser-cursor-icon] path')
  await expect(iconPath).toHaveAttribute('d', /^M0 0/)
  await expect(iconPath).toHaveAttribute('fill', '#202124')
  await expect(iconPath).toHaveAttribute('stroke', '#fff')
  await expect(cursor.locator('[data-deepdesk-browser-cursor-badge]')).toHaveText('AI')

  await ctx.page.evaluate(buildBrowserCursorExpression({ x: 240, y: 180 }, 'move'))
  await expect(cursor).toHaveAttribute('data-state', 'move')
  await expect.poll(() => cursor.evaluate(element => ({
    left: element.getBoundingClientRect().left,
    top: element.getBoundingClientRect().top
  }))).toEqual({ left: 240, top: 180 })
})

test('targets the visible label instead of empty space inside a wide search control', async () => {
  if (!ctx) throw new Error('DeepDesk E2E app is not running')
  await ctx.page.evaluate(() => {
    const button = document.createElement('button')
    button.id = 'wide-search-control'
    button.style.cssText = 'all:initial;position:fixed;left:80px;top:90px;width:760px;height:72px;background:#fff;border:1px solid #ccd2dc;z-index:2000000000;cursor:pointer'
    button.innerHTML = '<span style="position:absolute;right:24px;top:22px;font:20px sans-serif;color:#111">搜索</span>'
    button.addEventListener('click', () => { button.dataset.clicked = 'true' })
    document.documentElement.appendChild(button)
  })

  const located = await ctx.page.evaluate(buildBrowserElementLocatorExpression('#wide-search-control', false)) as {
    ok: boolean
    x: number
    y: number
    target: string
  }
  expect(located).toMatchObject({ ok: true, target: 'content' })
  expect(located.x).toBeGreaterThan(740)
  expect(located.y).toBeGreaterThan(100)
  expect(located.y).toBeLessThan(155)

  const cursorClient = {
    call: async (_method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
      return await ctx!.page.evaluate(String(params.expression ?? ''))
    }
  }
  await showBrowserCursorPresence(cursorClient)
  await showBrowserClickCue(cursorClient, located)
  const cursor = ctx.page.locator('[data-deepdesk-browser-cursor="v3"]')
  await expect.poll(() => cursor.evaluate(element => ({
    left: Math.round(element.getBoundingClientRect().left),
    top: Math.round(element.getBoundingClientRect().top)
  }))).toEqual({ left: Math.round(located.x), top: Math.round(located.y) })

  await ctx.page.mouse.click(located.x, located.y)
  await expect(ctx.page.locator('#wide-search-control')).toHaveAttribute('data-clicked', 'true')
})
