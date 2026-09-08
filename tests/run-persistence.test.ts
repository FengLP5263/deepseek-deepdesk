import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
vi.mock('electron', () => ({ app: { getPath: () => '' } }))
import { AppStore } from '../src/main/store'
import { createAgentPersistence, createChatPersistence } from '../src/main/run-persistence'
import { executeTool } from '../src/main/tools'
import { isAgentToolAllowedInMode, canRunAgentToolInParallel } from '../src/main/agent-mode'
import type { AgentRunRequest, AgentSession } from '../src/shared/agent-types'

let dir: string
let store: AppStore
const request = (id: string): AgentRunRequest => ({ runId: `run-${id}`, sessionId: id, task: '继续', providerId: 'deepseek', modelId: 'm', workdir: '', temperature: 1 })
const session = (id: string): AgentSession => ({ id, task: '任务', workdir: '', modelId: 'm', steps: [{ kind: 'task', text: '继续' }], history: [], createdAt: 1, updatedAt: 1 })
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(tmpdir(), 'deepdesk-checkpoints-'))
  store = new AppStore(dir)
  await store.init()
  store.upsertAgentSession(session('s'))
})
afterEach(async () => { await store.flush(); await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 }) })

describe('main-process run checkpoints', () => {
  it('does not let a stopped run overwrite the next run in the same session', () => {
    const old = createAgentPersistence(store, request('s'))!
    old.event({ runId: 'run-s', type: 'text', text: '旧内容' })
    store.upsertAgentSession({ ...session('s'), task: '新任务' })
    const next = createAgentPersistence(store, { ...request('s'), runId: 'new-run' })!
    next.event({ runId: 'new-run', type: 'text', text: '新回复' })
    next.event({ runId: 'new-run', type: 'done', history: [{ role: 'assistant', content: '新回复' }] })
    old.event({ runId: 'run-s', type: 'done', history: [] })
    expect(store.getAgentSession('s')?.steps.at(-1)?.text).toBe('新回复')
    expect(store.getAgentSession('s')?.hasUnread).toBe(true)
  })
  it('persists streaming output before done and recovers valid history without renderer saves', async () => {
    const recorder = createAgentPersistence(store, request('s'))!
    recorder.history([{ role: 'user', content: '继续' }])
    recorder.event({ runId: 'run-s', type: 'thinking', text: '分析中' })
    recorder.event({ runId: 'run-s', type: 'text', text: '第一段' })
    recorder.event({ runId: 'run-s', type: 'text', text: '第二段' })
    await new Promise(resolve => setTimeout(resolve, 550))
    await store.flush()
    const reopened = new AppStore(dir)
    await reopened.init()
    expect(reopened.getAgentSession('s')?.steps.at(-1)?.text).toBe('第一段第二段')
    expect(reopened.getAgentSession('s')?.history.at(-1)).toEqual({ role: 'assistant', content: '第一段第二段' })
    await reopened.flush()
    recorder.event({ runId: 'run-s', type: 'done', history: [{ role: 'assistant', content: '第一段第二段' }] })
  })

  it('keeps tool state and independent session outputs separate', async () => {
    store.upsertAgentSession(session('other'))
    const first = createAgentPersistence(store, request('s'))!
    const second = createAgentPersistence(store, request('other'))!
    first.event({ runId: 'run-s', type: 'tool_call', call: { id: 'c', name: 'read_file', args: { path: 'a.txt' } } })
    first.event({ runId: 'run-s', type: 'tool_result', callId: 'c', ok: true, output: '工具原文' })
    second.event({ runId: 'run-other', type: 'text', text: '另一会话' })
    first.event({ runId: 'run-s', type: 'done', history: [{ role: 'user', content: 'A' }] })
    second.event({ runId: 'run-other', type: 'done', history: [{ role: 'assistant', content: '另一会话' }] })
    expect(store.getAgentSession('s')?.steps.at(-1)).toEqual(expect.objectContaining({ result: '工具原文', status: 'ok', args: '{"path":"a.txt"}' }))
    expect(store.getAgentSession('other')?.steps.at(-1)?.text).toBe('另一会话')
    expect(store.getAgentSession('s')?.steps.some(step => step.text === '另一会话')).toBe(false)
  })

  it('does not resurrect a session deleted during a run', async () => {
    const recorder = createAgentPersistence(store, request('s'))!
    const archived = await recorder.archive('a'.repeat(20_000), 1000)
    const reference = archived.match(/reference=([a-f0-9]{64})/)![1]
    store.deleteAgentSession('s')
    recorder.event({ runId: 'run-s', type: 'text', text: '不能复活' })
    recorder.event({ runId: 'run-s', type: 'done' })
    await expect(recorder.read({ reference })).rejects.toThrow('已删除')
    expect(store.getAgentSession('s')).toBeNull()
    await store.flush()
    const reopened = new AppStore(dir)
    await reopened.init()
    expect(reopened.getAgentSession('s')).toBeNull()
    await reopened.flush()
  })

  it('archives the full file output before display truncation and reads it back in plan mode', async () => {
    const recorder = createAgentPersistence(store, request('s'))!
    await fs.writeFile(path.join(dir, 'large.txt'), 'x'.repeat(30_000) + '\nEND-OF-ORIGINAL')
    const result = await executeTool({ id: 'c', name: 'read_file', args: { path: 'large.txt' } }, dir, false, undefined, recorder.read)
    expect(result.content).not.toContain('END-OF-ORIGINAL')
    expect(result.rawContent).toContain('END-OF-ORIGINAL')
    const archived = await recorder.archive(result.rawContent!, 1000)
    expect(archived.length).toBeLessThan(result.rawContent!.length)
    const reference = archived.match(/reference=([a-f0-9]{64})/)![1]
    const call = { id: 'read', name: 'read_context' as const, args: { reference, offset: 29_990, limit: 100 } }
    expect(isAgentToolAllowedInMode(call, 'plan', [])).toBe(true)
    expect(canRunAgentToolInParallel(call, [])).toBe(true)
    const read = await executeTool(call, dir, false, undefined, recorder.read)
    expect(read.content).toContain('END-OF-ORIGINAL')
    expect(JSON.parse(await recorder.read({})).references).toContain(reference)
    store.upsertAgentSession(session('other'))
    await expect(createAgentPersistence(store, request('other'))!.read({ reference })).rejects.toThrow()
    expect((await executeTool(call, dir)).ok).toBe(false)
  })

  it('checkpoints normal chat with stable message ids and marks interrupted streams', async () => {
    store.upsertConversation({ id: 'chat', title: '聊天', providerId: 'deepseek', modelId: 'm', temperature: 1, createdAt: 1, updatedAt: 1,
      messages: [{ id: 'u', role: 'user', content: '你好', createdAt: 1 }, { id: 'a', role: 'assistant', content: '', createdAt: 1, streaming: true }] })
    const record = createChatPersistence(store, { runId: 'r', conversationId: 'chat', providerId: 'deepseek', modelId: 'm', temperature: 1, messages: [] })
    record({ runId: 'r', conversationId: 'chat', type: 'content', text: '未完成的回答' })
    await new Promise(resolve => setTimeout(resolve, 550))
    await store.flush()
    const reopened = new AppStore(dir)
    await reopened.init()
    expect(reopened.getConversation('chat')?.messages).toHaveLength(2)
    expect(reopened.getConversation('chat')?.messages[1]).toEqual(expect.objectContaining({ id: 'a', content: '未完成的回答', streaming: false, error: true }))
    await reopened.flush()
    record({ runId: 'r', conversationId: 'chat', type: 'done' })
  })
})
