import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { basename } from 'node:path'
import type { DeepDeskE2EApp } from './helpers'
import {
  closeDeepDesk,
  closeDeepDeskWithoutRemovingData,
  createLongAgentSessionUserData,
  createMessageActionsUserData,
  expectAppShell,
  expectComposerReady,
  getDesktopPlatform,
  goBackToChat,
  isMainWindowMaximized,
  launchDeepDesk,
  openSettings,
  pressAppShortcut
} from './helpers'

let app: ElectronApplication
let page: Page
let ctx: DeepDeskE2EApp | null = null

test.beforeEach(async () => {
  ctx = await launchDeepDesk()
  app = ctx.app
  page = ctx.page
})

test.afterEach(async () => {
  await closeDeepDesk(ctx)
  ctx = null
})

test('loads the app shell and opens settings', async () => {
  await expectAppShell(page)
  await expectComposerReady(page)

  const fonts = await page.evaluate(async () => {
    await document.fonts.ready
    const title = document.querySelector('.empty-title')
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--font-mono')
    return {
      body: getComputedStyle(document.body).fontFamily,
      title: title ? getComputedStyle(title).fontFamily : '',
      mono,
      loadedFaces: Array.from(document.fonts)
        .filter(font => font.family === 'Alimama FangYuanTi VF' || font.family === 'Alimama ShuHeiTi')
        .map(font => ({ family: font.family, status: font.status }))
    }
  })

  expect(fonts.body).toContain('Alimama FangYuanTi VF')
  expect(fonts.title).toContain('Alimama ShuHeiTi')
  expect(fonts.mono).toContain('Cascadia Code')
  expect(fonts.loadedFaces).toEqual(expect.arrayContaining([
    { family: 'Alimama FangYuanTi VF', status: 'loaded' },
    { family: 'Alimama ShuHeiTi', status: 'loaded' }
  ]))

  const composerToolbarStyles = await page.evaluate(() => {
    const permission = document.querySelector('.composer-left .composer-menu-trigger')
    const workdir = document.querySelector('.composer-left > .toolbar-item:not(.composer-menu-trigger)')
    const model = document.querySelector('.composer-model-trigger')
    if (!permission || !workdir || !model) return null

    return [permission, workdir, model].map(element => {
      const style = getComputedStyle(element)
      return {
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        lineHeight: style.lineHeight
      }
    })
  })

  expect(composerToolbarStyles).toEqual([
    { fontSize: '15px', fontWeight: '400', lineHeight: '22px' },
    { fontSize: '15px', fontWeight: '400', lineHeight: '22px' },
    { fontSize: '15px', fontWeight: '400', lineHeight: '22px' }
  ])

  await openSettings(page)

  await expect(page.getByRole('button', { name: '模型服务' })).toBeVisible()
  await expect(page.getByRole('button', { name: '常规' })).toBeVisible()
})

test('aligns the settings navigation and content columns', async () => {
  await openSettings(page)

  const layout = await page.evaluate(() => {
    const heading = document.querySelector('.settings-page-head')
    const content = document.querySelector('.settings-inner')
    const search = document.querySelector('.settings-search')
    const activeItem = document.querySelector('.settings-nav-item.active')
    if (!heading || !content || !search || !activeItem) return null

    return {
      headingLeft: Math.round(heading.getBoundingClientRect().left),
      contentLeft: Math.round(content.getBoundingClientRect().left),
      searchLeft: Math.round(search.getBoundingClientRect().left),
      activeItemLeft: Math.round(activeItem.getBoundingClientRect().left),
      searchRight: Math.round(search.getBoundingClientRect().right),
      activeItemRight: Math.round(activeItem.getBoundingClientRect().right)
    }
  })

  expect(layout).not.toBeNull()
  expect(layout!.headingLeft).toBe(layout!.contentLeft)
  expect(layout!.searchLeft).toBe(layout!.activeItemLeft)
  expect(layout!.searchRight).toBe(layout!.activeItemRight)
})

