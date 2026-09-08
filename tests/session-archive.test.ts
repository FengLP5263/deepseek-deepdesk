import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
vi.mock('electron', () => ({ app: { getPath: () => '' } }))
import { AppStore } from '../src/main/store'
import { createSessionArchive } from '../src/main/session-archive'
import { createAgentPersistence, createChatPersistence, flushRunCheckpoints } from '../src/main/run-persistence'
import { storageKey } from '../src/main/session-objects'
import type { AgentSession } from '../src/shared/agent-types'
import type { ConnectorActivity, Conversation } from '../src/shared/types'
import { searchAgentSessions } from '../src/renderer/src/lib/session-search'

let dir: string
let store: AppStore
const stores: AppStore[] = []
const session = (id = 's'): AgentSession => ({ id, task: '归档测试', workdir: '', modelId: 'm', createdAt: 1, updatedAt: 1, steps: [{ kind: 'task', text: '保留正文' }], history: [{ role: 'user', content: '保留正文' }], queuedMessages: [{ id: 'q', text: '下一条', createdAt: 1 }] })
async function open(): Promise<AppStore> { const next = new AppStore(dir); stores.push(next); await next.init(); return next }
beforeEach(async () => { dir = await fs.mkdtemp(path.join(tmpdir(), 'deepdesk-archive-')); store = await open() })
afterEach(async () => { flushRunCheckpoints(); await Promise.allSettled(stores.splice(0).map(s => s.flush())); await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }) })

