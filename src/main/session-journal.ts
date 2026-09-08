import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { AgentSession } from '../shared/agent-types'
import type { Conversation } from '../shared/types'
import type { SecretCodec } from './secret-storage'
import { atomicWrite, SessionObjects, storageKey, type JsonValue } from './session-objects'
import { clearSessionFiles } from './session-purge'

type Session = AgentSession | Conversation
type Kind = 'agent' | 'chat'
type Document = Record<string, JsonValue>
interface Delta { set: Document; remove: string[]; arrays: Record<string, { from: number; items: JsonValue[] }> }
interface RecordBody { version: 1; kind: Kind; id: string; seq: number; previous: string; delta: Delta | null; deletedAt?: number }
interface JournalRecord extends RecordBody { hash: string }
interface Entry { kind: Kind; id: string; seq: number; hash: string; value: Document | null; deletedAt?: number }

function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function diff(previous: Document, next: Document): Delta {
  const delta: Delta = { set: {}, remove: Object.keys(previous).filter(key => !(key in next)), arrays: {} }
  for (const [key, value] of Object.entries(next)) {
    if (JSON.stringify(previous[key]) === JSON.stringify(value)) continue
    if (Array.isArray(value)) {
      const old = Array.isArray(previous[key]) ? previous[key] : []
      let from = 0
      while (from < old.length && from < value.length && JSON.stringify(old[from]) === JSON.stringify(value[from])) from++
      delta.arrays[key] = { from, items: value.slice(from) }
    } else delta.set[key] = value
  }
  return delta
}
function apply(previous: Document, delta: Delta): Document {
  const next = { ...previous, ...delta.set }
  for (const key of delta.remove) delete next[key]
  for (const [key, change] of Object.entries(delta.arrays)) {
    const old = Array.isArray(previous[key]) ? previous[key] : []
    if (!Number.isSafeInteger(change.from) || change.from < 0 || change.from > old.length || !Array.isArray(change.items)) throw new Error('无效的会话增量')
    Object.defineProperty(next, key, { value: [...old.slice(0, change.from), ...change.items], enumerable: true, configurable: true, writable: true })
  }
  return next
}

/** Journals are authoritative; index and snapshots can always be rebuilt. */
export class SessionJournal {
  readonly objects: SessionObjects
  private entries = new Map<string, Entry>()
  private queue: Promise<void> = Promise.resolve()
  private failure: unknown
  private root: string

  constructor(directory: string, private readonly secrets: SecretCodec) {
    this.root = path.join(directory, 'sessions')
    this.objects = new SessionObjects(this.root)
  }

