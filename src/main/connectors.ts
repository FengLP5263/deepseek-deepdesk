import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import type { AppStore } from './store'
import type { ConnectorActionResult, ConnectorAuthSession, ConnectorAuthState, ConnectorConfig, ConnectorId, ConnectorState, ConnectorStatus } from '../shared/types'
import { getPlatformAdapter } from './platform'

const WECHAT_ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com'
const WECHAT_ILINK_BOT_TYPE = '3'
const DIRECT_AUTH_TTL_MS = 5 * 60_000

interface DesktopAppCandidate {
  path: string
}

interface GatewayAuthStartResponse {
  sessionId?: unknown
  qrUrl?: unknown
  qrDataUrl?: unknown
  expiresAt?: unknown
  message?: unknown
  detail?: unknown
}

interface GatewayAuthStatusResponse extends GatewayAuthStartResponse {
  state?: unknown
  connected?: unknown
}

interface ActiveDirectAuthSession {
  id: ConnectorId
  provider: 'lark-registration' | 'wechat-ilink'
  sessionId: string
  state: ConnectorAuthState
  message: string
  detail?: string
  qrUrl?: string
  qrDataUrl?: string
  expiresAt: number
  qrcode?: string
  currentApiBaseUrl?: string
  abortController?: AbortController
}

interface WeChatQrResponse {
  qrcode?: unknown
  qrcode_img_content?: unknown
}

interface WeChatStatusResponse {
  status?: unknown
  bot_token?: unknown
  ilink_bot_id?: unknown
  baseurl?: unknown
  ilink_user_id?: unknown
  redirect_host?: unknown
}

const directAuthSessions = new Map<string, ActiveDirectAuthSession>()

function connectorStatus(id: ConnectorId, name: string, state: ConnectorState, summary: string, detail: string, primaryAction: string, config: ConnectorConfig, disconnectAction?: string, command?: string): ConnectorStatus {
  return { id, name, state, summary, detail, primaryAction, disconnectAction, command, config }
}

function findConfig(configs: ConnectorConfig[], id: ConnectorId): ConnectorConfig {
  const found = configs.find(config => config.id === id)
  if (found) return found
  return {
    id,
    enabled: false,
    endpoint: '',
    token: '',
    refreshToken: '',
    accountId: '',
    userId: '',
    expiresAt: 0,
    appId: '',
    appSecret: '',
    verificationToken: '',
    encryptKey: '',
    updatedAt: 0
  }
}

function hasText(value: string): boolean {
  return value.trim().length > 0
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

function commandResultMessage(stdout: string, stderr: string): string {
  const text = `${stdout}\n${stderr}`.trim()
  return text.length > 500 ? text.slice(0, 500) + '...' : text
}

function trimBaseUrl(url: string): string {
  let next = url.trim()
  while (next.endsWith('/')) next = next.slice(0, -1)
  return next
}

function authHeaders(config: ConnectorConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (hasText(config.token)) headers['Authorization'] = 'Bearer ' + config.token.trim()
  return headers
}

function textFromUnknown(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberFromUnknown(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function errorCodeFromUnknown(value: unknown): string {
  if (value && typeof value === 'object' && 'code' in value) {
    const code = (value as { code?: unknown }).code
    return typeof code === 'string' ? code : ''
  }
  return ''
}

function errorMessageFromUnknown(value: unknown): string {
  if (value instanceof Error && value.message) return value.message
  if (value && typeof value === 'object' && 'description' in value) {
    const description = (value as { description?: unknown }).description
    if (typeof description === 'string' && description.trim()) return description.trim()
  }
  return String(value)
}

function authStateFromUnknown(value: unknown, connected: unknown): ConnectorAuthState {
  if (connected === true) return 'connected'
  if (value === 'pending' || value === 'scanned' || value === 'connected' || value === 'expired' || value === 'failed') return value
  return 'pending'
}

async function qrDataUrlFromText(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 178,
    color: {
      dark: '#1f2937',
      light: '#ffffff'
    }
  })
}

function directAuthDisabled(): boolean {
  return process.env['DEEPDESK_DISABLE_DIRECT_CONNECTORS'] === '1'
}

function directSessionKey(id: ConnectorId, sessionId: string): string {
  return id + ':' + sessionId
}

function cleanupSession(session: ActiveDirectAuthSession): void {
  if (session.abortController && !session.abortController.signal.aborted) {
    session.abortController.abort()
  }
}

function closeDirectSessionsFor(id: ConnectorId): void {
  for (const [key, session] of directAuthSessions) {
    if (session.id !== id) continue
    cleanupSession(session)
    directAuthSessions.delete(key)
  }
}

function directSessionResponse(session: ActiveDirectAuthSession): ConnectorAuthSession {
  return {
    id: session.id,
    ok: session.state !== 'failed',
    state: session.state,
    sessionId: session.sessionId,
    qrUrl: session.qrUrl,
    qrDataUrl: session.qrDataUrl,
    expiresAt: session.expiresAt,
    message: session.message,
    detail: session.detail
  }
}

function jsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json' }
}

