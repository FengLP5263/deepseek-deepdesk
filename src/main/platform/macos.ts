import { Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { platformInfoFromNode } from '../../shared/platform'
import { buildZshInvocation, executeShellInvocation, quotePosixArgument } from './shells'
import type { PlatformAdapter } from './types'

const menuTemplate: MenuItemConstructorOptions[] = [
  {
    role: 'appMenu',
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' }
    ]
  },
  { role: 'fileMenu' },
  { role: 'editMenu' },
  { role: 'viewMenu' },
  { role: 'windowMenu' }
]

export const macosPlatformAdapter: PlatformAdapter = {
  info: platformInfoFromNode('darwin'),
  windowOptions: {
    frame: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 10 }
  },
  quoteArgument: quotePosixArgument,
  executeCommand: (command, cwd, env) => executeShellInvocation(buildZshInvocation(command), cwd, env),
  installApplicationMenu: () => Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate)),
  shouldQuitWhenAllWindowsClose: () => false
}
