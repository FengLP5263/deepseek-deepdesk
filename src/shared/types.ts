import type { AgentSession } from './agent-types'

export type Theme = 'dark' | 'light' | 'system'

export type AgentPermissionMode = 'ask' | 'auto' | 'full'

export type ProviderType = 'openai'

export interface ModelConfig {
  id: string
  name?: string
  contextWindow?: number
  supportsReasoning?: boolean
}

export interface ProviderConfig {
  id: string
  name: string
  type: ProviderType
  baseUrl: string
  apiKey: string
  models: ModelConfig[]
  isBuiltIn?: boolean
  createdAt: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoning?: string
  createdAt: number
  error?: boolean
  model?: string
  streaming?: boolean
  feedback?: 'positive' | 'negative'
}

export interface Conversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  providerId: string
  modelId: string
  temperature: number
  messages: ChatMessage[]
}

export type MemoryScope = 'user' | 'project' | 'agent'

export type MemoryKind = 'preference' | 'fact' | 'procedure' | 'decision' | 'summary'

export interface MemoryItem {
  id: string
  scope: MemoryScope
  kind: MemoryKind
  content: string
  tags: string[]
  source?: {
    type: 'manual' | 'conversation' | 'agent'
    id?: string
  }
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface MemorySearchRequest {
  query: string
  scopes?: MemoryScope[]
  limit?: number
}

export type ConnectorId = 'lark' | 'wechat' | 'browser'

export type ConnectorState = 'connected' | 'available' | 'needs_setup' | 'unavailable'

export interface ConnectorConfig {
  id: ConnectorId
  enabled: boolean
  endpoint: string
  token: string
  refreshToken: string
  accountId: string
  userId: string
  expiresAt: number
  appId: string
  appSecret: string
  verificationToken: string
  encryptKey: string
  updatedAt: number
}

export type ConnectorConfigPatch = Partial<Omit<ConnectorConfig, 'updatedAt'>> & { id: ConnectorId }

export interface ConnectorStatus {
  id: ConnectorId
  name: string
  state: ConnectorState
  summary: string
  detail: string
  primaryAction: string
  disconnectAction?: string
  command?: string
  config?: ConnectorConfig
}

export type ConnectorAuthState = 'pending' | 'scanned' | 'connected' | 'expired' | 'failed'

export interface ConnectorAuthSession {
  id: ConnectorId
  ok: boolean
  state: ConnectorAuthState
  sessionId?: string
  qrDataUrl?: string
  qrUrl?: string
  expiresAt?: number
  message: string
  detail?: string
}

export interface ConnectorActionResult {
  id: ConnectorId
  ok: boolean
  message: string
  detail?: string
  command?: string
}

export interface AppSettings {
  version: number
  defaultProviderId: string
  defaultModelId: string
  temperature: number
  theme: Theme
  enterToSend: boolean
  agentWorkdir: string
  agentPermissionMode: AgentPermissionMode
}

export interface AppState {
  settings: AppSettings
  providers: ProviderConfig[]
  connectors: ConnectorConfig[]
  conversations: Conversation[]
  agentSessions: AgentSession[]
  memories: MemoryItem[]
}

export type ChatChunkType = 'start' | 'content' | 'reasoning' | 'done' | 'error'

export interface ChatChunkPayload {
  runId: string
  conversationId: string
  type: ChatChunkType
  text?: string
  message?: string
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }
  model?: string
}

export interface ChatStartRequest {
  runId: string
  conversationId: string
  providerId: string
  modelId: string
  temperature: number
  messages: Array<{ role: string; content: string }>
}

export interface ProviderTestResult {
  ok: boolean
  message: string
  models?: ModelConfig[]
}

export interface Usage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}
