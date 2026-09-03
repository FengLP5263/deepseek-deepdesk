import { app, globalShortcut, Menu, nativeImage, Tray } from 'electron'
import path from 'node:path'

export const DEEPDESK_GLOBAL_SHORTCUT = 'CommandOrControl+Shift+Space'

let tray: Tray | null = null

function trayIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tray-icon.png')
    : path.join(app.getAppPath(), 'build', 'icon.png')
}

export interface DesktopPresenceActions {
  showWindow: () => void
  newTask: () => void
}

export function configureDesktopPresence(actions: DesktopPresenceActions): void {
  shutdownDesktopPresence()
  const icon = nativeImage.createFromPath(trayIconPath()).resize({ width: process.platform === 'darwin' ? 18 : 20, height: process.platform === 'darwin' ? 18 : 20 })
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  if (!icon.isEmpty()) {
    tray = new Tray(icon)
    tray.setToolTip('DeepDesk')
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示 DeepDesk', click: actions.showWindow },
      { label: '新建任务', click: actions.newTask },
      { type: 'separator' },
      { label: '退出 DeepDesk', click: () => app.quit() }
    ]))
    tray.on('click', actions.showWindow)
  } else {
    console.warn('[desktop] 无法加载托盘图标:', trayIconPath())
  }
  if (!globalShortcut.register(DEEPDESK_GLOBAL_SHORTCUT, actions.showWindow)) {
    console.warn('[desktop] 全局快捷键注册失败:', DEEPDESK_GLOBAL_SHORTCUT)
  }
}

export function shutdownDesktopPresence(): void {
  globalShortcut.unregister(DEEPDESK_GLOBAL_SHORTCUT)
  tray?.destroy()
  tray = null
}
