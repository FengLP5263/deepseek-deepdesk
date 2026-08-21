import { app, BrowserWindow } from 'electron'
import { createMainWindow } from './window'
import { AppStore } from './store'
import { registerIpc } from './ipc'
import { cancelAllChats } from './llm'
import { getPlatformAdapter } from './platform'

let mainWindow: BrowserWindow | null = null
const platform = getPlatformAdapter()
const userDataDir = process.env['DEEPDESK_USER_DATA_DIR']
if (userDataDir) app.setPath('userData', userDataDir)
const store = new AppStore()
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(async () => {
    platform.installApplicationMenu()
    await store.init()
    registerIpc(store, () => mainWindow)
    mainWindow = createMainWindow()
    mainWindow.on('closed', () => {
      mainWindow = null
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow()
      }
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
  })

  app.on('window-all-closed', () => {
    if (platform.shouldQuitWhenAllWindowsClose()) app.quit()
  })

  let isQuitting = false
  app.on('before-quit', (event) => {
    cancelAllChats()
    if (isQuitting) return
    event.preventDefault()
    isQuitting = true
    void store.flush().finally(() => app.quit())
  })
}
