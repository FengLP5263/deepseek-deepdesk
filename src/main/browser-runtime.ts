import { app, clipboard } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { BrowserExtensionSetupAction, ConnectorActionResult, ConnectorConfig } from '../shared/types'
import type { AppStore } from './store'
import { BrowserExtensionBridge } from './browser-extension-bridge'
import { detectPreferredBrowser, isBrowserRunning, openBrowser, openBrowserExtensionManager, type DetectedBrowser } from './platform/browser'

let configuredStore: AppStore | null = null
let extensionBridge: BrowserExtensionBridge | null = null

export type BrowserSessionMode = 'extension' | 'idle'

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('浏览器操作已取消')
  error.name = 'AbortError'
  throw error
}

function browserConfig(store: AppStore): ConnectorConfig | undefined {
  return store.getSnapshot().connectors.find(config => config.id === 'browser')
}

export function browserDebugBaseUrl(): string {
  const configuredUrl = process.env['DEEPDESK_BROWSER_DEBUG_URL']?.trim()
  if (configuredUrl) return configuredUrl.replace(/\/+$/, '')
  if (extensionBridge?.connected && extensionBridge.baseUrl) return extensionBridge.baseUrl
  throw new Error('当前浏览器扩展尚未连接')
}

export async function configureBrowserAutomation(store: AppStore): Promise<void> {
  configuredStore = store
  if (process.env['DEEPDESK_DISABLE_BROWSER_EXTENSION_BRIDGE'] === '1') return
  extensionBridge ??= new BrowserExtensionBridge()
  try {
    await extensionBridge.start()
  } catch {
    extensionBridge = null
  }
}

export async function isBrowserDebugSessionReady(signal?: AbortSignal): Promise<boolean> {
  throwIfAborted(signal)
  if (!process.env['DEEPDESK_BROWSER_DEBUG_URL'] && !extensionBridge?.connected) return false
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 800)
  const onAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const response = await fetch(browserDebugBaseUrl() + '/json/version', { signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

export async function inspectBrowserAutomation(config: ConnectorConfig): Promise<{ browser: DetectedBrowser | null; running: boolean; mode: BrowserSessionMode }> {
  const [browser, running] = await Promise.all([
    detectPreferredBrowser(),
    config.enabled ? isBrowserDebugSessionReady() : Promise.resolve(false)
  ])
  const mode: BrowserSessionMode = extensionBridge?.connected ? 'extension' : 'idle'
  return { browser, running, mode }
}

export async function enableBrowserAutomation(store: AppStore): Promise<ConnectorActionResult> {
  const browser = await detectPreferredBrowser()
  if (!browser) {
    return {
      id: 'browser',
      ok: false,
      message: '未检测到支持的浏览器',
      detail: '请安装或将 Microsoft Edge、Google Chrome、Brave 或 Chromium 设为可用浏览器。'
    }
  }
  // Persist the user's intent before the one-time extension installation flow.
  // Once the extension connects, connector polling can complete activation without
  // requiring the user to click “连接” a second time.
  store.upsertConnectorConfig({ id: 'browser', enabled: true })
  let browserStarted = false
  if (!extensionBridge?.connected && !(await isBrowserRunning(browser))) {
    await openBrowser(browser)
    browserStarted = true
  }
  const configuredTimeout = Number(process.env['DEEPDESK_BROWSER_CONNECT_TIMEOUT_MS'])
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 0
    ? configuredTimeout
    : browserStarted ? 4_000 : 1_200
  const deadline = Date.now() + timeoutMs
  while (!extensionBridge?.connected && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 120))
  }
  if (!extensionBridge?.connected) {
    return {
      id: 'browser',
      ok: false,
      message: '需要安装浏览器扩展',
      detail: browserStarted
        ? `${browser.name} 已启动。完成一次扩展安装后，DeepDesk 会自动连接。`
        : `已检测到 ${browser.name}。完成一次扩展安装后，DeepDesk 会自动连接。`
    }
  }
  return {
    id: 'browser',
    ok: true,
    message: '浏览器已连接',
    detail: `已连接 ${browser.name}，可以沿用已有登录状态。`
  }
}

function browserExtensionDirectory(): string {
  const override = process.env['DEEPDESK_BROWSER_EXTENSION_DIR']?.trim()
  if (override) return override
  return app.isPackaged
    ? path.join(process.resourcesPath, 'browser-extension')
    : path.join(app.getAppPath(), 'browser-extension')
}

export async function setupBrowserSessionSharing(action: BrowserExtensionSetupAction): Promise<ConnectorActionResult> {
  const directory = browserExtensionDirectory()
  try {
    await fs.access(path.join(directory, 'manifest.json'))
    if (action === 'copy-extension-directory') {
      clipboard.writeText(directory)
      return {
        id: 'browser',
        ok: true,
        message: '扩展目录已复制',
        detail: '在浏览器扩展管理页选择“加载解压缩的扩展”后，粘贴该目录即可。'
      }
    }
    if (action !== 'open-extension-manager') {
      return { id: 'browser', ok: false, message: '不支持的浏览器扩展操作' }
    }
    const browser = await detectPreferredBrowser()
    if (!browser) return { id: 'browser', ok: false, message: '未检测到支持的浏览器' }
    await openBrowserExtensionManager(browser)
    return {
      id: 'browser',
      ok: true,
      message: '已打开浏览器扩展安装页',
      detail: '请开启“开发人员模式”，选择“加载解压缩的扩展”，再使用已复制的扩展目录。'
    }
  } catch (error) {
    return {
      id: 'browser',
      ok: false,
      message: '无法打开浏览器扩展',
      detail: error instanceof Error ? error.message : String(error)
    }
  }
}

export async function disableBrowserAutomation(store: AppStore): Promise<ConnectorActionResult> {
  store.upsertConnectorConfig({ id: 'browser', enabled: false })
  await extensionBridge?.detachAll()
  return {
    id: 'browser',
    ok: true,
    message: '浏览器连接器已停用',
    detail: 'DeepDesk 不会再自动建立浏览器调试会话。'
  }
}

export async function ensureBrowserAutomation(signal?: AbortSignal): Promise<void> {
  if (!process.env['DEEPDESK_BROWSER_DEBUG_URL'] && (!configuredStore || !browserConfig(configuredStore)?.enabled)) {
    throw new Error('浏览器连接器未启用，请先在“连接器”中启用')
  }
  if (process.env['DEEPDESK_BROWSER_DEBUG_URL']) {
    if (await isBrowserDebugSessionReady(signal)) return
    throw new Error('配置的浏览器调试服务不可用')
  }
  throwIfAborted(signal)
  if (!extensionBridge?.connected) {
    throw new Error('浏览器扩展未连接。请在“连接器 → 浏览器调试”点击“连接”，安装或启用扩展后重试。')
  }
  if (!(await isBrowserDebugSessionReady(signal))) throw new Error('当前浏览器连接暂不可用，请确认 DeepDesk 浏览器扩展保持启用后重试')
}

export async function shutdownBrowserAutomation(): Promise<void> {
  await extensionBridge?.stop()
  extensionBridge = null
}
