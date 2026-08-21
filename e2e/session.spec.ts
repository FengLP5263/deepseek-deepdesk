import { test, expect } from '@playwright/test'
import { basename } from 'node:path'
import { closeDeepDesk, expectAppShell, expectComposerReady, getDesktopPlatform, goBackToChat, isMainWindowMaximized, launchDeepDesk, openSettings, pressAppShortcut } from './helpers'

test('runs local acceptance flow in one Electron window', async () => {
  test.setTimeout(90000)
  const ctx = await launchDeepDesk()
  const { app, page } = ctx

  try {
    await test.step('load app shell', async () => {
      await expectAppShell(page)
      await expectComposerReady(page)
    })

    await test.step('verify titlebar drag markers and settings navigation', async () => {
      const platform = await getDesktopPlatform(page)
      await expect(page.locator('.titlebar')).toHaveClass(/drag/)
      await expect(page.locator('.titlebar-title')).toHaveCount(0)
      if (platform === 'macos') await expect(page.locator('.win-controls')).toHaveCount(0)
      else await expect(page.locator('.win-controls')).toHaveClass(/no-drag/)

      await openSettings(page)
      await expect(page.locator('.settings-title', { hasText: '常规' })).toBeVisible()
      await goBackToChat(page)
    })

    await test.step('collapse and expand sidebar', async () => {
      await page.getByTitle('收起侧边栏').click()
      await expect(page.locator('.sidebar.collapsed')).toBeVisible()

      await page.getByTitle('新建任务').click()
      await expect(page.getByPlaceholder('发消息，或让我帮你做点事…')).toBeVisible()

      await page.getByTitle('展开侧边栏').click()
      await expect(page.locator('.sidebar:not(.collapsed)')).toBeVisible()
    })

    await test.step('verify shortcuts and sidebar account footer', async () => {
      await page.locator('.app-shell').click()
      await pressAppShortcut(page, ',')
      await expect(page.locator('.settings-title', { hasText: '常规' })).toBeVisible()

      await page.keyboard.press('Escape')
      await expect(page.locator('.titlebar-title')).toHaveCount(0)

      await expect(page.locator('.account-chip')).toContainText('个人账户')
      await page.getByRole('button', { name: '设置' }).click()
      await expect(page.locator('.settings-title', { hasText: '常规' })).toBeVisible()

      await pressAppShortcut(page, ',')
      await expect(page.locator('.titlebar-title')).toHaveCount(0)
    })

    await test.step('cycle composer permission mode', async () => {
      const permissionButton = page.getByTitle('选择权限模式')
      await expect(permissionButton).toContainText('每次询问')

      await permissionButton.click()
      const menu = page.getByRole('menu', { name: '选择权限模式' })
      await menu.getByRole('menuitemradio', { name: '替我审批' }).click()
      await expect(permissionButton).toContainText('替我审批')

      await permissionButton.click()
      await menu.getByRole('menuitemradio', { name: '完全访问' }).click()
      await expect(permissionButton).toContainText('完全访问')

      await permissionButton.click()
      await menu.getByRole('menuitemradio', { name: '每次询问' }).click()
      await expect(permissionButton).toContainText('每次询问')
    })

    await test.step('select a mock agent work directory without a native dialog', async () => {
      const directoryPicker = page.locator('.agent-composer .composer-left > .toolbar-item')

      await directoryPicker.click()
      const selectedDirectoryPicker = page.locator('.agent-composer .toolbar-item').filter({ hasText: basename(ctx.userDataDir) })
      await expect(selectedDirectoryPicker).toContainText(basename(ctx.userDataDir))
      await expect(selectedDirectoryPicker).toHaveAttribute('title', `工作目录：${ctx.userDataDir}`)
    })

    await test.step('validate composer and context meter', async () => {
      const textarea = page.getByPlaceholder('发消息，或让我帮你做点事…')
      const sendButton = page.locator('.send-btn')

      await expect(sendButton).toBeDisabled()
      await textarea.fill('本地验收：检查未配置 key 的提示')
      await expect(sendButton).toBeEnabled()
      await sendButton.click()

      await expect(page.getByText('请先在「设置 → 模型服务」中配置 API Key')).toBeVisible()

      await textarea.fill('第一行')
      await textarea.press('Shift+Enter')
      await textarea.pressSequentially('第二行')
      await expect(textarea).toHaveValue('第一行\n第二行')

      await page.locator('.ctx-trigger').click()
      await expect(page.locator('.ctx-panel')).toBeVisible()
    })

    await test.step('update general settings', async () => {
      await openSettings(page)
      await page.getByRole('button', { name: '常规' }).click()

      await page.getByRole('button', { name: '浅色' }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

      await page.getByRole('button', { name: '深色' }).click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

      await page.getByRole('button', { name: '替我审批' }).click()
      await goBackToChat(page)
      await expect(page.getByTitle('选择权限模式')).toContainText('替我审批')
    })

    await test.step('validate provider modal', async () => {
      await openSettings(page)
      await page.getByRole('button', { name: '模型服务' }).click()
      await page.getByRole('button', { name: '添加服务' }).click()

      const modal = page.locator('.modal')
      await expect(modal.locator('.modal-title', { hasText: '添加模型服务' })).toBeVisible()

      await modal.getByRole('button', { name: '保存' }).click()
      await expect(page.getByText('请填写服务名称')).toBeVisible()

      await modal.getByPlaceholder('例如：智谱 GLM / Kimi / 本地 Ollama').fill('Session Mock')
      await modal.getByPlaceholder('https://api.deepseek.com').fill('http://127.0.0.1:11434/v1')
      await modal.getByPlaceholder('sk-…').fill('sk-session')
      await modal.getByRole('button', { name: '保存' }).click()

      const card = page.locator('.provider-card').filter({ hasText: 'Session Mock' })
      await expect(card).toBeVisible()
      const apiKeyInput = card.getByPlaceholder('sk-…')
      await expect(apiKeyInput).toHaveAttribute('type', 'password')
      await card.locator('.input-wrap').locator('.icon-btn').click()
      await expect(apiKeyInput).toHaveAttribute('type', 'text')

      await card.getByPlaceholder('添加模型 ID，如 deepseek-v4-flash').fill('session-chat')
      await card.getByRole('button', { name: '添加' }).click()
      await expect(card.locator('.model-chip-item', { hasText: 'session-chat' })).toBeVisible()

      await card.getByRole('button', { name: '删除' }).click()
      await expect(page.locator('.provider-card').filter({ hasText: 'Session Mock' })).toBeHidden()
    })

    await test.step('toggle maximize window control', async () => {
      if (await getDesktopPlatform(page) === 'macos') {
        await expect(page.getByRole('button', { name: '最大化' })).toHaveCount(0)
        return
      }
      const maximize = page.getByRole('button', { name: '最大化' })
      const initiallyMaximized = await isMainWindowMaximized(app)

      await maximize.click()
      await expect.poll(() => isMainWindowMaximized(app)).not.toBe(initiallyMaximized)
      await expect(maximize).toHaveAttribute('aria-pressed', String(!initiallyMaximized))

      await maximize.click()
      await expect.poll(() => isMainWindowMaximized(app)).toBe(initiallyMaximized)
      await expect(maximize).toHaveAttribute('aria-pressed', String(initiallyMaximized))
    })
  } finally {
    await closeDeepDesk(ctx)
  }
})
