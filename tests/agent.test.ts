import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  responses: [] as Array<{ content: string | null; reasoning?: string; toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>; finishReason?: string; interrupt?: boolean; waitForAbort?: boolean }>,
  requests: [] as Array<{ messages: Array<Record<string, unknown>>; tools: Array<Record<string, unknown>> }>,
  mcpTools: [] as Array<{ name: string; definition: Record<string, unknown>; serverId: string; serverName: string; toolName: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }>,
  mcpExecutions: [] as Array<{ name: string; args: Record<string, unknown> }>,
  mcpInspections: [] as Array<{ source: string; runId: string }>,
  mcpInstalls: [] as Array<{ candidateId: string; runId: string }>,
  mcpResult: 'MCP 执行结果',
  mcpDelayMs: 0,
  mcpActive: 0,
  mcpMaxActive: 0,
  mcpCandidate: undefined as undefined | { candidateId: string; name: string; source: string; serverVersion?: string; toolNames: string[] }
}))

vi.mock('../src/shared/llm/toolcall', () => ({
  streamChatCompletionWithTools: async function* (req: { messages: Array<Record<string, unknown>>; tools: Array<Record<string, unknown>>; signal?: AbortSignal }) {
    mocks.requests.push({ messages: structuredClone(req.messages), tools: structuredClone(req.tools) })
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
    if (resp.reasoning) yield { type: 'reasoning', text: resp.reasoning }
    if (resp.content) yield { type: 'content', text: resp.content }
    if (resp.interrupt) {
      const { IncompleteStreamError } = await import('../src/shared/llm/stream')
      throw new IncompleteStreamError()
    }
    yield { type: 'final', toolCalls: resp.toolCalls, finishReason: resp.finishReason ?? (resp.toolCalls.length > 0 ? 'tool_calls' : 'stop') }
  }
}))

vi.mock('../src/main/mcp', () => ({
  listMcpAgentTools: () => mocks.mcpTools,
  getMcpAgentTool: (name: string) => mocks.mcpTools.find(tool => tool.name === name),
  executeMcpAgentTool: async (name: string, args: Record<string, unknown>) => {
    mocks.mcpExecutions.push({ name, args })
    mocks.mcpActive += 1
    mocks.mcpMaxActive = Math.max(mocks.mcpMaxActive, mocks.mcpActive)
    if (mocks.mcpDelayMs > 0) await new Promise(resolve => setTimeout(resolve, mocks.mcpDelayMs))
    mocks.mcpActive -= 1
    return { ok: true, content: mocks.mcpResult, summary: 'MCP 执行完成' }
  },
  inspectMcpServer: async (source: string, runId: string) => {
    mocks.mcpInspections.push({ source, runId })
    return { ok: true, content: JSON.stringify({ candidate_id: 'candidate-1' }), summary: 'MCP 检查完成' }
  },
  getMcpInstallCandidate: (candidateId: string, runId: string) => candidateId === mocks.mcpCandidate?.candidateId && runId.startsWith('r-') ? mocks.mcpCandidate : undefined,
  installMcpServer: async (candidateId: string, runId: string) => {
    mocks.mcpInstalls.push({ candidateId, runId })
    return { ok: true, content: 'MCP 已安装', summary: 'MCP 安装完成' }
  }
}))

import { startAgent, cancelAgent, approveCommand } from '../src/main/agent'
import type { AgentEvent } from '../src/shared/agent-types'
import type { AppSettings, ProviderConfig } from '../src/shared/types'

