import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC } from '../shared/ipc-channels'
import { startChat, cancelChat } from './llm'
import { startAgent, cancelAgent, approveCommand } from './agent'
import { connectConnector, disconnectConnector, getConnectorActivityFeed, getConnectorAuthStatus, listConnectors, sendConnectorMessage, startConnectorAuth } from './connectors'
import type { AppStore } from './store'
import type { AppSettings, ChatStartRequest, Conversation, ProviderConfig, ProviderTestResult, MemoryItem, MemorySearchRequest, MemoryCaptureRequest, BrowserExtensionSetupAction, ConnectorConfigPatch, ConnectorId, ConnectorOutboundMessage } from '../shared/types'
import type { AgentRunRequest, AgentSession, AgentSessionExportFormat, AgentSessionExportResult } from '../shared/agent-types'
import { setupBrowserSessionSharing } from './browser-runtime'
import { connectMcpServer, deleteMcpServer, disconnectMcpServer, listMcpStatuses, saveMcpServer } from './mcp'
import type { McpServerConfig } from '../shared/types'
import { exportAgentSession } from './agent-session-export'
import { testProviderConnection } from './provider-models'

export function registerIpc(store: AppStore, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.SettingsGet, () => store.getSnapshot().settings)

  ipcMain.handle(IPC.SettingsSet, (_event, patch: Partial<AppSettings>) => {
    return store.updateSettings(patch)
  })

  ipcMain.handle(IPC.ProvidersList, () => store.getSnapshot().providers)

  ipcMain.handle(IPC.ProviderUpsert, (_event, provider: ProviderConfig) => {
    store.upsertProvider(provider)
  })

  ipcMain.handle(IPC.ProviderDelete, (_event, id: string) => {
    store.deleteProvider(id)
  })

  ipcMain.handle(IPC.ProviderTest, async (_event, provider: ProviderConfig): Promise<ProviderTestResult> => {
    return testProviderConnection(provider)
  })

  ipcMain.handle(IPC.McpServersList, () => listMcpStatuses())

  ipcMain.handle(IPC.McpServerSave, (_event, config: McpServerConfig) => saveMcpServer(config))

  ipcMain.handle(IPC.McpServerDelete, (_event, id: string) => deleteMcpServer(id))

  ipcMain.handle(IPC.McpServerConnect, (_event, id: string) => connectMcpServer(id))

  ipcMain.handle(IPC.McpServerDisconnect, (_event, id: string) => disconnectMcpServer(id))

  ipcMain.handle(IPC.ConversationsList, () => store.getSnapshot().conversations)

  ipcMain.handle(IPC.ConversationGet, (_event, id: string) => store.getConversation(id))

  ipcMain.handle(IPC.ConversationUpsert, (_event, conversation: Conversation) => {
    store.upsertConversation(conversation)
  })

  ipcMain.handle(IPC.ConversationDelete, (_event, id: string) => {
    store.deleteConversation(id)
  })

  ipcMain.handle(IPC.MemoriesList, () => store.listMemories())

  ipcMain.handle(IPC.MemoryUpsert, (_event, memory: MemoryItem) => store.upsertMemory(memory))

  ipcMain.handle(IPC.MemoryDelete, (_event, id: string) => {
    store.deleteMemory(id)
  })

  ipcMain.handle(IPC.MemoriesSearch, (_event, request: MemorySearchRequest) => store.searchMemories(request))
  ipcMain.handle(IPC.MemoriesCapture, (_event, request: MemoryCaptureRequest) => store.captureMemories(request))

  ipcMain.handle(IPC.ConnectorsList, () => listConnectors(store.getSnapshot().connectors))

  ipcMain.handle(IPC.ConnectorSave, (_event, config: ConnectorConfigPatch) => store.upsertConnectorConfig(config))

  ipcMain.handle(IPC.ConnectorAuthStart, (_event, id: ConnectorId) => startConnectorAuth(store, id))

  ipcMain.handle(IPC.ConnectorAuthStatus, (_event, id: ConnectorId, sessionId: string) => getConnectorAuthStatus(store, id, sessionId))

  ipcMain.handle(IPC.ConnectorConnect, (_event, id: ConnectorId) => connectConnector(store, id))

  ipcMain.handle(IPC.ConnectorDisconnect, (_event, id: ConnectorId) => disconnectConnector(store, id))

  ipcMain.handle(IPC.ConnectorBrowserSetup, (_event, action: BrowserExtensionSetupAction) => setupBrowserSessionSharing(action))

  ipcMain.handle(IPC.ConnectorActivities, (_event, id?: ConnectorId) => getConnectorActivityFeed(store, id))

  ipcMain.handle(IPC.ConnectorMessageSend, (_event, id: ConnectorId, message: ConnectorOutboundMessage) => sendConnectorMessage(store, id, message))

  ipcMain.handle(IPC.ChatStart, (event, req: ChatStartRequest) => {
    const provider = store.getSnapshot().providers.find(p => p.id === req.providerId)
    const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow()
    if (!provider) return { ok: false, message: '未找到该模型服务' }
    if (!win) return { ok: false, message: '窗口不可用' }
    if (!provider.apiKey) return { ok: false, message: '请先在设置中配置 API Key' }
    startChat(win, req, provider)
    return { ok: true }
  })

  ipcMain.handle(IPC.ChatCancel, (_event, runId: string) => {
    cancelChat(runId)
  })

  ipcMain.handle(IPC.AgentStart, (event, req: AgentRunRequest) => {
    const provider = store.getSnapshot().providers.find(p => p.id === req.providerId)
    const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow()
    if (!provider) return { ok: false, message: '未找到该模型服务' }
    if (!win) return { ok: false, message: '窗口不可用' }
    if (!provider.apiKey) return { ok: false, message: '请先在设置中配置 API Key' }
    const workdir = req.workdir && req.workdir.trim() ? req.workdir : app.getPath('home')
    startAgent(win, { ...req, workdir }, provider, store.getSnapshot().settings)
    return { ok: true }
  })

  ipcMain.handle(IPC.AgentCancel, (_event, runId: string) => {
    cancelAgent(runId)
  })

  ipcMain.handle(IPC.AgentApprove, (_event, callId: string, approved: boolean) => {
    approveCommand(callId, approved)
  })

  ipcMain.handle(IPC.AgentSessionsList, () => store.getSnapshot().agentSessions)

  ipcMain.handle(IPC.AgentSessionUpsert, (_event, session: AgentSession) => {
    store.upsertAgentSession(session)
  })

  ipcMain.handle(IPC.AgentSessionDelete, (_event, id: string) => {
    store.deleteAgentSession(id)
  })

  ipcMain.handle(IPC.AgentSessionRename, (_event, id: string, title: string) => {
    store.renameAgentSession(id, title)
  })

  ipcMain.handle(IPC.AgentSessionExport, async (event, id: string, format: AgentSessionExportFormat): Promise<AgentSessionExportResult> => {
    const session = store.getSnapshot().agentSessions.find(item => item.id === id)
    const win = BrowserWindow.fromWebContents(event.sender) ?? getWindow()
    if (!session) return { ok: false, message: '未找到会话' }
    if (!win) return { ok: false, message: '窗口不可用' }
    if (format !== 'markdown' && format !== 'json') return { ok: false, message: '不支持的导出格式' }
    return exportAgentSession(win, session, format)
  })

  ipcMain.handle(IPC.AgentPickDirectory, async (event) => {
    const e2eDirectory = process.env['DEEPDESK_E2E_PICK_DIRECTORY']
    if (e2eDirectory) return e2eDirectory

    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.WindowMinimize, event => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle(IPC.WindowToggleMaximize, event => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })

  ipcMain.handle(IPC.WindowClose, event => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle(IPC.WindowIsMaximized, event => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })

  ipcMain.handle(IPC.OpenExternal, async (_event, url: string) => {
    if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
      await shell.openExternal(url)
    }
  })

  ipcMain.handle(IPC.AppVersion, () => app.getVersion())
}
