import { expect, test } from '@playwright/test'
import type { DeepDeskE2EApp } from './helpers'
import { closeDeepDesk, launchDeepDesk, openSettings } from './helpers'

let ctx: DeepDeskE2EApp | null = null

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  ctx = null
})

test('adds an Anthropic Messages provider with protocol-specific guidance', async ({ browserName: _browserName }, testInfo) => {
  ctx = await launchDeepDesk()
  const page = ctx.page
  await openSettings(page)
  await page.getByRole('button', { name: '模型服务' }).click()
  await page.getByRole('button', { name: '添加服务' }).click()

  const modal = page.locator('.modal')
  await modal.locator('select').selectOption('anthropic')
  const inputs = modal.locator('input')
  await expect(inputs.nth(1)).toHaveValue('https://api.anthropic.com/v1')
  await expect(modal.getByText('原生支持 Claude Messages API')).toBeVisible()
  await inputs.nth(0).fill('团队 Claude')
  await inputs.nth(2).fill('sk-ant-e2e')
  await modal.getByRole('button', { name: '保存' }).click()

  const card = page.locator('.provider-card', { hasText: '团队 Claude' })
  await expect(card).toBeVisible()
  await expect(card.getByText('Anthropic', { exact: true })).toBeVisible()
  await expect(card.locator('select')).toHaveValue('anthropic')
  await card.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('anthropic-provider.png') })
})
