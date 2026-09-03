import { describe, expect, it } from 'vitest'
import type { McpAgentTool } from '../src/main/mcp'
import { findMcpTools, revealMcpTools, selectMcpToolsForRequest, shouldDeferMcpTools } from '../src/main/mcp-tool-catalog'

function tool(index: number, description = `能力 ${index}`): McpAgentTool {
  const name = `mcp__server__tool_${index}__${String(index).padStart(8, '0')}` as McpAgentTool['name']
  return {
    name,
    serverId: 'server',
    serverName: index === 7 ? '文档中心' : '通用服务',
    toolName: index === 7 ? 'search_documents' : `tool_${index}`,
    annotations: { readOnlyHint: true, destructiveHint: false },
    definition: { type: 'function', function: { name, description, parameters: { type: 'object' } } }
  }
}

describe('mcp-tool-catalog', () => {
  it('keeps a small MCP catalog eagerly available', () => {
    const tools = [tool(1), tool(2)]
    expect(shouldDeferMcpTools(tools)).toBe(false)
    expect(selectMcpToolsForRequest(tools, new Set(), '任意任务')).toEqual(tools)
  })

  it('defers a large catalog and exposes only relevant or discovered tools', () => {
    const tools = Array.from({ length: 20 }, (_, index) => tool(index, index === 7 ? '搜索和读取企业文档' : `其他能力 ${index}`))
    const discovered = new Set<string>([tools[3].name])
    const selected = selectMcpToolsForRequest(tools, discovered, '请搜索企业文档')

    expect(shouldDeferMcpTools(tools)).toBe(true)
    expect(selected.map(item => item.name)).toContain(tools[3].name)
    expect(selected.map(item => item.name)).toContain(tools[7].name)
    expect(selected.length).toBeLessThan(tools.length)
  })

  it('searches the deferred catalog and reveals matched schemas for the next turn', () => {
    const tools = Array.from({ length: 20 }, (_, index) => tool(index, index === 7 ? '搜索和读取企业文档' : `其他能力 ${index}`))
    const discovered = new Set<string>()
    const matches = findMcpTools(tools, '文档搜索')
    const result = revealMcpTools(tools, '文档中心', discovered)

    expect(matches[0].name).toBe(tools[7].name)
    expect(discovered.has(tools[7].name)).toBe(true)
    expect(result).toContain(tools[7].name)
    expect(selectMcpToolsForRequest(tools, discovered, '无关请求')).toContainEqual(tools[7])
  })
})
