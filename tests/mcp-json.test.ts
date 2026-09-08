import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
vi.mock('electron', () => ({ app: { getPath: () => '' } }))
import { AppStore } from '../src/main/store'
import { parseMcpJson, MAX_MCP_JSON_BYTES } from '../src/shared/mcp-json'
import { importMcpJson, readMcpJsonFile } from '../src/main/mcp-json'

let dir: string
const stores: AppStore[] = []
const json = (server: unknown) => JSON.stringify({ mcpServers: { example: server } })
beforeEach(async () => { dir = await fs.mkdtemp(path.join(tmpdir(), 'deepdesk-mcp-json-')) })
afterEach(async () => { await Promise.allSettled(stores.splice(0).map(store => store.flush())); await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }) })

describe('MCP JSON validation', () => {
  it('normalizes both root formats and saves as disabled regardless of imported enabled flags', () => {
    expect(parseMcpJson('\uFEFF' + json({ command: 'node', args: ['server.js'], env: { TOKEN: 'secret' }, enabled: true }))[0]).toMatchObject({ name: 'example', transport: 'stdio', enabled: false, args: ['server.js'], env: { TOKEN: 'secret' } })
    expect(parseMcpJson(JSON.stringify({ servers: { remote: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer secret' } } } }))[0]).toMatchObject({ transport: 'http', enabled: false, headers: { Authorization: 'Bearer secret' } })
  })
  it.each(['', '{broken', '{"mcpServers":{},}', '[]', '{}', '{"mcpServers":{}}', '{"mcpServers":{},"servers":{}}', '{"mcpServers":{"x":{"command":"node","command":"sh"}}}', '{"mcpServers":{"x":{"command":"node"},"x":{"command":"sh"}}}'])('rejects invalid JSON or duplicate keys without echoing contents: %s', raw => {
    expect(() => parseMcpJson(raw)).toThrow()
  })
  it.each([
    { command: 1 }, { command: 'node', args: 'server.js' }, { command: 'node', env: { KEY: 1 } },
    { command: 'node', url: 'https://example.com' }, { command: 'node', unknown: true }, { command: '${input:command}' },
    { type: 'sse', url: 'https://example.com' }, { url: 'file:///tmp/a' }, { url: 'https://name:password@example.com' },
    { url: 'https://example.com#fragment' }, { url: 'https://example.com', headers: { Authorization: 'ok\r\nInjected: header' } },
    { command: 'node', type: 'stdio', transport: 'http' }, { command: 'node', enabled: 'true' }
  ])('rejects unsupported or unsafe config %#', config => { expect(() => parseMcpJson(json(config))).toThrow() })
  it('bounds input size and number of servers and rejects trimmed/case duplicate names', () => {
    expect(() => parseMcpJson(' '.repeat(MAX_MCP_JSON_BYTES + 1))).toThrow('256 KB')
    expect(() => parseMcpJson(JSON.stringify({ mcpServers: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`s${i}`, { command: 'node' }])) }))).toThrow('50')
    expect(() => parseMcpJson('{"mcpServers":{" A ":{"command":"node"},"a":{"command":"node"}}}')).toThrow('重复')
    expect(() => parseMcpJson('{"mcpServers":{"x":{"command":"node","env":{"__proto__":"x"}}}}')).toThrow('保留')
  })
  it('reads UTF-8 files, rejects invalid encoding, directories and oversized files', async () => {
    const file = path.join(dir, 'config.json')
    await fs.writeFile(file, json({ command: 'node' }))
    expect(await readMcpJsonFile(file)).toContain('mcpServers')
    await fs.writeFile(file, Buffer.from([0xff, 0xfe]))
    await expect(readMcpJsonFile(file)).rejects.toThrow('UTF-8')
    await fs.writeFile(file, ' '.repeat(MAX_MCP_JSON_BYTES + 1))
    await expect(readMcpJsonFile(file)).rejects.toThrow('256 KB')
    await expect(readMcpJsonFile(dir)).rejects.toThrow()
  })
  it('validates the whole batch before writing, preserves duplicate configs and persists without executing', async () => {
    const store = new AppStore(dir); stores.push(store); await store.init()
    await expect(importMcpJson(store, '{"mcpServers":{"valid":{"command":"node"},"invalid":{"command":3}}}')).rejects.toThrow()
    expect(store.getSnapshot().mcpServers).toHaveLength(0)
    expect(await importMcpJson(store, json({ command: 'nonexistent-command-no-execution', enabled: true }))).toBe(1)
    await expect(importMcpJson(store, json({ command: 'changed' }))).rejects.toThrow('同名')
    const reopened = new AppStore(dir); stores.push(reopened); await reopened.init()
    expect(reopened.getSnapshot().mcpServers).toHaveLength(1)
    expect(reopened.getSnapshot().mcpServers[0]).toMatchObject({ command: 'nonexistent-command-no-execution', enabled: false })
  })
})
