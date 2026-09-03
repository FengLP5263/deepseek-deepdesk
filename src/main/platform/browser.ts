import { execFile, spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export type SupportedBrowserId = 'edge' | 'chrome' | 'brave' | 'chromium'

export interface DetectedBrowser {
  id: SupportedBrowserId
  name: string
  executablePath: string
  processName: string
}

interface CommandTextResult {
  ok: boolean
  stdout: string
}

function commandText(executable: string, args: string[]): Promise<CommandTextResult> {
  return new Promise(resolve => {
    execFile(executable, args, {
      windowsHide: true,
      timeout: 2_000,
      maxBuffer: 256 * 1024,
      env: process.env
    }, (error, stdout) => {
      resolve({ ok: !error, stdout: String(stdout ?? '') })
    })
  })
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

export function browserIdFromWindowsProgId(progId: string): SupportedBrowserId | undefined {
  const normalized = progId.trim().toLowerCase()
  if (normalized.includes('msedge')) return 'edge'
  if (normalized.includes('brave')) return 'brave'
  if (normalized.includes('chromium')) return 'chromium'
  if (normalized.includes('chrome')) return 'chrome'
  return undefined
}

export function browserIdFromMacBundleId(bundleId: string): SupportedBrowserId | undefined {
  const normalized = bundleId.trim().toLowerCase()
  if (normalized.includes('microsoft.edgemac')) return 'edge'
  if (normalized.includes('brave-browser')) return 'brave'
  if (normalized.includes('chromium')) return 'chromium'
  if (normalized.includes('google.chrome')) return 'chrome'
  return undefined
}

export function prioritizeBrowserCandidates(candidates: DetectedBrowser[], preferredId?: SupportedBrowserId): DetectedBrowser[] {
  if (!preferredId) return candidates
  return [
    ...candidates.filter(candidate => candidate.id === preferredId),
    ...candidates.filter(candidate => candidate.id !== preferredId)
  ]
}

function candidate(id: SupportedBrowserId, name: string, executablePath: string): DetectedBrowser {
  return { id, name, executablePath, processName: path.basename(executablePath) }
}

function uniqueCandidates(candidates: DetectedBrowser[]): DetectedBrowser[] {
  const seen = new Set<string>()
  return candidates.filter(item => {
    const key = item.executablePath.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function windowsBrowserCandidates(env: NodeJS.ProcessEnv): DetectedBrowser[] {
  const programFiles = env['ProgramFiles'] ?? 'C:\\Program Files'
  const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const localAppData = env['LOCALAPPDATA'] ?? ''
  return uniqueCandidates([
    candidate('edge', 'Microsoft Edge', path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
    candidate('edge', 'Microsoft Edge', path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
    ...(localAppData ? [candidate('edge', 'Microsoft Edge', path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))] : []),
    candidate('chrome', 'Google Chrome', path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    candidate('chrome', 'Google Chrome', path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    ...(localAppData ? [candidate('chrome', 'Google Chrome', path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'))] : []),
    candidate('brave', 'Brave', path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')),
    candidate('brave', 'Brave', path.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')),
    ...(localAppData ? [candidate('brave', 'Brave', path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'))] : []),
    ...(localAppData ? [candidate('chromium', 'Chromium', path.join(localAppData, 'Chromium', 'Application', 'chrome.exe'))] : [])
  ])
}

function macBrowserCandidates(): DetectedBrowser[] {
  return [
    candidate('edge', 'Microsoft Edge', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
    candidate('chrome', 'Google Chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
    candidate('brave', 'Brave', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'),
    candidate('chromium', 'Chromium', '/Applications/Chromium.app/Contents/MacOS/Chromium')
  ]
}

async function windowsDefaultBrowserId(): Promise<SupportedBrowserId | undefined> {
  for (const scheme of ['https', 'http']) {
    const result = await commandText('reg.exe', [
      'query',
      `HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${scheme}\\UserChoice`,
      '/v',
      'ProgId'
    ])
    if (!result.ok) continue
    const match = result.stdout.match(/ProgId\s+REG_SZ\s+([^\r\n]+)/i)
    const browserId = match ? browserIdFromWindowsProgId(match[1]) : undefined
    if (browserId) return browserId
  }
  return undefined
}

async function macDefaultBrowserId(): Promise<SupportedBrowserId | undefined> {
  const result = await commandText('defaults', ['read', 'com.apple.LaunchServices/com.apple.launchservices.secure', 'LSHandlers'])
  if (!result.ok) return undefined
  const blocks = result.stdout.match(/\{[\s\S]*?\}/g) ?? []
  for (const block of blocks) {
    if (!/LSHandlerURLScheme\s*=\s*"?https"?\s*;/i.test(block)) continue
    const match = block.match(/LSHandlerRoleAll\s*=\s*"?([^";]+)"?\s*;/i)
    const browserId = match ? browserIdFromMacBundleId(match[1]) : undefined
    if (browserId) return browserId
  }
  return undefined
}

function browserIdFromExecutable(executablePath: string): SupportedBrowserId {
  const normalized = executablePath.toLowerCase()
  if (normalized.includes('msedge') || normalized.includes('microsoft edge')) return 'edge'
  if (normalized.includes('brave')) return 'brave'
  if (normalized.includes('chromium')) return 'chromium'
  return 'chrome'
}

function browserName(id: SupportedBrowserId): string {
  if (id === 'edge') return 'Microsoft Edge'
  if (id === 'brave') return 'Brave'
  if (id === 'chromium') return 'Chromium'
  return 'Google Chrome'
}

export async function detectPreferredBrowser(): Promise<DetectedBrowser | null> {
  const override = process.env['DEEPDESK_BROWSER_EXECUTABLE']?.trim()
  if (override) {
    if (!(await exists(override))) return null
    const id = browserIdFromExecutable(override)
    return candidate(id, process.env['DEEPDESK_BROWSER_NAME']?.trim() || browserName(id), override)
  }

  const candidates = process.platform === 'win32' ? windowsBrowserCandidates(process.env) : macBrowserCandidates()
  const preferredId = process.platform === 'win32' ? await windowsDefaultBrowserId() : await macDefaultBrowserId()
  for (const item of prioritizeBrowserCandidates(candidates, preferredId)) {
    if (await exists(item.executablePath)) return item
  }
  return null
}

export async function openBrowserExtensionManager(browser: DetectedBrowser): Promise<void> {
  const extensionUrl = browser.id === 'edge'
    ? 'edge://extensions'
    : browser.id === 'brave'
      ? 'brave://extensions'
      : 'chrome://extensions'
  const child = spawn(browser.executablePath, [extensionUrl], {
    detached: true,
    stdio: 'ignore'
  })
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.unref()
}

export async function isBrowserRunning(browser: DetectedBrowser): Promise<boolean> {
  const result = process.platform === 'win32'
    ? await commandText('tasklist.exe', ['/FI', `IMAGENAME eq ${browser.processName}`, '/NH'])
    : await commandText('pgrep', ['-x', browser.processName])
  if (!result.ok) return false
  return process.platform === 'win32'
    ? result.stdout.toLowerCase().includes(browser.processName.toLowerCase())
    : result.stdout.trim().length > 0
}

export async function openBrowser(browser: DetectedBrowser): Promise<void> {
  const child = spawn(browser.executablePath, [], {
    detached: true,
    stdio: 'ignore'
  })
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })
  child.unref()
}
