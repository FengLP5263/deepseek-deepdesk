import type { AgentInteractionMode, AgentToolCall } from '../shared/agent-types'
import type { McpAgentTool } from './mcp'
import { isReadOnlyCommand } from './tools'

const PLAN_SAFE_TOOLS = new Set([
  'run_command',
  'read_file',
  'list_files',
  'search_content',
  'search_feishu_user',
  'browser_pages',
  'browser_snapshot',
  'browser_debug'
])

const PARALLEL_SAFE_TOOLS = new Set([
  'read_file',
  'list_files',
  'search_content',
  'search_feishu_user'
])

function definitionName(definition: Record<string, unknown>): string {
  const fn = definition.function
  if (!fn || typeof fn !== 'object' || Array.isArray(fn)) return ''
  const name = (fn as Record<string, unknown>).name
  return typeof name === 'string' ? name : ''
}

function isReadOnlyMcpTool(tool: McpAgentTool | undefined): boolean {
  return tool?.annotations?.readOnlyHint === true && tool.annotations.destructiveHint !== true
}

export function isAgentToolAllowedInMode(call: AgentToolCall, mode: AgentInteractionMode, mcpTools: McpAgentTool[]): boolean {
  if (mode === 'execute') return true
  if (call.name === 'run_command') return isReadOnlyCommand(String(call.args.command ?? ''))
  if (call.name.startsWith('mcp__')) return isReadOnlyMcpTool(mcpTools.find(tool => tool.name === call.name))
  return PLAN_SAFE_TOOLS.has(call.name)
}

export function selectAgentToolsForMode(
  baseTools: Array<Record<string, unknown>>,
  mcpTools: McpAgentTool[],
  mode: AgentInteractionMode
): Array<Record<string, unknown>> {
  if (mode === 'execute') return [...baseTools, ...mcpTools.map(tool => tool.definition)]
  return [
    ...baseTools.filter(tool => PLAN_SAFE_TOOLS.has(definitionName(tool))),
    ...mcpTools.filter(isReadOnlyMcpTool).map(tool => tool.definition)
  ]
}

export function canRunAgentToolInParallel(call: AgentToolCall, mcpTools: McpAgentTool[]): boolean {
  if (call.name === 'run_command') return isReadOnlyCommand(String(call.args.command ?? ''))
  if (call.name.startsWith('mcp__')) return isReadOnlyMcpTool(mcpTools.find(tool => tool.name === call.name))
  return PARALLEL_SAFE_TOOLS.has(call.name)
}

export function blockedPlanToolResult(call: AgentToolCall) {
  const label = call.name === 'run_command' ? String(call.args.command ?? call.name) : call.name
  return {
    ok: false,
    content: `规划模式禁止执行可能修改状态的操作：${label}`,
    summary: '规划模式已阻止写入操作'
  }
}
