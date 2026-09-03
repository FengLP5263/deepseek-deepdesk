import { expect, test } from '@playwright/test'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, createConnectorSessionUserData, launchDeepDesk } from './helpers'

let ctx: DeepDeskE2EApp | null = null

test.beforeEach(async () => {
  ctx = await launchDeepDesk(createConnectorSessionUserData())
})

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  ctx = null
})

test('searches desktop and connector sessions with keyboard navigation', async () => {
  const page = ctx!.page
  await expect(page.getByRole('button', { name: /搜索任务/u })).toBeVisible()

  await page.keyboard.press('Control+K')
  const dialog = page.getByRole('dialog', { name: '搜索任务' })
  const input = page.getByRole('textbox', { name: '搜索任务或对话内容' })
  await expect(dialog).toBeVisible()
  await expect(input).toBeFocused()
  await expect(dialog.getByRole('option')).toHaveCount(2)

  const bounds = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight }
  })
  expect(bounds.left).toBeGreaterThanOrEqual(0)
  expect(bounds.top).toBeGreaterThanOrEqual(0)
  expect(bounds.right).toBeLessThanOrEqual(bounds.width)
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.height)

  await input.fill('微信 同步')
  await expect(dialog.getByRole('option')).toHaveCount(1)
  await expect(dialog.getByText('项目微信群', { exact: true })).toBeVisible()
  await expect(dialog.getByText(/帮我同步这条微信消息/u)).toBeVisible()
  await input.press('Enter')

  await expect(dialog).toBeHidden()
  await expect(page.locator('.conv-item.active .conv-title-text')).toHaveText('项目微信群')

  await page.keyboard.press('Control+K')
  await input.fill('普通')
  await input.press('ArrowDown')
  await input.press('ArrowUp')
  await input.press('Enter')
  await expect(page.locator('.conv-item.active .conv-title-text')).toHaveText('普通本地任务')
})

test('opens from the sidebar and closes without stopping the active task', async () => {
  const page = ctx!.page
  await page.getByRole('button', { name: /搜索任务/u }).click()
  const dialog = page.getByRole('dialog', { name: '搜索任务' })
  await expect(dialog).toBeVisible()
  await page.getByRole('textbox', { name: '搜索任务或对话内容' }).press('Escape')
  await expect(dialog).toBeHidden()
})
