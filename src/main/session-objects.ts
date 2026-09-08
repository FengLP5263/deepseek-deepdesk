import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { renameWithRetry } from './json-file-store'

export const OBJECT_THRESHOLD = 16_000
const REFERENCE = '@deepdesk-object:v1:'
const LITERAL = '@deepdesk-literal:v1:'
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export function storageKey(kind: string, id: string): string {
  return createHash('sha256').update(JSON.stringify([kind, id])).digest('hex')
}

export async function atomicWrite(file: string, content: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`
  const handle = await fs.open(temporary, 'w', 0o600)
  try { await handle.writeFile(content, 'utf8'); await handle.sync() } finally { await handle.close() }
  await renameWithRetry(temporary, file)
}

/** Content-addressed objects are scoped to a session, never arbitrary filesystem paths. */
export class SessionObjects {
  private verified = new Set<string>()
  constructor(private readonly root: string) {}

  private directory(key: string): string {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('无效的会话存储标识')
    return path.join(this.root, key, 'objects')
  }

  async put(key: string, content: string): Promise<string> {
    const id = createHash('sha256').update(content).digest('hex')
    const directory = this.directory(key)
    if (this.verified.has(`${key}:${id}`)) return id
    await fs.mkdir(directory, { recursive: true })
    const file = path.join(directory, `${id}.txt`)
    try {
      if (await fs.readFile(file, 'utf8') !== content) throw new Error('上下文原文校验失败，请保留本地数据后重试')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await atomicWrite(file, content)
    }
    this.verified.add(`${key}:${id}`)
    return id
  }

  async get(key: string, id: string): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('无效的上下文引用')
    const file = path.join(this.directory(key), `${id}.txt`)
    if (!(await fs.lstat(file)).isFile()) throw new Error('上下文原文不是普通文件')
    const content = await fs.readFile(file, 'utf8')
    if (createHash('sha256').update(content).digest('hex') !== id) throw new Error('上下文原文校验失败')
    this.verified.add(`${key}:${id}`)
    return content
  }

  async read(key: string, id: string, offset = 0, limit = 8000): Promise<{ text: string; offset: number; nextOffset: number; total: number }> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 16_000) {
      throw new Error('读取范围无效：offset 必须非负，limit 必须为 1–16000')
    }
    const content = await this.get(key, id)
    const start = Math.min(offset, content.length)
    return { text: content.slice(start, start + limit), offset: start, nextOffset: Math.min(start + limit, content.length), total: content.length }
  }

  async list(key: string, offset = 0, limit = 20): Promise<{ references: string[]; entries: Array<{ reference: string; preview: string }>; nextOffset: number; total: number }> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('原文目录范围无效：limit 必须为 1–50')
    let files: string[]
    try { files = await fs.readdir(this.directory(key)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { references: [], entries: [], nextOffset: 0, total: 0 }
      throw error
    }
    const references = files.filter(file => /^[a-f0-9]{64}\.txt$/.test(file)).sort().map(file => file.slice(0, -4))
    const selected = references.slice(offset, offset + limit)
    const entries: Array<{ reference: string; preview: string }> = []
    for (const reference of selected) {
      const file = path.join(this.directory(key), `${reference}.txt`)
      if (!(await fs.lstat(file)).isFile()) throw new Error('上下文原文不是普通文件')
      const handle = await fs.open(file, 'r')
      try {
        const buffer = Buffer.alloc(1024)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        entries.push({ reference, preview: buffer.subarray(0, bytesRead).toString('utf8').slice(0, 160) })
      } finally { await handle.close() }
    }
    return { references: selected, entries, nextOffset: Math.min(offset + limit, references.length), total: references.length }
  }

  async encode(key: string, value: JsonValue): Promise<JsonValue> {
    if (typeof value === 'string') {
      if (value.length > OBJECT_THRESHOLD) return REFERENCE + await this.put(key, value)
      return value.startsWith(REFERENCE) || value.startsWith(LITERAL) ? LITERAL + value : value
    }
    if (Array.isArray(value)) {
      const encoded: JsonValue[] = []
      for (const item of value) encoded.push(await this.encode(key, item))
      return encoded
    }
    if (value && typeof value === 'object') {
      const entries: [string, JsonValue][] = []
      for (const [name, item] of Object.entries(value)) entries.push([name, await this.encode(key, item)])
      return Object.fromEntries(entries)
    }
    return value
  }

  async decode(key: string, value: JsonValue): Promise<JsonValue> {
    if (typeof value === 'string') {
      if (value.startsWith(LITERAL)) return value.slice(LITERAL.length)
      return value.startsWith(REFERENCE) ? this.get(key, value.slice(REFERENCE.length)) : value
    }
    if (Array.isArray(value)) return Promise.all(value.map(item => this.decode(key, item)))
    if (value && typeof value === 'object') {
      return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([name, item]) => [name, await this.decode(key, item)])))
    }
    return value
  }
}
