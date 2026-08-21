import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  responses: [] as Array<{ content: string | null; toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> }>
}))

vi.mock('../src/shared/llm/toolcall', () => ({
  streamChatCompletionWithTools: async function* () {
    const resp = mocks.responses.shift()
    if (!resp) return
    if (resp.content) yield { type: 'content', text: resp.content }
    yield { type: 'final', toolCalls: resp.toolCalls }
  }
}))

import { startAgent, approveCommand } from '../src/main/agent'
import type { AgentEvent } from '../src/shared/agent-types'
import type { AppSettings, ProviderConfig } from '../src/shared/types'

const provider: ProviderConfig = { id: 'deepseek', name: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: 'sk', models: [], createdAt: 0 }
const baseSettings: AppSettings = { version: 1, defaultProviderId: 'deepseek', defaultModelId: 'deepseek-v4-pro', temperature: 1, theme: 'dark', enterToSend: true, agentWorkdir: '', agentPermissionMode: 'ask' }
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

async function waitForApproval(events: AgentEvent[]): Promise<AgentEvent | undefined> {
  for (let i = 0; i < 100; i++) {
    const a = events.find(e => e.type === 'approval_request')
    if (a) return a
    await new Promise(r => setTimeout(r, 10))
  }
  return undefined
}

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agent-test-')); mocks.responses.length = 0 })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('startAgent', () => {
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