describe('session archive lifecycle', () => {
  it('persists archive and restores history, model, pin and queued messages after restart', async () => {
    store.upsertAgentSession({ ...session(), pinnedAt: 1 })
    const service = createSessionArchive(store, vi.fn())
    await service.archive({ kind: 'agent', id: 's' })
    expect(service.list()).toEqual([expect.objectContaining({ id: 's', title: '归档测试', source: 'desktop' })])
    expect(searchAgentSessions(store.getSnapshot().agentSessions, '')).toEqual([])
    expect(searchAgentSessions(store.getSnapshot().agentSessions, '保留')).toEqual([])
    store.upsertAgentSession({ ...session(), task: '迟到的保存' })
    const reopened = await open()
    expect(reopened.getAgentSession('s')).toMatchObject({ task: '归档测试', archivedAt: expect.any(Number) })
    await createSessionArchive(reopened, vi.fn()).restore({ kind: 'agent', id: 's' })
    const restored = (await open()).getAgentSession('s')!
    expect(restored.archivedAt).toBeUndefined()
    expect(restored).toMatchObject({ ...session(), pinnedAt: 1 })
  })

  it('flushes streaming content, stops only the archived run, ignores late output and prevents restart while archived', async () => {
    store.upsertAgentSession(session())
    store.upsertAgentSession(session('other'))
    const request = { runId: 'run', sessionId: 's', task: '继续', providerId: 'deepseek', modelId: 'm', workdir: '', temperature: 1 }
    const recorder = createAgentPersistence(store, request)!
    recorder.event({ runId: 'run', type: 'text', text: '已生成的内容' })
    const cancel = vi.fn()
    await createSessionArchive(store, cancel).archive({ kind: 'agent', id: 's' })
    expect(cancel).toHaveBeenCalledExactlyOnceWith('agent', 'run')
    expect(store.getAgentSession('s')?.steps.at(-1)?.text).toBe('已生成的内容')
    recorder.event({ runId: 'run', type: 'text', text: '迟到分片' })
    recorder.event({ runId: 'run', type: 'done', history: [] })
    expect(store.getAgentSession('s')?.steps.at(-1)?.text).toBe('已生成的内容')
    expect(store.getAgentSession('other')?.archivedAt).toBeUndefined()
    expect(() => createAgentPersistence(store, request)).toThrow('恢复会话')
    await expect(recorder.archive('secret', 256)).rejects.toThrow('任务已停止')
  })

  it('supports legacy chat conversations with streaming checkpoint and restore', async () => {
    const conversation: Conversation = { id: 'c', title: '聊天', createdAt: 1, updatedAt: 1, providerId: 'deepseek', modelId: 'm', temperature: 1,
      messages: [{ id: 'answer', role: 'assistant', content: '', createdAt: 1, streaming: true }] }
    store.upsertConversation(conversation)
    const record = createChatPersistence(store, { runId: 'chat-run', conversationId: 'c', providerId: 'deepseek', modelId: 'm', messages: [], temperature: 1 })
    record({ runId: 'chat-run', conversationId: 'c', type: 'content', text: '保留回答' })
    const archive = createSessionArchive(store, vi.fn())
    await archive.archive({ kind: 'chat', id: 'c' })
    expect(archive.list()[0].kind).toBe('chat')
    store.upsertConversation(conversation)
    expect(store.getConversation('c')?.messages[0]).toMatchObject({ content: '保留回答', streaming: false })
    await archive.restore({ kind: 'chat', id: 'c' })
    expect((await open()).getConversation('c')?.archivedAt).toBeUndefined()
  })

  it('purges only archived session files, drains raw writes, keeps tombstone and preserves other sessions/backups', async () => {
    store.upsertAgentSession(session())
    store.upsertAgentSession(session('other'))
    const archive = createSessionArchive(store, vi.fn())
    await expect(archive.remove({ kind: 'agent', id: 's' })).rejects.toThrow('已归档')
    await archive.archive({ kind: 'agent', id: 's' })
    const key = storageKey('agent', 's')
    const folder = path.join(dir, 'sessions', key)
    await fs.writeFile(path.join(folder, 'events.jsonl.recovery-test'), '旧正文')
    await fs.writeFile(path.join(dir, 'user-backup.txt'), '独立备份')
    const rawWrite = store.sessions.objects.put(key, '原文'.repeat(50000))
    await archive.remove({ kind: 'agent', id: 's' })
    await rawWrite
    expect((await fs.readdir(folder)).sort()).toEqual(['events.jsonl', 'purge.json'])
    expect(await fs.readFile(path.join(folder, 'events.jsonl'), 'utf8')).not.toContain('保留正文')
    expect(await fs.readFile(path.join(dir, 'user-backup.txt'), 'utf8')).toBe('独立备份')
    store.upsertAgentSession(session())
    expect(store.getAgentSession('s')).toBeNull()
    await expect(store.sessions.objects.put(key, '迟到原文')).rejects.toThrow('永久删除')
    const reopened = await open()
    expect(reopened.getAgentSession('s')).toBeNull()
    expect(reopened.getAgentSession('other')).not.toBeNull()
    await expect(createSessionArchive(reopened, vi.fn()).restore({ kind: 'agent', id: 's' })).rejects.toThrow('永久删除')
  })

  it('completes an interrupted purge from the durable marker on restart', async () => {
    store.upsertAgentSession(session())
    const archive = createSessionArchive(store, vi.fn())
    await archive.archive({ kind: 'agent', id: 's' })
    await archive.remove({ kind: 'agent', id: 's' })
    const folder = path.join(dir, 'sessions', storageKey('agent', 's'))
    await fs.writeFile(path.join(folder, 'snapshot.json'), 'simulate leftover private content')
    const restarted = await open()
    expect(restarted.getAgentSession('s')).toBeNull()
    await expect(fs.access(path.join(folder, 'snapshot.json'))).rejects.toThrow()
  })

  it('keeps inbound messages archived, then starts a fresh connector session only for new messages after purge', async () => {
    const activity = (id: string, createdAt: number): ConnectorActivity => ({ id, createdAt, connectorId: 'wechat', direction: 'inbound', sourceId: 'friend', sourceName: '朋友', threadId: 'thread', text: id, status: 'received' })
    const first = activity('old-message', Date.now() - 10000)
    store.upsertConnectorActivities([first])
    const id = store.getSnapshot().agentSessions[0].id
    const archive = createSessionArchive(store, vi.fn())
    await archive.archive({ kind: 'agent', id })
    store.upsertConnectorActivities([activity('while-archived', Date.now() - 5000)])
    expect(store.getAgentSession(id)?.archivedAt).toBeTruthy()
    expect(store.getAgentSession(id)?.steps).toHaveLength(2)
    await archive.remove({ kind: 'agent', id })
    const reopened = await open()
    reopened.upsertConnectorActivities([first])
    expect(reopened.getSnapshot().agentSessions).toHaveLength(0)
    const incoming = activity('new-message', Date.now() + 1000)
    reopened.upsertConnectorActivities([incoming])
    const next = reopened.getSnapshot().agentSessions[0]
    expect(next.id).not.toBe(id)
    expect(next.steps).toEqual([expect.objectContaining({ text: 'new-message' })])
    const service = createSessionArchive(reopened, vi.fn())
    await service.archive({ kind: 'agent', id: next.id })
    await service.remove({ kind: 'agent', id: next.id })
    const again = await open()
    again.upsertConnectorActivities([incoming])
    expect(again.getSnapshot().agentSessions).toHaveLength(0)
  })

  it('serializes operations on one session and rejects invalid targets', async () => {
    store.upsertAgentSession(session())
    const archive = createSessionArchive(store, vi.fn())
    const pending = archive.archive({ kind: 'agent', id: 's' })
    await expect(archive.restore({ kind: 'agent', id: 's' })).rejects.toThrow('正在处理')
    await pending
    await expect(archive.archive({ kind: 'agent', id: '' })).rejects.toThrow('无效')
  })
})
