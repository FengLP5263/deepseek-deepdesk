import { expect, test } from '@playwright/test'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, createContextBreakdownUserData, launchDeepDesk } from './helpers'

let ctx: DeepDeskE2EApp | null = null

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  ctx = null
})

test('shows context compaction as a compact non-message notice', async (_fixtures, testInfo) => {
  ctx = await launchDeepDesk(createContextBreakdownUserData())
  const page = ctx.page
  await page.locator('.conv-item', { hasText: '上下文组成视觉回归' }).click()

  const notice = page.locator('.agent-context-compaction')
  await expect(notice).toContainText('146K → 82K')
  await expect(notice).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('context-compaction.png') })
})