test('marks titlebar drag regions and supports settings back button', async () => {
  const platform = await getDesktopPlatform(page)
  await expect(page.locator('.titlebar')).toHaveClass(/drag/)
  await expect(page.locator('.titlebar')).toHaveClass(new RegExp('platform-' + platform))
  await expect(page.locator('.titlebar-tools')).toHaveClass(/no-drag/)
  await expect(page.locator('.titlebar-title')).toHaveCount(0)
  await expect(page.getByTitle('收起侧边栏')).toBeVisible()
  await expect(page.getByTitle('新建任务')).toBeVisible()
  if (platform === 'macos') {
    await expect(page.locator('.win-controls')).toHaveCount(0)
    const toolsLeft = await page.locator('.titlebar-tools').evaluate(element => Math.round(element.getBoundingClientRect().left))
    expect(toolsLeft).toBeGreaterThanOrEqual(70)
  } else {
    await expect(page.locator('.win-controls')).toHaveClass(/no-drag/)
  }

  await openSettings(page)

  await expect(page.locator('.settings-title', { hasText: '常规' })).toBeVisible()

  await goBackToChat(page)

  await expect(page.getByPlaceholder('发消息，或让我帮你做点事…')).toBeVisible()
})

test('integrates the titlebar and sidebar into one application shell', async () => {
  await expect(page.locator('.app-main')).toBeVisible()

  const layout = await page.evaluate(() => {
    const titlebar = document.querySelector('.titlebar')
    const sidebar = document.querySelector('.sidebar')
    const main = document.querySelector('.app-main')
    if (!titlebar || !sidebar || !main) return null
    return {
      titlebarBorder: getComputedStyle(titlebar).borderBottomWidth,
      titlebarHeight: getComputedStyle(titlebar).height,
      sidebarBorder: getComputedStyle(sidebar).borderRightWidth,
      sidebarWidth: getComputedStyle(sidebar).width,
      mainRadius: getComputedStyle(main).borderTopLeftRadius
    }
  })

  expect(layout).toEqual({ titlebarBorder: '0px', titlebarHeight: '34px', sidebarBorder: '0px', sidebarWidth: '220px', mainRadius: '14px' })
})

test('centers the empty conversation composer with the welcome content', async () => {
  const composer = page.locator('.agent-empty .agent-composer')
  await expect(composer).toBeVisible()
  await expect(page.locator('.agent-footer')).toBeHidden()

  const layout = await page.evaluate(() => {
    const main = document.querySelector('.app-main')
    const input = document.querySelector('.agent-empty .agent-composer')
    if (!main || !input) return null
    const mainBox = main.getBoundingClientRect()
    const inputBox = input.getBoundingClientRect()
    return {
      composerTopRatio: (inputBox.top - mainBox.top) / mainBox.height,
      composerBottomRatio: (inputBox.bottom - mainBox.top) / mainBox.height
    }
  })

  expect(layout).not.toBeNull()
  expect(layout!.composerTopRatio).toBeGreaterThan(0.35)
  expect(layout!.composerBottomRatio).toBeLessThan(0.82)
})

test('supports sidebar collapse, expand, and new task action', async () => {
  await expect(page.locator('.sidebar')).toBeVisible()
  await expect(page.getByRole('button', { name: /最近任务 \(0\)/ })).toHaveAttribute('aria-expanded', 'true')
  const navIconMetrics = await page.evaluate(() => Array.from(document.querySelectorAll<SVGElement>('.sidebar-nav-icon')).map(icon => ({
    width: Math.round(icon.getBoundingClientRect().width),
    height: Math.round(icon.getBoundingClientRect().height),
    iconClass: Array.from(icon.classList).find(className => className.startsWith('lucide-') && className !== 'lucide') ?? '',
    strokeWidth: icon.getAttribute('stroke-width')
  })))
  expect(navIconMetrics).toEqual([
    { width: 17, height: 17, iconClass: 'lucide-square-pen', strokeWidth: '1.9' },
    { width: 17, height: 17, iconClass: 'lucide-link2', strokeWidth: '1.9' },
    { width: 17, height: 17, iconClass: 'lucide-blocks', strokeWidth: '1.9' },
    { width: 17, height: 17, iconClass: 'lucide-ellipsis', strokeWidth: '1.9' }
  ])

  await page.getByTitle('收起侧边栏').click()

  await expect(page.locator('.sidebar.collapsed')).toHaveCSS('width', '0px')
  await expect(page.getByTitle('展开侧边栏')).toBeVisible()

  await page.getByTitle('新建任务').click()
  await expect(page.getByPlaceholder('发消息，或让我帮你做点事…')).toBeVisible()

  await page.getByTitle('展开侧边栏').click()

  await expect(page.locator('.sidebar:not(.collapsed)')).toBeVisible()
  await expect(page.locator('.brand', { hasText: 'DeepDesk' })).toBeVisible()
  await expect(page.locator('.brand-version')).toHaveText(/^v\d+\.\d+\.\d+$/)
})

