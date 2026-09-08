import { app } from 'electron'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AppState, AppSettings, ProviderConfig, Conversation, MemoryItem, MemorySearchRequest, MemoryCaptureRequest, ConnectorActivity, ConnectorActivityDirection, ConnectorActivityStatus, ConnectorConfig, ConnectorConfigPatch, ConnectorId, McpServerConfig } from '../shared/types'
import type { AgentSession } from '../shared/agent-types'
import type { SessionTarget } from '../shared/session-archive'
import { BUILTIN_PROVIDERS } from '../shared/llm/providers'
import { extractMemoryCandidates, relateMemory, searchMemories, type MemoryCandidate } from '../shared/memory'
import { normalizeAppFontScale } from '../shared/font-scale'
import { mapAppStateSecrets, plaintextSecretCodec, SecretStorageError, type SecretCodec } from './secret-storage'
import { CoalescedJsonWriter, readJsonWithTempRecovery } from './json-file-store'
import { SessionJournal } from './session-journal'
import { atomicWrite } from './session-objects'
import { recoverAgentSession, recoverConversation } from './session-recovery'

const DEFAULT_SETTINGS: AppSettings = {
  version: 1,
  defaultProviderId: 'deepseek',
  defaultModelId: 'deepseek-v4-flash',
  temperature: 1,
  theme: 'dark',
  appFont: 'default',
  appFontScale: 1,
  enterToSend: true,
  agentWorkdir: '',
  agentPermissionMode: 'ask',
  agentInteractionMode: 'execute',
  agentMaxMode: false
}

function cloneProviders(): ProviderConfig[] {
  return BUILTIN_PROVIDERS.map(p => ({
    ...p,
    models: p.models.map(m => ({ ...m }))
  }))
}

function normalizeProviders(providers: unknown): ProviderConfig[] {
  if (!Array.isArray(providers)) return []
  return (providers as ProviderConfig[]).map(provider => ({
    ...provider,
    type: provider.type === 'anthropic' || provider.type === 'openai-responses' ? provider.type : 'openai',
    models: Array.isArray(provider.models) ? provider.models : []
  }))
}

