import { execFile } from 'node:child_process'
import type { CommandEnvironment, CommandResult } from './types'

const COMMAND_TIMEOUT = 120000
const COMMAND_MAX_BUFFER = 4 * 1024 * 1024

export interface ShellInvocation {
  executable: string
  args: string[]
}

export function buildPowerShellInvocation(command: string): ShellInvocation {
  return {
    executable: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]
  }
}

export function buildZshInvocation(command: string): ShellInvocation {
  return {
    executable: '/bin/zsh',
    args: ['-l', '-c', command]
  }
}

export function quotePowerShellArgument(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'"
}

export function quotePosixArgument(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

export function executeShellInvocation(invocation: ShellInvocation, cwd: string, env?: CommandEnvironment): Promise<CommandResult> {
  return new Promise(resolve => {
    execFile(invocation.executable, invocation.args, {
      cwd,
      timeout: COMMAND_TIMEOUT,
      maxBuffer: COMMAND_MAX_BUFFER,
      windowsHide: true,
      env: env ? { ...process.env, ...env } : process.env
    }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
      resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), code })
    })
  })
}
