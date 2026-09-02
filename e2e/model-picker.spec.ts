import { test, expect } from '@playwright/test'
import type { DeepDeskE2EApp, MockChatServer } from './helpers'
import { closeDeepDesk, closeDeepDeskWithoutRemovingData, createMultiProviderUserData, launchDeepDesk, startMockChatServer } from './helpers'

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

test('shows configured models from every provider and switches the active provider', async ({ browserName: _browserName }, testInfo) => {
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
  const maxSwitch = menu.getByRole('switch', { name: 'Max 模式' })
  await expect(maxSwitch).toHaveAttribute('aria-checked', 'false')
  await maxSwitch.click()
  await expect(maxSwitch).toHaveAttribute('aria-checked', 'true')
  await expect(menu.getByRole('menuitemradio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true')
  await expect(menu.getByText('Mock Local', { exact: true })).toBeVisible()
  await expect(menu.getByText('智谱模型', { exact: true })).toBeVisible()
  await expect(menu.getByRole('menuitemradio', { name: 'Mock Chat' })).toBeVisible()

  const search = menu.getByRole('textbox', { name: '搜索模型' })
  await search.fill('glm')
  await expect(menu.getByRole('menuitemradio', { name: 'GLM 5.3 Flash' })).toBeVisible()
  await expect(menu.getByRole('menuitemradio', { name: 'Mock Chat' })).toBeHidden()
  await page.screenshot({ path: testInfo.outputPath('model-search.png') })
  await search.fill('不存在的模型')
  await expect(menu.getByText('未找到匹配模型')).toBeVisible()
  await search.fill('')

  await menu.getByRole('menuitemradio', { name: 'GLM 5.3 Flash' }).click()
  await expect(modelButton).toContainText('GLM 5.3 Flash')
  await page.getByTitle('上下文用量').click()
  const reserveRow = page.locator('.ctx-breakdown-row', { hasText: '回复预留' })
  await expect(reserveRow).toContainText('32.8K')
  await page.getByTitle('上下文用量').click()

  const composer = page.getByPlaceholder('发消息，或让我帮你做点事…')
  await composer.fill('验证跨供应商模型')
  await composer.press('Enter')
  await expect(page.getByText('跨供应商模型调用成功。')).toBeVisible()
  expect(server!.requests[0]?.model).toBe('glm-5.3-flash')
  expect(server!.requests[0]?.max_tokens).toBe(32768)

  await modelButton.click()
  await menu.getByRole('menuitem', { name: '配置模型服务' }).click()
  await expect(page.locator('.settings-title', { hasText: '模型服务' })).toBeVisible()

  const userDataDir = ctx!.userDataDir
  await closeDeepDeskWithoutRemovingData(ctx)
  ctx = await launchDeepDesk(userDataDir)
  await ctx.page.getByTitle('选择模型').click()
  await expect(ctx.page.getByRole('switch', { name: 'Max 模式' })).toHaveAttribute('aria-checked', 'true')
})

test('switches to persistent read-only plan mode and only exposes safe tools', async () => {
  const page = ctx!.page
  const modeButton = page.getByTitle('选择工作模式')
  await expect(modeButton).toContainText('执行')

  await modeButton.click()
  const menu = page.getByRole('menu', { name: '选择工作模式' })
  await expect(menu.getByRole('menuitemradio', { name: '执行任务' })).toHaveAttribute('aria-checked', 'true')
  await menu.getByRole('menuitemradio', { name: '规划方案' }).click()
  await expect(modeButton).toContainText('规划')

  const composerLayout = await page.locator('.composer-actions').evaluate(element => {
    const left = element.querySelector('.composer-left')!.getBoundingClientRect()
    const right = element.querySelector('.composer-right')!.getBoundingClientRect()
    return {
      leftRight: left.right,
      rightLeft: right.left,
      containerLeft: element.getBoundingClientRect().left,
      containerRight: element.getBoundingClientRect().right
    }
  })
  expect(composerLayout.leftRight).toBeLessThanOrEqual(composerLayout.rightLeft)
  expect(composerLayout.leftRight).toBeGreaterThan(composerLayout.containerLeft)
  expect(composerLayout.rightLeft).toBeLessThan(composerLayout.containerRight)

  const composer = page.getByPlaceholder('发消息，或让我帮你做点事…')
  await composer.fill('先检查项目并给出计划')
  await composer.press('Enter')
  await expect(page.getByText('跨供应商模型调用成功。')).toBeVisible()

  const toolNames = (server!.requests[0]?.tools ?? []).map(tool => (tool.function as { name?: string } | undefined)?.name)
  expect(toolNames).toContain('read_file')
  expect(toolNames).toContain('browser_snapshot')
  expect(toolNames).not.toContain('write_file')
  expect(toolNames).not.toContain('browser_click')
  expect(String(server!.requests[0]?.messages?.[0]?.content)).toContain('当前工作模式：规划')

  const userDataDir = ctx!.userDataDir
  await closeDeepDeskWithoutRemovingData(ctx)
  ctx = await launchDeepDesk(userDataDir)
  await expect(ctx.page.getByTitle('选择工作模式')).toContainText('规划')
})
