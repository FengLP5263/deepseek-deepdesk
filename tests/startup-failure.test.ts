import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  init: vi.fn(), flush: vi.fn(), exit: vi.fn(), quit: vi.fn(), showErrorBox: vi.fn(),
  createWindow: vi.fn(), configureBrowser: vi.fn(), configureMcp: vi.fn()
}))
vi.mock('electron', () => ({
  app: { setPath: vi.fn(), requestSingleInstanceLock: () => true, on: vi.fn(), whenReady: () => Promise.resolve(), exit: mocks.exit, quit: mocks.quit },
  BrowserWindow: {}, dialog: { showErrorBox: mocks.showErrorBox }
}))
vi.mock('../src/main/store', () => ({ AppStore: class { init = mocks.init; flush = mocks.flush } }))
vi.mock('../src/main/window', () => ({ createMainWindow: mocks.createWindow }))
vi.mock('../src/main/ipc', () => ({ registerIpc: vi.fn() }))
vi.mock('../src/main/llm', () => ({ cancelAllChats: vi.fn() }))
vi.mock('../src/main/agent', () => ({ cancelAllAgents: vi.fn() }))
vi.mock('../src/main/run-persistence', () => ({ flushRunCheckpoints: vi.fn() }))
vi.mock('../src/main/platform', () => ({ getPlatformAdapter: () => ({ installApplicationMenu: vi.fn() }) }))
vi.mock('../src/main/browser-runtime', () => ({ configureBrowserAutomation: mocks.configureBrowser, shutdownBrowserAutomation: vi.fn() }))
vi.mock('../src/main/mcp', () => ({ configureMcp: mocks.configureMcp, shutdownMcp: vi.fn() }))
vi.mock('../src/main/secret-storage', () => ({ createElectronSecretCodec: vi.fn() }))
vi.mock('../src/main/desktop-presence', () => ({ configureDesktopPresence: vi.fn(), shutdownDesktopPresence: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('startup failure containment', () => {
  it('reports failed data initialization and exits without flushing partial state', async () => {
    mocks.init.mockRejectedValue(new Error('会话数据格式无效'))
    await import('../src/main/index')
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(1))
    expect(mocks.showErrorBox).toHaveBeenCalledWith('DeepDesk 启动失败', expect.stringContaining('不要清空聊天记录'))
    expect(mocks.configureBrowser).not.toHaveBeenCalled()
    expect(mocks.createWindow).not.toHaveBeenCalled()
    expect(mocks.quit).not.toHaveBeenCalled()
    expect(mocks.flush).not.toHaveBeenCalled()
  })

  it('still exits cleanly if the error dialog cannot be displayed', async () => {
    mocks.init.mockRejectedValue(new Error('load failed'))
    mocks.showErrorBox.mockImplementation(() => { throw new Error('dialog unavailable') })
    await import('../src/main/index')
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(1))
    expect(mocks.flush).not.toHaveBeenCalled()
  })

  it('contains service setup failures after successful data initialization', async () => {
    mocks.init.mockResolvedValue(undefined)
    mocks.configureBrowser.mockRejectedValue(new Error('service unavailable'))
    await import('../src/main/index')
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(1))
    expect(mocks.configureMcp).not.toHaveBeenCalled()
    expect(mocks.createWindow).not.toHaveBeenCalled()
  })
})
