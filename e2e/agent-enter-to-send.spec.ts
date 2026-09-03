import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, createMemoryUserData, getDesktopPlatform, launchDeepDesk, startMockChatServer } from './helpers'

let ctx: DeepDeskE2EApp | null = null

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  ctx = null
})

test('honors the global Enter-to-send preference in the Agent composer', async () => {
  const mock = await startMockChatServer('快捷键发送成功')
  try {
    const userDataDir = createMemoryUserData(mock.baseUrl)
    const statePath = join(userDataDir, 'deepdesk.json')
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as { settings: { enterToSend: boolean } }
    state.settings.enterToSend = false
    writeFileSync(statePath, JSON.stringify(state), 'utf8')
    ctx = await launchDeepDesk(userDataDir)

    const composer = ctx.page.locator('.agent-empty-composer .composer-textarea')
    await composer.fill('第一行')
    await composer.press('Enter')
    await expect(composer).toHaveValue('第一行\n')
    await expect(ctx.page.getByText('快捷键发送成功')).toHaveCount(0)

    const modifier = await getDesktopPlatform(ctx.page) === 'macos' ? 'Meta' : 'Control'
    await composer.press(`${modifier}+Enter`)
    await expect(ctx.page.getByText('快捷键发送成功')).toBeVisible()
  } finally {
    await mock.close()
  }
})
