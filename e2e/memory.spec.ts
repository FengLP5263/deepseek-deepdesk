import { test, expect } from '@playwright/test'
import type { DeepDeskE2EApp, MockChatServer } from './helpers'
import { closeDeepDesk, createMultiProviderUserData, launchDeepDesk, startMockChatServer } from './helpers'

let ctx: DeepDeskE2EApp | null = null
let server: MockChatServer | null = null

test.beforeEach(async () => {
  server = await startMockChatServer('我会按你的偏好回答。')
  ctx = await launchDeepDesk(createMultiProviderUserData(server.baseUrl))
})

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  await server?.close()
  ctx = null
  server = null
})

test('captures an explicit memory and shows it in settings without manual entry', async () => {
  const page = ctx!.page
  const composer = page.getByPlaceholder('发消息，或让我帮你做点事…')
  await expect(page.getByTitle('未选择时使用系统用户主目录').last()).toContainText('用户主目录')

  await composer.fill('帮我记一下：我喜欢先给结论再解释')
  await composer.press('Enter')
  await expect(page.getByText('我会按你的偏好回答。')).toBeVisible()

  await page.getByRole('button', { name: '设置' }).click()
  await page.getByRole('button', { name: '记忆' }).click()
  const sectionTitle = page.locator('.settings-section-title', { hasText: '长期记忆' })
  const sectionDescription = page.locator('.settings-section-desc')
  const [titleBox, descriptionBox] = await Promise.all([sectionTitle.boundingBox(), sectionDescription.boundingBox()])
  expect(titleBox).not.toBeNull()
  expect(descriptionBox).not.toBeNull()
  expect(descriptionBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height + 6)
  const memoryCard = page.locator('.memory-card', { hasText: '我喜欢先给结论再解释' })
  await expect(memoryCard).toBeVisible()
  await expect(memoryCard).toContainText('自动记录')
  await expect(memoryCard).toContainText('偏好')
})
