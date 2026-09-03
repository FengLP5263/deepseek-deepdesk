import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { AgentToolResult, McpInstallApproval } from '../shared/agent-types'
import type { McpServerConfig, McpServerStatus } from '../shared/types'

export const MCP_INSTALL_CANDIDATE_TTL_MS = 10 * 60 * 1000

export interface McpInstallCandidate extends McpInstallApproval {
  runId: string
  config: McpServerConfig
  expiresAt: number
}

export interface StdioInstallInspection {
  result: AgentToolResult
  candidate?: McpInstallCandidate
}

function optionalString(value: unknown, label: string, maxLength: number): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw new Error(`${label}格式无效`)
  const text = value.trim()
  if (text.length > maxLength || text.includes('\0')) throw new Error(`${label}过长或包含无效字符`)
  return text
}

function stringArgs(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 64) throw new Error('命令参数格式无效')
  return value.map(item => {
    if (typeof item !== 'string' || item.length > 4096 || item.includes('\0')) throw new Error('命令参数格式无效')
    return item
  })
}

function commandPreview(command: string, args: string[]): string {
  return [command, ...args].map(part => /\s|"/.test(part) ? `"${part.replaceAll('"', '\\"')}"` : part).join(' ')
}

function sameStdioConfig(left: McpServerConfig, right: McpServerConfig): boolean {
  return left.transport === 'stdio'
    && left.command.trim() === right.command.trim()
    && left.cwd.trim() === right.cwd.trim()
    && JSON.stringify(left.args) === JSON.stringify(right.args)
}

export function inspectStdioInstall(input: Record<string, unknown>, runId: string, statuses: McpServerStatus[], now = Date.now()): StdioInstallInspection {
  try {
    const command = optionalString(input.command, '启动命令', 1024)
    if (!command) throw new Error('请提供本地 MCP 的启动命令')
    const args = stringArgs(input.args)
    const cwd = optionalString(input.cwd, '工作目录', 2048)
    const name = optionalString(input.name, '服务器名称', 80) || `${basename(command)} MCP`
    const source = commandPreview(command, args)
    const proposed: McpServerConfig = {
      id: `mcp-${randomUUID()}`, name, transport: 'stdio', enabled: true,
      command, args, env: {}, cwd, url: '', token: '', headers: {}, createdAt: now, updatedAt: now
    }
    const existing = statuses.find(status => sameStdioConfig(status.config, proposed))
    if (existing?.state === 'connected') {
      return { result: { ok: true, content: JSON.stringify({ status: 'already_installed', name: existing.config.name, source, tools: existing.tools.map(tool => tool.name), message: '该 MCP 服务已经安装并连接，无需重复安装。' }), summary: `${existing.config.name} 已安装` } }
    }
    const candidateId = randomUUID()
    const config = existing ? { ...proposed, id: existing.config.id, createdAt: existing.config.createdAt } : proposed
    const candidate: McpInstallCandidate = {
      candidateId, runId, name: config.name, source, transport: 'stdio', command, args: [...args], cwd,
      toolNames: [], config, expiresAt: now + MCP_INSTALL_CANDIDATE_TTL_MS
    }
    return {
      candidate,
      result: {
        ok: true,
        content: JSON.stringify({ status: 'ready_to_install', candidate_id: candidateId, expires_at: new Date(candidate.expiresAt).toISOString(), name: config.name, transport: 'stdio', command, args, cwd, tools: [], next_action: '调用 install_mcp_server，并等待用户确认；批准后 DeepDesk 才会启动进程并发现工具。' }),
        summary: `已准备安装 ${config.name}`
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { result: { ok: false, content: `${message}。请提供精确的 command 和 args；包含 Token 或环境变量时请改用“设置 → MCP”安全配置。`, summary: '本地 MCP 配置无效' } }
  }
}
