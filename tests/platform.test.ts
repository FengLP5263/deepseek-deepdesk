import { describe, expect, it } from 'vitest'
import { createAgentTools } from '../src/main/agent-tools'
import { buildSystemPrompt } from '../src/main/agent'
import { buildPowerShellInvocation, buildZshInvocation, quotePosixArgument, quotePowerShellArgument } from '../src/main/platform/shells'
import { isDangerousCommand, isReadOnlyCommand } from '../src/main/tools'
import { platformInfoFromNode } from '../src/shared/platform'

describe('platform adapters', () => {
  it('maps supported Node platforms and rejects unsupported systems', () => {
    expect(platformInfoFromNode('win32')).toEqual({ id: 'windows', shellName: 'powershell', nativeWindowControls: false })
    expect(platformInfoFromNode('darwin')).toEqual({ id: 'macos', shellName: 'zsh', nativeWindowControls: true })
    expect(() => platformInfoFromNode('linux')).toThrow('暂不支持')
  })

  it('builds deterministic PowerShell and zsh invocations', () => {
    expect(buildPowerShellInvocation('Get-Location')).toEqual({
      executable: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'Get-Location']
    })
    expect(buildZshInvocation('pwd')).toEqual({ executable: '/bin/zsh', args: ['-l', '-c', 'pwd'] })
  })

  it('quotes arguments for both shells', () => {
    expect(quotePowerShellArgument("O'Brien")).toBe("'O''Brien'")
    expect(quotePosixArgument("O'Brien")).toBe("'O'\\''Brien'")
  })

  it('describes the active shell in Agent tools and prompts', () => {
    const macos = platformInfoFromNode('darwin')
    const windows = platformInfoFromNode('win32')
    expect(JSON.stringify(createAgentTools(macos))).toContain('zsh')
    expect(JSON.stringify(createAgentTools(windows))).toContain('PowerShell')
    expect(buildSystemPrompt('/tmp/project', macos, 'ask')).toContain('zsh（macOS）')
    expect(buildSystemPrompt('C:\\project', windows, 'ask')).toContain('PowerShell（Windows）')
  })

  it('recognizes Windows and macOS command risk consistently', () => {
    expect(isDangerousCommand('Remove-Item -Recurse -Force C:\\temp')).toBe(true)
    expect(isDangerousCommand('diskutil eraseDisk APFS Empty /dev/disk9')).toBe(true)
    expect(isDangerousCommand('rm -fr ./generated')).toBe(true)
    expect(isReadOnlyCommand('Get-ChildItem')).toBe(true)
    expect(isReadOnlyCommand('ls -la')).toBe(true)
    expect(isReadOnlyCommand('rm -rf ./generated')).toBe(false)
  })
})