async function fetchJsonWithTimeout<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return await res.json() as T
  } finally {
    clearTimeout(timer)
  }
}

function missingGatewayService(id: ConnectorId): ConnectorAuthSession {
  return {
    id,
    ok: false,
    state: 'failed',
    message: id === 'lark' ? '请先配置飞书接入服务' : '请先配置微信接入服务',
    detail: '可填写接入服务地址，或使用 DeepDesk 内置扫码接入。'
  }
}

async function startGatewayAuth(id: ConnectorId, config: ConnectorConfig): Promise<ConnectorAuthSession> {
  const endpoint = trimBaseUrl(config.endpoint)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(endpoint + '/connectors/' + id + '/auth/start', {
      method: 'POST',
      headers: authHeaders(config),
      body: JSON.stringify({
        connector: id,
        appId: config.appId.trim(),
        appSecret: config.appSecret.trim(),
        verificationToken: config.verificationToken.trim(),
        encryptKey: config.encryptKey.trim()
      }),
      signal: controller.signal
    })
    if (!res.ok) {
      return { id, ok: false, state: 'failed', message: '获取二维码失败', detail: '接入服务返回 HTTP ' + res.status }
    }
    const json = await res.json() as GatewayAuthStartResponse
    const qrUrl = textFromUnknown(json.qrUrl)
    const rawQrDataUrl = textFromUnknown(json.qrDataUrl)
    const qrDataUrl = rawQrDataUrl ?? (qrUrl ? await qrDataUrlFromText(qrUrl) : undefined)
    if (!qrDataUrl) {
      return { id, ok: false, state: 'failed', message: '接入服务未返回二维码', detail: '需要返回 qrUrl 或 qrDataUrl。' }
    }
    return {
      id,
      ok: true,
      state: 'pending',
      sessionId: textFromUnknown(json.sessionId),
      qrUrl,
      qrDataUrl,
      expiresAt: numberFromUnknown(json.expiresAt),
      message: textFromUnknown(json.message) ?? '请扫码完成接入',
      detail: textFromUnknown(json.detail)
    }
  } catch (error) {
    const e = error as Error
    return { id, ok: false, state: 'failed', message: '无法连接接入服务', detail: e.message || '网络请求失败' }
  } finally {
    clearTimeout(timer)
  }
}

