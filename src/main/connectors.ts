import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import QRCode from 'qrcode'
import type { AppStore } from './store'
import type { ConnectorActionResult, ConnectorActivity, ConnectorActivityDirection, ConnectorActivityFeed, ConnectorActivityStatus, ConnectorAuthSession, ConnectorAuthState, ConnectorConfig, ConnectorId, ConnectorOutboundMessage, ConnectorState, ConnectorStatus } from '../shared/types'
import { listBrowserPages } from './browser-cdp'
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

interface GatewayActivityResponse {
  events?: unknown
  items?: unknown
  message?: unknown
}

interface GatewaySendMessageResponse {
  ok?: unknown
  messageId?: unknown
  id?: unknown
  message?: unknown
  detail?: unknown
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

interface WeChatUpdatesResponse {
  ret?: unknown
  errcode?: unknown
  errmsg?: unknown
  msgs?: unknown
  messages?: unknown
  Msgs?: unknown
  get_updates_buf?: unknown
  next_key?: unknown
  nextKey?: unknown
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
    messageCursor: '',
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

function timestampFromUnknown(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return Date.now()
}

function directionFromUnknown(value: unknown): ConnectorActivityDirection {
  if (value === 'outbound' || value === 'system') return value
  return 'inbound'
}

function activityStatusFromUnknown(value: unknown): ConnectorActivityStatus {
  if (value === 'handled' || value === 'failed') return value
  return 'new'
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

function wechatIlinkHeaders(config: ConnectorConfig): Record<string, string> {
  const value = randomBytes(4).readUInt32BE(0).toString()
  return {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'Authorization': 'Bearer ' + config.token.trim(),
    'X-WECHAT-UIN': Buffer.from(value).toString('base64')
  }
}

function wechatIlinkBaseInfo(): { base_info: { channel_version: string } } {
  return { base_info: { channel_version: '1.0.0' } }
}

function isWechatIlinkDirectConfig(config: ConnectorConfig): boolean {
  if (!hasText(config.token) || !hasText(config.endpoint)) return false
  try {
    const host = new URL(config.endpoint).host
    return host.includes('weixin.qq.com') || host.includes('ilinkai.weixin.qq.com')
  } catch {
    return false
  }
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
    return { id, ok: false, state: 'failed', message: '浏览器调试不需要扫码接入' }
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

function normalizeGatewayActivity(id: ConnectorId, raw: unknown, index: number): ConnectorActivity | null {
  if (!raw || typeof raw !== 'object') return null
  const item = raw as Record<string, unknown>
  const text = textFromUnknown(item['text']) ?? textFromUnknown(item['content']) ?? textFromUnknown(item['message'])
  if (!text) return null
  const createdAt = timestampFromUnknown(item['createdAt'] ?? item['timestamp'] ?? item['time'])
  const sourceName = textFromUnknown(item['sourceName']) ?? textFromUnknown(item['fromName']) ?? textFromUnknown(item['senderName']) ?? (id === 'wechat' ? '微信用户' : '飞书用户')
  const sourceId = textFromUnknown(item['sourceId']) ?? textFromUnknown(item['fromId']) ?? textFromUnknown(item['senderId']) ?? ''
  const threadId = textFromUnknown(item['threadId'])
    ?? textFromUnknown(item['externalThreadId'])
    ?? textFromUnknown(item['chatId'])
    ?? textFromUnknown(item['roomId'])
    ?? textFromUnknown(item['conversationId'])
    ?? sourceId
  const rawId = textFromUnknown(item['id']) ?? textFromUnknown(item['messageId'])
  return {
    id: rawId ?? `${id}-${createdAt}-${index}`,
    connectorId: id,
    direction: directionFromUnknown(item['direction']),
    sourceName,
    sourceId,
    threadId,
    conversationName: textFromUnknown(item['conversationName']) ?? textFromUnknown(item['chatName']) ?? textFromUnknown(item['roomName']),
    text,
    createdAt,
    status: activityStatusFromUnknown(item['status']),
    taskId: textFromUnknown(item['taskId'])
  }
}

export async function sendConnectorMessage(store: AppStore, id: ConnectorId, message: ConnectorOutboundMessage): Promise<ConnectorActionResult> {
  if (id === 'browser') return { id, ok: false, message: '浏览器调试不支持消息回写' }
  const text = message.text.trim()
  const threadId = message.threadId.trim()
  if (!text || !threadId) return { id, ok: false, message: '消息内容或会话标识为空' }

  const config = findConfig(store.getSnapshot().connectors, id)
  if (!config.enabled) return { id, ok: false, message: id === 'wechat' ? '微信尚未连接' : '飞书尚未连接' }
  if (!hasText(config.endpoint)) {
    return {
      id,
      ok: false,
      message: id === 'wechat' ? '缺少微信接入服务地址' : '缺少飞书接入服务地址',
      detail: '消息同步需要外部接入服务提供发送接口。'
    }
  }
  if (id === 'wechat' && isWechatIlinkDirectConfig(config)) {
    return sendWechatIlinkMessage(store, config, { ...message, threadId, text })
  }

  try {
    const json = await fetchJsonWithTimeout<GatewaySendMessageResponse>(
      trimBaseUrl(config.endpoint) + '/connectors/' + id + '/messages',
      {
        method: 'POST',
        headers: authHeaders(config),
        body: JSON.stringify({
          sessionId: message.sessionId,
          threadId,
          text
        })
      },
      8000
    )
    const ok = json.ok !== false
    const messageId = textFromUnknown(json.messageId) ?? textFromUnknown(json.id) ?? `${id}-out-${Date.now()}`
    store.upsertConnectorActivities([{
      id: messageId,
      connectorId: id,
      direction: 'outbound',
      sourceName: 'DeepDesk',
      sourceId: 'deepdesk',
      threadId,
      text,
      createdAt: Date.now(),
      status: ok ? 'handled' : 'failed',
      taskId: message.sessionId
    }])
    return {
      id,
      ok,
      message: textFromUnknown(json.message) ?? (ok ? '已同步到连接器会话' : '连接器服务返回发送失败'),
      detail: textFromUnknown(json.detail)
    }
  } catch (error) {
    store.upsertConnectorActivities([{
      id: `${id}-out-failed-${Date.now()}`,
      connectorId: id,
      direction: 'outbound',
      sourceName: 'DeepDesk',
      sourceId: 'deepdesk',
      threadId,
      text,
      createdAt: Date.now(),
      status: 'failed',
      taskId: message.sessionId
    }])
    return {
      id,
      ok: false,
      message: id === 'wechat' ? '同步到微信失败' : '同步到飞书失败',
      detail: error instanceof Error ? error.message : String(error)
    }
  }
}

async function sendWechatIlinkMessage(store: AppStore, config: ConnectorConfig, message: ConnectorOutboundMessage): Promise<ConnectorActionResult> {
  const replyToken = message.replyToken?.trim()
  if (!replyToken) {
    return {
      id: 'wechat',
      ok: false,
      message: '缺少微信回复令牌',
      detail: '请先从微信收到一条消息；DeepDesk 需要使用该消息的 context_token 才能把回复发回原会话。'
    }
  }
  try {
    const json = await fetchJsonWithTimeout<{ ret?: unknown; errcode?: unknown; errmsg?: unknown }>(
      trimBaseUrl(config.endpoint) + '/ilink/bot/sendmessage',
      {
        method: 'POST',
        headers: wechatIlinkHeaders(config),
        body: JSON.stringify({
          msg: {
            from_user_id: '',
            to_user_id: message.threadId,
            client_id: randomUUID(),
            message_type: 2,
            message_state: 2,
            context_token: replyToken,
            item_list: [{ type: 1, text_item: { text: message.text } }]
          },
          ...wechatIlinkBaseInfo()
        })
      },
      10_000
    )
    const ret = numberFromUnknown(json.ret)
    const errcode = numberFromUnknown(json.errcode)
    const ok = (ret === undefined || ret === 0) && errcode !== -14
    if (errcode === -14) store.upsertConnectorConfig({ id: 'wechat', enabled: false })
    store.upsertConnectorActivities([{
      id: `wechat-out-${Date.now()}`,
      connectorId: 'wechat',
      direction: 'outbound',
      sourceName: 'DeepDesk',
      sourceId: 'deepdesk',
      threadId: message.threadId,
      text: message.text,
      replyToken,
      createdAt: Date.now(),
      status: ok ? 'handled' : 'failed',
      taskId: message.sessionId
    }])
    return {
      id: 'wechat',
      ok,
      message: ok ? '已同步到微信会话' : '微信发送失败',
      detail: ok ? undefined : textFromUnknown(json.errmsg)
    }
  } catch (error) {
    return {
      id: 'wechat',
      ok: false,
      message: '同步到微信失败',
      detail: error instanceof Error ? error.message : String(error)
    }
  }
}

function normalizeGatewayActivities(id: ConnectorId, json: GatewayActivityResponse): ConnectorActivity[] {
  const rawItems = Array.isArray(json.events) ? json.events : Array.isArray(json.items) ? json.items : []
  return rawItems.map((item, index) => normalizeGatewayActivity(id, item, index)).filter((item): item is ConnectorActivity => item !== null)
}

function objectFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function listFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function wechatMessageText(message: Record<string, unknown>): string | undefined {
  const direct = textFromUnknown(message['text']) ?? textFromUnknown(message['content']) ?? textFromUnknown(message['message'])
  if (direct) return direct
  const items = listFromUnknown(message['item_list'] ?? message['itemList'])
  const parts = items
    .map(item => {
      const record = objectFromUnknown(item)
      if (!record) return undefined
      const textItem = objectFromUnknown(record['text_item'] ?? record['textItem'])
      const voiceItem = objectFromUnknown(record['voice_item'] ?? record['voiceItem'])
      const fileItem = objectFromUnknown(record['file_item'] ?? record['fileItem'])
      const imageItem = objectFromUnknown(record['image_item'] ?? record['imageItem'])
      return textFromUnknown(textItem?.['text'])
        ?? textFromUnknown(voiceItem?.['text'])
        ?? textFromUnknown(fileItem?.['file_name'])
        ?? textFromUnknown(imageItem?.['file_name'])
    })
    .filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join('\n') : undefined
}

function wechatMessageCreatedAt(message: Record<string, unknown>): number {
  const ms = numberFromUnknown(message['create_time_ms'] ?? message['createTimeMs'])
  if (ms) return ms
  return timestampFromUnknown(message['create_time'] ?? message['createTime'] ?? message['timestamp'])
}

function normalizeWechatIlinkActivity(raw: unknown, index: number): ConnectorActivity | null {
  const message = objectFromUnknown(raw)
  if (!message) return null
  const messageType = message['message_type'] ?? message['messageType']
  if (messageType !== undefined && messageType !== 1) return null
  const text = wechatMessageText(message)
  if (!text) return null
  const fromUserId = textFromUnknown(message['from_user_id'])
    ?? textFromUnknown(message['fromUserId'])
    ?? textFromUnknown(message['senderId'])
    ?? textFromUnknown(message['sourceId'])
    ?? ''
  const threadId = textFromUnknown(message['threadId'])
    ?? textFromUnknown(message['chatId'])
    ?? textFromUnknown(message['roomId'])
    ?? fromUserId
  const createdAt = wechatMessageCreatedAt(message)
  const rawId = textFromUnknown(message['message_id']) ?? textFromUnknown(message['messageId']) ?? textFromUnknown(message['id'])
  return {
    id: rawId ?? `wechat-${createdAt}-${index}`,
    connectorId: 'wechat',
    direction: 'inbound',
    sourceName: textFromUnknown(message['from_user_name']) ?? textFromUnknown(message['fromUserName']) ?? textFromUnknown(message['senderName']) ?? '微信用户',
    sourceId: fromUserId,
    threadId,
    conversationName: textFromUnknown(message['room_name']) ?? textFromUnknown(message['roomName']) ?? textFromUnknown(message['chatName']) ?? '微信会话',
    text,
    replyToken: textFromUnknown(message['context_token']) ?? textFromUnknown(message['contextToken']),
    createdAt,
    status: 'new'
  }
}

async function syncWechatIlinkActivities(store: AppStore, config: ConnectorConfig): Promise<string | undefined> {
  try {
    const json = await fetchJsonWithTimeout<WeChatUpdatesResponse>(
      trimBaseUrl(config.endpoint) + '/ilink/bot/getupdates',
      {
        method: 'POST',
        headers: wechatIlinkHeaders(config),
        body: JSON.stringify({
          get_updates_buf: config.messageCursor,
          ...wechatIlinkBaseInfo()
        })
      },
      38_000
    )
    const ret = numberFromUnknown(json.ret)
    const errcode = numberFromUnknown(json.errcode)
    if ((ret !== undefined && ret !== 0) || errcode === -14) {
      if (errcode === -14) store.upsertConnectorConfig({ id: 'wechat', enabled: false })
      return '微信连接已失效，请重新扫码接入。'
    }
    const rawMessages = Array.isArray(json.msgs) ? json.msgs : Array.isArray(json.messages) ? json.messages : Array.isArray(json.Msgs) ? json.Msgs : []
    const activities = rawMessages.map((item, index) => normalizeWechatIlinkActivity(item, index)).filter((item): item is ConnectorActivity => item !== null)
    const nextCursor = textFromUnknown(json.get_updates_buf) ?? textFromUnknown(json.next_key) ?? textFromUnknown(json.nextKey)
    if (nextCursor && nextCursor !== config.messageCursor) {
      store.upsertConnectorConfig({ id: 'wechat', messageCursor: nextCursor })
    }
    store.upsertConnectorActivities(activities)
    return activities.length > 0 ? '收到 ' + activities.length + ' 条微信消息。' : undefined
  } catch (error) {
    return '暂时无法从微信接入服务拉取消息：' + (error instanceof Error ? error.message : String(error))
  }
}

async function syncGatewayActivities(store: AppStore, id: ConnectorId, config: ConnectorConfig): Promise<string | undefined> {
  if (!config.enabled) return id === 'wechat' ? '微信尚未连接，扫码接入后可接收消息。' : '飞书尚未连接，扫码接入后可接收消息。'
  if (!hasText(config.endpoint)) return id === 'wechat' ? '微信已连接，但当前没有可拉取消息的接入服务地址。' : '飞书已连接，但当前没有可拉取消息的接入服务地址。'
  if (id === 'wechat' && isWechatIlinkDirectConfig(config)) return syncWechatIlinkActivities(store, config)
  const endpoint = trimBaseUrl(config.endpoint)
  try {
    const res = await fetchJsonWithTimeout<GatewayActivityResponse>(
      endpoint + '/connectors/' + id + '/events?limit=20',
      { headers: authHeaders(config) },
      6000
    )
    const activities = normalizeGatewayActivities(id, res)
    store.upsertConnectorActivities(activities)
    const message = textFromUnknown(res.message)
    if (activities.length > 0) return message
    return message ?? '接入服务暂时没有返回新的消息。'
  } catch (error) {
    return id === 'wechat'
      ? '暂时无法从微信接入服务拉取消息：' + (error instanceof Error ? error.message : String(error))
      : '暂时无法从飞书接入服务拉取消息：' + (error instanceof Error ? error.message : String(error))
  }
}

async function listBrowserTargets(): Promise<ConnectorActivity[]> {
  try {
    const pages = (await listBrowserPages()).slice(0, 5)
    return pages.map((page, index) => ({
      id: 'browser-' + String(page.id || index),
      connectorId: 'browser',
      direction: 'system',
      sourceName: '浏览器调试',
      sourceId: page.id,
      conversationName: 'Chrome DevTools',
      text: page.title + (page.url ? ' · ' + page.url : ''),
      createdAt: Date.now(),
      status: 'handled'
    }))
  } catch {
    return []
  }
}

export async function getConnectorActivityFeed(store: AppStore, id?: ConnectorId): Promise<ConnectorActivityFeed> {
  const messages: string[] = []
  const configs = store.getSnapshot().connectors
  const ids: ConnectorId[] = id ? [id] : ['wechat', 'lark', 'browser']
  for (const connectorId of ids) {
    if (connectorId === 'browser') continue
    const message = await syncGatewayActivities(store, connectorId, findConfig(configs, connectorId))
    if (message) messages.push(message)
  }
  const browserItems = ids.includes('browser') ? await listBrowserTargets() : []
  const storedItems = store.listConnectorActivities(id).filter(item => item.connectorId !== 'browser')
  const items = [...browserItems, ...storedItems]
    .filter(item => !id || item.connectorId === id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)
  return {
    items,
    syncedAt: Date.now(),
    message: messages[0]
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
    return connectorStatus('browser', '浏览器调试', 'connected', '已连接', 'AI 可以读取页面结构、操作网页，并采集控制台、异常和网络调试信息。', '重新检测', config, '断开')
  }
  const candidate = await findExisting(chromeCandidates())
  if (candidate) {
    return connectorStatus('browser', '浏览器调试', 'available', '可连接', '连接后，AI 将获得网页读取、交互和调试能力。', '连接浏览器', config, undefined, browserLaunchCommand())
  }
  return connectorStatus('browser', '浏览器调试', 'needs_setup', '不可用', '需要先安装 Chrome 或 Chromium 浏览器，才能启用浏览器调试连接。', '重新检测', config, undefined, browserLaunchCommand())
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
    return { id: 'browser', ok: true, message: '已连接浏览器调试', detail: 'AI 现在可以读取、操作并调试这个独立浏览器会话。' }
  }
  const command = browserLaunchCommand()
  const result = await getPlatformAdapter().executeCommand(command, process.cwd())
  return result.code === 0
    ? { id: 'browser', ok: true, message: '已连接浏览器调试', detail: 'AI 现在可以读取、操作并调试这个独立浏览器会话。' }
    : { id: 'browser', ok: false, message: '连接浏览器调试失败', detail: commandResultMessage(result.stdout, result.stderr) }
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
    return { id: 'browser', ok: false, message: '断开浏览器调试失败', detail: commandResultMessage(result.stdout, result.stderr) }
  }
  if (result.stdout.includes('closed')) {
    return { id: 'browser', ok: true, message: '已断开浏览器调试', detail: '已关闭由 DeepDesk 启动的独立浏览器会话。' }
  }
  return { id: 'browser', ok: false, message: '未找到可断开的浏览器调试', detail: '当前浏览器会话可能不是由 DeepDesk 启动的。' }
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
