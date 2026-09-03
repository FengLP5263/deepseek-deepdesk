import { expect, test } from '@playwright/test'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, createMessageActionsUserData, launchDeepDesk } from './helpers'

let ctx: DeepDeskE2EApp | null = null

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  ctx = null
})

function colorSpread(color: string): number {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? []
  if (channels.length !== 3) throw new Error(`Unable to parse color: ${color}`)
  return Math.max(...channels) - Math.min(...channels)
}

test('uses neutral black and gray surfaces throughout the dark theme', async ({ browserName: _browserName }, testInfo) => {
  ctx = await launchDeepDesk(createMessageActionsUserData('dark'))
  const page = ctx.page
  await page.locator('.conv-item', { hasText: '消息操作视觉回归' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.locator('.composer-model-trigger').click()
  await expect(page.locator('.composer-model-popover')).toBeVisible()

  const colors = await page.locator('body, .app-main, .sidebar, .agent-composer, .agent-task, .conv-item.active, .composer-model-popover').evaluateAll(elements => elements.map(element => ({
    selector: element.className || element.tagName,
    background: getComputedStyle(element).backgroundColor
  })))
  for (const color of colors) {
    expect(color.background, `${color.selector} should use a neutral surface`).not.toBe('rgba(0, 0, 0, 0)')
    expect(colorSpread(color.background), `${color.selector} should not have a blue or purple cast`).toBeLessThanOrEqual(1)
  }

  await page.screenshot({ path: testInfo.outputPath('dark-theme-neutral.png') })
})
