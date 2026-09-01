import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { DeepDeskE2EApp } from './helpers'
import {
  closeDeepDesk,
  closeDeepDeskWithoutRemovingData,
  createConnectorSessionUserData,
  createContextBreakdownUserData,
  createLongAgentSessionUserData,
  createMemoryUserData,
  createMessageActionsUserData,
  expectAppShell,
  expectComposerReady,
  getDesktopPlatform,
  goBackToChat,
  isMainWindowMaximized,
  launchDeepDesk,
  openSettings,
  pressAppShortcut,
  startMockApprovalServer,
  startMockChatServer,
  startMockMcpInstallServer
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

test('adds, edits, and removes an MCP server from settings', async () => {
  await openSettings(page)
  await page.getByRole('button', { name: 'MCP', exact: true }).click()

  await expect(page.locator('.settings-title')).toHaveText('MCP')
  await expect(page.locator('.mcp-empty')).toContainText('还没有 MCP 服务器')
  await page.getByRole('button', { name: '添加服务器' }).click()

  const form = page.locator('.modal', { hasText: '添加 MCP 服务器' })
  await expect(form).toBeVisible()
  await form.getByLabel('服务器名称').fill('团队知识库')
  await form.getByLabel('连接方式').selectOption('http')
  await form.getByLabel('服务器地址').fill('https://example.com/mcp')
  await form.getByRole('button', { name: '保存', exact: true }).click()

  const card = page.locator('.mcp-card', { hasText: '团队知识库' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('未连接')
  await expect(card).toContainText('https://example.com/mcp')
  await expect(card.getByRole('button', { name: '连接', exact: true })).toBeVisible()

  await card.getByTitle('编辑服务器').click()
  const editForm = page.locator('.modal', { hasText: '编辑 MCP 服务器' })
  await expect(editForm.getByLabel('服务器名称')).toHaveValue('团队知识库')
  await editForm.getByRole('button', { name: '取消' }).click()

  await card.getByTitle('删除服务器').click()
  const confirm = page.locator('.modal', { hasText: '删除 MCP 服务器' })
  await confirm.getByRole('button', { name: '删除', exact: true }).click()
  await expect(card).toHaveCount(0)
  await expect(page.locator('.mcp-empty')).toContainText('还没有 MCP 服务器')
})

test('inspects and installs an HTTP MCP service from the conversation after explicit confirmation', async () => {
  await closeDeepDesk(ctx)
  ctx = null
  const mock = await startMockMcpInstallServer()

  try {
    ctx = await launchDeepDesk(createMemoryUserData(mock.baseUrl))
    app = ctx.app
    page = ctx.page

    await page.getByPlaceholder('发消息，或让我帮你做点事…').fill(`把这个 MCP 服务装一下：${mock.mcpUrl}`)
    await page.locator('.send-btn').click()

    const approval = page.getByRole('dialog', { name: '安装 MCP 服务' })
    await expect(approval).toBeVisible()
    await expect(approval).toContainText('DeepDesk Docs')
    await expect(approval).toContainText(mock.mcpUrl)
    await expect(approval).toContainText('search_docs')
    await expect(approval).toContainText('1 个工具')
    await expect(approval.getByRole('button', { name: '安装并连接' })).toBeVisible()
    await expect(approval.getByRole('button', { name: '取消' })).toBeVisible()

    await approval.getByRole('button', { name: '安装并连接' }).click()
    await expect(page.getByText('MCP 服务已安装并连接。')).toBeVisible()

    await openSettings(page)
    await page.getByRole('button', { name: 'MCP', exact: true }).click()
    const card = page.locator('.mcp-card', { hasText: 'DeepDesk Docs' })
    await expect(card).toContainText('已连接')
    await expect(card).toContainText('1 个可用工具')
  } finally {
    await mock.close()
  }
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
  await expect(page.locator('.connector-card', { hasText: '飞书' })).toBeVisible()
  await expect(page.locator('.connector-card', { hasText: '微信' })).toBeVisible()
  const browserConnector = page.locator('.connector-card', { hasText: '浏览器调试' })
  await expect(browserConnector).toBeVisible()
  await expect(browserConnector).toContainText('E2E Browser · 未连接')
  await expect(browserConnector.getByRole('button', { name: '连接', exact: true })).toBeVisible()
  await expect(browserConnector.getByRole('button', { name: '安装扩展' })).toHaveCount(0)
  await expect(browserConnector.getByRole('button', { name: '启用' })).toHaveCount(0)
  await expect(browserConnector.getByRole('button', { name: '停用' })).toHaveCount(0)
  await browserConnector.getByRole('button', { name: '连接', exact: true }).click()
  const browserSetupModal = page.locator('.modal', { hasText: '安装浏览器扩展' })
  await expect(browserSetupModal).toBeVisible()
  await expect(browserSetupModal).toContainText('完成后 DeepDesk 会自动连接')
  await expect(browserSetupModal.getByRole('button', { name: '复制扩展目录' })).toBeVisible()
  await browserSetupModal.getByRole('button', { name: '关闭' }).click()
  await expect(browserConnector).toContainText('E2E Browser · 等待扩展')
  await expect(page.locator('.connector-activity-panel', { hasText: '连接器消息' })).toBeVisible()
  await expect(page.locator('.connector-activity-empty')).toContainText('还没有收到连接器消息')
  await expect(page.locator('.connector-card', { hasText: '飞书' }).getByAltText('飞书 图标')).toBeVisible()
  await expect(page.locator('.connector-card', { hasText: '微信' }).getByAltText('微信 图标')).toBeVisible()
  const connectorIconSizes = await page.locator('.connector-card', { hasText: /飞书|微信/ }).locator('.connector-icon img').evaluateAll(images => {
    return images.map(image => {
      const rect = image.getBoundingClientRect()
      return { width: Math.round(rect.width), height: Math.round(rect.height) }
    })
  })
  expect(connectorIconSizes).toEqual([{ width: 34, height: 34 }, { width: 34, height: 34 }])
  await expect(page.locator('.connector-state')).toHaveCount(3)
  await expect(page.locator('.connector-note')).toContainText('模型服务')
  const wechatConnector = page.locator('.connector-card', { hasText: '微信' })
  await expect(wechatConnector).not.toContainText('OpenClaw')
  await expect(wechatConnector).not.toContainText('LobsterAI')
  await expect(wechatConnector.getByPlaceholder('微信接入服务地址')).toHaveCount(0)
  await wechatConnector.getByRole('button', { name: '扫码接入' }).click()
  const wechatModal = page.locator('.modal', { hasText: '微信扫码接入' })
  await expect(wechatModal.getByLabel('微信扫码接入二维码')).toBeVisible()
  await expect(wechatModal.getByText('请先配置微信接入服务')).toBeVisible()
  await expect(wechatModal.getByRole('button', { name: '高级配置' })).toBeVisible()
  await wechatModal.getByPlaceholder('微信接入服务地址').fill('http://127.0.0.1:3210')
  await wechatModal.getByPlaceholder('访问令牌').fill('test-token')
  await wechatModal.getByRole('button', { name: '保存配置' }).click()
  await expect(wechatModal.locator('.connector-modal-result', { hasText: '连接器配置已保存' })).toBeVisible()
  await wechatModal.getByRole('button', { name: '启用微信' }).click()
  await expect(wechatModal.locator('.connector-modal-result', { hasText: '已启用微信接入' })).toBeVisible()
  await wechatModal.getByRole('button', { name: '关闭' }).click()
  await expect(wechatConnector).toContainText('已连接')
  await expect(wechatConnector.getByRole('button', { name: '断开' })).toBeVisible()
  await expect(wechatConnector.getByRole('button', { name: '扫码接入' })).toHaveCount(0)
  await wechatConnector.getByRole('button', { name: '断开' }).click()
  await expect(wechatConnector).toContainText('可连接')
  await expect(wechatConnector.getByRole('button', { name: '连接' })).toBeVisible()
  await expect(wechatConnector.getByRole('button', { name: '断开' })).toHaveCount(0)

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

  await page.getByRole('button', { name: '系统字体' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-font', 'system')

  await page.getByRole('button', { name: '默认字体' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-font', 'default')

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
  await expect(page.locator('.ctx-panel', { hasText: '256K' })).toBeVisible()
  await expect(page.locator('.ctx-panel', { hasText: '当前输入' })).toBeVisible()
  await expect(page.locator('.ctx-breakdown-row[data-tone="input"] .ctx-breakdown-dot')).toBeVisible()
  await expect(page.locator('.ctx-bar-segment[data-tone="input"]')).toBeVisible()

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

test('shows colored context composition categories', async () => {
  await closeDeepDesk(ctx)
  ctx = await launchDeepDesk(createContextBreakdownUserData())
  app = ctx.app
  page = ctx.page

  await page.locator('.conv-item', { hasText: '上下文组成视觉回归' }).click()
  await page.locator('.ctx-trigger').click()
  const panel = page.locator('.ctx-panel')
  await expect(panel).toBeVisible()
  await expect(panel.locator('.ctx-breakdown-row[data-tone="system"]', { hasText: '系统指令 / 记忆' })).toBeVisible()
  await expect(panel.locator('.ctx-breakdown-row[data-tone="user"]', { hasText: '用户消息' })).toBeVisible()
  await expect(panel.locator('.ctx-breakdown-row[data-tone="assistant"]', { hasText: 'AI 回复' })).toBeVisible()
  await expect(panel.locator('.ctx-breakdown-row[data-tone="tool-call"]', { hasText: '工具调用参数' })).toBeVisible()
  await expect(panel.locator('.ctx-breakdown-row[data-tone="tool-result"]', { hasText: '工具返回结果' })).toBeVisible()
  await expect(panel.locator('.ctx-bar-segment[data-tone="system"]')).toBeVisible()
  await expect(panel.locator('.ctx-bar-segment[data-tone="user"]')).toBeVisible()
  await expect(panel.locator('.ctx-bar-segment[data-tone="assistant"]')).toBeVisible()
  await expect(panel.locator('.ctx-bar-segment[data-tone="tool-call"]')).toBeVisible()
  await expect(panel.locator('.ctx-bar-segment[data-tone="tool-result"]')).toBeVisible()
})

test('adds, edits, adds model, and deletes a custom provider without network calls', async () => {
  await openSettings(page)
  await page.getByRole('button', { name: '模型服务' }).click()
  await page.getByRole('button', { name: '添加服务' }).click()

  const modal = page.locator('.modal')
  await modal.getByPlaceholder('例如：智谱 GLM / Kimi / 本地 Ollama').fill('智谱 GLM')
  await modal.getByPlaceholder('https://api.deepseek.com').fill('https://open.bigmodel.cn/api/paas/v4')
  await modal.getByPlaceholder('sk-…').fill('sk-test-e2e')
  await modal.getByRole('button', { name: '保存' }).click()

  const card = page.locator('.provider-card').filter({ hasText: '智谱 GLM' })
  await expect(card).toBeVisible()
  await expect(card.locator('.provider-icon.brand-zhipu img')).toBeVisible()
  await expect(card.getByText('自定义')).toBeVisible()
  await expect(card.getByText('已配置')).toBeVisible()

  const apiKeyInput = card.getByPlaceholder('sk-…')
  await expect(apiKeyInput).toHaveAttribute('type', 'password')
  await card.locator('.input-wrap').locator('.icon-btn').click()
  await expect(apiKeyInput).toHaveAttribute('type', 'text')

  await card.locator('input').first().fill('Mock Local Updated')
  const renamedDraftCard = page.locator('.provider-card').filter({ hasText: 'Mock Local Updated' })
  await renamedDraftCard.getByRole('button', { name: '保存' }).click()

  const updatedCard = page.locator('.provider-card').filter({ hasText: 'Mock Local Updated' })
  await expect(updatedCard).toBeVisible()
  await expect(updatedCard.getByRole('status')).toContainText('保存成功')

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
  await page.getByRole('button', { name: '系统字体' }).click()
  await page.getByRole('button', { name: '完全访问' }).click()

  const userDataDir = ctx!.userDataDir
  await closeDeepDeskWithoutRemovingData(ctx)
  ctx = await launchDeepDesk(userDataDir)
  app = ctx.app
  page = ctx.page

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.locator('html')).toHaveAttribute('data-font', 'system')
  await expect(page.getByTitle('选择权限模式')).toContainText('完全访问')
})

test('groups connector sessions separately from recent tasks', async () => {
  await closeDeepDesk(ctx)
  ctx = await launchDeepDesk(createConnectorSessionUserData())
  app = ctx.app
  page = ctx.page

  await expect(page.getByRole('button', { name: /最近任务 \(1\)/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /连接器会话 \(1\)/ })).toBeVisible()
  await expect(page.locator('.conv-item').filter({ hasText: '普通本地任务' })).toBeVisible()

  const connectorItem = page.locator('.conv-item.connector').filter({ hasText: '项目微信群' })
  await expect(connectorItem).toContainText('微信')

  await page.getByRole('button', { name: /最近任务 \(1\)/ }).click()
  const footerLayout = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar')
    const footer = document.querySelector('.sidebar-footer')
    if (!sidebar || !footer) return null
    return {
      sidebarBottom: Math.round(sidebar.getBoundingClientRect().bottom),
      footerBottom: Math.round(footer.getBoundingClientRect().bottom)
    }
  })
  expect(footerLayout).not.toBeNull()
  expect(Math.abs(footerLayout!.sidebarBottom - footerLayout!.footerBottom)).toBeLessThanOrEqual(1)

  await connectorItem.click()
  await expect(page.getByText('帮我同步这条微信消息')).toBeVisible()
  await expect(page.getByText('已同步到 DeepDesk 桌面端。')).toBeVisible()
})

test('persists memory settings and injects matching memory into an agent request', async () => {
  await closeDeepDesk(ctx)
  ctx = null
  const mock = await startMockChatServer('已收到记忆上下文。')

  try {
    ctx = await launchDeepDesk(createMemoryUserData(mock.baseUrl))
    app = ctx.app
    page = ctx.page

    const memoryContent = 'DeepDesk 记忆系统相关回答要先给结论，并保持简洁。'

    await openSettings(page)
    await page.getByRole('button', { name: '记忆' }).click()
    await expect(page.locator('.settings-title', { hasText: '记忆' })).toBeVisible()

    await page.locator('.memory-editor select').nth(0).selectOption('project')
    await page.locator('.memory-editor select').nth(1).selectOption('preference')
    await page.locator('.memory-editor textarea').fill(memoryContent)
    await page.locator('.memory-editor input').fill('deepdesk 记忆系统')
    await page.getByRole('button', { name: '添加记忆' }).click()

    await expect(page.locator('.memory-card', { hasText: memoryContent })).toBeVisible()

    const userDataDir = ctx.userDataDir
    await closeDeepDeskWithoutRemovingData(ctx)
    ctx = await launchDeepDesk(userDataDir)
    app = ctx.app
    page = ctx.page

    await openSettings(page)
    await page.getByRole('button', { name: '记忆' }).click()
    await expect(page.locator('.memory-card', { hasText: memoryContent })).toBeVisible()
    await goBackToChat(page)

    const task = 'DeepDesk 记忆系统 怎么介绍'
    await page.getByPlaceholder('发消息，或让我帮你做点事…').fill(task)
    await page.locator('.send-btn').click()
    await expect(page.getByText('已收到记忆上下文。')).toBeVisible()

    await expect.poll(() => mock.requests.length).toBe(1)
    const messages = mock.requests[0].messages ?? []
    expect(String(messages[0]?.content ?? '')).toContain(memoryContent)
    expect(messages[messages.length - 1]).toEqual(expect.objectContaining({ role: 'user', content: task }))

    await expect.poll(() => {
      const raw = readFileSync(join(userDataDir, 'deepdesk.json'), 'utf8')
      const state = JSON.parse(raw) as { agentSessions?: Array<{ steps?: Array<{ text?: string }> }> }
      return state.agentSessions?.length ?? 0
    }).toBe(1)
    const raw = readFileSync(join(userDataDir, 'deepdesk.json'), 'utf8')
    const state = JSON.parse(raw) as { agentSessions: Array<{ steps: Array<{ text?: string }> }> }
    expect(state.agentSessions[0].steps.map(step => step.text ?? '').join('\n')).not.toContain(memoryContent)
  } finally {
    await mock.close()
  }
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

test('shows ChatGPT-style queued messages, keeps approval above the composer, and stops immediately', async () => {
  await closeDeepDesk(ctx)
  ctx = null
  const mock = await startMockApprovalServer()

  try {
    ctx = await launchDeepDesk(createMemoryUserData(mock.baseUrl))
    app = ctx.app
    page = ctx.page

    await page.getByPlaceholder('发消息，或让我帮你做点事…').fill('请检查当前版本')
    await page.locator('.send-btn').click()

    const approval = page.getByRole('dialog', { name: '执行审批' })
    await expect(approval).toBeVisible()
    await expect(approval).toContainText('执行命令')
    await expect(approval).toContainText('node -v')
    await expect(page.locator('.agent-scroll .agent-approval')).toHaveCount(0)

    const runningInput = page.getByPlaceholder('输入下一条消息，将在当前回复完成后发送…')
    await runningInput.fill('稍后检查测试')
    await runningInput.press('Enter')
    const queue = page.getByRole('region', { name: '待发送消息队列' })
    await expect(queue).toContainText('稍后检查测试')
    await queue.getByRole('button', { name: '编辑待发送消息' }).click()
    await queue.locator('.agent-queue-editor').fill('稍后检查完整测试')
    await queue.getByRole('button', { name: '保存' }).click()
    await expect(queue).toContainText('稍后检查完整测试')
    await expect(queue.locator('.agent-queue-header')).toHaveCount(0)
    await expect(queue.locator('.agent-queue-label')).toHaveText('待发送')
    await expect(queue.getByRole('button', { name: '立即发送' })).toBeVisible()

    const queueStyle = await queue.locator('.agent-queue-item').evaluate(element => {
      const style = getComputedStyle(element)
      return {
        borderRadius: style.borderRadius,
        backgroundIsTransparent: style.backgroundColor === 'transparent' || style.backgroundColor === 'rgba(0, 0, 0, 0)'
      }
    })
    expect(queueStyle).toEqual({ borderRadius: '12px', backgroundIsTransparent: false })

    const layout = await page.evaluate(() => {
      const approvalEl = document.querySelector<HTMLElement>('.agent-approval')
      const composerEl = document.querySelector<HTMLElement>('.agent-footer .agent-composer')
      const queueEl = document.querySelector<HTMLElement>('.agent-footer .agent-queue')
      const scrollEl = document.querySelector<HTMLElement>('.agent-scroll')
      if (!approvalEl || !composerEl || !queueEl || !scrollEl) return null
      const approvalBox = approvalEl.getBoundingClientRect()
      const composerBox = composerEl.getBoundingClientRect()
      const queueBox = queueEl.getBoundingClientRect()
      const scrollBox = scrollEl.getBoundingClientRect()
      return {
        approval: { x: approvalBox.x, y: approvalBox.y, width: approvalBox.width, height: approvalBox.height },
        composer: { x: composerBox.x, y: composerBox.y, width: composerBox.width },
        queue: { x: queueBox.x, y: queueBox.y, width: queueBox.width, height: queueBox.height },
        scroll: { y: scrollBox.y, height: scrollBox.height }
      }
    })
    expect(layout).not.toBeNull()
    expect(layout!.approval.y).toBeGreaterThan(layout!.scroll.y + 120)
    expect(layout!.approval.y + layout!.approval.height).toBeLessThanOrEqual(layout!.composer.y - 8)
    expect(Math.abs(layout!.approval.x - layout!.composer.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(layout!.approval.width - layout!.composer.width)).toBeLessThanOrEqual(1)
    expect(layout!.queue.x).toBeGreaterThan(layout!.composer.x)
    expect(layout!.queue.width).toBeLessThan(layout!.composer.width)
    expect(layout!.queue.y + layout!.queue.height - layout!.composer.y).toBeGreaterThanOrEqual(14)
    expect(layout!.queue.y + layout!.queue.height - layout!.composer.y).toBeLessThanOrEqual(18)

    const stopButton = page.getByRole('button', { name: '停止生成' })
    await expect(stopButton).toBeVisible()
    const stopIcon = await stopButton.evaluate(element => {
      const square = element.querySelector<HTMLElement>('.stop-square')
      if (!square) return null
      const style = getComputedStyle(square)
      return {
        width: style.width,
        height: style.height,
        borderWidth: style.borderWidth,
        filled: style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent',
        svgCount: element.querySelectorAll('svg').length
      }
    })
    expect(stopIcon).toEqual({
      width: '10px',
      height: '10px',
      borderWidth: '0px',
      filled: true,
      svgCount: 0
    })

    await stopButton.click()
    await expect(stopButton).toBeHidden()
    await expect(approval).toBeHidden()
    await expect(page.getByText('思考中…')).toHaveCount(0)
    await expect(queue).toContainText('稍后检查完整测试')
  } finally {
    await mock.close()
  }
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
  await expect(userMessage.getByRole('button', { name: '取消' })).toBeVisible()
  await expect(userMessage.getByRole('button', { name: '保存' })).toBeVisible()
  await expect(userMessage.getByRole('button', { name: '重新发送' })).toBeVisible()
  await userMessage.getByRole('button', { name: '取消' }).click()
  await expect(userMessage.locator('textarea')).toHaveCount(0)
  await userMessage.getByRole('button', { name: '编辑消息' }).click()
  await userMessage.locator('textarea').fill('你看看这个是什么类型，顺便解释依据')
  await userMessage.getByRole('button', { name: '保存' }).click()
  await expect(userMessage).toContainText('你看看这个是什么类型，顺便解释依据')
  await expect(userMessage.locator('textarea')).toHaveCount(0)

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

test('manages recent task titles and deletion from the sidebar overflow menu', async () => {
  await closeDeepDesk(ctx)
  ctx = await launchDeepDesk(createMessageActionsUserData())
  app = ctx.app
  page = ctx.page

  const session = page.locator('.conv-item', { hasText: '消息操作视觉回归' })
  await expect(session).toBeVisible()
  await session.hover()
  await session.getByRole('button', { name: /会话操作/ }).click()
  await expect(page.getByRole('menu', { name: '会话操作' })).toBeVisible()
  await page.getByRole('menuitem', { name: '编辑标题' }).click()

  const input = page.getByLabel('编辑会话标题')
  await expect(input).toBeVisible()
  await input.fill('侧栏菜单会话')
  await input.press('Enter')
  await expect(page.locator('.conv-item', { hasText: '侧栏菜单会话' })).toBeVisible()

  const renamed = page.locator('.conv-item', { hasText: '侧栏菜单会话' })
  await renamed.hover()
  await renamed.getByRole('button', { name: /会话操作/ }).click()
  await page.getByRole('menuitem', { name: '删除会话' }).click()
  await expect(page.getByText('删除这个会话？')).toBeVisible()
  await page.getByRole('button', { name: '确认删除' }).click()
  await expect(page.locator('.conv-item', { hasText: '侧栏菜单会话' })).toHaveCount(0)
})
