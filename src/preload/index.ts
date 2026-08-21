import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { DeepDeskApi } from '../shared/api'
import type { AgentEvent, AgentRunRequest, AgentSession } from '../shared/agent-types'
import type { AppSettings, ChatChunkPayload, ChatStartRequest, Conversation, ProviderConfig, ProviderTestResult } from '../shared/types'
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
  conversations: {
    list: () => ipcRenderer.invoke(IPC.ConversationsList) as Promise<Conversation[]>,
    get: (id: string) => ipcRenderer.invoke(IPC.ConversationGet, id) as Promise<Conversation | null>,
    upsert: (conversation: Conversation) => ipcRenderer.invoke(IPC.ConversationUpsert, conversation) as Promise<void>,
    remove: (id: string) => ipcRenderer.invoke(IPC.ConversationDelete, id) as Promise<void>
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
