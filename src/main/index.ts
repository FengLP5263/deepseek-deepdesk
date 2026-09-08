import { app, BrowserWindow, dialog } from 'electron'
import { createMainWindow } from './window'
import { AppStore } from './store'
import { registerIpc } from './ipc'
import { cancelAllChats } from './llm'
import { cancelAllAgents } from './agent'
import { flushRunCheckpoints } from './run-persistence'
import { getPlatformAdapter } from './platform'
import { configureBrowserAutomation, shutdownBrowserAutomation } from './browser-runtime'
import { configureMcp, shutdownMcp } from './mcp'
import { createElectronSecretCodec } from './secret-storage'
import { configureDesktopPresence, shutdownDesktopPresence } from './desktop-presence'
import { IPC } from '../shared/ipc-channels'

let mainWindow: BrowserWindow | null = null
const platform = getPlatformAdapter()
const userDataDir = process.env['DEEPDESK_USER_DATA_DIR']
if (userDataDir) app.setPath('userData', userDataDir)
const store = new AppStore(undefined, createElectronSecretCodec())
const gotLock = app.requestSingleInstanceLock()

function ensureMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow
  mainWindow = createMainWindow()
  mainWindow.on('closed', () => { mainWindow = null })
  return mainWindow
}

function showMainWindow(): BrowserWindow {
  const win = ensureMainWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return win
}

function requestNewTask(): void {
  const win = showMainWindow()
  const send = (): void => { if (!win.isDestroyed()) win.webContents.send(IPC.AppNewTaskRequested) }
  if (win.webContents.isLoadingMainFrame()) win.webContents.once('did-finish-load', send)
  else send()
}

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (app.isReady()) showMainWindow()
  })

  void app.whenReady().then(async () => {
    platform.installApplicationMenu()
    await store.init()
    await configureBrowserAutomation(store)
    await configureMcp(store)
    registerIpc(store, () => mainWindow)
    mainWindow = ensureMainWindow()
    configureDesktopPresence({ showWindow: () => { showMainWindow() }, newTask: requestNewTask })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) ensureMainWindow()
      else showMainWindow()
    })

    if (process.argv.includes('--smoke-test')) {
      const win = mainWindow
      win.webContents.once('did-finish-load', () => {
        console.log('[smoke] renderer loaded')
        setTimeout(() => {
          console.log('[smoke] SMOKE_OK')
          app.exit(0)
        }, 1500)
      })
      win.webContents.once('did-fail-load', (_event, code, desc) => {
        console.error('[smoke] did-fail-load code=' + code + ' desc=' + desc)
        app.exit(1)
      })
    }
  }).catch(error => {
    console.error('[startup] 初始化失败，停止启动并保留本地恢复数据', error)
    try {
      dialog.showErrorBox('DeepDesk 启动失败', '本地数据或服务初始化失败。请保留应用数据目录，不要清空聊天记录；可将终端错误日志提供给维护者排查。')
    } catch {
      console.error('[startup] 无法显示错误提示，请查看终端日志')
    } finally {
      // Do not run normal quit/flush on a partially initialized store.
      app.exit(1)
    }
  })

  app.on('window-all-closed', () => {
    if (platform.shouldQuitWhenAllWindowsClose()) app.quit()
  })

  let isQuitting = false
  app.on('before-quit', (event) => {
    cancelAllChats()
    cancelAllAgents()
    if (isQuitting) return
    event.preventDefault()
    isQuitting = true
    shutdownDesktopPresence()
    flushRunCheckpoints()
    void Promise.all([store.flush(), shutdownBrowserAutomation(), shutdownMcp()])
      .catch(error => console.error('[shutdown] 保存或清理失败，保留本地恢复数据', error))
      .finally(() => app.quit())
  })
}
