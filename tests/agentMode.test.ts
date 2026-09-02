import { describe, expect, it } from 'vitest'
import type { AgentToolCall } from '../src/shared/agent-types'
import type { McpAgentTool } from '../src/main/mcp'
import { blockedPlanToolResult, canRunAgentToolInParallel, isAgentToolAllowedInMode, selectAgentToolsForMode } from '../src/main/agent-mode'

function definition(name: string): Record<string, unknown> {
  return { type: 'function', function: { name, parameters: { type: 'object', properties: {} } } }
}

function mcpTool(name: McpAgentTool['name'], readOnly: boolean): McpAgentTool {
  return {
    name,
    definition: definition(name),
    serverId: 'server',
    serverName: 'Server',
    toolName: name,
    annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly }
  }
}

describe('agent-mode', () => {
  const readMcp = mcpTool('mcp__server__read__11111111', true)
  const writeMcp = mcpTool('mcp__server__write__22222222', false)

  it('规划模式只向模型暴露只读内置工具和只读 MCP 工具', () => {
    const selected = selectAgentToolsForMode([
      definition('read_file'),
      definition('write_file'),
      definition('browser_snapshot'),
      definition('browser_click')
    ], [readMcp, writeMcp], 'plan')
    const names = selected.map(tool => (tool.function as { name: string }).name)

    expect(names).toEqual(['read_file', 'browser_snapshot', readMcp.name])
  })

  it('规划模式运行时再次拦截写命令、写文件和交互式浏览器操作', () => {
    const call = (name: AgentToolCall['name'], args: Record<string, unknown> = {}): AgentToolCall => ({ id: name, name, args })

    expect(isAgentToolAllowedInMode(call('run_command', { command: 'git status' }), 'plan', [])).toBe(true)
    expect(isAgentToolAllowedInMode(call('run_command', { command: 'git commit -am test' }), 'plan', [])).toBe(false)
    expect(isAgentToolAllowedInMode(call('read_file', { path: 'README.md' }), 'plan', [])).toBe(true)
    expect(isAgentToolAllowedInMode(call('write_file', { path: 'x', content: 'x' }), 'plan', [])).toBe(false)
    expect(isAgentToolAllowedInMode(call('browser_click', { selector: '#submit' }), 'plan', [])).toBe(false)
    expect(isAgentToolAllowedInMode(call(readMcp.name), 'plan', [readMcp, writeMcp])).toBe(true)
    expect(isAgentToolAllowedInMode(call(writeMcp.name), 'plan', [readMcp, writeMcp])).toBe(false)
    expect(blockedPlanToolResult(call('write_file')).summary).toContain('已阻止')
  })

  it('执行模式保留全部工具', () => {
    const selected = selectAgentToolsForMode([definition('read_file'), definition('write_file')], [readMcp, writeMcp], 'execute')
    expect(selected).toHaveLength(4)
  })

  it('只有无副作用的读取工具允许并行调度', () => {
    const call = (name: AgentToolCall['name'], args: Record<string, unknown> = {}): AgentToolCall => ({ id: name, name, args })

    expect(canRunAgentToolInParallel(call('read_file'), [])).toBe(true)
    expect(canRunAgentToolInParallel(call('run_command', { command: 'git status' }), [])).toBe(true)
    expect(canRunAgentToolInParallel(call('run_command', { command: 'pnpm test' }), [])).toBe(false)
    expect(canRunAgentToolInParallel(call('browser_snapshot'), [])).toBe(false)
    expect(canRunAgentToolInParallel(call('write_file'), [])).toBe(false)
    expect(canRunAgentToolInParallel(call(readMcp.name), [readMcp, writeMcp])).toBe(true)
    expect(canRunAgentToolInParallel(call(writeMcp.name), [readMcp, writeMcp])).toBe(false)
  })
})