const provider: ProviderConfig = { id: 'deepseek', name: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com', apiKey: 'sk', models: [], createdAt: 0 }
const baseSettings: AppSettings = { version: 1, defaultProviderId: 'deepseek', defaultModelId: 'deepseek-v4-pro', temperature: 1, theme: 'dark', appFont: 'default', appFontScale: 1, enterToSend: true, agentWorkdir: '', agentPermissionMode: 'ask' }
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
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agent-test-'))
  mocks.responses.length = 0
  mocks.requests.length = 0
  mocks.mcpTools.length = 0
  mocks.mcpExecutions.length = 0
  mocks.mcpInspections.length = 0
  mocks.mcpInstalls.length = 0
  mocks.mcpResult = 'MCP 执行结果'
  mocks.mcpDelayMs = 0
  mocks.mcpActive = 0
  mocks.mcpMaxActive = 0
  mocks.mcpCandidate = undefined
})
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
    mocks.responses.push({ content: null, reasoning: '先创建目标文件。', toolCalls: [{ id: 'c1', name: 'write_file', args: { path: 'hello.txt', content: 'hello agent' } }] })
    mocks.responses.push({ content: '已完成', toolCalls: [] })
    const { events, win } = makeWin()
    startAgent(win as never, { runId: 'r1', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '写个文件', temperature: 1 }, provider, baseSettings)
    await runUntilDone(events)
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(target, 'utf-8')).toBe('hello agent')
    expect(events.some(e => e.type === 'tool_call')).toBe(true)
    expect(events.some(e => e.type === 'tool_result' && e.ok === true)).toBe(true)
    expect(events.some(e => e.type === 'text' && e.text === '已完成')).toBe(true)
    expect(events.filter(e => e.type === 'thinking').map(e => e.text ?? '').join('')).toContain('先创建目标文件。')
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

  it('切换模型后发送前会补齐上次异常中断的工具结果', async () => {
    mocks.responses.push({ content: '已恢复', toolCalls: [] })
    const { events, win } = makeWin()
    startAgent(win as never, {
      runId: 'r-repair-history',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-pro',
      workdir: dir,
      task: '怎么了',
      temperature: 1,
      history: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call-complete', type: 'function', function: { name: 'browser_snapshot', arguments: '{}' } },
            { id: 'call-missing', type: 'function', function: { name: 'browser_navigate', arguments: '{"url":"https://example.com"}' } }
          ]
        },
        { role: 'tool', tool_call_id: 'call-complete', content: '页面读取完成' }
      ]
    }, provider, baseSettings)
    await runUntilDone(events)

    const sent = mocks.requests[0].messages
    expect(sent).toContainEqual({ role: 'tool', tool_call_id: 'call-complete', content: '页面读取完成' })
    expect(sent).toContainEqual({ role: 'tool', tool_call_id: 'call-missing', content: '工具调用结果缺失；DeepDesk 已将其标记为未完成。' })
    expect(sent.at(-1)).toEqual({ role: 'user', content: '怎么了' })
    expect(events.some(event => event.type === 'error')).toBe(false)
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

  it('auto 模式：MCP 明确标注的只读工具自动执行并进入模型工具列表', async () => {
    const name = 'mcp__demo__read__12345678'
    mocks.mcpTools.push({
      name,
      serverId: 'demo',
      serverName: '演示服务器',
      toolName: 'read',
      annotations: { readOnlyHint: true, destructiveHint: false },
      definition: { type: 'function', function: { name, description: '读取数据', parameters: { type: 'object' } } }
    })
    mocks.responses.push({ content: null, toolCalls: [{ id: 'mcp-read', name, args: { id: 7 } }] })
    mocks.responses.push({ content: '读取完成', toolCalls: [] })
    const { events, win } = makeWin()
    const autoSettings: AppSettings = { ...baseSettings, agentPermissionMode: 'auto' }

    startAgent(win as never, { runId: 'r-mcp-read', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '读取 MCP 数据', temperature: 1 }, provider, autoSettings)
    await runUntilDone(events)

    expect(events.some(event => event.type === 'approval_request')).toBe(false)
    expect(mocks.mcpExecutions).toEqual([{ name, args: { id: 7 } }])
    expect(mocks.requests[0].tools).toContainEqual(expect.objectContaining({ type: 'function', function: expect.objectContaining({ name }) }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', callId: 'mcp-read', ok: true }))
  })

  it('超长工具结果完整展示，但进入下一轮模型上下文前会压缩', async () => {
    const name = 'mcp__demo__large__12345678'
    mocks.mcpTools.push({
      name,
      serverId: 'demo',
      serverName: '演示服务器',
      toolName: 'large',
      annotations: { readOnlyHint: true, destructiveHint: false },
      definition: { type: 'function', function: { name, description: '读取大量数据', parameters: { type: 'object' } } }
    })
    mocks.mcpResult = `BEGIN\n${'large result '.repeat(12000)}\nERROR: retained failure\nEND`
    mocks.responses.push({ content: null, toolCalls: [{ id: 'mcp-large', name, args: {} }] })
    mocks.responses.push({ content: '已处理', toolCalls: [] })
    const { events, win } = makeWin()
    const autoSettings: AppSettings = { ...baseSettings, agentPermissionMode: 'auto' }

    startAgent(win as never, { runId: 'r-mcp-large', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '读取大量 MCP 数据', temperature: 1 }, provider, autoSettings)
    await runUntilDone(events)

    const shown = events.find(event => event.type === 'tool_result')?.output ?? ''
    const sent = String(mocks.requests[1].messages.find(message => message.role === 'tool')?.content ?? '')
    expect(shown).toBe(mocks.mcpResult)
    expect(sent.length).toBeLessThan(shown.length)
    expect(sent).toContain('工具结果已压缩')
    expect(sent).toContain('ERROR: retained failure')
    expect(sent).toContain('END')
  })

  it('同一轮无需审批的只读 MCP 工具会并行执行并按调用顺序回填', async () => {
    const first = 'mcp__demo__first__11111111'
    const second = 'mcp__demo__second__22222222'
    for (const name of [first, second]) {
      mocks.mcpTools.push({
        name,
        serverId: 'demo',
        serverName: '演示服务器',
        toolName: name,
        annotations: { readOnlyHint: true, destructiveHint: false },
        definition: { type: 'function', function: { name, description: '读取数据', parameters: { type: 'object' } } }
      })
    }
    mocks.mcpDelayMs = 30
    mocks.responses.push({ content: null, toolCalls: [
      { id: 'parallel-first', name: first, args: { order: 1 } },
      { id: 'parallel-second', name: second, args: { order: 2 } }
    ] })
    mocks.responses.push({ content: '并行读取完成', toolCalls: [] })
    const { events, win } = makeWin()
    const autoSettings: AppSettings = { ...baseSettings, agentPermissionMode: 'auto' }

    startAgent(win as never, { runId: 'r-mcp-parallel', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '并行读取', temperature: 1 }, provider, autoSettings)
    await runUntilDone(events)

    expect(mocks.mcpMaxActive).toBe(2)
    const nextTurnResults = mocks.requests[1].messages.filter(message => message.role === 'tool')
    expect(nextTurnResults.map(message => message.tool_call_id)).toEqual(['parallel-first', 'parallel-second'])
    expect(events.some(event => event.type === 'approval_request')).toBe(false)
  })

  it('大型 MCP 目录按需搜索并在下一轮注入命中的真实工具', async () => {
    const names: string[] = []
    for (let index = 0; index < 20; index += 1) {
      const name = `mcp__server__tool_${index}__${String(index).padStart(8, '0')}`
      names.push(name)
      mocks.mcpTools.push({
        name,
        serverId: 'server',
        serverName: '扩展服务',
        toolName: index === 7 ? 'search_documents' : `tool_${index}`,
        annotations: { readOnlyHint: true, destructiveHint: false },
        definition: { type: 'function', function: { name, description: index === 7 ? '搜索企业文档' : `其他能力 ${index}`, parameters: { type: 'object' } } }
      })
    }
    mocks.responses.push({ content: null, toolCalls: [{ id: 'catalog-search', name: 'search_mcp_tools', args: { query: '企业文档' } }] })
    mocks.responses.push({ content: null, toolCalls: [{ id: 'document-search', name: names[7], args: { query: 'DeepDesk' } }] })
    mocks.responses.push({ content: '文档搜索完成', toolCalls: [] })
    const { events, win } = makeWin()
    const autoSettings: AppSettings = { ...baseSettings, agentPermissionMode: 'auto' }

    startAgent(win as never, { runId: 'r-mcp-catalog', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '查看可用扩展能力', temperature: 1 }, provider, autoSettings)
    await runUntilDone(events)

    const firstTools = mocks.requests[0].tools.map(item => (item.function as { name?: string }).name)
    const secondTools = mocks.requests[1].tools.map(item => (item.function as { name?: string }).name)
    expect(firstTools).toContain('search_mcp_tools')
    expect(firstTools).not.toContain(names[7])
    expect(secondTools).toContain(names[7])
    expect(mocks.mcpExecutions).toContainEqual({ name: names[7], args: { query: 'DeepDesk' } })
    expect(events.some(event => event.type === 'approval_request')).toBe(false)
  })

  it('auto 模式：未声明只读的 MCP 工具仍需用户批准', async () => {
    const name = 'mcp__demo__write__87654321'
    mocks.mcpTools.push({
      name,
      serverId: 'demo',
      serverName: '演示服务器',
      toolName: 'write',
      annotations: { destructiveHint: true },
      definition: { type: 'function', function: { name, description: '写入数据', parameters: { type: 'object' } } }
    })
    mocks.responses.push({ content: null, toolCalls: [{ id: 'mcp-write', name, args: { value: 'x' } }] })
    mocks.responses.push({ content: '已取消', toolCalls: [] })
    const { events, win } = makeWin()
    const autoSettings: AppSettings = { ...baseSettings, agentPermissionMode: 'auto' }

    startAgent(win as never, { runId: 'r-mcp-write', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '写入 MCP 数据', temperature: 1 }, provider, autoSettings)
    const approval = await waitForApproval(events)

    expect(approval).toEqual(expect.objectContaining({ reason: '调用外部 MCP 工具：演示服务器 · write', command: '演示服务器 · write' }))
    approveCommand(approval!.callId!, false)
    await runUntilDone(events)
    expect(mocks.mcpExecutions).toEqual([])
  })

  it('会话可以检查 MCP 地址，但安装即使在 full 模式也必须展示服务详情并确认', async () => {
    mocks.mcpCandidate = {
      candidateId: 'candidate-1',
      name: 'Docs MCP',
      source: 'https://mcp.example.com/mcp',
      serverVersion: '2.1.0',
      toolNames: ['search_docs', 'read_doc']
    }
    mocks.responses.push({ content: null, toolCalls: [{ id: 'inspect-1', name: 'inspect_mcp_server', args: { source: 'https://mcp.example.com/mcp' } }] })
    mocks.responses.push({ content: null, toolCalls: [{ id: 'install-1', name: 'install_mcp_server', args: { candidate_id: 'candidate-1' } }] })
    mocks.responses.push({ content: '安装完成', toolCalls: [] })
    const { events, win } = makeWin()
    const fullSettings: AppSettings = { ...baseSettings, agentPermissionMode: 'full' }

    startAgent(win as never, { runId: 'r-mcp-install', providerId: 'deepseek', modelId: 'deepseek-v4-pro', workdir: dir, task: '安装这个 MCP', temperature: 1 }, provider, fullSettings)
    const approval = await waitForApproval(events)

    expect(mocks.mcpInspections).toEqual([{ source: 'https://mcp.example.com/mcp', runId: 'r-mcp-install' }])
    expect(approval).toEqual(expect.objectContaining({
      callId: 'install-1',
      reason: '安装 MCP 服务',
      command: 'Docs MCP',
      target: 'https://mcp.example.com/mcp',
      mcpInstall: mocks.mcpCandidate
    }))
    expect(mocks.mcpInstalls).toEqual([])

    approveCommand('install-1', true)
    await runUntilDone(events)

    expect(mocks.mcpInstalls).toEqual([{ candidateId: 'candidate-1', runId: 'r-mcp-install' }])
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_result', callId: 'install-1', ok: true }))
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
