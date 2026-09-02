import { describe, expect, it } from 'vitest'
import { createAgentTools } from '../src/main/agent-tools'
import { buildSystemPrompt } from '../src/main/agent'
import { buildPowerShellInvocation, buildZshInvocation, quotePosixArgument, quotePowerShellArgument } from '../src/main/platform/shells'
import { browserIdFromMacBundleId, browserIdFromWindowsProgId, prioritizeBrowserCandidates, type DetectedBrowser } from '../src/main/platform/browser'
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

  it('maps system default browser identifiers and prioritizes the matching Chromium browser', () => {
    expect(browserIdFromWindowsProgId('MSEdgeHTM')).toBe('edge')
    expect(browserIdFromWindowsProgId('ChromeHTML')).toBe('chrome')
    expect(browserIdFromMacBundleId('com.microsoft.edgemac')).toBe('edge')
    expect(browserIdFromWindowsProgId('FirefoxURL')).toBeUndefined()

    const chrome: DetectedBrowser = { id: 'chrome', name: 'Google Chrome', executablePath: 'chrome.exe', processName: 'chrome.exe' }
    const edge: DetectedBrowser = { id: 'edge', name: 'Microsoft Edge', executablePath: 'msedge.exe', processName: 'msedge.exe' }
    expect(prioritizeBrowserCandidates([chrome, edge], 'edge').map(browser => browser.id)).toEqual(['edge', 'chrome'])
  })

  it('describes the active shell in Agent tools and prompts', () => {
    const macos = platformInfoFromNode('darwin')
    const windows = platformInfoFromNode('win32')
    expect(JSON.stringify(createAgentTools(macos))).toContain('zsh')
    const windowsTools = JSON.stringify(createAgentTools(windows))
    expect(windowsTools).toContain('PowerShell')
    expect(windowsTools).not.toContain('"submit"')
    expect(buildSystemPrompt('/tmp/project', macos, 'ask')).toContain('zsh（macOS）')
    const windowsPrompt = buildSystemPrompt('C:\\project', windows, 'ask')
    expect(windowsPrompt).toContain('PowerShell（Windows）')
    expect(windowsPrompt).toContain('browser_type 只负责输入')
  })

  it('recognizes Windows and macOS command risk consistently', () => {
    expect(isDangerousCommand('Remove-Item -Recurse -Force C:\\temp')).toBe(true)
    expect(isDangerousCommand('diskutil eraseDisk APFS Empty /dev/disk9')).toBe(true)
    expect(isDangerousCommand('rm -fr ./generated')).toBe(true)
    expect(isReadOnlyCommand('Get-ChildItem')).toBe(true)
    expect(isReadOnlyCommand('ls -la')).toBe(true)
    expect(isReadOnlyCommand('lark-cli im chats get --help')).toBe(true)
    expect(isReadOnlyCommand('lark-cli im chats get --chat-id oc_xxx')).toBe(true)
    expect(isReadOnlyCommand('lark-cli im +messages-send --user-id ou_xxx --text hi')).toBe(false)
    expect(isReadOnlyCommand('rm -rf ./generated')).toBe(false)
  })
})
