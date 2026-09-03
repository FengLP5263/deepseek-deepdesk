import { expect, test } from '@playwright/test'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, createContextBreakdownUserData, launchDeepDesk } from './helpers'

let ctx: DeepDeskE2EApp | null = null

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  ctx = null
})

test('handles a new task request while desktop presence is initialized', async () => {
  ctx = await launchDeepDesk(createContextBreakdownUserData())
  const page = ctx.page
  await page.locator('.conv-item', { hasText: '上下文组成视觉回归' }).click()
  await expect(page.getByText('上下文由系统指令')).toBeVisible()

  await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.webContents.send('app:new-task-requested'))

  await expect(page.getByText('你好，我是 DeepDesk')).toBeVisible()
  await expect(page.locator('.composer-textarea')).toBeFocused()
})
