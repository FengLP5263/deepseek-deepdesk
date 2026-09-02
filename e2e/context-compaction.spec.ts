import { expect, test } from '@playwright/test'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, createContextBreakdownUserData, launchDeepDesk } from './helpers'

let ctx: DeepDeskE2EApp | null = null

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  ctx = null
})

test('shows context compaction as a compact non-message notice', async ({ browserName: _browserName }, testInfo) => {
  ctx = await launchDeepDesk(createContextBreakdownUserData())
  const page = ctx.page
  await page.locator('.conv-item', { hasText: '上下文组成视觉回归' }).click()

  const notice = page.locator('.agent-context-compaction')
  await expect(notice).toContainText('146K → 82K')
  await expect(notice).toBeVisible()
  const tool = page.locator('.agent-tool')
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as Window & { __copiedToolResult?: string }).__copiedToolResult = text } } }))
  await tool.getByRole('button', { name: '复制工具结果' }).click()
  await expect(tool.getByRole('button', { name: '工具结果已复制' })).toBeVisible()
  await expect(tool.locator('.agent-tool-result')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as Window & { __copiedToolResult?: string }).__copiedToolResult)).toBe('store.ts 中包含持久化逻辑。')
  await tool.locator('.agent-tool-head').click()
  await expect(tool.locator('.agent-tool-result')).toBeVisible()
  await page.locator('.ctx-trigger').click()
  const panel = page.locator('.ctx-panel')
  await expect(panel.getByText('工具定义')).toBeVisible()
  await expect(panel.getByText('回复预留')).toBeVisible()
  await expect(panel.locator('.ctx-bar-segment[data-tone="tool-schema"]')).toBeVisible()
  await expect(panel.locator('.ctx-bar-segment[data-tone="output-reserve"]')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('context-compaction.png') })
})
