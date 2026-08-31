import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  responses: [] as Array<{ content: string | null; toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>; finishReason?: string; interrupt?: boolean; waitForAbort?: boolean }>,
  requests: [] as Array<{ messages: Array<Record<string, unknown>> }>
}))

vi.mock('../src/shared/llm/toolcall', () => ({
  streamChatCompletionWithTools: async function* (req: { messages: Array<Record<string, unknown>>; signal?: AbortSignal }) {
    mocks.requests.push({ messages: structuredClone(req.messages) })
    const resp = mocks.responses.shift()
    if (!resp) return
    if (resp.waitForAbort) {
      await new Promise<void>((_resolve, reject) => {
        const rejectAbort = (): void => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        }
        if (req.signal?.aborted) rejectAbort()
        else req.signal?.addEventListener('abort', rejectAbort, { once: true })
      })
    }
    if (resp.content) yield { type: 'content', text: resp.content }
    if (resp.interrupt) {
      const { IncompleteStreamError } = await import('../src/shared/llm/stream')
      throw new IncompleteStreamError()
    }
    yield { type: 'final', toolCalls: resp.toolCalls, finishReason: resp.finishReason ?? (resp.toolCalls.length > 0 ? 'tool_calls' : 'stop') }
  }
}))

import { startAgent, cancelAgent, approveCommand } from '../src/main/agent'
import type { AgentEvent } from '../src/shared/agent-types'
import type { AppSettings, ProviderConfig } from '../src/shared/types'

const provider: ProviderConfig = { id: 'deepseek', name: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: 'sk', models: [], createdAt: 0 }
const baseSettings: AppSettings = { version: 1, defaultProviderId: 'deepseek', defaultModelId: 'deepseek-v4-pro', temperature: 1, theme: 'dark', appFont: 'default', enterToSend: true, agentWorkdir: '', agentPermissionMode: 'ask' }
const outputCommand = (text: string): string => process.platform === 'win32' ? 'Write-Output ' + text : "printf '%s\\n' " + text

function makeWin() {
  const events: AgentEvent[] = []
  const win = { isDestroyed: () => false, webContents: { send: (_c: string, ev: AgentEvent) => events.push(ev) } }
  return { events, win }
}

async function runUntilDone(events: AgentEvent[]): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (events.some(e => e.type === 'done' || e.type === 'error')) return
    await new Promise(r => setTimeout(r, 10))
  }
}

async function runUntilDoneById(events: AgentEvent[], runId: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (events.some(e => e.runId === runId && (e.type === 'done' || e.type === 'error'))) return
    await new Promise(r => setTimeout(r, 10))
  }
}

async function waitForApproval(events: AgentEvent[]): Promise<AgentEvent | undefined> {
  for (let i = 0; i < 100; i++) {
    const a = events.find(e => e.type === 'approval_request')
    if (a) return a
    await new Promise(r => setTimeout(r, 10))
  }
  return undefined
}

