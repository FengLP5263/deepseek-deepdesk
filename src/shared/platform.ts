export type DesktopPlatform = 'windows' | 'macos'
export type CommandShellName = 'powershell' | 'zsh'

export interface PlatformInfo {
  readonly id: DesktopPlatform
  readonly shellName: CommandShellName
  readonly nativeWindowControls: boolean
}

const WINDOWS_INFO: PlatformInfo = {
  id: 'windows',
  shellName: 'powershell',
  nativeWindowControls: false
}

const MACOS_INFO: PlatformInfo = {
  id: 'macos',
  shellName: 'zsh',
  nativeWindowControls: true
}

export function platformInfoFromNode(platform: string): PlatformInfo {
  if (platform === 'win32') return WINDOWS_INFO
  if (platform === 'darwin') return MACOS_INFO
  throw new Error('DeepDesk 暂不支持当前操作系统: ' + platform)
}
