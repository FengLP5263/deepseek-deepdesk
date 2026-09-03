import { expect, test } from '@playwright/test'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, closeDeepDeskWithoutRemovingData, createContextBreakdownUserData, launchDeepDesk } from './helpers'

let ctx: DeepDeskE2EApp | null = null

test.beforeEach(async () => {
  ctx = await launchDeepDesk()
})

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  ctx = null
})

async function ctrlWheel(deltaY: number): Promise<void> {
  if (!ctx) throw new Error('DeepDesk E2E app is not running')
  await ctx.page.mouse.move(500, 300)
  await ctx.page.keyboard.down('Control')
  await ctx.page.mouse.wheel(0, deltaY)
  await ctx.page.keyboard.up('Control')
}

async function effectiveWidth(selector: string): Promise<number> {
  if (!ctx) throw new Error('DeepDesk E2E app is not running')
  return ctx.page.locator(selector).first().evaluate(element => {
    const root = element.closest('#root')
    const zoom = root ? Number.parseFloat(getComputedStyle(root).zoom) : 1
    return element.getBoundingClientRect().width * zoom
  })
}

async function expectAppShellFillsViewport(): Promise<void> {
  if (!ctx) throw new Error('DeepDesk E2E app is not running')
  const shellEdges = await ctx.page.evaluate(() => {
    const root = document.querySelector('#root')!.getBoundingClientRect()
    const close = document.querySelector('.win-btn.close')?.getBoundingClientRect()
    const sidebar = document.querySelector('.sidebar')!.getBoundingClientRect()
    const main = document.querySelector('.app-main')!.getBoundingClientRect()
    return {
      viewportRight: window.innerWidth,
      viewportBottom: window.innerHeight,
      rootRight: root.right,
      rootBottom: root.bottom,
      closeRight: close?.right ?? null,
      sidebarBottom: sidebar.bottom,
      mainRight: main.right,
      mainBottom: main.bottom
    }
  })
  expect(Math.abs(shellEdges.rootRight - shellEdges.viewportRight)).toBeLessThan(2)
  expect(Math.abs(shellEdges.rootBottom - shellEdges.viewportBottom)).toBeLessThan(2)
  if (shellEdges.closeRight !== null) {
    expect(Math.abs(shellEdges.closeRight - shellEdges.viewportRight)).toBeLessThan(2)
  }
  expect(Math.abs(shellEdges.sidebarBottom - shellEdges.viewportBottom)).toBeLessThan(2)
  expect(Math.abs(shellEdges.mainRight - shellEdges.viewportRight)).toBeLessThan(2)
  expect(Math.abs(shellEdges.mainBottom - shellEdges.viewportBottom)).toBeLessThan(2)
}

test('scales the complete interface with Ctrl + mouse wheel and persists the selected scale', async () => {
  if (!ctx) throw new Error('DeepDesk E2E app is not running')
  const html = ctx.page.locator('html')
  await expect(html).toHaveAttribute('data-font-scale', '100')
  const initialIconWidth = await effectiveWidth('.composer-model-trigger svg')

  await ctx.page.mouse.move(500, 300)
  await ctx.page.mouse.wheel(0, -100)
  await expect(html).toHaveAttribute('data-font-scale', '100')

  await ctrlWheel(-100)
  await expect(html).toHaveAttribute('data-font-scale', '110')
  await expect.poll(() => ctx!.page.locator('#root').evaluate(element => getComputedStyle(element).zoom)).toBe('1.1')
  await expect.poll(() => effectiveWidth('.composer-model-trigger svg')).toBeGreaterThan(initialIconWidth * 1.08)

  const userDataDir = ctx.userDataDir
  await closeDeepDeskWithoutRemovingData(ctx)
  ctx = await launchDeepDesk(userDataDir)

  await expect(ctx.page.locator('html')).toHaveAttribute('data-font-scale', '110')
})

test('keeps context details aligned and scales model icons at the maximum scale', async () => {
  if (!ctx) throw new Error('DeepDesk E2E app is not running')
  await closeDeepDesk(ctx)
  ctx = await launchDeepDesk(createContextBreakdownUserData())
  await ctx.page.locator('.conv-item', { hasText: '上下文组成视觉回归' }).click()

  for (let step = 0; step < 5; step += 1) await ctrlWheel(-100)
  await expect(ctx.page.locator('html')).toHaveAttribute('data-font-scale', '150')
  await expect.poll(() => ctx!.page.locator('#root').evaluate(element => getComputedStyle(element).zoom)).toBe('1.5')

  await expect.poll(() => effectiveWidth('.composer-model-trigger svg')).toBeGreaterThan(20)
  await ctx.page.locator('.composer-model-trigger').click()
  await expect(ctx.page.locator('.composer-model-popover')).toBeVisible()
  await expect.poll(() => effectiveWidth('.composer-model-popover .model-menu-option svg')).toBeGreaterThan(23)
  await ctx.page.locator('.composer-model-trigger').click()

  await ctx.page.locator('.ctx-trigger').click()
  const panel = ctx.page.locator('.ctx-panel')
  await expect(panel).toBeVisible()
  const headerLines = await panel.locator('.ctx-header > span').evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().top)))
  expect(new Set(headerLines).size).toBe(1)
  await expect.poll(() => panel.locator('.ctx-header').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await expectAppShellFillsViewport()

  await ctx.page.locator('.ctx-trigger').click()
  for (let step = 0; step < 7; step += 1) await ctrlWheel(100)
  await expect(ctx.page.locator('html')).toHaveAttribute('data-font-scale', '80')
  await expectAppShellFillsViewport()
})