async function startLarkLocalAuth(store: AppStore, config: ConnectorConfig): Promise<ConnectorAuthSession> {
  if (directAuthDisabled()) return missingGatewayService('lark')
  closeDirectSessionsFor('lark')
  const sessionId = randomUUID()
  const abortController = new AbortController()
  const session: ActiveDirectAuthSession = {
    id: 'lark',
    provider: 'lark-registration',
    sessionId,
    state: 'pending',
    message: '正在生成飞书二维码',
    detail: '请稍候。',
    expiresAt: Date.now() + DIRECT_AUTH_TTL_MS,
    abortController
  }

  let resolveQrReady: () => void = () => undefined
  let rejectQrReady: (error: Error) => void = () => undefined
  const qrReady = new Promise<void>((resolve, reject) => {
    resolveQrReady = resolve
    rejectQrReady = reject
  })
  directAuthSessions.set(directSessionKey('lark', sessionId), session)

  void (async () => {
    try {
      const lark = await import('@larksuiteoapi/node-sdk')
      const result = await lark.registerApp({
        source: 'deepdesk',
        appId: hasText(config.appId) ? config.appId.trim() : undefined,
        createOnly: !hasText(config.appId),
        signal: abortController.signal,
        appPreset: {
          name: 'DeepDesk',
          desc: 'DeepDesk 桌面 AI 助手，用于通过飞书消息触发 AI 任务并返回处理结果。'
        },
        addons: {
          preset: false,
          scopes: { tenant: ['im:message:send_as_bot'] },
          events: { items: { tenant: ['im.message.receive_v1'] } }
        },
        onQRCodeReady(info) {
          void (async () => {
            try {
              session.qrUrl = info.url
              session.qrDataUrl = await qrDataUrlFromText(info.url)
              session.expiresAt = Date.now() + info.expireIn * 1000
              session.message = '请使用飞书扫码授权'
              session.detail = '扫码后确认创建或更新 DeepDesk 飞书应用。'
              resolveQrReady()
            } catch (error) {
              rejectQrReady(error instanceof Error ? error : new Error(String(error)))
            }
          })()
        },
        onStatusChange(info) {
          const status = String(info.status)
          if (status === 'polling') {
            session.state = 'pending'
            session.message = '等待飞书扫码'
            session.detail = '请使用飞书扫描二维码并确认授权。'
          } else if (status === 'scanned' || status === 'scaned') {
            session.state = 'scanned'
            session.message = '已扫码，等待确认'
            session.detail = '请在飞书中确认授权。'
          } else if (status === 'slow_down') {
            session.state = 'pending'
            session.message = '等待飞书确认'
            session.detail = '飞书要求降低查询频率，DeepDesk 会继续等待。'
          } else if (status === 'domain_switched') {
            session.state = 'pending'
            session.message = '正在切换飞书授权域'
            session.detail = 'DeepDesk 会继续等待授权结果。'
          }
        }
      })
      store.upsertConnectorConfig({
        id: 'lark',
        enabled: true,
        appId: result.client_id,
        appSecret: result.client_secret,
        userId: result.user_info?.open_id ?? ''
      })
      session.state = 'connected'
      session.message = '已完成飞书接入'
      session.detail = '飞书应用已创建或更新，现在可以继续配置消息监听能力。'
    } catch (error) {
      if (abortController.signal.aborted) return
      session.state = errorCodeFromUnknown(error) === 'expired_token' ? 'expired' : 'failed'
      session.message = session.state === 'expired' ? '飞书二维码已过期' : '飞书扫码接入失败'
      session.detail = errorMessageFromUnknown(error)
      rejectQrReady(error instanceof Error ? error : new Error(String(error)))
    }
  })()

  try {
    await qrReady
  } catch (error) {
    return { id: 'lark', ok: false, state: 'failed', message: '获取飞书二维码失败', detail: error instanceof Error ? error.message : String(error) }
  }
  return directSessionResponse(session)
}

