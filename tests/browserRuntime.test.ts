import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const browserPlatformMocks = vi.hoisted(() => ({
  detectPreferredBrowser: vi.fn(),
  isBrowserRunning: vi.fn(),
  openBrowser: vi.fn(),
  openBrowserExtensionManager: vi.fn()
}))

const electronMocks = vi.hoisted(() => ({
  writeText: vi.fn()
}))

const browserExtensionBridgeMocks = vi.hoisted(() => ({
  connected: false,
  baseUrl: 'http://127.0.0.1:32180/test-token',
  start: vi.fn(),
  stop: vi.fn(),
  detachAll: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => join(tmpdir(), 'deepdesk-browser-runtime'),
    getAppPath: () => process.cwd(),
    isPackaged: false
  },
  clipboard: { writeText: electronMocks.writeText }
}))

vi.mock('../src/main/platform/browser', () => browserPlatformMocks)
vi.mock('../src/main/browser-extension-bridge', () => ({
  BrowserExtensionBridge: class {
    get connected(): boolean { return browserExtensionBridgeMocks.connected }
    get baseUrl(): string { return browserExtensionBridgeMocks.baseUrl }
    start(): Promise<void> { return browserExtensionBridgeMocks.start() }
    stop(): Promise<void> { return browserExtensionBridgeMocks.stop() }
    detachAll(): Promise<void> { return browserExtensionBridgeMocks.detachAll() }
  }
}))

import { configureBrowserAutomation, enableBrowserAutomation, ensureBrowserAutomation, inspectBrowserAutomation, setupBrowserSessionSharing, shutdownBrowserAutomation } from '../src/main/browser-runtime'
import { AppStore } from '../src/main/store'

let dir: string
let store: AppStore

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'deepdesk-browser-runtime-'))
  store = new AppStore(dir)
  await store.init()
  browserExtensionBridgeMocks.connected = false
  browserExtensionBridgeMocks.start.mockReset()
  browserExtensionBridgeMocks.start.mockResolvedValue(undefined)
  browserExtensionBridgeMocks.stop.mockReset()
  browserExtensionBridgeMocks.stop.mockResolvedValue(undefined)
  browserExtensionBridgeMocks.detachAll.mockReset()
  browserExtensionBridgeMocks.detachAll.mockResolvedValue(undefined)
  await configureBrowserAutomation(store)
  browserPlatformMocks.detectPreferredBrowser.mockReset()
  browserPlatformMocks.detectPreferredBrowser.mockResolvedValue({
    id: 'edge',
    name: 'Microsoft Edge',
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    processName: 'msedge.exe'
  })
  browserPlatformMocks.openBrowserExtensionManager.mockReset()
  browserPlatformMocks.openBrowserExtensionManager.mockResolvedValue(undefined)
  browserPlatformMocks.isBrowserRunning.mockReset()
  browserPlatformMocks.isBrowserRunning.mockResolvedValue(true)
  browserPlatformMocks.openBrowser.mockReset()
  browserPlatformMocks.openBrowser.mockResolvedValue(undefined)
})

afterEach(async () => {
  await shutdownBrowserAutomation()
  await store.flush()
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  electronMocks.writeText.mockReset()
})

describe('browser automation runtime', () => {
  it('在连接器未启用时拒绝连接当前浏览器', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))

    await expect(ensureBrowserAutomation()).rejects.toThrow('浏览器连接器未启用')
    expect(browserPlatformMocks.openBrowserExtensionManager).not.toHaveBeenCalled()
  })

  it('扩展离线时拒绝浏览器工具调用且不打开其他浏览器', async () => {
    store.upsertConnectorConfig({ id: 'browser', enabled: true })
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(ensureBrowserAutomation()).rejects.toThrow('浏览器扩展未连接')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(browserPlatformMocks.detectPreferredBrowser).not.toHaveBeenCalled()
    expect(browserPlatformMocks.openBrowserExtensionManager).not.toHaveBeenCalled()
  })

  it('扩展在线时直接使用当前浏览器登录状态', async () => {
    store.upsertConnectorConfig({ id: 'browser', enabled: true })
    browserExtensionBridgeMocks.connected = true
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))

    await ensureBrowserAutomation()
    const status = await inspectBrowserAutomation(store.getSnapshot().connectors.find(config => config.id === 'browser')!)

    expect(status).toMatchObject({ running: true, mode: 'extension' })
    expect(browserPlatformMocks.openBrowserExtensionManager).not.toHaveBeenCalled()
  })

  it('运行中的浏览器连接失败时不会打开新窗口或安装页面', async () => {
    vi.stubEnv('DEEPDESK_BROWSER_CONNECT_TIMEOUT_MS', '0')

    const result = await enableBrowserAutomation(store)

    expect(result).toMatchObject({ ok: false, message: '需要安装浏览器扩展' })
    expect(browserPlatformMocks.isBrowserRunning).toHaveBeenCalledOnce()
    expect(browserPlatformMocks.openBrowser).not.toHaveBeenCalled()
    expect(browserPlatformMocks.openBrowserExtensionManager).not.toHaveBeenCalled()
    expect(store.getSnapshot().connectors.find(connector => connector.id === 'browser')?.enabled).toBe(true)
  })

  it('安装扩展后无需再次点击连接即可完成启用', async () => {
    vi.stubEnv('DEEPDESK_BROWSER_CONNECT_TIMEOUT_MS', '0')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))

    await enableBrowserAutomation(store)
    browserExtensionBridgeMocks.connected = true

    await ensureBrowserAutomation()
    const config = store.getSnapshot().connectors.find(connector => connector.id === 'browser')!
    const status = await inspectBrowserAutomation(config)
    expect(config.enabled).toBe(true)
    expect(status).toMatchObject({ running: true, mode: 'extension' })
  })

  it('没有浏览器进程时启动默认浏览器再等待连接', async () => {
    vi.stubEnv('DEEPDESK_BROWSER_CONNECT_TIMEOUT_MS', '0')
    browserPlatformMocks.isBrowserRunning.mockResolvedValue(false)

    const result = await enableBrowserAutomation(store)

    expect(result).toMatchObject({ ok: false, message: '需要安装浏览器扩展' })
    expect(result.detail).toContain('Microsoft Edge 已启动')
    expect(browserPlatformMocks.openBrowser).toHaveBeenCalledOnce()
    expect(browserPlatformMocks.openBrowserExtensionManager).not.toHaveBeenCalled()
  })

  it('复制扩展目录时不会打开文件夹或浏览器页面', async () => {
    const result = await setupBrowserSessionSharing('copy-extension-directory')

    expect(result).toMatchObject({ ok: true, message: '扩展目录已复制' })
    expect(electronMocks.writeText).toHaveBeenCalledWith(expect.stringContaining('browser-extension'))
    expect(browserPlatformMocks.openBrowserExtensionManager).not.toHaveBeenCalled()
  })

  it('只有明确选择时才打开扩展管理页', async () => {
    const result = await setupBrowserSessionSharing('open-extension-manager')

    expect(result).toMatchObject({ ok: true, message: '已打开浏览器扩展安装页' })
    expect(electronMocks.writeText).not.toHaveBeenCalled()
    expect(browserPlatformMocks.openBrowserExtensionManager).toHaveBeenCalledWith(expect.objectContaining({ id: 'edge' }))
  })
})