test('opens sidebar feature pages and applies a skill template', async () => {
  await page.getByRole('button', { name: '连接器' }).click()
  await expect(page.locator('.titlebar-title')).toHaveCount(0)
  await expect(page.locator('.hub-header', { hasText: '连接器' })).toBeVisible()
  await page.getByRole('button', { name: '打开模型服务设置' }).click()
  await expect(page.locator('.settings-title', { hasText: '模型服务' })).toBeVisible()

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '技能广场' }).click()
  await page.setViewportSize({ width: 1050, height: 720 })
  await expect(page.locator('.titlebar-title')).toHaveCount(0)
  await expect(page.locator('.skill-section-head', { hasText: '精选技能' })).toBeVisible()
  const skillToolbarLayout = await page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll<HTMLElement>('.skill-top-tab, .skill-pill'))
    const avatar = document.querySelector<HTMLElement>('.skill-avatar')
    return {
      controls: controls.map(control => ({
        height: Math.round(control.getBoundingClientRect().height),
        whiteSpace: getComputedStyle(control).whiteSpace
      })),
      avatar: avatar
        ? {
            width: Math.round(avatar.getBoundingClientRect().width),
            borderRadius: getComputedStyle(avatar).borderTopLeftRadius
          }
        : null
    }
  })
  expect(skillToolbarLayout.controls.length).toBeGreaterThan(0)
  expect(skillToolbarLayout.controls.every(control => control.whiteSpace === 'nowrap' && control.height <= 38)).toBe(true)
  expect(skillToolbarLayout.avatar).not.toBeNull()
  expect(skillToolbarLayout.avatar!.borderRadius === '50%' || Number.parseFloat(skillToolbarLayout.avatar!.borderRadius) >= skillToolbarLayout.avatar!.width / 2).toBe(true)
  await page.getByPlaceholder('搜索技能').fill('UI')
  const uiSkillCard = page.locator('.skill-grid .skill-card', { hasText: 'UI 走查' })
  await expect(uiSkillCard).toBeVisible()
  await uiSkillCard.getByTitle('取消安装').click()
  await page.getByRole('button', { name: /我安装的/ }).click()
  await expect(uiSkillCard).toBeHidden()
  await page.getByRole('button', { name: /我安装的/ }).click()
  await uiSkillCard.getByTitle('安装技能').click()
  await uiSkillCard.getByRole('button', { name: '使用技能' }).click()
  await expect(page.getByPlaceholder('发消息，或让我帮你做点事…')).toHaveValue(/UI 做一次走查/)

  await page.getByRole('button', { name: '更多' }).click()
  await expect(page.locator('.titlebar-title')).toHaveCount(0)
  await page.locator('.hub-card', { hasText: '设置' }).getByRole('button', { name: '打开设置' }).click()
  await expect(page.locator('.settings-title', { hasText: '常规' })).toBeVisible()
})

