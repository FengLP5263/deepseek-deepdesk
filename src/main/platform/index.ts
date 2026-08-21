import type { PlatformAdapter } from './types'
import { macosPlatformAdapter } from './macos'
import { windowsPlatformAdapter } from './windows'

let currentAdapter: PlatformAdapter | undefined

export function platformAdapterFor(platform: string): PlatformAdapter {
  if (platform === 'win32') return windowsPlatformAdapter
  if (platform === 'darwin') return macosPlatformAdapter
  throw new Error('DeepDesk 暂不支持当前操作系统: ' + platform)
}

export function getPlatformAdapter(): PlatformAdapter {
  currentAdapter ??= platformAdapterFor(process.platform)
  return currentAdapter
}
