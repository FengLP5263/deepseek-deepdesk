import type { BrowserWindowConstructorOptions } from 'electron'
import type { PlatformInfo } from '../../shared/platform'

export interface CommandResult {
  stdout: string
  stderr: string
  code: number
}

export interface CommandEnvironment {
  [key: string]: string | undefined
}

export interface PlatformAdapter {
  readonly info: PlatformInfo
  readonly windowOptions: BrowserWindowConstructorOptions
  quoteArgument(value: string): string
  executeCommand(command: string, cwd: string, env?: CommandEnvironment): Promise<CommandResult>
  installApplicationMenu(): void
  shouldQuitWhenAllWindowsClose(): boolean
}