test('supports global settings shortcuts and sidebar account footer', async () => {
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

test('selects agent permission mode from the gray composer menu', async () => {
  const permissionButton = page.getByTitle('选择权限模式')
  const modelButton = page.getByTitle('选择模型')

  await expect(permissionButton).toContainText('每次询问')

  await permissionButton.click()
  const menu = page.getByRole('menu', { name: '选择权限模式' })
  await expect(menu).toBeVisible()
  const permissionStyle = await menu.evaluate(element => {
    const option = element.querySelector<HTMLElement>('[role="menuitemradio"]')
    const style = getComputedStyle(element)
    const optionStyle = option ? getComputedStyle(option) : null
    return {
      backgroundColor: style.backgroundColor,
      borderRadius: style.borderTopLeftRadius,
      boxShadow: style.boxShadow,
      paddingTop: style.paddingTop,
      optionBorderRadius: optionStyle?.borderTopLeftRadius ?? '',
      optionHeight: option ? Math.round(option.getBoundingClientRect().height) : 0
    }
  })
  await modelButton.click()
  const modelMenu = page.getByRole('menu', { name: '选择模型' })
  await expect(modelMenu).toBeVisible()
  await expect(menu).toBeHidden()
  const modelStyle = await modelMenu.evaluate(element => {
    const option = element.querySelector<HTMLElement>('[role="menuitemradio"]')
    const style = getComputedStyle(element)
    const optionStyle = option ? getComputedStyle(option) : null
    return {
      backgroundColor: style.backgroundColor,
      borderRadius: style.borderTopLeftRadius,
      boxShadow: style.boxShadow,
      paddingTop: style.paddingTop,
      optionBorderRadius: optionStyle?.borderTopLeftRadius ?? '',
      optionHeight: option ? Math.round(option.getBoundingClientRect().height) : 0
    }
  })
  expect(permissionStyle).toEqual(modelStyle)

  await permissionButton.click()
  await expect(modelMenu).toBeHidden()
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitemradio', { name: '替我审批' }).click()
  await expect(permissionButton).toContainText('替我审批')

  await permissionButton.click()
  await menu.getByRole('menuitemradio', { name: '完全访问' }).click()
  await expect(permissionButton).toContainText('完全访问')

  await permissionButton.click()
  await menu.getByRole('menuitemradio', { name: '每次询问' }).click()
  await expect(permissionButton).toContainText('每次询问')
})

test('selects a model from the polished composer model picker', async () => {
  const modelButton = page.getByTitle('选择模型')

  await expect(modelButton).toContainText('Auto')

  await modelButton.click()
  const menu = page.getByRole('menu', { name: '选择模型' })
  await expect(menu).toBeVisible()
  const menuStyle = await menu.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return {
      width: Math.round(rect.width),
      radius: getComputedStyle(element).borderTopLeftRadius
    }
  })
  expect(menuStyle.width).toBeLessThanOrEqual(248)
  expect(menuStyle.radius).toBe('8px')
  await expect(menu).not.toContainText('0.79')
  await expect(menu.getByRole('switch', { name: 'Max 模式' })).toBeVisible()
  await expect(menu.getByRole('menuitemradio', { name: 'Auto' })).toHaveAttribute('aria-checked', 'true')

  await menu.getByRole('menuitemradio', { name: 'DeepSeek V4 Pro（深度思考）' }).click()
  await expect(modelButton).toContainText('DeepSeek V4 Pro（深度思考）')

  await modelButton.click()
  await page.getByRole('menuitem', { name: '配置自定义模型' }).click()
  await expect(page.locator('.settings-title', { hasText: '模型服务' })).toBeVisible()
})

test('selects a mock agent work directory without opening a native dialog', async () => {
  const directoryPicker = page.locator('.agent-composer .composer-left > .toolbar-item')

  await directoryPicker.click()

  const selectedDirectoryPicker = page.locator('.agent-composer .toolbar-item').filter({ hasText: basename(ctx!.userDataDir) })
  await expect(selectedDirectoryPicker).toContainText(basename(ctx!.userDataDir))
  await expect(selectedDirectoryPicker).toHaveAttribute('title', `工作目录：${ctx!.userDataDir}`)
})