async function startWeChatIlinkAuth(config: ConnectorConfig): Promise<ConnectorAuthSession> {
  if (directAuthDisabled()) return missingGatewayService('wechat')
  closeDirectSessionsFor('wechat')
  try {
    const localTokenList = hasText(config.token) ? [config.token.trim()] : []
    const json = await fetchJsonWithTimeout<WeChatQrResponse>(
      WECHAT_ILINK_BASE_URL + '/ilink/bot/get_bot_qrcode?bot_type=' + encodeURIComponent(WECHAT_ILINK_BOT_TYPE),
      {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ local_token_list: localTokenList.slice(0, 10) })
      },
      10000
    )
    const qrcode = textFromUnknown(json.qrcode)
    const qrUrl = textFromUnknown(json.qrcode_img_content)
    if (!qrcode || !qrUrl) {
      return { id: 'wechat', ok: false, state: 'failed', message: '微信服务未返回二维码', detail: '请稍后重试。' }
    }
    const sessionId = randomUUID()
    const session: ActiveDirectAuthSession = {
      id: 'wechat',
      provider: 'wechat-ilink',
      sessionId,
      state: 'pending',
      message: '请使用微信扫码授权',
      detail: '扫码完成后 DeepDesk 会自动检测接入状态。',
      qrcode,
      qrUrl,
      qrDataUrl: await qrDataUrlFromText(qrUrl),
      currentApiBaseUrl: WECHAT_ILINK_BASE_URL,
      expiresAt: Date.now() + DIRECT_AUTH_TTL_MS
    }
    directAuthSessions.set(directSessionKey('wechat', sessionId), session)
    return directSessionResponse(session)
  } catch (error) {
    return { id: 'wechat', ok: false, state: 'failed', message: '获取微信二维码失败', detail: error instanceof Error ? error.message : String(error) }
  }
}

async function pollWeChatIlinkStatus(store: AppStore, session: ActiveDirectAuthSession): Promise<ConnectorAuthSession> {
  if (!session.qrcode) return { id: 'wechat', ok: false, state: 'failed', sessionId: session.sessionId, message: '授权会话无效' }
  if (Date.now() > session.expiresAt) {
    session.state = 'expired'
    session.message = '二维码已过期'
    session.detail = '请重新获取二维码。'
    return directSessionResponse(session)
  }
  try {
    const baseUrl = session.currentApiBaseUrl ?? WECHAT_ILINK_BASE_URL
    const json = await fetchJsonWithTimeout<WeChatStatusResponse>(
      baseUrl + '/ilink/bot/get_qrcode_status?qrcode=' + encodeURIComponent(session.qrcode),
      { headers: jsonHeaders() },
      38000
    )
    const status = textFromUnknown(json.status)
    if (status === 'scaned') {
      session.state = 'scanned'
      session.message = '已扫码，请在手机上确认'
      session.detail = undefined
    } else if (status === 'scaned_but_redirect') {
      const redirectHost = textFromUnknown(json.redirect_host)
      if (redirectHost) session.currentApiBaseUrl = redirectHost.startsWith('http') ? redirectHost : 'https://' + redirectHost
      session.state = 'scanned'
      session.message = '已扫码，正在切换授权节点'
    } else if (status === 'confirmed') {
      const token = textFromUnknown(json.bot_token) ?? ''
      const accountId = textFromUnknown(json.ilink_bot_id) ?? ''
      const endpoint = textFromUnknown(json.baseurl) ?? ''
      store.upsertConnectorConfig({
        id: 'wechat',
        enabled: true,
        token,
        accountId,
        userId: textFromUnknown(json.ilink_user_id) ?? '',
        endpoint
      })
      session.state = 'connected'
      session.message = '已完成微信接入'
      session.detail = '现在可以通过微信消息触发 DeepDesk 任务。'
      cleanupSession(session)
    } else if (status === 'binded_redirect') {
      store.upsertConnectorConfig({ id: 'wechat', enabled: true })
      session.state = 'connected'
      session.message = '微信接入已存在'
      session.detail = '当前微信账号已经绑定，可直接使用。'
      cleanupSession(session)
    } else if (status === 'expired') {
      session.state = 'expired'
      session.message = '二维码已过期'
      session.detail = '请重新获取二维码。'
      cleanupSession(session)
    } else if (status === 'need_verifycode' || status === 'verify_code_blocked') {
      session.state = 'failed'
      session.message = '微信需要额外验证'
      session.detail = '当前版本暂不支持配对验证码，请重新获取二维码或稍后重试。'
      cleanupSession(session)
    } else {
      session.state = 'pending'
      session.message = '等待微信扫码'
      session.detail = '扫码完成后 DeepDesk 会自动检测接入状态。'
    }
    return directSessionResponse(session)
  } catch (error) {
    session.state = 'pending'
    session.message = '等待微信扫码'
    session.detail = error instanceof Error ? '暂时无法查询状态：' + error.message : '暂时无法查询状态'
    return directSessionResponse(session)
  }
}

