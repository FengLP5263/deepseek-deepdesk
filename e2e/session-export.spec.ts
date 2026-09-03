import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, createMessageActionsUserData, launchDeepDesk } from './helpers'

let ctx: DeepDeskE2EApp | null = null

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  ctx = null
})

test('exports a session from the sidebar menu as Markdown', async ({ browserName: _browserName }, testInfo) => {
  const output = testInfo.outputPath('DeepDesk-session.md')
  ctx = await launchDeepDesk(createMessageActionsUserData(), { DEEPDESK_E2E_EXPORT_PATH: output })
  const page = ctx.page
  await page.getByRole('button', { name: '会话操作：消息操作视觉回归' }).click()
  await expect(page.getByRole('menu', { name: '会话操作' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('session-export-menu.png') })
  await page.getByRole('menuitem', { name: '导出 Markdown' }).click()

  await expect.poll(() => existsSync(output)).toBe(true)
  const markdown = readFileSync(output, 'utf8')
  expect(markdown).toContain('# 消息操作视觉回归')
  expect(markdown).toContain('## 用户')
  expect(markdown).toContain('## DeepDesk')
})
