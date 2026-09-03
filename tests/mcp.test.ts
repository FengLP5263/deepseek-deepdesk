import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'deepdesk-mcp-app') } }))

import { AppStore } from '../src/main/store'
import { createMcpAgentToolName, formatMcpToolResult, McpManager } from '../src/main/mcp'
import type { McpConnection, McpConnectionFactory } from '../src/main/mcp'
import type { McpServerConfig } from '../src/shared/types'

let dir: string
let store: AppStore

function config(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'demo-server', name: '演示服务器', transport: 'stdio', enabled: false,
    command: 'demo-mcp', args: [], env: {}, cwd: '', url: '', token: '', headers: {},
    createdAt: 1, updatedAt: 1, ...overrides
  }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'deepdesk-mcp-test-'))
  store = new AppStore(dir)
  await store.init()
})

afterEach(async () => {
  await store.flush()
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
})

describe('McpManager', () => {
  it('检查远程端点后只生成短时凭证，确认安装时才保存并连接', async () => {
    const close = vi.fn(async () => undefined)
    const factory: McpConnectionFactory = vi.fn(async () => ({
      listTools: async () => [{ name: 'search_docs', description: '搜索文档', inputSchema: { type: 'object' } }],
      callTool: async () => ({}),
      serverInfo: () => ({ name: 'Docs MCP', version: '2.1.0' }),
      close
    }))
    const manager = new McpManager(store, factory)

    const inspected = await manager.inspectRemoteSource('https://mcp.example.com/mcp#readme', 'run-a')

    expect(inspected.ok).toBe(true)
    expect(store.getSnapshot().mcpServers).toEqual([])
    const payload = JSON.parse(inspected.content) as { candidate_id: string; source: string; tools: string[] }
    expect(payload.source).toBe('https://mcp.example.com/mcp')
    expect(payload.tools).toEqual(['search_docs'])
    expect(manager.getInstallCandidate(payload.candidate_id, 'other-run')).toBeUndefined()
    expect(manager.getInstallCandidate(payload.candidate_id, 'run-a')).toEqual(expect.objectContaining({
      name: 'Docs MCP', source: 'https://mcp.example.com/mcp', serverVersion: '2.1.0', toolNames: ['search_docs']
    }))
    await expect(manager.installCandidate(payload.candidate_id, 'other-run')).resolves.toEqual(expect.objectContaining({ ok: false }))

    const installed = await manager.installCandidate(payload.candidate_id, 'run-a')

    expect(installed).toEqual(expect.objectContaining({ ok: true, summary: '已安装并连接 Docs MCP' }))
    expect(store.getSnapshot().mcpServers).toEqual([expect.objectContaining({
      name: 'Docs MCP', transport: 'http', url: 'https://mcp.example.com/mcp', enabled: true
    })])
    expect(close).toHaveBeenCalled()
    expect(manager.getInstallCandidate(payload.candidate_id, 'run-a')).toBeUndefined()
  })

  it('会话内检查拒绝非 HTTP 地址和带账号密码的地址', async () => {
    const factory: McpConnectionFactory = vi.fn()
    const manager = new McpManager(store, factory)

    await expect(manager.inspectRemoteSource('stdio://local-tool', 'run-a')).resolves.toEqual(expect.objectContaining({ ok: false, summary: 'MCP 地址无效' }))
    await expect(manager.inspectRemoteSource('https://user:secret@example.com/mcp', 'run-a')).resolves.toEqual(expect.objectContaining({ ok: false, summary: 'MCP 地址无效' }))
    expect(factory).not.toHaveBeenCalled()
  })

  it('会话可准备 stdio MCP，确认安装前不启动进程，确认后由客户端保存并连接', async () => {
    const close = vi.fn(async () => undefined)
    const factory: McpConnectionFactory = vi.fn(async () => ({
      listTools: async () => [{ name: 'browser_open', inputSchema: { type: 'object' } }],
      callTool: async () => ({}),
      serverInfo: () => ({ name: 'Playwright MCP', version: '0.1.0' }),
      close
    }))
    const manager = new McpManager(store, factory)

    const command = 'C:\\Program Files\\nodejs\\node.exe'
    const inspected = manager.inspectStdioSource({ name: 'Playwright MCP', command, args: ['-y', '@playwright/mcp@latest'] }, 'run-stdio')

    expect(inspected.ok).toBe(true)
    expect(factory).not.toHaveBeenCalled()
    expect(store.getSnapshot().mcpServers).toEqual([])
    const payload = JSON.parse(inspected.content) as { candidate_id: string; command: string; args: string[] }
    expect(payload).toEqual(expect.objectContaining({ command, args: ['-y', '@playwright/mcp@latest'] }))
    expect(manager.getInstallCandidate(payload.candidate_id, 'run-stdio')).toEqual(expect.objectContaining({
      name: 'Playwright MCP', transport: 'stdio', source: '"C:\\Program Files\\nodejs\\node.exe" -y @playwright/mcp@latest', command, args: ['-y', '@playwright/mcp@latest']
    }))

    const installed = await manager.installCandidate(payload.candidate_id, 'run-stdio')

    expect(installed).toEqual(expect.objectContaining({ ok: true, summary: '已安装并连接 Playwright MCP' }))
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ transport: 'stdio', command, args: ['-y', '@playwright/mcp@latest'], enabled: true }))
    expect(store.getSnapshot().mcpServers).toEqual([expect.objectContaining({ name: 'Playwright MCP', transport: 'stdio', enabled: true })])
  })

  it('连接后发现工具、生成稳定工具名并把调用路由回原始 MCP 工具', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: '读取成功' }] }))
    const close = vi.fn(async () => undefined)
    const connection: McpConnection = {
      listTools: async () => [{
        name: 'read_document', description: '读取文档', inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
        annotations: { readOnlyHint: true }
      }],
      callTool,
      serverInfo: () => ({ name: 'Demo MCP', version: '1.0.0' }),
      close
    }
    const factory: McpConnectionFactory = vi.fn(async () => connection)
    store.upsertMcpServer(config())
    const manager = new McpManager(store, factory)

    const connected = await manager.connect('demo-server')

    expect(connected.ok).toBe(true)
    expect(connected.status).toEqual(expect.objectContaining({ state: 'connected', toolCount: 1, serverName: 'Demo MCP' }))
    expect(store.getSnapshot().mcpServers[0].enabled).toBe(true)
    const tool = manager.listAgentTools()[0]
    expect(tool.name).toMatch(/^mcp__[A-Za-z0-9_-]+$/)
    expect(tool.name.length).toBeLessThanOrEqual(64)
    expect(tool.definition).toEqual(expect.objectContaining({ type: 'function' }))

    const result = await manager.callTool(tool.name, { path: 'README.md' })

    expect(callTool).toHaveBeenCalledWith('read_document', { path: 'README.md' }, undefined)
    expect(result).toEqual({ ok: true, content: '读取成功', summary: '演示服务器 · read_document 完成' })

    const disconnected = await manager.disconnect('demo-server')
    expect(disconnected.ok).toBe(true)
    expect(close).toHaveBeenCalledOnce()
    expect(store.getSnapshot().mcpServers[0].enabled).toBe(false)
    expect(manager.listAgentTools()).toEqual([])
  })

  it('连接失败会保留配置并返回可见错误状态', async () => {
    const factory: McpConnectionFactory = vi.fn(async () => { throw new Error('server unavailable') })
    store.upsertMcpServer(config())
    const manager = new McpManager(store, factory)

    const result = await manager.connect('demo-server')

    expect(result.ok).toBe(false)
    expect(result.message).toContain('server unavailable')
    expect(manager.listStatuses()[0].state).toBe('error')
    expect(store.getSnapshot().mcpServers).toHaveLength(1)
  })

  it('应用启动时只恢复已启用的服务器', async () => {
    const factory = vi.fn(async (): Promise<McpConnection> => ({
      listTools: async () => [], callTool: async () => ({}), serverInfo: () => ({}), close: async () => undefined
    }))
    store.upsertMcpServer(config({ id: 'enabled', enabled: true }))
    store.upsertMcpServer(config({ id: 'disabled', enabled: false }))
    const manager = new McpManager(store, factory)

    await manager.initialize()

    expect(factory).toHaveBeenCalledOnce()
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ id: 'enabled' }))
  })

  it('可通过真实 stdio 传输发现并调用 MCP 工具', async () => {
    const fixture = join(process.cwd(), 'tests', 'fixtures', 'mcp-stdio-server.mjs')
    store.upsertMcpServer(config({ command: process.execPath, args: [fixture] }))
    const manager = new McpManager(store)

    const connected = await manager.connect('demo-server')
    expect(connected).toEqual(expect.objectContaining({ ok: true, status: expect.objectContaining({ toolCount: 1, serverName: 'deepdesk-test-mcp' }) }))

    const tool = manager.listAgentTools()[0]
    expect(tool.toolName).toBe('echo')
    expect(tool.annotations).toEqual(expect.objectContaining({ readOnlyHint: true, destructiveHint: false }))
    await expect(manager.callTool(tool.name, { text: 'hello' })).resolves.toEqual({
      ok: true,
      content: 'echo:hello',
      summary: '演示服务器 · echo 完成'
    })

    await manager.closeAll()
  })
})

describe('MCP tool helpers', () => {
  it('工具名经过清理后仍稳定且不会冲突', () => {
    const first = createMcpAgentToolName('中文 服务器', '搜索/文档')
    const again = createMcpAgentToolName('中文 服务器', '搜索/文档')
    const other = createMcpAgentToolName('中文 服务器', '搜索 文档 2')
    expect(first).toBe(again)
    expect(first).not.toBe(other)
    expect(first).toMatch(/^mcp__[A-Za-z0-9_-]+$/)
  })

  it('二进制内容只暴露摘要并保留结构化结果', () => {
    const result = formatMcpToolResult({
      content: [{ type: 'image', mimeType: 'image/png', data: 'base64-data' }],
      structuredContent: { count: 2 }
    }, '图像服务', 'capture')
    expect(result.ok).toBe(true)
    expect(result.content).toContain('[图片：image/png]')
    expect(result.content).toContain('"count": 2')
    expect(result.content).not.toContain('base64-data')
  })
})