async function waitForApprovalCount(events: AgentEvent[], count: number): Promise<AgentEvent[]> {
  for (let i = 0; i < 100; i++) {
    const approvals = events.filter(e => e.type === 'approval_request')
    if (approvals.length >= count) return approvals
    await new Promise(r => setTimeout(r, 10))
  }
  return events.filter(e => e.type === 'approval_request')
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agent-test-')); mocks.responses.length = 0; mocks.requests.length = 0 })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('startAgent', () => {
  it('取消时会中止仍在等待的模型流并结束当前运行', async () => {
    mocks.responses.push({ content: null, toolCalls: [], waitForAbort: true })
    const { events, win } = makeWin()
    startAgent(win as never, { runId: 'r-cancel', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '长时间思考', temperature: 1 }, provider, baseSettings)
    for (let index = 0; index < 50 && !events.some(event => event.type === 'thinking'); index += 1) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    cancelAgent('r-cancel')
    await runUntilDone(events)

    expect(events.some(event => event.type === 'done' && event.message === '已停止')).toBe(true)
    expect(events.some(event => event.type === 'error')).toBe(false)
  })

  it('工具调用循环：写文件后产出最终答案', async () => {
    const target = join(dir, 'hello.txt')
    mocks.responses.push({ content: null, toolCalls: [{ id: 'c1', name: 'write_file', args: { path: 'hello.txt', content: 'hello agent' } }] })
    mocks.responses.push({ content: '已完成', toolCalls: [] })
    const { events, win } = makeWin()
    startAgent(win as never, { runId: 'r1', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '写个文件', temperature: 1 }, provider, baseSettings)
    await runUntilDone(events)
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(target, 'utf-8')).toBe('hello agent')
    expect(events.some(e => e.type === 'tool_call')).toBe(true)
    expect(events.some(e => e.type === 'tool_result' && e.ok === true)).toBe(true)
    expect(events.some(e => e.type === 'text' && e.text === '已完成')).toBe(true)
    expect(events.some(e => e.type === 'done')).toBe(true)
  })

  it('模型因输出长度结束时自动续写并合并为一条回复', async () => {
    mocks.responses.push({ content: '第一段，', toolCalls: [], finishReason: 'length' })
    mocks.responses.push({ content: '第二段。', toolCalls: [], finishReason: 'stop' })
    const { events, win } = makeWin()

    startAgent(win as never, { runId: 'r-length', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '请输出完整内容', temperature: 1 }, provider, baseSettings)
    await runUntilDone(events)

    expect(events.filter(event => event.type === 'text').map(event => event.text).join('')).toBe('第一段，第二段。')
    expect(events.some(event => event.type === 'error')).toBe(false)
    const done = events.find(event => event.type === 'done')
    expect(done?.history?.at(-1)).toEqual({ role: 'assistant', content: '第一段，第二段。' })
    expect(mocks.requests[1].messages).toContainEqual({ role: 'assistant', content: '第一段，' })
    expect(String(mocks.requests[1].messages.at(-1)?.content)).toContain('从中断位置继续')
  })

  it('流在输出中途断开时保留已收到内容并自动恢复', async () => {
    mocks.responses.push({ content: '已收到的前半段，', toolCalls: [], interrupt: true })
    mocks.responses.push({ content: '恢复后的后半段。', toolCalls: [], finishReason: 'stop' })
    const { events, win } = makeWin()

    startAgent(win as never, { runId: 'r-interrupted', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '请输出完整内容', temperature: 1 }, provider, baseSettings)
    await runUntilDone(events)

    expect(events.filter(event => event.type === 'text').map(event => event.text).join('')).toBe('已收到的前半段，恢复后的后半段。')
    expect(events.some(event => event.type === 'error')).toBe(false)
    expect(mocks.requests).toHaveLength(2)
    expect(mocks.requests[1].messages).toContainEqual({ role: 'assistant', content: '已收到的前半段，' })
  })

  it('模型错误标记为正常结束但留下明显残句时自动续写', async () => {
    mocks.responses.push({ content: '停用账号多为 7/', toolCalls: [], finishReason: 'stop' })
    mocks.responses.push({ content: '21 日批量导入。', toolCalls: [], finishReason: 'stop' })
    const { events, win } = makeWin()

    startAgent(win as never, { runId: 'r-dangling-stop', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '请输出完整统计', temperature: 1 }, provider, baseSettings)
    await runUntilDone(events)

    expect(events.filter(event => event.type === 'text').map(event => event.text).join('')).toBe('停用账号多为 7/21 日批量导入。')
    expect(events.some(event => event.type === 'error')).toBe(false)
    expect(mocks.requests).toHaveLength(2)
    expect(mocks.requests[1].messages).toContainEqual({ role: 'assistant', content: '停用账号多为 7/' })
  })

  it('单个工具抛错时返回失败结果并允许模型继续恢复', async () => {
    mocks.responses.push({ content: null, toolCalls: [{ id: 'missing-page', name: 'read_file', args: { path: '不存在的文件.txt' } }] })
    mocks.responses.push({ content: '文件不存在，我已停止读取。', toolCalls: [] })
    const { events, win } = makeWin()

    startAgent(win as never, { runId: 'r-tool-error', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '读取文件', temperature: 1 }, provider, baseSettings)
    await runUntilDone(events)

    expect(events).toContainEqual(expect.objectContaining({ runId: 'r-tool-error', type: 'tool_result', callId: 'missing-page', ok: false }))
    expect(events.some(event => event.type === 'text' && event.text === '文件不存在，我已停止读取。')).toBe(true)
    expect(events.some(event => event.type === 'error')).toBe(false)
    expect(events.some(event => event.type === 'done')).toBe(true)
    expect(mocks.requests[1].messages).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: 'missing-page' }))
  })

  it('发送给模型前会压缩超过窗口预算的旧上下文并保留当前问题', async () => {
    const smallProvider: ProviderConfig = {
      ...provider,
      models: [{ id: 'tiny', contextWindow: 900 }]
    }
    mocks.responses.push({ content: '已完成', toolCalls: [] })
    const { events, win } = makeWin()
    startAgent(win as never, {
      runId: 'r-context',
      providerId: 'deepseek',
      modelId: 'tiny',
      workdir: dir,
      task: '最新问题必须保留',
      temperature: 1,
      history: [
        { role: 'system', content: 'system prompt' },
        { role: 'user', content: '较早上下文'.repeat(500) },
        { role: 'assistant', content: '较早回答'.repeat(500) }
      ]
    }, smallProvider, baseSettings)
    await runUntilDone(events)

    const sent = mocks.requests[0].messages
    expect(sent.some(message => String(message.content).includes('[上下文压缩摘要]'))).toBe(true)
    expect(sent.at(-1)).toEqual({ role: 'user', content: '最新问题必须保留' })
    expect(JSON.stringify(sent).length).toBeLessThan('较早上下文'.repeat(500).length + '较早回答'.repeat(500).length)
  })

  it('ask 模式：run_command 默认需批准，拒绝后不执行', async () => {
    mocks.responses.push({ content: null, toolCalls: [{ id: 'c2', name: 'run_command', args: { command: 'Write-Output should-not-run' } }] })
    mocks.responses.push({ content: '结束', toolCalls: [] })
    const { events, win } = makeWin()
    startAgent(win as never, { runId: 'r2', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '跑命令', temperature: 1 }, provider, baseSettings)
    const approval = await waitForApproval(events)
    expect(approval).toBeTruthy()
    approveCommand(approval!.callId!, false)
    await runUntilDone(events)
    const tr = events.find(e => e.type === 'tool_result')
    expect(tr?.ok).toBe(false)
    expect(tr?.summary).toContain('拒绝')
  })

  it('并发运行时一个 run 结束不会清理另一个 run 的待审批', async () => {
    mocks.responses.push({ content: null, toolCalls: [{ id: 'c9', name: 'run_command', args: { command: 'Write-Output one' } }] })
    mocks.responses.push({ content: null, toolCalls: [{ id: 'c10', name: 'run_command', args: { command: 'Write-Output two' } }] })
    mocks.responses.push({ content: 'run one done', toolCalls: [] })
    mocks.responses.push({ content: 'run two done', toolCalls: [] })
    const { events, win } = makeWin()

    startAgent(win as never, { runId: 'r9', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: 'run one', temperature: 1 }, provider, baseSettings)
    startAgent(win as never, { runId: 'r10', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: 'run two', temperature: 1 }, provider, baseSettings)
    const approvals = await waitForApprovalCount(events, 2)
    expect(approvals.map(e => e.callId).sort()).toEqual(['c10', 'c9'])

    approveCommand('c9', false)
    for (let i = 0; i < 100; i++) {
      if (events.some(e => e.runId === 'r9' && e.type === 'done')) break
      await new Promise(r => setTimeout(r, 10))
    }
    await new Promise(r => setTimeout(r, 80))
    expect(events.some(e => e.runId === 'r10' && e.type === 'tool_result')).toBe(false)

    approveCommand('c10', false)
    await runUntilDoneById(events, 'r10')
    expect(events.some(e => e.runId === 'r10' && e.type === 'done')).toBe(true)
  })

  it('full 模式：命令直接执行，无需批准', async () => {
    mocks.responses.push({ content: null, toolCalls: [{ id: 'c3', name: 'run_command', args: { command: outputCommand('auto-run-ok') } }] })
    mocks.responses.push({ content: '完成', toolCalls: [] })
    const { events, win } = makeWin()
    const fullSettings: AppSettings = { ...baseSettings, agentPermissionMode: 'full' }
    startAgent(win as never, { runId: 'r3', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '跑命令', temperature: 1 }, provider, fullSettings)
    await runUntilDone(events)
    expect(events.some(e => e.type === 'approval_request')).toBe(false)
    const tr = events.find(e => e.type === 'tool_result')
    expect(tr?.ok).toBe(true)
    expect(tr?.output).toContain('auto-run-ok')
  })

  it('auto 模式：只读命令自动批准', async () => {
    mocks.responses.push({ content: null, toolCalls: [{ id: 'c6', name: 'run_command', args: { command: outputCommand('readonly-ok') } }] })
    mocks.responses.push({ content: '完成', toolCalls: [] })
    const { events, win } = makeWin()
    const autoSettings: AppSettings = { ...baseSettings, agentPermissionMode: 'auto' }
    startAgent(win as never, { runId: 'r6', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '只读命令', temperature: 1 }, provider, autoSettings)
    await runUntilDone(events)
    expect(events.some(e => e.type === 'approval_request')).toBe(false)
    const tr = events.find(e => e.type === 'tool_result')
    expect(tr?.ok).toBe(true)
    expect(tr?.output).toContain('readonly-ok')
  })

  it('auto 模式：非只读命令仍需批准', async () => {
    mocks.responses.push({ content: null, toolCalls: [{ id: 'c7', name: 'run_command', args: { command: 'New-Item -ItemType File foo.txt' } }] })
    mocks.responses.push({ content: '完成', toolCalls: [] })
    const { events, win } = makeWin()
    const autoSettings: AppSettings = { ...baseSettings, agentPermissionMode: 'auto' }
    startAgent(win as never, { runId: 'r7', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '写文件', temperature: 1 }, provider, autoSettings)
    const approval = await waitForApproval(events)
    expect(approval).toBeTruthy()
    approveCommand(approval!.callId!, false)
    await runUntilDone(events)
  })

  it('ask 模式：访问工作目录外文件需批准', async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'agent-outside-'))
    const outsideFile = join(outsideDir, 'secret.txt')
    writeFileSync(outsideFile, 'secret data')
    mocks.responses.push({ content: null, toolCalls: [{ id: 'c4', name: 'read_file', args: { path: outsideFile } }] })
    mocks.responses.push({ content: '结束', toolCalls: [] })
    const { events, win } = makeWin()
    startAgent(win as never, { runId: 'r4', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '读外部文件', temperature: 1 }, provider, baseSettings)
    const approval = await waitForApproval(events)
    expect(approval).toBeTruthy()
    expect(approval?.target).toBe(outsideFile)
    approveCommand(approval!.callId!, true)
    await runUntilDone(events)
    const tr = events.find(e => e.type === 'tool_result')
    expect(tr?.ok).toBe(true)
    rmSync(outsideDir, { recursive: true, force: true })
  })

  it('send_feishu_message 默认需批准，拒绝后不发送', async () => {
    mocks.responses.push({ content: null, toolCalls: [{ id: 'c8', name: 'send_feishu_message', args: { user_id: 'ou_test', text: '你好' } }] })
    mocks.responses.push({ content: '完成', toolCalls: [] })
    const { events, win } = makeWin()
    startAgent(win as never, { runId: 'r8', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '发消息', temperature: 1 }, provider, baseSettings)
    const approval = await waitForApproval(events)
    expect(approval).toBeTruthy()
    expect(approval?.reason).toBe('发送飞书消息')
    expect(approval?.command).toBe('你好')
    expect(approval?.target).toBe('ou_test')
    approveCommand(approval!.callId!, false)
    await runUntilDone(events)
    const tr = events.find(e => e.type === 'tool_result')
    expect(tr?.ok).toBe(false)
    expect(tr?.summary).toContain('拒绝')
  })

  it('浏览器脚本执行默认需批准，拒绝后不连接调试页面', async () => {
    mocks.responses.push({ content: null, toolCalls: [{ id: 'browser-1', name: 'browser_evaluate', args: { expression: 'document.cookie' } }] })
    mocks.responses.push({ content: '完成', toolCalls: [] })
    const { events, win } = makeWin()
    startAgent(win as never, { runId: 'r-browser', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '检查页面', temperature: 1 }, provider, baseSettings)

    const approval = await waitForApproval(events)
    expect(approval).toBeTruthy()
    expect(approval?.reason).toBe('操作浏览器页面')
    expect(approval?.command).toContain('browser_evaluate')
    approveCommand(approval!.callId!, false)
    await runUntilDone(events)

    const result = events.find(event => event.type === 'tool_result')
    expect(result?.ok).toBe(false)
    expect(result?.summary).toContain('拒绝')
  })

  it('full 模式：写工作目录外文件直接放行', async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'agent-outside-'))
    const outsideFile = join(outsideDir, 'w.txt')
    mocks.responses.push({ content: null, toolCalls: [{ id: 'c5', name: 'write_file', args: { path: outsideFile, content: 'hi' } }] })
    mocks.responses.push({ content: '完成', toolCalls: [] })
    const { events, win } = makeWin()
    const fullSettings: AppSettings = { ...baseSettings, agentPermissionMode: 'full' }
    startAgent(win as never, { runId: 'r5', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '写外部文件', temperature: 1 }, provider, fullSettings)
    await runUntilDone(events)
    expect(existsSync(outsideFile)).toBe(true)
    expect(readFileSync(outsideFile, 'utf-8')).toBe('hi')
    expect(events.some(e => e.type === 'approval_request')).toBe(false)
    rmSync(outsideDir, { recursive: true, force: true })
  })
})
