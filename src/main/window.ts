import { app, BrowserWindow, shell } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { IPC } from '../shared/ipc-channels'
import { getPlatformAdapter } from './platform'

function getDevelopmentWindowIcon(): string | undefined {
  if (app.isPackaged) return undefined

  const iconPath = path.join(app.getAppPath(), 'build', 'icon.png')
  return existsSync(iconPath) ? iconPath : undefined
}

export function createMainWindow(): BrowserWindow {
  const platform = getPlatformAdapter()
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: '#0e0e0e',
    title: 'DeepDesk',
    icon: getDevelopmentWindowIcon(),
    ...platform.windowOptions,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  const sendMaximized = (): void => {
    if (!win.isDestroyed()) win.webContents.send(IPC.WindowMaximizedChanged, win.isMaximized())
  }
  win.on('maximize', sendMaximized)
  win.on('unmaximize', sendMaximized)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const allowed = url.startsWith('file://') || (devUrl !== undefined && url.startsWith(devUrl))
    if (!allowed) event.preventDefault()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}
