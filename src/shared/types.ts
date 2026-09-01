import type { AgentSession } from './agent-types'

export type Theme = 'dark' | 'light' | 'system'

export type AgentPermissionMode = 'ask' | 'auto' | 'full'

export type AppFont = 'default' | 'system' | 'microsoft' | 'serif' | 'mono'

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

export interface MemoryCaptureRequest {
  text: string
  source: NonNullable<MemoryItem['source']>
}

export type ConnectorId = 'lark' | 'wechat' | 'browser'

export type ConnectorState = 'connected' | 'available' | 'needs_setup' | 'unavailable'

export interface ConnectorConfig {
  id: ConnectorId
  enabled: boolean
  endpoint: string
  token: string
  refreshToken: string
  messageCursor: string
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
  browserMode?: 'extension' | 'idle'
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

export type BrowserExtensionSetupAction = 'copy-extension-directory' | 'open-extension-manager'

export type ConnectorActivityDirection = 'inbound' | 'outbound' | 'system'

export type ConnectorActivityStatus = 'new' | 'handled' | 'failed'

export interface ConnectorActivity {
  id: string
  connectorId: ConnectorId
  direction: ConnectorActivityDirection
  sourceName: string
  sourceId: string
  threadId?: string
  conversationName?: string
  text: string
  replyToken?: string
  createdAt: number
  status: ConnectorActivityStatus
  taskId?: string
}

export interface ConnectorActivityFeed {
  items: ConnectorActivity[]
  syncedAt: number
  message?: string
}

export interface ConnectorOutboundMessage {
  sessionId: string
  threadId: string
  text: string
  replyToken?: string
}

export type McpTransport = 'stdio' | 'http'

export interface McpServerConfig {
  id: string
  name: string
  transport: McpTransport
  enabled: boolean
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  url: string
  token: string
  headers: Record<string, string>
  createdAt: number
  updatedAt: number
}

export interface McpToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface McpToolInfo {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  annotations?: McpToolAnnotations
}

export type McpConnectionState = 'connected' | 'connecting' | 'disconnected' | 'error'

export interface McpServerStatus {
  config: McpServerConfig
  state: McpConnectionState
  message: string
  serverName?: string
  serverVersion?: string
  toolCount: number
  tools: McpToolInfo[]
}

export interface McpActionResult {
  ok: boolean
  message: string
  status?: McpServerStatus
}

export interface AppSettings {
  version: number
  defaultProviderId: string
  defaultModelId: string
  temperature: number
  theme: Theme
  appFont: AppFont
  appFontScale: number
  enterToSend: boolean
  agentWorkdir: string
  agentPermissionMode: AgentPermissionMode
}

export interface AppState {
  settings: AppSettings
  providers: ProviderConfig[]
  mcpServers: McpServerConfig[]
  connectors: ConnectorConfig[]
  connectorActivities: ConnectorActivity[]
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