export async function startConnectorAuth(store: AppStore, id: ConnectorId): Promise<ConnectorAuthSession> {
  const config = findConfig(store.getSnapshot().connectors, id)
  if (id === 'browser') {
    return { id, ok: false, state: 'failed', message: '浏览器自动化不需要扫码接入' }
  }
  if (hasText(config.endpoint)) return startGatewayAuth(id, config)
  if (id === 'lark') return startLarkLocalAuth(store, config)
  if (id === 'wechat') return startWeChatIlinkAuth(config)
  return startGatewayAuth(id, config)
}

export async function getConnectorAuthStatus(store: AppStore, id: ConnectorId, sessionId: string): Promise<ConnectorAuthSession> {
  const config = findConfig(store.getSnapshot().connectors, id)
  if (!hasText(sessionId)) return { id, ok: false, state: 'failed', message: '授权会话无效' }
  const directSession = directAuthSessions.get(directSessionKey(id, sessionId))
  if (directSession) {
    if (directSession.provider === 'wechat-ilink') return pollWeChatIlinkStatus(store, directSession)
    if (Date.now() > directSession.expiresAt && directSession.state !== 'connected') {
      directSession.state = 'expired'
      directSession.message = '二维码已过期'
      directSession.detail = '请重新获取二维码。'
      cleanupSession(directSession)
    }
    return directSessionResponse(directSession)
  }
  if (!hasText(config.endpoint)) return missingGatewayService(id)
  const endpoint = trimBaseUrl(config.endpoint)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const url = endpoint + '/connectors/' + id + '/auth/status?sessionId=' + encodeURIComponent(sessionId)
    const res = await fetch(url, { headers: authHeaders(config), signal: controller.signal })
    if (!res.ok) {
      return { id, ok: false, state: 'failed', sessionId, message: '查询授权状态失败', detail: '接入服务返回 HTTP ' + res.status }
    }
    const json = await res.json() as GatewayAuthStatusResponse
    const state = authStateFromUnknown(json.state, json.connected)
    if (state === 'connected') {
      store.upsertConnectorConfig({ id, enabled: true })
    }
    return {
      id,
      ok: state !== 'failed',
      state,
      sessionId,
      qrUrl: textFromUnknown(json.qrUrl),
      qrDataUrl: textFromUnknown(json.qrDataUrl),
      expiresAt: numberFromUnknown(json.expiresAt),
      message: textFromUnknown(json.message) ?? (state === 'connected' ? '已完成接入' : '等待扫码确认'),
      detail: textFromUnknown(json.detail)
    }
  } catch (error) {
    const e = error as Error
    return { id, ok: false, state: 'failed', sessionId, message: '无法查询授权状态', detail: e.message || '网络请求失败' }
  } finally {
    clearTimeout(timer)
  }
}

function checkLark(config: ConnectorConfig): ConnectorStatus {
  const configured = hasText(config.token) || (hasText(config.appId) && hasText(config.appSecret))
  if (config.enabled && configured) {
    return connectorStatus(
      'lark',
      '飞书',
      'connected',
      '已接入',
      'DeepDesk 可以通过你配置的飞书应用接收消息、发送回复，并触发任务。',
      '连接',
      config,
      '断开'
    )
  }
  return connectorStatus(
    'lark',
    '飞书',
    hasText(config.appId) || hasText(config.endpoint) ? 'available' : 'needs_setup',
    configured ? '未启用' : '未接入',
    '扫码授权后，可用飞书消息触发任务并接收处理结果。',
    configured ? '连接' : '扫码接入',
    config
  )
}

