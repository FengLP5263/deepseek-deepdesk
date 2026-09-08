import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { MAX_MCP_JSON_BYTES, parseMcpJson } from '../shared/mcp-json'
import type { AppStore } from './store'

export async function readMcpJsonFile(file: string): Promise<string> {
  const handle = await fs.open(file, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > MAX_MCP_JSON_BYTES) throw new Error('请选择不超过 256 KB 的 JSON 文件')
    const buffer = Buffer.alloc(MAX_MCP_JSON_BYTES + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset > MAX_MCP_JSON_BYTES) throw new Error('JSON 文件不能超过 256 KB')
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset)) }
    catch { throw new Error('请将 JSON 文件保存为 UTF-8 编码') }
  } finally { await handle.close() }
}

export async function importMcpJson(store: AppStore, text: string): Promise<number> {
  const configs = parseMcpJson(text)
  const existing = new Set(store.getSnapshot().mcpServers.map(server => server.name.trim().toLocaleLowerCase()))
  if (configs.some(config => existing.has(config.name.toLocaleLowerCase()))) throw new Error('存在同名 MCP 服务器，请在 JSON 中更名后重新导入；已有配置未修改')
  const now = Date.now()
  // All entries are validated before the first write. Imported commands are never executed here.
  store.addMcpServers(configs.map(config => ({ ...config, id: `mcp-${randomUUID()}`, createdAt: now, updatedAt: now })))
  await store.flush()
  return configs.length
}
