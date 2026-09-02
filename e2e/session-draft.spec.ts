import { expect, test } from '@playwright/test'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, closeDeepDeskWithoutRemovingData, createMemoryUserData, launchDeepDesk, startMockChatServer } from './helpers'

let ctx: DeepDeskE2EApp | null = null

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  ctx = null
})

test('restores an unsent Agent draft after restart and clears it after sending', async () => {
  const mock = await startMockChatServer('草稿已发送')
  try {
    ctx = await launchDeepDesk(createMemoryUserData(mock.baseUrl))
    const composer = ctx.page.locator('.agent-empty-composer .composer-textarea')
    await composer.fill('重启后继续编辑的草稿')
    await ctx.page.waitForTimeout(250)

    const userDataDir = ctx.userDataDir
    await closeDeepDeskWithoutRemovingData(ctx)
    ctx = await launchDeepDesk(userDataDir)
    const restored = ctx.page.locator('.agent-empty-composer .composer-textarea')
    await expect(restored).toHaveValue('重启后继续编辑的草稿')
    await ctx.page.locator('.agent-empty-composer .send-btn').click()
    await expect(ctx.page.getByText('草稿已发送')).toBeVisible()
    await ctx.page.waitForTimeout(250)

    await closeDeepDeskWithoutRemovingData(ctx)
    ctx = await launchDeepDesk(userDataDir)
    await expect(ctx.page.locator('.agent-empty-composer .composer-textarea')).toHaveValue('')
  } finally {
    await mock.close()
  }
})
