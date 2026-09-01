import { test, expect } from '@playwright/test'
import type { DeepDeskE2EApp, MockChatServer } from './helpers'
import { closeDeepDesk, createMultiProviderUserData, launchDeepDesk, startMockChatServer } from './helpers'

let ctx: DeepDeskE2EApp | null = null
let server: MockChatServer | null = null

test.beforeEach(async () => {
  server = await startMockChatServer('跨供应商模型调用成功。')
  ctx = await launchDeepDesk(createMultiProviderUserData(server.baseUrl))
})

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  await server?.close()
  ctx = null
  server = null
})

test('shows configured models from every provider and switches the active provider', async () => {
  const page = ctx!.page
  const modelButton = page.getByTitle('选择模型')
  await expect(modelButton).toContainText('Auto')

  await modelButton.click()
  const menu = page.getByRole('menu', { name: '选择模型' })
  await expect(menu).toBeVisible()
  const menuStyle = await menu.evaluate(element => ({
    width: Math.round(element.getBoundingClientRect().width),
    radius: getComputedStyle(element).borderTopLeftRadius
  }))
  expect(menuStyle.width).toBe(268)
  expect(menuStyle.radius).toBe('8px')
  await expect(menu.getByRole('switch', { name: 'Max 模式' })).toBeVisible()
  await expect(menu.getByRole('menuitemradio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true')
  await expect(menu.getByText('Mock Local', { exact: true })).toBeVisible()
  await expect(menu.getByText('智谱模型', { exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitemradio', { name: 'Mock Chat' })).toBeVisible()

  await menu.getByRole('menuitemradio', { name: 'GLM 5.3 Flash' }).click()
  await expect(modelButton).toContainText('GLM 5.3 Flash')

  const composer = page.getByPlaceholder('发消息，或让我帮你做点事…')
  await composer.fill('验证跨供应商模型')
  await composer.press('Enter')
  await expect(page.getByText('跨供应商模型调用成功。')).toBeVisible()
  expect(server!.requests[0]?.model).toBe('glm-5.3-flash')

  await modelButton.click()
  await menu.getByRole('menuitem', { name: '配置模型服务' }).click()
  await expect(page.locator('.settings-title', { hasText: '模型服务' })).toBeVisible()
})
