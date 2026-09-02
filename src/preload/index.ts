import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { DeepDeskApi } from '../shared/api'
import type { AgentEvent, AgentRunRequest, AgentSession, AgentSessionExportFormat, AgentSessionExportResult } from '../shared/agent-types'
import type { AppSettings, ChatChunkPayload, ChatStartRequest, Conversation, ProviderConfig, ProviderTestResult, MemoryItem, MemorySearchRequest, MemoryCaptureRequest, BrowserExtensionSetupAction, ConnectorActionResult, ConnectorActivityFeed, ConnectorAuthSession, ConnectorConfig, ConnectorConfigPatch, ConnectorId, ConnectorOutboundMessage, ConnectorStatus, McpActionResult, McpServerConfig, McpServerStatus } from '../shared/types'
import { platformInfoFromNode } from '../shared/platform'

const api: DeepDeskApi = {
  platform: platformInfoFromNode(process.platform),
  settings: {
    get: () => ipcRenderer.invoke(IPC.SettingsGet) as Promise<AppSettings>,
    set: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.SettingsSet, patch) as Promise<AppSettings>
  },
  providers: {
    list: () => ipcRenderer.invoke(IPC.ProvidersList) as Promise<ProviderConfig[]>,
    upsert: (provider: ProviderConfig) => ipcRenderer.invoke(IPC.ProviderUpsert, provider) as Promise<void>,
    remove: (id: string) => ipcRenderer.invoke(IPC.ProviderDelete, id) as Promise<void>,
    test: (provider: ProviderConfig) => ipcRenderer.invoke(IPC.ProviderTest, provider) as Promise<ProviderTestResult>
  },
  mcp: {
    list: () => ipcRenderer.invoke(IPC.McpServersList) as Promise<McpServerStatus[]>,
    save: (config: McpServerConfig) => ipcRenderer.invoke(IPC.McpServerSave, config) as Promise<McpServerStatus>,
    remove: (id: string) => ipcRenderer.invoke(IPC.McpServerDelete, id) as Promise<void>,
    connect: (id: string) => ipcRenderer.invoke(IPC.McpServerConnect, id) as Promise<McpActionResult>,
    disconnect: (id: string) => ipcRenderer.invoke(IPC.McpServerDisconnect, id) as Promise<McpActionResult>
  },
  conversations: {
    list: () => ipcRenderer.invoke(IPC.ConversationsList) as Promise<Conversation[]>,
    get: (id: string) => ipcRenderer.invoke(IPC.ConversationGet, id) as Promise<Conversation | null>,
    upsert: (conversation: Conversation) => ipcRenderer.invoke(IPC.ConversationUpsert, conversation) as Promise<void>,
    remove: (id: string) => ipcRenderer.invoke(IPC.ConversationDelete, id) as Promise<void>
  },
  memories: {
    list: () => ipcRenderer.invoke(IPC.MemoriesList) as Promise<MemoryItem[]>,
    upsert: (memory: MemoryItem) => ipcRenderer.invoke(IPC.MemoryUpsert, memory) as Promise<MemoryItem>,
    remove: (id: string) => ipcRenderer.invoke(IPC.MemoryDelete, id) as Promise<void>,
    search: (request: MemorySearchRequest) => ipcRenderer.invoke(IPC.MemoriesSearch, request) as Promise<MemoryItem[]>,
    capture: (request: MemoryCaptureRequest) => ipcRenderer.invoke(IPC.MemoriesCapture, request) as Promise<MemoryItem[]>
  },
  connectors: {
    list: () => ipcRenderer.invoke(IPC.ConnectorsList) as Promise<ConnectorStatus[]>,
    save: (config: ConnectorConfigPatch) => ipcRenderer.invoke(IPC.ConnectorSave, config) as Promise<ConnectorConfig>,
    startAuth: (id: ConnectorId) => ipcRenderer.invoke(IPC.ConnectorAuthStart, id) as Promise<ConnectorAuthSession>,
    authStatus: (id: ConnectorId, sessionId: string) => ipcRenderer.invoke(IPC.ConnectorAuthStatus, id, sessionId) as Promise<ConnectorAuthSession>,
    connect: (id: ConnectorId) => ipcRenderer.invoke(IPC.ConnectorConnect, id) as Promise<ConnectorActionResult>,
    disconnect: (id: ConnectorId) => ipcRenderer.invoke(IPC.ConnectorDisconnect, id) as Promise<ConnectorActionResult>,
    setupBrowser: (action: BrowserExtensionSetupAction) => ipcRenderer.invoke(IPC.ConnectorBrowserSetup, action) as Promise<ConnectorActionResult>,
    activities: (id?: ConnectorId) => ipcRenderer.invoke(IPC.ConnectorActivities, id) as Promise<ConnectorActivityFeed>,
    sendMessage: (id: ConnectorId, message: ConnectorOutboundMessage) => ipcRenderer.invoke(IPC.ConnectorMessageSend, id, message) as Promise<ConnectorActionResult>
  },
  chat: {
    start: (req: ChatStartRequest) => ipcRenderer.invoke(IPC.ChatStart, req) as Promise<{ ok: boolean; message?: string }>,
    cancel: (runId: string) => ipcRenderer.invoke(IPC.ChatCancel, runId) as Promise<void>,
    onChunk: (cb: (payload: ChatChunkPayload) => void) => {
      const listener = (_event: unknown, payload: ChatChunkPayload): void => cb(payload)
      ipcRenderer.on(IPC.ChatChunk, listener)
      return () => { ipcRenderer.removeListener(IPC.ChatChunk, listener) }
    }
  },
  agent: {
    start: (req: AgentRunRequest) => ipcRenderer.invoke(IPC.AgentStart, req) as Promise<{ ok: boolean; message?: string }>,
    cancel: (runId: string) => ipcRenderer.invoke(IPC.AgentCancel, runId) as Promise<void>,
    approve: (callId: string, approved: boolean) => ipcRenderer.invoke(IPC.AgentApprove, callId, approved) as Promise<void>,
    pickDirectory: () => ipcRenderer.invoke(IPC.AgentPickDirectory) as Promise<string | null>,
    listSessions: () => ipcRenderer.invoke(IPC.AgentSessionsList) as Promise<AgentSession[]>,
    saveSession: (session: AgentSession) => ipcRenderer.invoke(IPC.AgentSessionUpsert, session) as Promise<void>,
    deleteSession: (id: string) => ipcRenderer.invoke(IPC.AgentSessionDelete, id) as Promise<void>,
    renameSession: (id: string, title: string) => ipcRenderer.invoke(IPC.AgentSessionRename, id, title) as Promise<void>,
    exportSession: (id: string, format: AgentSessionExportFormat) => ipcRenderer.invoke(IPC.AgentSessionExport, id, format) as Promise<AgentSessionExportResult>,
    onChunk: (cb: (event: AgentEvent) => void) => {
      const listener = (_event: unknown, event: AgentEvent): void => cb(event)
      ipcRenderer.on(IPC.AgentChunk, listener)
      return () => { ipcRenderer.removeListener(IPC.AgentChunk, listener) }
    }
  },
  window: {
    minimize: () => ipcRenderer.invoke(IPC.WindowMinimize) as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke(IPC.WindowToggleMaximize) as Promise<void>,
    close: () => ipcRenderer.invoke(IPC.WindowClose) as Promise<void>,
    isMaximized: () => ipcRenderer.invoke(IPC.WindowIsMaximized) as Promise<boolean>,
    onMaximizedChange: (cb: (maximized: boolean) => void) => {
      const listener = (_event: unknown, maximized: boolean): void => cb(maximized)
      ipcRenderer.on(IPC.WindowMaximizedChanged, listener)
      return () => { ipcRenderer.removeListener(IPC.WindowMaximizedChanged, listener) }
    }
  },
  openExternal: (url: string) => ipcRenderer.invoke(IPC.OpenExternal, url) as Promise<void>,
  appVersion: () => ipcRenderer.invoke(IPC.AppVersion) as Promise<string>
}

contextBridge.exposeInMainWorld('api', api)
