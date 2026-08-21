import { Menu } from 'electron'
import { platformInfoFromNode } from '../../shared/platform'
import { buildPowerShellInvocation, executeShellInvocation, quotePowerShellArgument } from './shells'
import type { PlatformAdapter } from './types'

export const windowsPlatformAdapter: PlatformAdapter = {
  info: platformInfoFromNode('win32'),
  windowOptions: {
    frame: false
  },
  quoteArgument: quotePowerShellArgument,
  executeCommand: (command, cwd, env) => executeShellInvocation(buildPowerShellInvocation(command), cwd, env),
  installApplicationMenu: () => Menu.setApplicationMenu(null),
  shouldQuitWhenAllWindowsClose: () => true
}
