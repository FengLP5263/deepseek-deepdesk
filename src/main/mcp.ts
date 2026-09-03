import { createHash, randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { AgentToolResult, McpAgentToolName, McpInstallApproval } from '../shared/agent-types'
import type { McpActionResult, McpServerConfig, McpServerStatus, McpToolAnnotations, McpToolInfo } from '../shared/types'
import { APP_VERSION } from '../shared/app-meta'
import type { AppStore } from './store'
import { inspectStdioInstall, MCP_INSTALL_CANDIDATE_TTL_MS, type McpInstallCandidate } from './mcp-install'

const CONNECT_TIMEOUT_MS = 15_000
const TOOL_TIMEOUT_MS = 120_000
const MAX_TOOL_RESULT_CHARS = 100_000

export interface McpConnection {
  listTools: (signal?: AbortSignal) => Promise<McpToolInfo[]>
  callTool: (name: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>
  serverInfo: () => { name?: string; version?: string; instructions?: string }
  close: () => Promise<void>
}

export type McpConnectionFactory = (config: McpServerConfig, signal?: AbortSignal) => Promise<McpConnection>

export interface McpAgentTool {
  name: McpAgentToolName
  definition: Record<string, unknown>
  serverId: string
  serverName: string
  toolName: string
  annotations?: McpToolAnnotations
}

interface RuntimeState {
  state: McpServerStatus['state']
  message: string
  connection?: McpConnection
  tools: McpAgentTool[]
  serverName?: string
  serverVersion?: string
  instructions?: string
}

function normalizeRemoteSource(source: string): string {
  const value = source.trim()
  if (!value) throw new Error('请提供 MCP 服务地址')
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('会话内安装仅支持 HTTP 或 HTTPS MCP 服务地址')
  if (url.username || url.password) throw new Error('MCP 地址不能包含账号或密码，请在设置中安全配置认证信息')
  url.hash = ''
  return url.toString()
}

function sameRemoteSource(left: string, right: string): boolean {
  try {
    return normalizeRemoteSource(left) === normalizeRemoteSource(right)
  } catch {
    return false
  }
}

function endpointName(source: string): string {
  const url = new URL(source)
  const segment = url.pathname.split('/').filter(Boolean).at(-1)
  return segment && segment.toLowerCase() !== 'mcp' ? `${url.hostname} · ${segment}` : url.hostname
}

function cleanName(value: string, fallback: string, maxLength: number): string {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return (cleaned || fallback).slice(0, maxLength)
}

export function createMcpAgentToolName(serverId: string, toolName: string): McpAgentToolName {
  const server = cleanName(serverId, 'server', 16)
  const tool = cleanName(toolName, 'tool', 28)
  const digest = createHash('sha256').update(serverId + '\0' + toolName).digest('hex').slice(0, 8)
  return `mcp__${server}__${tool}__${digest}`
}

function validateConfig(config: McpServerConfig): void {
  if (!config.name.trim()) throw new Error('请填写 MCP 服务器名称')
  if (config.transport === 'stdio') {
    if (!config.command.trim()) throw new Error('请填写启动命令')
    return
  }
  if (!config.url.trim()) throw new Error('请填写服务器地址')
  const url = new URL(config.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('服务器地址仅支持 HTTP 或 HTTPS')
}

function normalizeTools(config: McpServerConfig, tools: McpToolInfo[]): McpAgentTool[] {
  return tools.map(tool => {
    const name = createMcpAgentToolName(config.id, tool.name)
    const description = [`MCP · ${config.name}`, tool.description?.trim()].filter(Boolean).join('：')
    return {
      name,
      serverId: config.id,
      serverName: config.name,
      toolName: tool.name,
      annotations: tool.annotations,
      definition: {
        type: 'function',
        function: {
          name,
          description,
          parameters: tool.inputSchema
        }
      }
    }
  })
}

function truncate(value: string): string {
  if (value.length <= MAX_TOOL_RESULT_CHARS) return value
  return value.slice(0, MAX_TOOL_RESULT_CHARS) + `\n\n[结果过长，已截断 ${value.length - MAX_TOOL_RESULT_CHARS} 个字符]`
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function formatMcpToolResult(raw: unknown, serverName: string, toolName: string): AgentToolResult {
  if (!raw || typeof raw !== 'object') {
    const content = truncate(String(raw ?? 'MCP 工具没有返回内容'))
    return { ok: true, content, summary: `${serverName} · ${toolName} 完成` }
  }
  const result = raw as Record<string, unknown>
  const isError = result.isError === true
  const parts: string[] = []
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (!item || typeof item !== 'object') continue
      const block = item as Record<string, unknown>
      if (block.type === 'text' && typeof block.text === 'string') {
        parts.push(block.text)
      } else if (block.type === 'resource' && block.resource && typeof block.resource === 'object') {
        const resource = block.resource as Record<string, unknown>
        if (typeof resource.text === 'string') parts.push(resource.text)
        else parts.push(`[资源：${String(resource.uri ?? '未命名')} · ${String(resource.mimeType ?? '二进制')}]`)
      } else if (block.type === 'resource_link') {
        parts.push(`[资源链接：${String(block.name ?? block.uri ?? '未命名')} · ${String(block.uri ?? '')}]`)
      } else if (block.type === 'image' || block.type === 'audio') {
        parts.push(`[${block.type === 'image' ? '图片' : '音频'}：${String(block.mimeType ?? '未知格式')}]`)
      }
    }
  }
  if (result.structuredContent !== undefined) parts.push(stringifyJson(result.structuredContent))
  if (parts.length === 0 && result.toolResult !== undefined) parts.push(stringifyJson(result.toolResult))
  if (parts.length === 0) parts.push(isError ? 'MCP 工具执行失败' : 'MCP 工具执行完成')
  const content = truncate(parts.join('\n\n'))
  return { ok: !isError, content, summary: `${serverName} · ${toolName} ${isError ? '失败' : '完成'}` }
}

async function createSdkConnection(config: McpServerConfig, signal?: AbortSignal): Promise<McpConnection> {
  validateConfig(config)
  const client = new Client({ name: 'DeepDesk', version: APP_VERSION }, { capabilities: {} })
  let transport: StdioClientTransport | StreamableHTTPClientTransport
  if (config.transport === 'stdio') {
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...getDefaultEnvironment(), ...config.env },
      cwd: config.cwd || undefined,
      stderr: 'pipe'
    })
  } else {
    const headers = new Headers(config.headers)
    if (config.token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${config.token}`)
    transport = new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers } })
  }
  try {
    await client.connect(transport, { signal, timeout: CONNECT_TIMEOUT_MS })
  } catch (error) {
    await transport.close().catch(() => undefined)
    throw error
  }
  return {
    listTools: async signal => {
      const result = await client.listTools(undefined, { signal, timeout: CONNECT_TIMEOUT_MS })
      return result.tools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
        annotations: tool.annotations
      }))
    },
    callTool: (name, args, signal) => client.callTool({ name, arguments: args }, undefined, { signal, timeout: TOOL_TIMEOUT_MS, maxTotalTimeout: TOOL_TIMEOUT_MS }),
    serverInfo: () => ({
      name: client.getServerVersion()?.name,
      version: client.getServerVersion()?.version,
      instructions: client.getInstructions()
    }),
    close: async () => {
      if (transport instanceof StreamableHTTPClientTransport && transport.sessionId) {
        await transport.terminateSession().catch(() => undefined)
      }
      await client.close().catch(() => undefined)
    }
  }
}

export class McpManager {
  private readonly runtime = new Map<string, RuntimeState>()
  private readonly connecting = new Map<string, Promise<McpActionResult>>()
  private readonly installCandidates = new Map<string, McpInstallCandidate>()

  constructor(private readonly store: AppStore, private readonly factory: McpConnectionFactory = createSdkConnection) {}

  async initialize(): Promise<void> {
    const enabled = this.store.getSnapshot().mcpServers.filter(server => server.enabled)
    await Promise.allSettled(enabled.map(server => this.connect(server.id)))
  }

  listStatuses(): McpServerStatus[] {
    return this.store.getSnapshot().mcpServers.map(config => this.statusFor(config))
  }

  async save(config: McpServerConfig): Promise<McpServerStatus> {
    validateConfig(config)
    await this.closeRuntime(config.id)
    const saved = this.store.upsertMcpServer(config)
    this.runtime.set(saved.id, { state: 'disconnected', message: '尚未连接', tools: [] })
    if (saved.enabled) await this.connect(saved.id)
    return this.statusFor(this.configById(saved.id) ?? saved)
  }

  async remove(id: string): Promise<void> {
    await this.closeRuntime(id)
    this.runtime.delete(id)
    this.store.deleteMcpServer(id)
  }

  connect(id: string): Promise<McpActionResult> {
    const pending = this.connecting.get(id)
    if (pending) return pending
    const operation = this.doConnect(id).finally(() => this.connecting.delete(id))
    this.connecting.set(id, operation)
    return operation
  }

  private async doConnect(id: string): Promise<McpActionResult> {
    const config = this.configById(id)
    if (!config) return { ok: false, message: '未找到 MCP 服务器' }
    await this.closeRuntime(id)
    this.runtime.set(id, { state: 'connecting', message: '正在连接…', tools: [] })
    let connection: McpConnection | undefined
    try {
      connection = await this.factory(config)
      const tools = normalizeTools(config, await connection.listTools())
      const server = connection.serverInfo()
      const runtime: RuntimeState = {
        state: 'connected',
        message: `已连接，发现 ${tools.length} 个工具`,
        connection,
        tools,
        serverName: server.name,
        serverVersion: server.version,
        instructions: server.instructions
      }
      this.runtime.set(id, runtime)
      const saved = this.store.upsertMcpServer({ ...config, enabled: true })
      const status = this.statusFor(saved)
      return { ok: true, message: runtime.message, status }
    } catch (error) {
      await connection?.close().catch(() => undefined)
      const message = error instanceof Error ? error.message : String(error)
      this.runtime.set(id, { state: 'error', message: `连接失败：${message}`, tools: [] })
      return { ok: false, message: `连接失败：${message}`, status: this.statusFor(config) }
    }
  }

  async disconnect(id: string): Promise<McpActionResult> {
    const config = this.configById(id)
    if (!config) return { ok: false, message: '未找到 MCP 服务器' }
    await this.closeRuntime(id)
    const saved = this.store.upsertMcpServer({ ...config, enabled: false })
    this.runtime.set(id, { state: 'disconnected', message: '已断开', tools: [] })
    return { ok: true, message: '已断开', status: this.statusFor(saved) }
  }

  listAgentTools(): McpAgentTool[] {
    return Array.from(this.runtime.values()).flatMap(item => item.state === 'connected' ? item.tools : [])
  }

  getInstructions(): string {
    return Array.from(this.runtime.values())
      .filter(item => item.state === 'connected' && item.instructions?.trim())
      .map(item => item.instructions?.trim() ?? '')
      .join('\n\n')
  }

  getTool(name: string): McpAgentTool | undefined {
    return this.listAgentTools().find(tool => tool.name === name)
  }

  async inspectRemoteSource(source: string, runId: string, signal?: AbortSignal): Promise<AgentToolResult> {
    this.pruneInstallCandidates()
    let normalizedSource: string
    try {
      normalizedSource = normalizeRemoteSource(source)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, content: message, summary: 'MCP 地址无效' }
    }

    const existingStatus = this.listStatuses().find(status => status.config.transport === 'http' && sameRemoteSource(status.config.url, normalizedSource))
    if (existingStatus?.state === 'connected') {
      const content = stringifyJson({
        status: 'already_installed',
        name: existingStatus.config.name,
        source: normalizedSource,
        tools: existingStatus.tools.map(tool => tool.name),
        message: '该 MCP 服务已经安装并连接，无需重复安装。'
      })
      return { ok: true, content, summary: `${existingStatus.config.name} 已安装` }
    }

    const now = Date.now()
    const baseConfig: McpServerConfig = existingStatus?.config ?? {
      id: `mcp-${randomUUID()}`,
      name: endpointName(normalizedSource),
      transport: 'http',
      enabled: false,
      command: '',
      args: [],
      env: {},
      cwd: '',
      url: normalizedSource,
      token: '',
      headers: {},
      createdAt: now,
      updatedAt: now
    }

    let connection: McpConnection | undefined
    try {
      connection = await this.factory({ ...baseConfig, url: normalizedSource }, signal)
      const tools = await connection.listTools(signal)
      const server = connection.serverInfo()
      const name = server.name?.trim() || baseConfig.name
      const candidateId = randomUUID()
      const expiresAt = now + MCP_INSTALL_CANDIDATE_TTL_MS
      const candidate: McpInstallCandidate = {
        candidateId,
        runId,
        name,
        source: normalizedSource,
        transport: 'http',
        serverVersion: server.version,
        toolNames: tools.map(tool => tool.name),
        config: { ...baseConfig, name, url: normalizedSource, enabled: true },
        expiresAt
      }
      this.installCandidates.set(candidateId, candidate)
      return {
        ok: true,
        content: stringifyJson({
          status: 'ready_to_install',
          candidate_id: candidateId,
          expires_at: new Date(expiresAt).toISOString(),
          name,
          source: normalizedSource,
          server_version: server.version,
          tools: candidate.toolNames,
          next_action: '调用 install_mcp_server，并等待用户确认。'
        }),
        summary: `已检查 ${name}，发现 ${tools.length} 个工具`
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        content: `无法把该地址识别为可直接连接的 Streamable HTTP MCP 服务：${detail}\n\n如果这是 GitHub、npm、MCP Registry 或普通介绍页，请提供服务实际暴露的 HTTP MCP 端点；需要密钥或自定义请求头时，请前往“设置 → MCP”配置。`,
        summary: 'MCP 服务检查失败'
      }
    } finally {
      await connection?.close().catch(() => undefined)
    }
  }

  inspectStdioSource(input: Record<string, unknown>, runId: string): AgentToolResult {
    this.pruneInstallCandidates()
    const inspection = inspectStdioInstall(input, runId, this.listStatuses())
    if (inspection.candidate) this.installCandidates.set(inspection.candidate.candidateId, inspection.candidate)
    return inspection.result
  }

  getInstallCandidate(candidateId: string, runId: string): McpInstallApproval | undefined {
    this.pruneInstallCandidates()
    const candidate = this.installCandidates.get(candidateId)
    if (!candidate || candidate.runId !== runId) return undefined
    return {
      candidateId: candidate.candidateId,
      name: candidate.name,
      source: candidate.source,
      transport: candidate.transport,
      command: candidate.command,
      args: candidate.args ? [...candidate.args] : undefined,
      cwd: candidate.cwd,
      serverVersion: candidate.serverVersion,
      toolNames: [...candidate.toolNames]
    }
  }

  async installCandidate(candidateId: string, runId: string): Promise<AgentToolResult> {
    this.pruneInstallCandidates()
    const candidate = this.installCandidates.get(candidateId)
    if (!candidate || candidate.runId !== runId) {
      return { ok: false, content: '安装凭证无效或已过期，请重新检查 MCP 服务地址。', summary: 'MCP 安装凭证无效' }
    }
    const status = await this.save(candidate.config)
    if (status.state !== 'connected') {
      return { ok: false, content: status.message, summary: `${candidate.name} 安装后连接失败` }
    }
    this.installCandidates.delete(candidateId)
    return {
      ok: true,
      content: stringifyJson({
        status: 'installed',
        name: status.config.name,
        source: candidate.source,
        tools: status.tools.map(tool => tool.name),
        message: 'MCP 服务已保存并连接，后续启动时会自动恢复连接。'
      }),
      summary: `已安装并连接 ${status.config.name}`
    }
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<AgentToolResult> {
    const tool = this.getTool(name)
    if (!tool) return { ok: false, content: 'MCP 工具不可用或服务器已断开', summary: 'MCP 工具不可用' }
    const runtime = this.runtime.get(tool.serverId)
    if (!runtime?.connection) return { ok: false, content: 'MCP 服务器未连接', summary: 'MCP 服务器未连接' }
    const result = await runtime.connection.callTool(tool.toolName, args, signal)
    return formatMcpToolResult(result, tool.serverName, tool.toolName)
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled(Array.from(this.connecting.values()))
    await Promise.allSettled(Array.from(this.runtime.keys()).map(id => this.closeRuntime(id)))
    this.installCandidates.clear()
  }

  private pruneInstallCandidates(now = Date.now()): void {
    for (const [id, candidate] of this.installCandidates) {
      if (candidate.expiresAt <= now) this.installCandidates.delete(id)
    }
  }

  private configById(id: string): McpServerConfig | undefined {
    return this.store.getSnapshot().mcpServers.find(server => server.id === id)
  }

  private statusFor(config: McpServerConfig): McpServerStatus {
    const runtime = this.runtime.get(config.id)
    return {
      config,
      state: runtime?.state ?? 'disconnected',
      message: runtime?.message ?? '尚未连接',
      serverName: runtime?.serverName,
      serverVersion: runtime?.serverVersion,
      toolCount: runtime?.tools.length ?? 0,
      tools: runtime?.tools.map(tool => ({
        name: tool.toolName,
        description: typeof (tool.definition.function as Record<string, unknown>).description === 'string'
          ? String((tool.definition.function as Record<string, unknown>).description)
          : undefined,
        inputSchema: ((tool.definition.function as Record<string, unknown>).parameters ?? { type: 'object' }) as Record<string, unknown>,
        annotations: tool.annotations
      })) ?? []
    }
  }

  private async closeRuntime(id: string): Promise<void> {
    const runtime = this.runtime.get(id)
    if (runtime) this.runtime.set(id, { state: 'disconnected', message: '已断开', tools: [] })
    if (runtime?.connection) await runtime.connection.close().catch(() => undefined)
  }
}

let manager: McpManager | null = null

export async function configureMcp(store: AppStore): Promise<void> {
  if (manager) await manager.closeAll()
  manager = new McpManager(store)
  void manager.initialize().catch(error => console.error('[mcp] 恢复服务器连接失败:', error))
}

export function listMcpStatuses(): McpServerStatus[] {
  return manager?.listStatuses() ?? []
}

export function saveMcpServer(config: McpServerConfig): Promise<McpServerStatus> {
  if (!manager) throw new Error('MCP 尚未初始化')
  return manager.save(config)
}

export async function deleteMcpServer(id: string): Promise<void> {
  if (!manager) throw new Error('MCP 尚未初始化')
  await manager.remove(id)
}

export function connectMcpServer(id: string): Promise<McpActionResult> {
  if (!manager) return Promise.resolve({ ok: false, message: 'MCP 尚未初始化' })
  return manager.connect(id)
}

export function disconnectMcpServer(id: string): Promise<McpActionResult> {
  if (!manager) return Promise.resolve({ ok: false, message: 'MCP 尚未初始化' })
  return manager.disconnect(id)
}

export function listMcpAgentTools(): McpAgentTool[] {
  return manager?.listAgentTools() ?? []
}

export function getMcpInstructions(): string {
  return manager?.getInstructions() ?? ''
}

export function getMcpAgentTool(name: string): McpAgentTool | undefined {
  return manager?.getTool(name)
}

export function executeMcpAgentTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<AgentToolResult> {
  if (!manager) return Promise.resolve({ ok: false, content: 'MCP 尚未初始化', summary: 'MCP 不可用' })
  return manager.callTool(name, args, signal)
}

export function inspectMcpServer(input: Record<string, unknown>, runId: string, signal?: AbortSignal): Promise<AgentToolResult> {
  if (!manager) return Promise.resolve({ ok: false, content: 'MCP 尚未初始化', summary: 'MCP 不可用' })
  if (typeof input.command === 'string' && input.command.trim()) return Promise.resolve(manager.inspectStdioSource(input, runId))
  return manager.inspectRemoteSource(String(input.source ?? ''), runId, signal)
}

export function getMcpInstallCandidate(candidateId: string, runId: string): McpInstallApproval | undefined {
  return manager?.getInstallCandidate(candidateId, runId)
}

export function installMcpServer(candidateId: string, runId: string): Promise<AgentToolResult> {
  if (!manager) return Promise.resolve({ ok: false, content: 'MCP 尚未初始化', summary: 'MCP 不可用' })
  return manager.installCandidate(candidateId, runId)
}

export async function shutdownMcp(): Promise<void> {
  await manager?.closeAll()
  manager = null
}
