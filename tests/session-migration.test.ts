import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
vi.mock('electron', () => ({ app: { getPath: () => '' } }))
import { AppStore } from '../src/main/store'
import { SessionJournal } from '../src/main/session-journal'
import { plaintextSecretCodec } from '../src/main/secret-storage'
import type { AgentSession } from '../src/shared/agent-types'

let dir: string
const stores: AppStore[] = []
const session: AgentSession = { id: 'old', task: '旧会话', workdir: '', modelId: 'm', createdAt: 1, updatedAt: 1,
  steps: [{ kind: 'task', text: '请记住：我喜欢简洁的回答' }], history: [{ role: 'user', content: '你好' }] }
async function open(): Promise<AppStore> {
  const store = new AppStore(dir)
  stores.push(store)
  await store.init()
  return store
}
beforeEach(async () => { dir = await fs.mkdtemp(path.join(tmpdir(), 'deepdesk-migration-')) })
afterEach(async () => { await Promise.allSettled(stores.splice(0).map(store => store.flush())); await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }) })

describe('AppStore journal migration', () => {
  it.each([undefined, null])('recovers legacy sessions without history (%s) from saved dialogue', async history => {
    const legacy = { ...session, history, steps: [
      { kind: 'task', text: '请用中文回答' },
      { kind: 'text', text: '好的，我会用中文。' },
      { kind: 'task', text: '查看文件' },
      { kind: 'tool', callId: 'read-1', name: 'read_file', args: '{"path":"a.txt"}', status: 'ok', result: '文件内容' },
      { kind: 'text', text: '已读取。' }
    ] }
    const file = path.join(dir, 'deepdesk.json')
    await fs.writeFile(file, JSON.stringify({ agentSessions: [legacy, { ...session, id: 'valid' }] }))
    const store = await open()
    const restored = store.getAgentSession('old')!
    expect(restored.steps).toEqual(legacy.steps)
    expect(restored.history).toEqual([
      { role: 'user', content: '请用中文回答' },
      { role: 'assistant', content: '好的，我会用中文。' },
      { role: 'user', content: '查看文件' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'read-1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }] },
      { role: 'tool', tool_call_id: 'read-1', content: '文件内容' },
      { role: 'assistant', content: '已读取。' }
    ])
    expect(store.getAgentSession('valid')?.history).toEqual(session.history)
    expect(JSON.parse(await fs.readFile(`${file}.pre-sessions-v1.bak`, 'utf8')).agentSessions[0]).toEqual(JSON.parse(JSON.stringify(legacy)))
    expect((await open()).getAgentSession('old')?.history).toEqual(restored.history)
  })

  it('preserves deliberately empty history and handles legacy missing steps/messages', async () => {
    await fs.writeFile(path.join(dir, 'deepdesk.json'), JSON.stringify({
      agentSessions: [{ ...session, history: [] }, { ...session, id: 'no-steps', steps: undefined }],
      conversations: [{ id: 'empty-chat', title: '空会话', providerId: 'deepseek', modelId: 'm', createdAt: 1, updatedAt: 1 }]
    }))
    const store = await open()
    expect(store.getAgentSession('old')?.history).toEqual([])
    expect(store.getAgentSession('no-steps')).toMatchObject({ steps: [], history: session.history })
    expect(store.getSnapshot().conversations[0].messages).toEqual([])
  })

  it('does not turn thoughts, failures or missing tool results into successful model answers', async () => {
    await fs.writeFile(path.join(dir, 'deepdesk.json'), JSON.stringify({ agentSessions: [{ ...session, history: undefined, steps: [
      { kind: 'task', text: '读取文件' }, { kind: 'thinking', text: '内部思考' },
      { kind: 'tool', callId: 'pending', name: 'read_file', status: 'running' },
      { kind: 'error', message: '网络错误' }, { kind: 'context', text: '界面状态' }
    ] }] }))
    const restored = (await open()).getAgentSession('old')!
    expect(restored.history).toHaveLength(3)
    expect(restored.history[2]).toMatchObject({ role: 'tool', tool_call_id: 'pending', content: expect.stringContaining('无法确认执行结果') })
    expect(restored.steps[2].status).toBe('cancelled')
    expect(restored.steps).toHaveLength(5)
  })

  it.each(['invalid', [null]])('rejects malformed chat messages (%j) without erasing source data', async messages => {
    const file = path.join(dir, 'deepdesk.json')
    const original = JSON.stringify({ conversations: [{ id: 'bad-chat', messages }] })
    await fs.writeFile(file, original)
    await expect(open()).rejects.toThrow('会话数据格式无效')
    await Promise.all(stores.map(store => store.flush()))
    expect(await fs.readFile(file, 'utf8')).toBe(original)
  })

  it.each([{ history: {} }, { history: [null] }, { steps: 'invalid' }, { steps: [null] }])('rejects malformed session arrays without erasing source data: %j', async patch => {
    const file = path.join(dir, 'deepdesk.json')
    const original = JSON.stringify({ agentSessions: [{ ...session, ...patch }] })
    await fs.writeFile(file, original)
    await expect(open()).rejects.toThrow('会话数据格式无效')
    await Promise.all(stores.map(store => store.flush()))
    expect(await fs.readFile(file, 'utf8')).toBe(original)
  })

  it('seeds the UI fixture through the journal without erasing existing configuration', async () => {
    const store = await open()
    store.upsertMemory({ id: 'keep', scope: 'user', kind: 'preference', content: '保留', tags: [], enabled: true, createdAt: 1, updatedAt: 1 })
    await store.flush()
    await promisify(execFile)(process.execPath, ['scripts/seed-ui-session.mjs', '--user-data-dir', dir], { cwd: process.cwd(), timeout: 20_000, windowsHide: true })
    const reopened = await open()
    expect(reopened.getSnapshot().agentSessions.some(item => item.task === 'UI会话')).toBe(true)
    expect(reopened.listMemories().some(item => item.id === 'keep')).toBe(true)
  }, 25_000)
  it('backs up old data before removing histories from settings and reloads sessions', async () => {
    const file = path.join(dir, 'deepdesk.json')
    await fs.writeFile(file, JSON.stringify({ agentSessions: [session] }))
    const store = await open()
    expect(store.getAgentSession('old')?.task).toBe('旧会话')
    const saved = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(saved.sessionStorageVersion).toBe(1)
    expect(saved.agentSessions).toEqual([])
    expect(JSON.parse(await fs.readFile(`${file}.pre-sessions-v1.bak`, 'utf8')).agentSessions).toEqual([session])
    store.upsertAgentSession({ ...session, task: '新标题' })
    await store.flush()
    expect(await fs.readFile(file, 'utf8')).toBe(JSON.stringify(saved, null, 2))
    expect((await open()).getAgentSession('old')?.task).toBe('新标题')
  })

  it('resumes interrupted migration without reviving journal tombstones', async () => {
    await fs.writeFile(path.join(dir, 'deepdesk.json'), JSON.stringify({ agentSessions: [session, { ...session, id: 'keep' }] }))
    const journal = new SessionJournal(dir, plaintextSecretCodec)
    await journal.load()
    journal.upsert('agent', session)
    journal.delete('agent', session.id)
    await journal.flush()
    const store = await open()
    expect(store.getAgentSession('old')).toBeNull()
    expect(store.getAgentSession('keep')).toBeTruthy()
    store.deleteAgentSession('keep')
    await store.flush()
    expect((await open()).getSnapshot().agentSessions).toEqual([])
  })

  it('does not reimport memories a user deleted on every restart', async () => {
    await fs.writeFile(path.join(dir, 'deepdesk.json'), JSON.stringify({ agentSessions: [session] }))
    const store = await open()
    expect(store.listMemories().length).toBeGreaterThan(0)
    for (const memory of store.listMemories()) store.deleteMemory(memory.id)
    await store.flush()
    expect((await open()).listMemories()).toEqual([])
  })

  it('fails closed for corrupt settings instead of overwriting them with defaults', async () => {
    const file = path.join(dir, 'deepdesk.json')
    await fs.writeFile(file, '{corrupt')
    await expect(open()).rejects.toThrow()
    expect(await fs.readFile(file, 'utf8')).toBe('{corrupt')
  })

  it('marks interrupted tool/thinking steps as stopped on recovery', async () => {
    const store = await open()
    store.upsertAgentSession({ ...session, steps: [{ kind: 'thinking', status: 'running', text: '正在分析' }, { kind: 'tool', status: 'running', callId: 'c' }] })
    await store.flush()
    const restored = (await open()).getAgentSession('old')
    expect(restored?.steps.every(step => step.status === 'cancelled')).toBe(true)
  })
})