function checkWeChat(config: ConnectorConfig): ConnectorStatus {
  const configured = hasText(config.endpoint) && hasText(config.token)
  if (config.enabled && configured) {
    return connectorStatus(
      'wechat',
      '微信',
      'connected',
      '已接入',
      'DeepDesk 可以通过你配置的微信接入服务接收消息、发送回复，并触发任务。',
      '连接',
      config,
      '断开'
    )
  }
  return connectorStatus(
    'wechat',
    '微信',
    configured || !hasText(config.endpoint) ? 'available' : 'needs_setup',
    configured ? '未启用' : '未接入',
    '扫码授权后，可用微信消息触发任务并接收处理结果。',
    configured ? '连接' : '扫码接入',
    config
  )
}

async function fetchBrowserVersion(): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 800)
  try {
    const res = await fetch('http://127.0.0.1:9222/json/version', { signal: controller.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function chromeCandidates(): DesktopAppCandidate[] {
  if (process.platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files'
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
    const localAppData = process.env['LOCALAPPDATA'] ?? ''
    return [
      { path: path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      { path: path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe') },
      ...(localAppData ? [{ path: path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') }] : [])
    ]
  }
  return [
    { path: '/Applications/Google Chrome.app' },
    { path: '/Applications/Chromium.app' }
  ]
}

async function findExisting(candidates: DesktopAppCandidate[]): Promise<DesktopAppCandidate | null> {
  for (const candidate of candidates) {
    if (await exists(candidate.path)) return candidate
  }
  return null
}

function browserLaunchCommand(): string {
  const profile = path.join(app.getPath('userData'), 'browser-automation-profile')
  if (process.platform === 'win32') {
    return 'chrome.exe --remote-debugging-port=9222 --user-data-dir=' + getPlatformAdapter().quoteArgument(profile)
  }
  return 'open -na "Google Chrome" --args --remote-debugging-port=9222 --user-data-dir=' + getPlatformAdapter().quoteArgument(profile)
}

async function checkBrowser(config: ConnectorConfig): Promise<ConnectorStatus> {
  if (await fetchBrowserVersion()) {
    return connectorStatus('browser', '浏览器自动化', 'connected', '已连接', 'DeepDesk 可以使用当前浏览器会话完成网页操作和信息采集。', '重新检测', config, '关闭连接')
  }
  const candidate = await findExisting(chromeCandidates())
  if (candidate) {
    return connectorStatus('browser', '浏览器自动化', 'available', '可启动', '点击启动后，DeepDesk 会打开一个用于自动化任务的浏览器会话。', '启动浏览器', config, undefined, browserLaunchCommand())
  }
  return connectorStatus('browser', '浏览器自动化', 'needs_setup', '不可用', '需要先安装 Chrome 或 Chromium 浏览器，才能使用浏览器自动化。', '重新检测', config, undefined, browserLaunchCommand())
}

export async function listConnectors(configs: ConnectorConfig[]): Promise<ConnectorStatus[]> {
  const lark = checkLark(findConfig(configs, 'lark'))
  const wechat = checkWeChat(findConfig(configs, 'wechat'))
  const browser = await checkBrowser(findConfig(configs, 'browser'))
  return [lark, wechat, browser]
}

export async function connectConnector(store: AppStore, id: ConnectorId): Promise<ConnectorActionResult> {
  if (id === 'lark') {
    const config = findConfig(store.getSnapshot().connectors, id)
    if (!hasText(config.token) && (!hasText(config.appId) || !hasText(config.appSecret))) {
      return { id, ok: false, message: '请先完成飞书扫码接入', detail: '需要飞书应用 ID 和应用密钥；也可以配置自有接入服务地址。' }
    }
    store.upsertConnectorConfig({ id, enabled: true })
    return { id, ok: true, message: '已启用飞书接入', detail: 'DeepDesk 将通过飞书消息接收任务并返回结果。' }
  }
  if (id === 'wechat') {
    const config = findConfig(store.getSnapshot().connectors, id)
    if (!hasText(config.token)) {
      return { id, ok: false, message: '请先完成微信扫码接入', detail: '需要通过微信扫码获取访问令牌。' }
    }
    store.upsertConnectorConfig({ id, enabled: true })
    return { id, ok: true, message: '已启用微信接入', detail: 'DeepDesk 将通过微信消息接收任务并返回结果。' }
  }
  return openBrowserDebug()
}

async function openBrowserDebug(): Promise<ConnectorActionResult> {
  const profile = path.join(app.getPath('userData'), 'browser-automation-profile')
  await fs.mkdir(profile, { recursive: true })
  if (process.platform === 'win32') {
    const candidate = await findExisting(chromeCandidates())
    if (!candidate) return { id: 'browser', ok: false, message: '未检测到可用浏览器', detail: '请先安装 Chrome 或 Chromium。' }
    const child = spawn(candidate.path, ['--remote-debugging-port=9222', '--user-data-dir=' + profile], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
    return { id: 'browser', ok: true, message: '已启动浏览器会话', detail: '浏览器准备完成后即可用于网页任务。' }
  }
  const command = browserLaunchCommand()
  const result = await getPlatformAdapter().executeCommand(command, process.cwd())
  return result.code === 0
    ? { id: 'browser', ok: true, message: '已启动浏览器会话', detail: '浏览器准备完成后即可用于网页任务。' }
    : { id: 'browser', ok: false, message: '启动浏览器会话失败', detail: commandResultMessage(result.stdout, result.stderr) }
}

function managedBrowserCloseCommand(): string {
  const profile = path.join(app.getPath('userData'), 'browser-automation-profile')
  const quote = getPlatformAdapter().quoteArgument
  if (process.platform === 'win32') {
    return `$profile = ${quote(profile)}; $items = Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" | Where-Object { $_.CommandLine -like '*--remote-debugging-port=9222*' -and $_.CommandLine -like ('*' + $profile + '*') }; $items | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; if ($items) { 'closed' } else { 'not-found' }`
  }
  return `profile=${quote(profile)}; pids=$(ps -axo pid=,command= | grep -- '--remote-debugging-port=9222' | grep -- "$profile" | grep -v grep | awk '{print $1}'); if [ -z "$pids" ]; then printf '%s\\n' not-found; else kill $pids && printf '%s\\n' closed; fi`
}

async function disconnectBrowser(): Promise<ConnectorActionResult> {
  const command = managedBrowserCloseCommand()
  const result = await getPlatformAdapter().executeCommand(command, process.cwd())
  if (result.code !== 0) {
    return { id: 'browser', ok: false, message: '关闭浏览器会话失败', detail: commandResultMessage(result.stdout, result.stderr) }
  }
  if (result.stdout.includes('closed')) {
    return { id: 'browser', ok: true, message: '已关闭浏览器会话', detail: '只关闭由 DeepDesk 启动的浏览器会话。' }
  }
  return { id: 'browser', ok: false, message: '未找到可关闭的浏览器会话', detail: '当前浏览器会话可能不是由 DeepDesk 启动的。' }
}

export async function disconnectConnector(store: AppStore, id: ConnectorId): Promise<ConnectorActionResult> {
  if (id === 'browser') return disconnectBrowser()
  closeDirectSessionsFor(id)
  store.upsertConnectorConfig({ id, enabled: false })
  return {
    id,
    ok: true,
    message: id === 'lark' ? '已断开飞书接入' : '已断开微信接入',
    detail: '已在 DeepDesk 本地禁用该接入配置，外部服务本身不会被删除或停止。'
  }
}

export function closeConnectorAuthSessionsForTest(): void {
  closeDirectSessionsFor('lark')
  closeDirectSessionsFor('wechat')
}