test('updates general settings without calling external services', async () => {
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByRole('button', { name: '常规' }).click()

  await page.getByRole('button', { name: '浅色' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  await page.getByRole('button', { name: '深色' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await page.getByRole('button', { name: '替我审批' }).click()
  await page.getByTitle('返回').click()

  await expect(page.getByTitle('选择权限模式')).toContainText('替我审批')
})

test('opens provider modal, validates required fields, and closes it', async () => {
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByRole('button', { name: '模型服务' }).click()
  await page.getByRole('button', { name: '添加服务' }).click()

  const modal = page.locator('.modal')
  await expect(modal.locator('.modal-title', { hasText: '添加模型服务' })).toBeVisible()

  await modal.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('请填写服务名称')).toBeVisible()

  await modal.getByRole('button', { name: '取消' }).click()
  await expect(page.locator('.modal-title', { hasText: '添加模型服务' })).toBeHidden()
})

test('toggles maximize window control and emits UI state', async () => {
  test.skip(await getDesktopPlatform(page) === 'macos', 'macOS 使用原生交通灯窗口控制')
  const maximize = page.getByRole('button', { name: '最大化' })
  const initiallyMaximized = await isMainWindowMaximized(app)

  await maximize.click()
  await expect.poll(() => isMainWindowMaximized(app)).not.toBe(initiallyMaximized)
  await expect(maximize).toHaveAttribute('aria-pressed', String(!initiallyMaximized))

  await expect(maximize).toBeVisible()

  await maximize.click()
  await expect.poll(() => isMainWindowMaximized(app)).toBe(initiallyMaximized)
  await expect(maximize).toHaveAttribute('aria-pressed', String(initiallyMaximized))
})

test('validates composer send button and missing api key error', async () => {
  const textarea = page.getByPlaceholder('发消息，或让我帮你做点事…')
  const sendButton = page.locator('.send-btn')

  await expect(sendButton).toBeDisabled()

  await textarea.fill('帮我介绍一下 DeepDesk')
  await expect(sendButton).toBeEnabled()

  await sendButton.click()

  const error = page.getByText('请先在「设置 → 模型服务」中配置 API Key')
  await expect(error).toBeVisible()
  await expect(textarea).toHaveValue('')
})

test('supports multiline composer input and context meter panel', async () => {
  const textarea = page.getByPlaceholder('发消息，或让我帮你做点事…')

  await textarea.fill('第一行')
  await textarea.press('Shift+Enter')
  await textarea.pressSequentially('第二行')

  await expect(textarea).toHaveValue('第一行\n第二行')

  await page.locator('.ctx-trigger').click()
  await expect(page.locator('.ctx-panel')).toBeVisible()
  await expect(page.locator('.ctx-panel', { hasText: '上下文已用' })).toBeVisible()

  await page.getByTitle('选择模型').click()
  const modelMenu = page.getByRole('menu', { name: '选择模型' })
  await expect(modelMenu).toBeVisible()
  await expect(page.locator('.ctx-panel')).toBeHidden()

  await page.locator('.ctx-trigger').click()
  await expect(page.locator('.ctx-panel')).toBeVisible()
  await expect(modelMenu).toBeHidden()

  await textarea.click()
  await expect(page.locator('.ctx-panel')).toBeHidden()

  await page.getByTitle('选择模型').click()
  await expect(modelMenu).toBeVisible()
  await textarea.click()
  await expect(modelMenu).toBeHidden()
})

test('adds, edits, adds model, and deletes a custom provider without network calls', async () => {
  await openSettings(page)
  await page.getByRole('button', { name: '模型服务' }).click()
  await page.getByRole('button', { name: '添加服务' }).click()

  const modal = page.locator('.modal')
  await modal.getByPlaceholder('例如：智谱 GLM / Kimi / 本地 Ollama').fill('Mock Local')
  await modal.getByPlaceholder('https://api.deepseek.com').fill('http://127.0.0.1:11434/v1')
  await modal.getByPlaceholder('sk-…').fill('sk-test-e2e')
  await modal.getByRole('button', { name: '保存' }).click()

  const card = page.locator('.provider-card').filter({ hasText: 'Mock Local' })
  await expect(card).toBeVisible()
  await expect(card.getByText('自定义')).toBeVisible()
  await expect(card.getByText('已配置')).toBeVisible()

  const apiKeyInput = card.getByPlaceholder('sk-…')
  await expect(apiKeyInput).toHaveAttribute('type', 'password')
  await card.locator('.input-wrap').locator('.icon-btn').click()
  await expect(apiKeyInput).toHaveAttribute('type', 'text')

  await card.locator('input').first().fill('Mock Local Updated')
  await card.getByRole('button', { name: '保存' }).click()

  const updatedCard = page.locator('.provider-card').filter({ hasText: 'Mock Local Updated' })
  await expect(updatedCard).toBeVisible()

  await updatedCard.getByPlaceholder('添加模型 ID，如 deepseek-v4-flash').fill('mock-chat')
  await updatedCard.getByRole('button', { name: '添加' }).click()
  await expect(updatedCard.locator('.model-chip-item', { hasText: 'mock-chat' })).toBeVisible()

  await updatedCard.getByRole('button', { name: '删除' }).click()
  await expect(page.locator('.provider-card').filter({ hasText: 'Mock Local Updated' })).toBeHidden()
})

test('persists general settings after app restart with the same user data directory', async () => {
  await openSettings(page)
  await page.getByRole('button', { name: '常规' }).click()
  await page.getByRole('button', { name: '浅色' }).click()
  await page.getByRole('button', { name: '完全访问' }).click()

  const userDataDir = ctx!.userDataDir
  await closeDeepDeskWithoutRemovingData(ctx)
  ctx = await launchDeepDesk(userDataDir)
  app = ctx.app
  page = ctx.page

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByTitle('选择权限模式')).toContainText('完全访问')
})

test('places the scroll-to-bottom control above the composer in a long agent session', async () => {
  await closeDeepDesk(ctx)
  ctx = await launchDeepDesk(createLongAgentSessionUserData())
  app = ctx.app
  page = ctx.page

  const session = page.locator('.conv-item', { hasText: '长对话视觉回归' })
  const taskToggle = page.getByRole('button', { name: /最近任务 \(1\)/ })
  await expect(taskToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(session).toBeVisible()
  await taskToggle.click()
  await expect(taskToggle).toHaveAttribute('aria-expanded', 'false')
  await expect(session).toBeHidden()
  await taskToggle.click()
  await expect(taskToggle).toHaveAttribute('aria-expanded', 'true')
  await expect(session).toBeVisible()
  await session.click()

  const scroll = page.locator('.agent-scroll')
  await expect(scroll).toBeVisible()
  await scroll.evaluate(element => {
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll'))
  })

  const scrollButton = page.getByTitle('回到底部')
  await expect(scrollButton).toBeVisible()

  const [buttonBox, composerBox] = await Promise.all([scrollButton.boundingBox(), page.locator('.agent-composer').boundingBox()])
  expect(buttonBox).not.toBeNull()
  expect(composerBox).not.toBeNull()
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(composerBox!.y - 8)

  await scrollButton.click()
  await expect.poll(async () => scroll.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThanOrEqual(2)
})

test('provides polished message actions and code block download in a local conversation', async () => {
  await closeDeepDesk(ctx)
  ctx = await launchDeepDesk(createMessageActionsUserData())
  app = ctx.app
  page = ctx.page

  await page.locator('.conv-item', { hasText: '消息操作视觉回归' }).click()

  const userMessage = page.locator('.agent-message.user', { hasText: '你看看这个是什么类型' })
  const assistantMessage = page.locator('.agent-message.assistant', { hasText: '这是 TypeScript 示例' })
  await expect(userMessage).toBeVisible()
  await expect(assistantMessage).toBeVisible()

  await expect(userMessage.getByRole('button', { name: '复制消息' })).toBeVisible()
  await userMessage.getByRole('button', { name: '编辑消息' }).click()
  await expect(userMessage.locator('textarea')).toHaveValue('你看看这个是什么类型')

  await expect(assistantMessage.getByRole('button', { name: '复制消息' })).toBeVisible()
  await expect(assistantMessage.getByRole('button', { name: '重新生成' })).toBeVisible()
  await assistantMessage.getByRole('button', { name: '喜欢', exact: true }).click()
  await expect(assistantMessage.getByRole('button', { name: '喜欢', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await assistantMessage.getByRole('button', { name: '不喜欢', exact: true }).click()
  await expect(assistantMessage.getByRole('button', { name: '喜欢', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(assistantMessage.getByRole('button', { name: '不喜欢', exact: true })).toHaveAttribute('aria-pressed', 'true')

  const codeBlock = assistantMessage.locator('.codeblock')
  await expect(codeBlock.getByRole('button', { name: '复制代码' })).toBeVisible()
  await page.evaluate(() => {
    const testWindow = window as Window & { __deepdeskDownload?: { filename: string; href: string } }
    HTMLAnchorElement.prototype.click = function (): void {
      testWindow.__deepdeskDownload = { filename: this.download, href: this.href }
    }
  })
  await codeBlock.getByRole('button', { name: '下载代码' }).click()
  await expect.poll(() => page.evaluate(() => {
    const testWindow = window as Window & { __deepdeskDownload?: { filename: string; href: string } }
    return testWindow.__deepdeskDownload
  })).toEqual({ filename: 'deepdesk-code.ts', href: expect.stringMatching(/^blob:/) })

  const messageLayout = await assistantMessage.evaluate(element => {
    const actions = element.querySelector('.agent-message-actions')
    if (!actions) return null
    return {
      messageBottom: Math.round(element.getBoundingClientRect().bottom),
      actionsBottom: Math.round(actions.getBoundingClientRect().bottom)
    }
  })
  expect(messageLayout).not.toBeNull()
  expect(messageLayout!.actionsBottom).toBeLessThanOrEqual(messageLayout!.messageBottom)
})
