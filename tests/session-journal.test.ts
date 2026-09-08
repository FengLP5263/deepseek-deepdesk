import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SessionJournal } from '../src/main/session-journal'
import { SessionObjects, storageKey } from '../src/main/session-objects'
import type { AgentSession } from '../src/shared/agent-types'

let dir: string
const codec = { protect: (value: string) => `secret:${Buffer.from(value).toString('base64')}`, reveal: (value: string) => Buffer.from(value.slice(7), 'base64').toString() }
const session = (id = 's'): AgentSession => ({ id, task: '测试', workdir: '', modelId: 'model', createdAt: 1, updatedAt: 1, steps: [{ kind: 'task', text: '你好' }], history: [{ role: 'user', content: '你好' }] })
const journalPath = (id = 's') => path.join(dir, 'sessions', storageKey('agent', id), 'events.jsonl')
beforeEach(async () => { dir = await fs.mkdtemp(path.join(tmpdir(), 'deepdesk-journal-')) })
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }) })

describe('per-session journals', () => {
  it('stores changed tails and rebuilds a corrupt lightweight index', async () => {
    const journal = new SessionJournal(dir, codec)
    await journal.load()
    const value = session()
    journal.upsert('agent', value)
    await journal.flush()
    value.steps.push({ kind: 'text', text: '回答' })
    value.history.push({ role: 'assistant', content: '回答' })
    journal.upsert('agent', value)
    await journal.flush()
    const rows = (await fs.readFile(journalPath(), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    expect(rows).toHaveLength(2)
    expect(rows[1].delta.arrays.steps).toEqual({ from: 1, items: [{ kind: 'text', text: '回答' }] })
    const index = await fs.readFile(path.join(dir, 'sessions/index.json'), 'utf8')
    expect(index).not.toContain('steps')
    expect(index).not.toContain('回答')
    await fs.writeFile(path.join(dir, 'sessions/index.json'), '{broken')
    const restored = new SessionJournal(dir, codec)
    expect((await restored.load()).agentSessions).toEqual([value])
    await restored.flush()
    expect(JSON.parse(await fs.readFile(path.join(dir, 'sessions/index.json'), 'utf8')).entries).toHaveLength(1)
  })

  it('checkpoints periodically and falls back when a snapshot is corrupt', async () => {
    const journal = new SessionJournal(dir, codec)
    await journal.load()
    for (let n = 0; n < 65; n++) journal.upsert('agent', { ...session(), task: String(n) })
    await journal.flush()
    const snapshotPath = path.join(path.dirname(journalPath()), 'snapshot.json')
    expect(JSON.parse(await fs.readFile(snapshotPath, 'utf8')).seq).toBe(64)
    await fs.writeFile(snapshotPath, '{broken')
    expect((await new SessionJournal(dir, codec).load()).agentSessions[0].task).toBe('64')
  })

  it('preserves and discards only the uncommitted tail, then appends valid records', async () => {
    const journal = new SessionJournal(dir, codec)
    await journal.load()
    journal.upsert('agent', session())
    await journal.flush()
    await fs.appendFile(journalPath(), '{"seq":2,"中文":')
    const restored = new SessionJournal(dir, codec)
    expect((await restored.load()).agentSessions).toEqual([session()])
    expect((await fs.readdir(path.dirname(journalPath()))).some(file => file.includes('.recovery-'))).toBe(true)
    restored.upsert('agent', { ...session(), task: '继续' })
    await restored.flush()
    expect((await new SessionJournal(dir, codec).load()).agentSessions[0].task).toBe('继续')
  })

  it('does not skip committed corruption or overwrite the journal', async () => {
    const journal = new SessionJournal(dir, codec)
    await journal.load()
    journal.upsert('agent', session())
    await journal.flush()
    const corrupt = (await fs.readFile(journalPath(), 'utf8')).replace('你好', '篡改')
    await fs.writeFile(journalPath(), corrupt)
    await expect(new SessionJournal(dir, codec).load()).rejects.toThrow('日志损坏')
    expect(await fs.readFile(journalPath(), 'utf8')).toBe(corrupt)
  })

  it('persists tombstones, handles edited/truncated histories and hashes unsafe ids', async () => {
    const id = '../../微信/中文'
    const journal = new SessionJournal(dir, codec)
    await journal.load()
    journal.upsert('agent', session(id))
    journal.upsert('agent', { ...session(id), steps: [], history: [] })
    await journal.flush()
    expect((await new SessionJournal(dir, codec).load()).agentSessions[0].steps).toEqual([])
    journal.delete('agent', id)
    await journal.flush()
    const restored = new SessionJournal(dir, codec)
    expect((await restored.load()).agentSessions).toEqual([])
    expect(restored.has('agent', id)).toBe(true)
    expect((await fs.readdir(path.join(dir, 'sessions'))).filter(name => /^[a-f0-9]{64}$/.test(name))).toHaveLength(1)
  })

  it('offloads large strings, escapes literal markers and encrypts connector reply tokens', async () => {
    const journal = new SessionJournal(dir, codec)
    await journal.load()
    const value: AgentSession = { ...session(), source: { type: 'connector', connectorId: 'wechat', externalThreadId: 'thread', externalReplyToken: 'PRIVATE-REPLY-TOKEN' } }
    const original = '很长的工具结果'.repeat(8000)
    value.steps.push({ kind: 'tool', result: original })
    value.history.push({ role: 'tool', content: '@deepdesk-object:v1:not-a-real-reference' })
    journal.upsert('agent', value)
    await journal.flush()
    const raw = await fs.readFile(journalPath(), 'utf8')
    expect(raw.length).toBeLessThan(3000)
    expect(raw).not.toContain(original)
    expect(raw).not.toContain('PRIVATE-REPLY-TOKEN')
    expect((await new SessionJournal(dir, codec).load()).agentSessions).toEqual([value])
  })

  it('rejects flush on disk failure instead of reporting success', async () => {
    const journal = new SessionJournal(dir, codec)
    await journal.load()
    vi.spyOn(fs, 'open').mockRejectedValueOnce(Object.assign(new Error('disk full'), { code: 'ENOSPC' }))
    journal.upsert('agent', session())
    await expect(journal.flush()).rejects.toThrow('disk full')
  })
})

describe('context object boundaries', () => {
  it('reads ranges, deduplicates and rejects cross-session or arbitrary path references', async () => {
    const objects = new SessionObjects(path.join(dir, 'sessions'))
    const key = storageKey('agent', 's')
    const ref = await objects.put(key, '0123456789')
    expect(await objects.put(key, '0123456789')).toBe(ref)
    expect(await objects.read(key, ref, 2, 3)).toEqual({ text: '234', offset: 2, nextOffset: 5, total: 10 })
    expect(await objects.read(key, ref, 999, 3)).toEqual({ text: '', offset: 10, nextOffset: 10, total: 10 })
    expect((await objects.list(key)).references).toEqual([ref])
    await expect(objects.read(storageKey('agent', 'other'), ref)).rejects.toThrow()
    await expect(objects.read(key, '../deepdesk.json')).rejects.toThrow('无效')
    await expect(objects.read('../', ref)).rejects.toThrow('无效')
    for (const offset of [-1, 1.5, NaN]) await expect(objects.read(key, ref, offset)).rejects.toThrow('范围')
    await expect(objects.read(key, ref, 0, 16001)).rejects.toThrow('范围')
  })

  it('detects changed original content and concurrent writes do not leave partial objects', async () => {
    const objects = new SessionObjects(path.join(dir, 'sessions'))
    const key = storageKey('agent', 's')
    const refs = await Promise.all(Array.from({ length: 4 }, () => objects.put(key, 'same content')))
    expect(new Set(refs).size).toBe(1)
    await fs.writeFile(path.join(dir, 'sessions', key, 'objects', `${refs[0]}.txt`), 'changed')
    await expect(objects.read(key, refs[0])).rejects.toThrow('校验失败')
  })
})
