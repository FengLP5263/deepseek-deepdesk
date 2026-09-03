import { safeStorage } from 'electron'
import type { AppState } from '../shared/types'

const ENCRYPTED_PREFIX = 'deepdesk:encrypted:v1:'

export interface SecretCodec {
  protect(value: string): string
  reveal(value: string): string
}

export class SecretStorageError extends Error {
  override name = 'SecretStorageError'
}

export const plaintextSecretCodec: SecretCodec = {
  protect: value => value,
  reveal: value => value
}

export function createElectronSecretCodec(): SecretCodec {
  let warned = false
  const available = (): boolean => {
    const result = safeStorage.isEncryptionAvailable()
    if (!result && !warned) {
      warned = true
      console.warn('[security] 系统安全存储不可用，本地凭据将保持原始格式')
    }
    return result
  }
  return {
    protect(value) {
      if (!value || value.startsWith(ENCRYPTED_PREFIX) || !available()) return value
      return ENCRYPTED_PREFIX + safeStorage.encryptString(value).toString('base64')
    },
    reveal(value) {
      if (!value.startsWith(ENCRYPTED_PREFIX)) return value
      if (!available()) throw new SecretStorageError('系统安全存储当前不可用，无法解密本地凭据')
      try {
        const payload = value.slice(ENCRYPTED_PREFIX.length)
        return safeStorage.decryptString(Buffer.from(payload, 'base64'))
      } catch {
        throw new SecretStorageError('本地凭据无法由当前系统账户解密')
      }
    }
  }
}

function mapRecord(record: Record<string, string>, map: (value: string) => string): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, map(value)]))
}

export function mapAppStateSecrets(input: AppState, codec: SecretCodec, direction: 'protect' | 'reveal'): AppState {
  const state = structuredClone(input)
  const map = direction === 'protect' ? codec.protect : codec.reveal
  for (const provider of state.providers) provider.apiKey = map(provider.apiKey)
  for (const server of state.mcpServers) {
    server.token = map(server.token)
    server.env = mapRecord(server.env, map)
    server.headers = mapRecord(server.headers, map)
  }
  for (const connector of state.connectors) {
    connector.token = map(connector.token)
    connector.refreshToken = map(connector.refreshToken)
    connector.appSecret = map(connector.appSecret)
    connector.verificationToken = map(connector.verificationToken)
    connector.encryptKey = map(connector.encryptKey)
  }
  for (const activity of state.connectorActivities) {
    if (activity.replyToken) activity.replyToken = map(activity.replyToken)
  }
  for (const session of state.agentSessions) {
    if (session.source?.type === 'connector' && session.source.externalReplyToken) {
      session.source.externalReplyToken = map(session.source.externalReplyToken)
    }
  }
  return state
}
