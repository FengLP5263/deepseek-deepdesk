import { z } from 'zod'
import type { McpServerConfig } from './types'

export const MAX_MCP_JSON_BYTES = 256 * 1024
export type McpImportConfig = Omit<McpServerConfig, 'id' | 'createdAt' | 'updatedAt'>
const strings = z.record(z.string())
const serverSchema = z.object({
  type: z.enum(['stdio', 'http', 'streamable-http']).optional(),
  transport: z.enum(['stdio', 'http', 'streamable-http']).optional(),
  command: z.string().optional(), args: z.array(z.string()).max(256).optional(),
  env: strings.optional(), cwd: z.string().optional(), url: z.string().optional(),
  token: z.string().optional(), headers: strings.optional(),
  enabled: z.boolean().optional(), disabled: z.boolean().optional()
}).strict()

/** JSON.parse accepts duplicate keys; reject them before any configuration is persisted. */
function checkDuplicateKeys(text: string): void {
  const scopes: Array<Set<string> | null> = []
  for (let i = 0; i < text.length; i++) {
    const character = text[i]
    if (character === '{') scopes.push(new Set())
    else if (character === '[') scopes.push(null)
    else if (character === '}' || character === ']') scopes.pop()
    else if (character === '"') {
      const start = i++
      while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; i++ }
      let after = i + 1
      while (/\s/u.test(text[after] ?? '') && after < text.length) after++
      if (text[after] === ':') {
        const key = JSON.parse(text.slice(start, i + 1)) as string
        const scope = scopes.at(-1)
        if (scope?.has(key)) throw new Error('JSON 中存在重复的字段或服务器名称，请移除重复项')
        scope?.add(key)
      }
    }
  }
}

function checkValues(value: unknown, depth = 0): void {
  if (depth > 8) throw new Error('配置嵌套层级过多')
  if (typeof value === 'string' && (/\$\{[^}]*\}/u.test(value) || value.includes('\0'))) throw new Error('请替换配置中的变量占位符，并移除空字符后再导入')
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('配置中包含不支持的保留字段名')
      checkValues(child, depth + 1)
    }
  }
}

export function parseMcpJson(text: string): McpImportConfig[] {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_MCP_JSON_BYTES) throw new Error('JSON 配置不能超过 256 KB')
  const clean = text.replace(/^\uFEFF/u, '').trim()
  let parsed: unknown
  try { parsed = JSON.parse(clean) } catch { throw new Error('JSON 格式不正确：请检查双引号、逗号和括号；不支持注释或尾随逗号') }
  checkDuplicateKeys(clean)
  const root = z.object({ mcpServers: z.record(z.unknown()).optional(), servers: z.record(z.unknown()).optional() }).strict().safeParse(parsed)
  if (!root.success || Boolean(root.data.mcpServers) === Boolean(root.data.servers)) throw new Error('顶层必须包含且只包含 mcpServers 或 servers 对象')
  const entries = Object.entries(root.data.mcpServers ?? root.data.servers ?? {})
  if (!entries.length || entries.length > 50) throw new Error('一次需要导入 1 至 50 个 MCP 服务器')
  const names = new Set<string>()
  return entries.map(([name, value]) => {
    const trimmed = name.trim()
    if (!trimmed || trimmed.length > 100 || names.has(trimmed.toLocaleLowerCase())) throw new Error('服务器名称不能为空、超过 100 字符或重复')
    names.add(trimmed.toLocaleLowerCase())
    checkValues({ [name]: value })
    const result = serverSchema.safeParse(value)
    if (!result.success) throw new Error(`服务器“${trimmed}”字段无效：${result.error.issues.map(issue => issue.path.join('.') || '配置对象').join('、')}。请使用支持的字段及类型`)
    const config = result.data
    if (config.type && config.transport && config.type !== config.transport) throw new Error(`服务器“${trimmed}”的 type 与 transport 不一致`)
    const type = config.type ?? config.transport ?? (config.command !== undefined ? 'stdio' : 'http')
    const stdio = type === 'stdio'
    if (stdio) {
      if (!config.command?.trim() || config.url !== undefined || config.headers !== undefined || config.token !== undefined) throw new Error(`服务器“${trimmed}”需要 command，且不能混用远程连接字段`)
    } else {
      if (config.command !== undefined || config.args !== undefined || config.env !== undefined || config.cwd !== undefined) throw new Error(`服务器“${trimmed}”不能混用本地启动字段`)
      let url: URL
      try { url = new URL(config.url ?? '') } catch { throw new Error(`服务器“${trimmed}”需要有效的 HTTP(S) URL`) }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error(`服务器“${trimmed}”的地址仅支持 HTTP(S)，不能包含用户名、密码或片段`)
      if (Object.entries(config.headers ?? {}).some(([key, value]) => !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(key) || /[\r\n]/u.test(value))) throw new Error(`服务器“${trimmed}”的请求头格式不正确`)
    }
    return { name: trimmed, transport: stdio ? 'stdio' : 'http', enabled: false,
      command: config.command?.trim() ?? '', args: config.args ?? [], env: config.env ?? {}, cwd: config.cwd?.trim() ?? '',
      url: config.url?.trim() ?? '', token: config.token ?? '', headers: config.headers ?? {} }
  })
}