  async load(): Promise<{ agentSessions: AgentSession[]; conversations: Conversation[] }> {
    await fs.mkdir(this.root, { recursive: true })
    const result: { agentSessions: AgentSession[]; conversations: Conversation[] } = { agentSessions: [], conversations: [] }
    for (const directory of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!directory.isDirectory() || !/^[a-f0-9]{64}$/.test(directory.name)) continue
      const key = directory.name
      const entry = await this.replay(key)
      if (!entry) continue
      this.entries.set(key, entry)
      if (!entry.value) continue
      const decoded = await this.objects.decode(key, entry.value)
      const session = JSON.parse(JSON.stringify(decoded)) as Session
      if (session.id !== entry.id) throw new Error('会话标识校验失败')
      if (entry.kind === 'agent') {
        if (!('steps' in session) || !Array.isArray(session.steps) || !Array.isArray(session.history)) throw new Error('Agent 会话数据无效')
        this.mapSecret(session, 'reveal')
        result.agentSessions.push(session)
      } else {
        if (!('messages' in session) || !Array.isArray(session.messages)) throw new Error('聊天会话数据无效')
        result.conversations.push(session)
      }
    }
    return result
  }

  private async replay(key: string): Promise<Entry | null> {
    let markerText: string | undefined
    try { markerText = await fs.readFile(path.join(this.root, key, 'purge.json'), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (markerText !== undefined) {
      const marker = JSON.parse(markerText) as JournalRecord
      const { hash, ...body } = marker
      if (body.version !== 1 || !['agent', 'chat'].includes(body.kind) || storageKey(body.kind, body.id) !== key || body.delta !== null || body.seq !== 1 || body.previous !== '' || digest(body) !== hash) throw new Error('永久删除记录校验失败')
      await this.objects.revoke(key)
      await clearSessionFiles(this.root, key, JSON.stringify(marker))
      return { kind: body.kind, id: body.id, seq: 1, hash, value: null, deletedAt: body.deletedAt }
    }
    const file = path.join(this.root, key, 'events.jsonl')
    let bytes: Buffer
    try { bytes = await fs.readFile(file) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    const end = bytes.lastIndexOf(10) + 1
    const lines = bytes.subarray(0, end).toString('utf8').split('\n').filter(Boolean)
    const records: JournalRecord[] = []
    let previousHash = ''
    for (const line of lines) {
      const { hash, ...body } = JSON.parse(line) as JournalRecord
      if (body.version !== 1 || !['agent', 'chat'].includes(body.kind) || storageKey(body.kind, body.id) !== key ||
        body.seq !== records.length + 1 || body.previous !== previousHash || digest(body) !== hash) {
        throw new Error(`会话日志损坏，已停止加载以保护原始数据：${key}`)
      }
      previousHash = hash
      records.push({ ...body, hash })
    }
    let entry: Entry = { kind: 'agent', id: '', seq: 0, hash: '', value: null }
    try {
      const snapshot = JSON.parse(await fs.readFile(path.join(this.root, key, 'snapshot.json'), 'utf8')) as Entry & { valueHash: string }
      if (Number.isSafeInteger(snapshot.seq) && snapshot.seq > 0 && records[snapshot.seq - 1]?.hash === snapshot.hash &&
        storageKey(snapshot.kind, snapshot.id) === key && digest(snapshot.value) === snapshot.valueHash) entry = snapshot
    } catch { /* Missing/corrupt snapshot: replay the authoritative journal. */ }
    for (const record of records.slice(entry.seq)) {
      const value = record.delta ? apply(entry.value ?? {}, record.delta) : null
      entry = { kind: record.kind, id: record.id, seq: record.seq, hash: record.hash, value }
    }
    if (end < bytes.length) {
      // Preserve the torn tail before removing it; never skip corruption in committed records.
      await fs.copyFile(file, `${file}.recovery-${Date.now()}`)
      await fs.truncate(file, end)
    }
    return entry.seq ? entry : null
  }

  private mapSecret(session: Session, direction: 'protect' | 'reveal'): void {
    if ('steps' in session && session.source?.type === 'connector' && session.source.externalReplyToken) {
      session.source.externalReplyToken = this.secrets[direction](session.source.externalReplyToken)
    }
  }

  upsert(kind: Kind, input: Session): void {
    const session = structuredClone(input)
    this.mapSecret(session, 'protect')
    this.enqueue(async () => {
      const key = storageKey(kind, session.id)
      if (this.isDeleted(kind, session.id)) return
      const value = await this.objects.encode(key, JSON.parse(JSON.stringify(session)) as JsonValue) as Document
      const previous = this.entries.get(key)
      const delta = diff(previous?.value ?? {}, value)
      if (previous?.value && !Object.keys(delta.set).length && !Object.keys(delta.arrays).length && !delta.remove.length) return
      await this.append(key, kind, session.id, delta)
    })
  }

  delete(kind: Kind, id: string): void {
    this.enqueue(async () => {
      const key = storageKey(kind, id)
      if (this.entries.get(key)?.value) await this.append(key, kind, id, null)
    })
  }

  purge(kind: Kind, id: string): void {
    this.enqueue(async () => {
      const key = storageKey(kind, id)
      if (!this.entries.get(key)?.value?.archivedAt) throw new Error('只能清理已归档会话')
      const body: RecordBody = { version: 1, kind, id, seq: 1, previous: '', delta: null, deletedAt: Math.max(Date.now(), Number(this.entries.get(key)?.value?.updatedAt ?? 0)) }
      const hash = digest(body)
      const record = JSON.stringify({ ...body, hash })
      await atomicWrite(path.join(this.root, key, 'purge.json'), record)
      this.entries.set(key, { kind, id, seq: 1, hash, value: null, deletedAt: body.deletedAt })
      await this.objects.revoke(key)
      await clearSessionFiles(this.root, key, record)
    })
  }

  private enqueue(operation: () => Promise<void>): void {
    this.queue = this.queue.then(async () => {
      if (this.failure) return
      try { await operation() } catch (error) {
        this.failure = error
        console.error('[sessions] 会话持久化失败，保留日志等待恢复', error)
      }
    })
  }

  private async append(key: string, kind: Kind, id: string, delta: Delta | null): Promise<void> {
    const previous = this.entries.get(key)
    const body: RecordBody = { version: 1, kind, id, seq: (previous?.seq ?? 0) + 1, previous: previous?.hash ?? '', delta }
    const hash = digest(body)
    const directory = path.join(this.root, key)
    await fs.mkdir(directory, { recursive: true })
    const handle = await fs.open(path.join(directory, 'events.jsonl'), 'a', 0o600)
    try { await handle.writeFile(JSON.stringify({ ...body, hash }) + '\n', 'utf8'); await handle.sync() } finally { await handle.close() }
    const entry: Entry = { kind, id, seq: body.seq, hash, value: delta ? apply(previous?.value ?? {}, delta) : null }
    this.entries.set(key, entry)
    if (entry.seq === 1 || entry.seq % 64 === 0 || !delta) await atomicWrite(path.join(directory, 'snapshot.json'), JSON.stringify({ ...entry, valueHash: digest(entry.value) }))
  }

  has(kind: Kind, id: string): boolean { return this.entries.has(storageKey(kind, id)) }
  isDeleted(kind: Kind, id: string): boolean { return this.entries.get(storageKey(kind, id))?.value === null }

  lastThreadDeletion(baseId: string): number {
    const prefix = `thread:${baseId.length}:${baseId}:`
    let deletedAt = 0
    for (const entry of this.entries.values()) {
      if (entry.kind === 'agent' && (entry.id === baseId || entry.id.startsWith(prefix))) deletedAt = Math.max(deletedAt, entry.deletedAt ?? 0)
    }
    return deletedAt
  }

  async flush(): Promise<void> {
    const pending = this.queue
    await pending
    if (this.failure) throw this.failure
    if (pending !== this.queue) return this.flush()
    const entries = [...this.entries.entries()].filter(([, entry]) => entry.value).map(([key, entry]) => ({
      key, kind: entry.kind, id: entry.id, seq: entry.seq, title: entry.value?.task ?? entry.value?.title,
      createdAt: entry.value?.createdAt, updatedAt: entry.value?.updatedAt,
      archivedAt: entry.value?.archivedAt,
      providerId: entry.value?.providerId, modelId: entry.value?.modelId
    }))
    await atomicWrite(path.join(this.root, 'index.json'), JSON.stringify({ version: 1, entries }))
  }
}