function createConnectorConfig(id: ConnectorId): ConnectorConfig {
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

function normalizeConnectors(connectors: unknown): ConnectorConfig[] {
  const incoming = Array.isArray(connectors) ? connectors as Partial<ConnectorConfig>[] : []
  return (['lark', 'wechat', 'browser'] satisfies ConnectorId[]).map(id => {
    const found = incoming.find(item => item.id === id)
    return { ...createConnectorConfig(id), ...found, id }
  })
}

function normalizeConnectorActivities(activities: unknown): ConnectorActivity[] {
  const incoming = Array.isArray(activities) ? activities as Partial<ConnectorActivity>[] : []
  return incoming
    .filter(item => item.id && item.connectorId && item.text && item.createdAt)
    .map(item => {
      const direction: ConnectorActivityDirection = item.direction === 'outbound' || item.direction === 'system' ? item.direction : 'inbound'
      const status: ConnectorActivityStatus = item.status === 'handled' || item.status === 'failed' ? item.status : 'new'
      return {
        id: String(item.id),
        connectorId: item.connectorId === 'lark' || item.connectorId === 'wechat' || item.connectorId === 'browser' ? item.connectorId : 'wechat',
        direction,
        sourceName: String(item.sourceName ?? ''),
        sourceId: String(item.sourceId ?? ''),
        threadId: typeof item.threadId === 'string' ? item.threadId : undefined,
        conversationName: typeof item.conversationName === 'string' ? item.conversationName : undefined,
        text: String(item.text),
        replyToken: typeof item.replyToken === 'string' ? item.replyToken : undefined,
        createdAt: Number(item.createdAt),
        status,
        taskId: typeof item.taskId === 'string' ? item.taskId : undefined
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 200)
}

function normalizeMcpServers(servers: unknown): McpServerConfig[] {
  const incoming = Array.isArray(servers) ? servers as Partial<McpServerConfig>[] : []
  return incoming
    .filter(server => typeof server.id === 'string' && server.id.trim() && typeof server.name === 'string' && server.name.trim())
    .map(server => ({
      id: String(server.id),
      name: String(server.name),
      transport: server.transport === 'http' ? 'http' : 'stdio',
      enabled: server.enabled === true,
      command: typeof server.command === 'string' ? server.command : '',
      args: Array.isArray(server.args) ? server.args.filter((arg): arg is string => typeof arg === 'string') : [],
      env: server.env && typeof server.env === 'object' && !Array.isArray(server.env)
        ? Object.fromEntries(Object.entries(server.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        : {},
      cwd: typeof server.cwd === 'string' ? server.cwd : '',
      url: typeof server.url === 'string' ? server.url : '',
      token: typeof server.token === 'string' ? server.token : '',
      headers: server.headers && typeof server.headers === 'object' && !Array.isArray(server.headers)
        ? Object.fromEntries(Object.entries(server.headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
        : {},
      createdAt: Number(server.createdAt) || Date.now(),
      updatedAt: Number(server.updatedAt) || Date.now()
    }))
}

export class AppStore {
  private file: string
  private data: AppState
  private secrets: SecretCodec
  private writer: CoalescedJsonWriter
  readonly sessions: SessionJournal

  constructor(storageDir?: string, secrets: SecretCodec = plaintextSecretCodec) {
    const dir = storageDir ?? app.getPath('userData')
    this.file = path.join(dir, 'deepdesk.json')
    this.secrets = secrets
    this.sessions = new SessionJournal(dir, secrets)
    this.data = {
      settings: { ...DEFAULT_SETTINGS },
      providers: cloneProviders(),
      mcpServers: [],
      connectors: normalizeConnectors([]),
      connectorActivities: [],
      conversations: [],
      agentSessions: [],
      memories: []
    }
    this.writer = new CoalescedJsonWriter(this.file, () => JSON.stringify({
      ...mapAppStateSecrets({ ...this.data, agentSessions: [], conversations: [] }, this.secrets, 'protect'),
      sessionStorageVersion: 1, memoryBackfillVersion: 1
    }, null, 2), undefined, () => this.sessions.flush())
  }

  async init(): Promise<void> {
    let parsed: Partial<AppState> & { sessionStorageVersion?: number; memoryBackfillVersion?: number } = {}
    try {
      const loaded = await readJsonWithTempRecovery<typeof parsed>(this.file)
      parsed = loaded.value
      this.data = mapAppStateSecrets(this.migrate(loaded.value), this.secrets, 'reveal')
      if (loaded.recovered) console.warn('[store] 已从未完成写入的临时文件恢复本地数据')
    } catch (error) {
      if (error instanceof SecretStorageError || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const saved = await this.sessions.load()
    if (parsed.sessionStorageVersion !== undefined && parsed.sessionStorageVersion !== 1) throw new Error('会话存储版本较新，请升级 DeepDesk')
    if (!parsed.sessionStorageVersion) {
      if (this.data.agentSessions.length || this.data.conversations.length) await atomicWrite(`${this.file}.pre-sessions-v1.bak`, JSON.stringify(parsed))
      saved.agentSessions.push(...this.data.agentSessions.filter(item => !this.sessions.has('agent', item.id)))
      saved.conversations.push(...this.data.conversations.filter(item => !this.sessions.has('chat', item.id)))
    }
    this.data.agentSessions = saved.agentSessions.map(recoverAgentSession)
    this.data.conversations = saved.conversations.map(recoverConversation)
    if (!this.data.providers || this.data.providers.length === 0) {
      this.data.providers = cloneProviders()
    }
    if (!this.data.settings) this.data.settings = { ...DEFAULT_SETTINGS }
    this.data.mcpServers = normalizeMcpServers(this.data.mcpServers)
    this.data.connectors = normalizeConnectors(this.data.connectors)
    if (!this.data.conversations) this.data.conversations = []
    if (!this.data.agentSessions) this.data.agentSessions = []
    if (!this.data.memories) this.data.memories = []
    this.data.connectorActivities = normalizeConnectorActivities(this.data.connectorActivities)
    this.migrateDeepSeekV4()
    this.hydrateBuiltInProviderModels()
    if (!parsed.memoryBackfillVersion) this.backfillMemories()
    for (const session of this.data.agentSessions) this.sessions.upsert('agent', session)
    for (const conversation of this.data.conversations) this.sessions.upsert('chat', conversation)
    await this.sessions.flush()
    this.persist()
    await this.flush()
  }

  private migrate(parsed: Partial<AppState>): AppState {
    const raw = parsed.settings as (Partial<AppSettings> & { agentAutoApprove?: boolean }) | undefined
    const settings: AppSettings = { ...DEFAULT_SETTINGS, ...raw }
    settings.appFontScale = normalizeAppFontScale(settings.appFontScale)
    if (raw?.agentAutoApprove === true && settings.agentPermissionMode === 'ask') {
      settings.agentPermissionMode = 'auto'
    }
    const providers = normalizeProviders(parsed.providers)
    const mcpServers = normalizeMcpServers(parsed.mcpServers)
    const connectors = normalizeConnectors(parsed.connectors)
    const connectorActivities = normalizeConnectorActivities(parsed.connectorActivities)
    const conversations = Array.isArray(parsed.conversations) ? parsed.conversations : []
    const agentSessions = Array.isArray(parsed.agentSessions)
      ? parsed.agentSessions.map(session => ({
          ...session,
          hasUnread: session.hasUnread === true,
          providerId: session.providerId || providers.find(provider => provider.models?.some(model => model.id === session.modelId))?.id || settings.defaultProviderId
        }))
      : []
    const memories = Array.isArray(parsed.memories) ? parsed.memories : []
    return { settings, providers, mcpServers, connectors, connectorActivities, conversations, agentSessions, memories }
  }

  private migrateDeepSeekV4(): void {
    const oldIds = ['deepseek-chat', 'deepseek-reasoner']
    const oldToNew: Record<string, string> = {
      'deepseek-chat': 'deepseek-v4-flash',
      'deepseek-reasoner': 'deepseek-v4-pro'
    }
    const builtin = BUILTIN_PROVIDERS.find(p => p.id === 'deepseek')
    const ds = this.data.providers.find(p => p.id === 'deepseek')
    if (builtin && ds && ds.models.some(m => oldIds.includes(m.id))) {
      ds.models = builtin.models.map(m => ({ ...m }))
    }
    if (oldIds.includes(this.data.settings.defaultModelId)) {
      this.data.settings.defaultModelId = oldToNew[this.data.settings.defaultModelId]
    }
    for (const conv of this.data.conversations) {
      if (conv.providerId === 'deepseek' && oldIds.includes(conv.modelId)) {
        conv.modelId = oldToNew[conv.modelId]
      }
    }
  }

  private hydrateBuiltInProviderModels(): void {
    for (const builtin of BUILTIN_PROVIDERS) {
      const provider = this.data.providers.find(p => p.id === builtin.id)
      if (!provider) continue
      if (!Array.isArray(provider.models)) provider.models = []
      const existingIds = new Set(provider.models.map(model => model.id))
      const missing = builtin.models.filter(model => !existingIds.has(model.id))
      if (missing.length > 0) {
        provider.models = [...provider.models, ...missing.map(model => ({ ...model }))]
      }
      provider.models = provider.models.map(model => {
        const builtinModel = builtin.models.find(item => item.id === model.id)
        return builtinModel ? { ...model, contextWindow: builtinModel.contextWindow, supportsReasoning: builtinModel.supportsReasoning ?? model.supportsReasoning } : model
      })
      provider.isBuiltIn = provider.isBuiltIn ?? builtin.isBuiltIn
      if (!provider.name) provider.name = builtin.name
      if (!provider.baseUrl) provider.baseUrl = builtin.baseUrl
    }
  }

  getSnapshot(): AppState {
    return structuredClone(this.data)
  }

  updateSettings(patch: Partial<AppSettings>): AppSettings {
    this.data.settings = { ...this.data.settings, ...patch }
    this.data.settings.appFontScale = normalizeAppFontScale(this.data.settings.appFontScale)
    this.persist()
    return structuredClone(this.data.settings)
  }

  upsertProvider(provider: ProviderConfig): void {
    provider = { ...provider, type: provider.type === 'anthropic' || provider.type === 'openai-responses' ? provider.type : 'openai' }
    const idx = this.data.providers.findIndex(p => p.id === provider.id)
    if (idx >= 0) this.data.providers[idx] = structuredClone(provider)
    else this.data.providers.push(structuredClone(provider))
    this.persist()
  }

  deleteProvider(id: string): void {
    this.data.providers = this.data.providers.filter(p => p.id !== id)
    const settings = this.data.settings
    if (settings.defaultProviderId === id && this.data.providers.length > 0) {
      settings.defaultProviderId = this.data.providers[0].id
    }
    this.persist()
  }

  upsertMcpServer(config: McpServerConfig): McpServerConfig {
    const now = Date.now()
    const current = this.data.mcpServers.find(server => server.id === config.id)
    const next: McpServerConfig = {
      ...structuredClone(config),
      name: config.name.trim(),
      command: config.command.trim(),
      cwd: config.cwd.trim(),
      url: config.url.trim(),
      token: config.token.trim(),
      createdAt: current?.createdAt ?? config.createdAt ?? now,
      updatedAt: now
    }
    const idx = this.data.mcpServers.findIndex(server => server.id === config.id)
    if (idx >= 0) this.data.mcpServers[idx] = next
    else this.data.mcpServers.push(next)
    this.persist()
    return structuredClone(next)
  }

  deleteMcpServer(id: string): void {
    this.data.mcpServers = this.data.mcpServers.filter(server => server.id !== id)
    this.persist()
  }

  addMcpServers(configs: McpServerConfig[]): void {
    this.data.mcpServers.push(...structuredClone(configs))
    this.persist()
  }

  upsertConnectorConfig(patch: ConnectorConfigPatch): ConnectorConfig {
    const idx = this.data.connectors.findIndex(connector => connector.id === patch.id)
    const current = idx >= 0 ? this.data.connectors[idx] : createConnectorConfig(patch.id)
    const next: ConnectorConfig = {
      ...current,
      ...patch,
      id: patch.id,
      updatedAt: Date.now()
    }
    if (idx >= 0) this.data.connectors[idx] = structuredClone(next)
    else this.data.connectors.push(structuredClone(next))
    this.data.connectors = normalizeConnectors(this.data.connectors)
    this.persist()
    return structuredClone(next)
  }

  listConnectorActivities(id?: ConnectorId): ConnectorActivity[] {
    const items = id ? this.data.connectorActivities.filter(item => item.connectorId === id) : this.data.connectorActivities
    return structuredClone(items.sort((a, b) => b.createdAt - a.createdAt).slice(0, 100))
  }

  upsertConnectorActivities(items: ConnectorActivity[]): void {
    if (items.length === 0) return
    const byId = new Map(this.data.connectorActivities.map(item => [item.id, item]))
    for (const item of items) {
      byId.set(item.id, structuredClone(item))
      this.upsertConnectorSessionFromActivity(item)
    }
    this.data.connectorActivities = Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt).slice(0, 200)
    this.persist()
  }

  private upsertConnectorSessionFromActivity(activity: ConnectorActivity): void {
    if (activity.connectorId === 'browser' || activity.direction !== 'inbound') return
    const externalThreadId = activity.threadId || activity.sourceId || activity.id
    const baseId = `connector-${activity.connectorId}-${externalThreadId}`
    if (activity.createdAt <= this.sessions.lastThreadDeletion(baseId)) return
    const existing = this.data.agentSessions.find(session => session.source?.type === 'connector' && session.source.connectorId === activity.connectorId && session.source.externalThreadId === externalThreadId)
    const id = existing?.id ?? (this.sessions.isDeleted('agent', baseId) ? `thread:${baseId.length}:${baseId}:${randomUUID()}` : baseId)
    const alreadyAdded = existing?.steps.some(step => step.sourceActivityId === activity.id) ?? false
    if (alreadyAdded) return

    const title = activity.conversationName || activity.sourceName || (activity.connectorId === 'wechat' ? '微信会话' : '飞书会话')
    const step = {
      kind: 'task' as const,
      text: activity.text,
      sourceActivityId: activity.id,
      sourceConnectorId: activity.connectorId
    }
    const historyItem = { role: 'user', content: activity.text }
    const source = {
      type: 'connector' as const,
      connectorId: activity.connectorId,
      externalThreadId,
      externalUserName: activity.sourceName || undefined,
      externalConversationName: activity.conversationName,
      externalReplyToken: activity.replyToken,
      lastSyncAt: Date.now()
    }

    if (existing) {
      existing.steps.push(step)
      existing.history.push(historyItem)
      existing.updatedAt = Math.max(existing.updatedAt, activity.createdAt)
      existing.source = source
      this.sessions.upsert('agent', existing)
      return
    }

    this.data.agentSessions.push({
      id,
      task: title,
      workdir: this.data.settings.agentWorkdir,
      providerId: this.data.settings.defaultProviderId,
      modelId: this.data.settings.defaultModelId,
      createdAt: activity.createdAt,
      updatedAt: activity.createdAt,
      steps: [step],
      history: [historyItem],
      source
    })
    this.sessions.upsert('agent', this.data.agentSessions[this.data.agentSessions.length - 1])
  }

  getConversation(id: string): Conversation | null {
    const found = this.data.conversations.find(c => c.id === id)
    return found ? structuredClone(found) : null
  }

  upsertConversation(conversation: Conversation): void {
    const idx = this.data.conversations.findIndex(c => c.id === conversation.id)
    if (this.data.conversations[idx]?.archivedAt || this.sessions.isDeleted('chat', conversation.id)) return
    conversation = { ...conversation, archivedAt: undefined }
    if (idx >= 0) this.data.conversations[idx] = structuredClone(conversation)
    else this.data.conversations.push(structuredClone(conversation))
    this.sessions.upsert('chat', conversation)
  }

  deleteConversation(id: string): void {
    this.data.conversations = this.data.conversations.filter(c => c.id !== id)
    this.sessions.delete('chat', id)
  }

  clearConversations(): void {
    for (const conversation of this.data.conversations) this.sessions.delete('chat', conversation.id)
    this.data.conversations = []
  }

  listMemories(): MemoryItem[] {
    return structuredClone(this.data.memories)
  }

  upsertMemory(memory: MemoryItem): MemoryItem {
    const now = Date.now()
    const clean: MemoryItem = {
      ...memory,
      content: memory.content.trim(),
      tags: memory.tags.map(tag => tag.trim()).filter(Boolean),
      createdAt: memory.createdAt || now,
      updatedAt: now
    }
    const idx = this.data.memories.findIndex(item => item.id === clean.id)
    if (idx >= 0) {
      clean.createdAt = this.data.memories[idx].createdAt
      this.data.memories[idx] = structuredClone(clean)
    } else {
      this.data.memories.push(structuredClone(clean))
    }
    this.persist()
    return structuredClone(clean)
  }

  deleteMemory(id: string): void {
    this.data.memories = this.data.memories.filter(memory => memory.id !== id)
    this.persist()
  }

  searchMemories(request: MemorySearchRequest): MemoryItem[] {
    return structuredClone(searchMemories(this.data.memories, request.query, request.scopes, request.limit))
  }

  captureMemories(request: MemoryCaptureRequest): MemoryItem[] {
    const captured = this.captureMemoryCandidates(extractMemoryCandidates(request.text), request.source)
    if (captured.length > 0) this.persist()
    return structuredClone(captured)
  }

  private captureMemoryCandidates(candidates: MemoryCandidate[], source: NonNullable<MemoryItem['source']>): MemoryItem[] {
    const captured: MemoryItem[] = []
    for (const candidate of candidates) {
      const related = this.data.memories
        .map(memory => ({ memory, relationship: relateMemory(memory, candidate) }))
        .find(item => item.relationship !== 'distinct')
      const now = Date.now()
      if (related) {
        const existing = related.memory
        existing.content = candidate.content
        existing.enabled = true
        existing.updatedAt = now
        existing.source = source
        existing.tags = Array.from(new Set([...existing.tags, ...candidate.tags, ...(related.relationship === 'conflict' ? ['已更新'] : [])]))
        captured.push(existing)
        continue
      }
      const memory: MemoryItem = {
        id: `memory-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        ...candidate,
        source,
        enabled: true,
        createdAt: now,
        updatedAt: now
      }
      this.data.memories.push(memory)
      captured.push(memory)
    }
    return captured
  }

  private backfillMemories(): void {
    for (const conversation of this.data.conversations) {
      for (const message of conversation.messages) {
        if (message.role !== 'user') continue
        this.captureMemoryCandidates(extractMemoryCandidates(message.content), { type: 'conversation', id: conversation.id })
      }
    }
    for (const session of this.data.agentSessions) {
      for (const step of session.steps) {
        if (step.kind !== 'task' || !step.text) continue
        this.captureMemoryCandidates(extractMemoryCandidates(step.text), { type: 'agent', id: session.id })
      }
    }
  }

  upsertAgentSession(session: AgentSession): void {
    const idx = this.data.agentSessions.findIndex(s => s.id === session.id)
    if (this.data.agentSessions[idx]?.archivedAt || this.sessions.isDeleted('agent', session.id)) return
    session = { ...session, archivedAt: undefined }
    if (idx >= 0) this.data.agentSessions[idx] = structuredClone(session)
    else this.data.agentSessions.push(structuredClone(session))
    this.sessions.upsert('agent', session)
  }

  getAgentSession(id: string): AgentSession | null {
    const session = this.data.agentSessions.find(item => item.id === id)
    return session ? structuredClone(session) : null
  }

  deleteAgentSession(id: string): void {
    this.data.agentSessions = this.data.agentSessions.filter(s => s.id !== id)
    this.sessions.delete('agent', id)
  }

  renameAgentSession(id: string, title: string): void {
    const s = this.data.agentSessions.find(x => x.id === id)
    if (s) {
      s.task = title
      s.updatedAt = Date.now()
      this.sessions.upsert('agent', s)
    }
  }

  clearAgentSessions(): void {
    for (const session of this.data.agentSessions) this.sessions.delete('agent', session.id)
    this.data.agentSessions = []
  }

  setSessionArchived(target: SessionTarget, archived: boolean): void {
    if (this.sessions.isDeleted(target.kind, target.id)) throw new Error('会话已永久删除')
    const session = target.kind === 'agent'
      ? this.data.agentSessions.find(item => item.id === target.id)
      : this.data.conversations.find(item => item.id === target.id)
    if (!session) throw new Error('未找到会话')
    if (archived === Boolean(session.archivedAt)) return
    session.archivedAt = archived ? Date.now() : undefined
    if ('steps' in session) {
      session.hasUnread = false
      session.steps = session.steps.map(step => step.status === 'running' ? { ...step, status: 'cancelled' } : step)
    } else session.messages = session.messages.map(message => ({ ...message, streaming: false }))
    this.sessions.upsert(target.kind, session)
  }

  async purgeArchivedSession(target: SessionTarget): Promise<void> {
    const session = target.kind === 'agent' ? this.getAgentSession(target.id) : this.getConversation(target.id)
    if (!session?.archivedAt) throw new Error('只能永久删除已归档的会话')
    this.sessions.purge(target.kind, target.id)
    await this.sessions.flush()
    if (target.kind === 'agent') this.data.agentSessions = this.data.agentSessions.filter(item => item.id !== target.id)
    else this.data.conversations = this.data.conversations.filter(item => item.id !== target.id)
  }

  private persist(): void {
    this.writer.request()
  }

  async flush(): Promise<void> {
    await this.sessions.flush()
    await this.writer.flush()
  }
}
