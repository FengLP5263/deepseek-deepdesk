import type { McpAgentTool } from './mcp'

export const MCP_EAGER_TOOL_LIMIT = 16
export const MCP_EAGER_SCHEMA_CHARACTER_LIMIT = 24000
const MAX_RELEVANT_TOOLS = 4
const MAX_SEARCH_RESULTS = 8

function definitionDescription(tool: McpAgentTool): string {
  const fn = tool.definition.function
  if (!fn || typeof fn !== 'object' || Array.isArray(fn)) return ''
  const description = (fn as Record<string, unknown>).description
  return typeof description === 'string' ? description : ''
}

function searchableText(tool: McpAgentTool): string {
  return `${tool.serverName} ${tool.toolName} ${definitionDescription(tool)}`.toLocaleLowerCase()
}

function searchTerms(query: string): string[] {
  const words = query
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(term => term.trim())
    .filter(term => term.length >= 2)
  const terms = new Set(words)
  for (const word of words) {
    const characters = Array.from(word)
    if (!characters.some(character => /[\p{Script=Han}]/u.test(character))) continue
    for (let index = 0; index < characters.length - 1; index += 1) {
      terms.add(characters.slice(index, index + 2).join(''))
    }
  }
  return [...terms]
}

function relevance(tool: McpAgentTool, query: string): number {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return 0
  const haystack = searchableText(tool)
  let score = 0
  if (normalized.includes(tool.toolName.toLocaleLowerCase())) score += 20
  if (normalized.includes(tool.serverName.toLocaleLowerCase())) score += 12
  for (const term of searchTerms(normalized)) {
    if (haystack.includes(term)) score += Math.min(8, term.length)
  }
  return score
}

export function shouldDeferMcpTools(tools: McpAgentTool[]): boolean {
  if (tools.length > MCP_EAGER_TOOL_LIMIT) return true
  return JSON.stringify(tools.map(tool => tool.definition)).length > MCP_EAGER_SCHEMA_CHARACTER_LIMIT
}

export function findMcpTools(tools: McpAgentTool[], query: string, limit = MAX_SEARCH_RESULTS): McpAgentTool[] {
  return tools
    .map((tool, index) => ({ tool, index, score: relevance(tool, query) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(1, limit))
    .map(item => item.tool)
}

export function selectMcpToolsForRequest(tools: McpAgentTool[], discoveredNames: Set<string>, task: string): McpAgentTool[] {
  if (!shouldDeferMcpTools(tools)) return tools
  const selected = new Map<string, McpAgentTool>()
  for (const tool of tools) {
    if (discoveredNames.has(tool.name)) selected.set(tool.name, tool)
  }
  for (const tool of findMcpTools(tools, task, MAX_RELEVANT_TOOLS)) selected.set(tool.name, tool)
  return [...selected.values()]
}

export function revealMcpTools(tools: McpAgentTool[], query: string, discoveredNames: Set<string>): string {
  const matches = findMcpTools(tools, query)
  for (const tool of matches) discoveredNames.add(tool.name)
  if (matches.length === 0) return `没有找到与“${query}”匹配的 MCP 工具。请换用服务名、能力或操作对象重新搜索。`
  const lines = matches.map(tool => {
    const description = definitionDescription(tool)
    return `- ${tool.name} | ${tool.serverName} · ${tool.toolName}${description ? ` | ${description}` : ''}`
  })
  return `找到 ${matches.length} 个 MCP 工具；这些工具将在下一轮模型请求中可用：\n${lines.join('\n')}`
}
