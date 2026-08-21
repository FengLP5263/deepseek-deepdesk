import type { AppSettings, ProviderConfig, ProviderTestResult, Conversation, ChatStartRequest, ChatChunkPayload } from './types'
import type { AgentEvent, AgentRunRequest, AgentSession } from './agent-types'
import type { PlatformInfo } from './platform'

export interface DeepDeskApi {
  platform: Readonly<PlatformInfo>
  settings: {
    get: () => Promise<AppSettings>
    set: (patch: Partial<AppSettings>) => Promise<AppSettings>
  }
  providers: {
    list: () => Promise<ProviderConfig[]>
    upsert: (provider: ProviderConfig) => Promise<void>
    remove: (id: string) => Promise<void>
    test: (provider: ProviderConfig) => Promise<ProviderTestResult>
  }
  conversations: {
    list: () => Promise<Conversation[]>
    get: (id: string) => Promise<Conversation | null>
    upsert: (conversation: Conversation) => Promise<void>
    remove: (id: string) => Promise<void>
  }
  chat: {
    start: (req: ChatStartRequest) => Promise<{ ok: boolean; message?: string }>
    cancel: (runId: string) => Promise<void>
    onChunk: (cb: (payload: ChatChunkPayload) => void) => () => void
  }
  agent: {
    start: (req: AgentRunRequest) => Promise<{ ok: boolean; message?: string }>
    cancel: (runId: string) => Promise<void>
    approve: (callId: string, approved: boolean) => Promise<void>
    pickDirectory: () => Promise<string | null>
    onChunk: (cb: (event: AgentEvent) => void) => () => void
    listSessions: () => Promise<AgentSession[]>
    saveSession: (session: AgentSession) => Promise<void>
    deleteSession: (id: string) => Promise<void>
    renameSession: (id: string, title: string) => Promise<void>
  }
  window: {
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onMaximizedChange: (cb: (maximized: boolean) => void) => () => void
  }
  openExternal: (url: string) => Promise<void>
  appVersion: () => Promise<string>
}
