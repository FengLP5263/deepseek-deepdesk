import { describe, expect, it } from 'vitest'
import { compactToolResultForContext, CONTEXT_COMPRESSION_TARGET, estimateContextUsage, estimateTextTokens, estimateToolDefinitionsTokens, getModelContextWindow, manageContextMessages, repairToolCallHistory, toolResultContextTokenBudget } from '../src/shared/context-manager'
import type { ProviderConfig } from '../src/shared/types'

describe('context-manager', () => {
  it('estimates context composition by independent buckets', () => {
    const usage = estimateContextUsage([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: '用户问题' },
      {
        role: 'assistant',
        content: '需要调用工具',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'run_command', arguments: '{"command":"pnpm test"}' } }]
      },
      { role: 'tool', tool_call_id: 'c1', content: '测试通过' }
    ], '当前输入')

    expect(usage.parts.map(part => part.tone)).toEqual(['system', 'user', 'assistant', 'tool-call', 'tool-result', 'input'])
    expect(usage.used).toBeGreaterThan(0)
  })

  it('将发送给模型的工具定义计入上下文组成', () => {
    const tools = [{ type: 'function', function: { name: 'search', description: '搜索项目内容', parameters: { type: 'object', properties: { query: { type: 'string' } } } } }]
    const usage = estimateContextUsage([{ role: 'user', content: '查一下' }], '', tools)

    expect(estimateToolDefinitionsTokens(tools)).toBeGreaterThan(0)
    expect(usage.parts).toContainEqual(expect.objectContaining({ label: '工具定义', tone: 'tool-schema' }))
    expect(usage.used).toBeGreaterThan(estimateContextUsage([{ role: 'user', content: '查一下' }]).used)
  })

  it('将 Responses API 的加密推理历史计入 AI 上下文', () => {
    const usage = estimateContextUsage([
      { role: 'user', content: '继续' },
      { type: 'reasoning', id: 'rs_1', encrypted_content: 'encrypted-context'.repeat(80), summary: [] }
    ])

    expect(usage.parts.find(part => part.tone === 'assistant')?.tokens).toBeGreaterThan(100)
  })

  it('keeps messages unchanged when they are inside the safe budget', () => {
    const messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' }
    ]

    const result = manageContextMessages(messages, { contextWindow: 1000, threshold: 1, reserveTokens: 0 })

    expect(result.compressed).toBe(false)
    expect(result.messages).toEqual(messages)
  })

  it('repairs incomplete tool call history before switching models', () => {
    const repaired = repairToolCallHistory([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call-1', type: 'function', function: { name: 'browser_snapshot', arguments: '{}' } },
          { id: 'call-2', type: 'function', function: { name: 'browser_navigate', arguments: '{"url":"https://example.com"}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'call-1', content: '页面读取完成' },
      { role: 'user', content: '怎么了' },
      { role: 'tool', tool_call_id: 'orphan', content: '孤立结果' }
    ])

    expect(repaired).toEqual([
      expect.objectContaining({ role: 'assistant' }),
      { role: 'tool', tool_call_id: 'call-1', content: '页面读取完成' },
      { role: 'tool', tool_call_id: 'call-2', content: '工具调用结果缺失；DeepDesk 已将其标记为未完成。' },
      { role: 'user', content: '怎么了' }
    ])
  })

  it('compresses older turns and keeps the latest user request', () => {
    const oldText = '较早上下文'.repeat(500)
    const messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: oldText },
      { role: 'assistant', content: oldText },
      { role: 'user', content: '最新问题必须保留' }
    ]

    const result = manageContextMessages(messages, { contextWindow: 900, threshold: 1, reserveTokens: 0 })

    expect(result.compressed).toBe(true)
    expect(result.messages[0]).toEqual({ role: 'system', content: 'system prompt' })
    expect(result.messages.some(message => String(message.content).includes('[上下文压缩摘要]'))).toBe(true)
    expect(result.messages.at(-1)).toEqual({ role: 'user', content: '最新问题必须保留' })
    expect(result.after.used).toBeLessThan(result.before.used)
    expect(result.after.used).toBeLessThanOrEqual(Math.floor(900 * CONTEXT_COMPRESSION_TARGET))
  })

  it('触发整理时通知调用方并为后续对话留出明显余量', () => {
    let notifications = 0
    const messages = Array.from({ length: 20 }, (_, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', content: `历史消息 ${index} ${'上下文'.repeat(120)}` }))
    const result = manageContextMessages(messages, { contextWindow: 4000, reserveTokens: 200, onCompactionStart: () => { notifications += 1 } })

    expect(notifications).toBe(1)
    expect(result.compressed).toBe(true)
    expect(result.after.used).toBeLessThanOrEqual(Math.floor(4000 * CONTEXT_COMPRESSION_TARGET) - 200)
  })

  it('压缩预算会扣除工具定义而不是只计算消息正文', () => {
    const history = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: '旧问题'.repeat(300) },
      { role: 'assistant', content: '旧回答'.repeat(300) },
      { role: 'user', content: '当前问题' }
    ]
    const tools = [{ type: 'function', function: { name: 'large_tool', description: '工具说明'.repeat(250), parameters: { type: 'object', properties: {} } } }]
    const withoutTools = manageContextMessages(history, { contextWindow: 3000, threshold: 1, reserveTokens: 500 })
    const withTools = manageContextMessages(history, { contextWindow: 3000, threshold: 1, reserveTokens: 500, tools })

    expect(withoutTools.compressed).toBe(false)
    expect(withTools.compressed).toBe(true)
    expect(withTools.after.used).toBeLessThanOrEqual(2500)
    expect(withTools.after.parts.some(part => part.tone === 'tool-schema')).toBe(true)
  })

  it('does not keep orphan tool result messages at the start of recent context', () => {
    const messages = [
      { role: 'system', content: 'system prompt' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"large.txt"}' } }]
      },
      { role: 'tool', tool_call_id: 'c1', content: 'very large result '.repeat(400) },
      { role: 'user', content: '继续' }
    ]

    const result = manageContextMessages(messages, { contextWindow: 420, threshold: 1, reserveTokens: 0 })
    const firstNonSystem = result.messages.find(message => message.role !== 'system')

    expect(result.compressed).toBe(true)
    expect(firstNonSystem?.role).not.toBe('tool')
    expect(result.messages.at(-1)).toEqual({ role: 'user', content: '继续' })
  })

  it('recompresses previous compression summaries instead of stacking them as protected system prompts', () => {
    const messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'system', content: '[上下文压缩摘要]\n上一轮摘要'.repeat(200) },
      { role: 'user', content: '旧问题'.repeat(300) },
      { role: 'assistant', content: '旧回答'.repeat(300) },
      { role: 'user', content: '当前问题' }
    ]

    const result = manageContextMessages(messages, { contextWindow: 800, threshold: 1, reserveTokens: 0 })
    const summaries = result.messages.filter(message => String(message.content).includes('[上下文压缩摘要]'))

    expect(result.compressed).toBe(true)
    expect(summaries).toHaveLength(1)
    expect(result.messages.at(-1)).toEqual({ role: 'user', content: '当前问题' })
  })

  it('压缩时优先保留中段关键决定并限制摘要自身预算', () => {
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: 'system prompt' },
      ...Array.from({ length: 8 }, (_, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', content: `普通早期内容 ${index} ${'说明'.repeat(120)}` })),
      { role: 'user', content: '关键决定：发布前必须运行完整测试，失败时不要合并。' },
      ...Array.from({ length: 14 }, (_, index) => ({ role: index % 2 === 0 ? 'assistant' : 'user', content: `普通后续内容 ${index} ${'细节'.repeat(120)}` })),
      { role: 'user', content: '请继续处理当前任务' }
    ]

    const result = manageContextMessages(messages, { contextWindow: 900, threshold: 1, reserveTokens: 0 })
    const summary = result.messages.find(message => String(message.content).startsWith('[上下文压缩摘要]'))

    expect(result.compressed).toBe(true)
    expect(String(summary?.content)).toContain('发布前必须运行完整测试')
    expect(estimateContextUsage([summary ?? {}]).used).toBeLessThanOrEqual(512)
    expect(result.after.used).toBeLessThanOrEqual(900)
  })

  it('reads configured model context window with a 256K fallback', () => {
    const provider: ProviderConfig = {
      id: 'p',
      name: 'Provider',
      type: 'openai',
      baseUrl: 'https://example.com',
      apiKey: 'sk',
      createdAt: 1,
      models: [{ id: 'small', contextWindow: 32000 }]
    }

    expect(getModelContextWindow(provider, 'small')).toBe(32000)
    expect(getModelContextWindow(provider, 'missing')).toBe(256000)
  })

  it('compacts oversized tool results while preserving boundaries and key failures', () => {
    const content = `BEGIN\n${'ordinary output '.repeat(800)}\nERROR: important failure\n${'tail output '.repeat(800)}\nEND`
    const compacted = compactToolResultForContext(content, 500)

    expect(estimateTextTokens(compacted)).toBeLessThanOrEqual(500)
    expect(compacted).toContain('BEGIN')
    expect(compacted).toContain('ERROR: important failure')
    expect(compacted).toContain('END')
    expect(compacted).toContain('工具结果已压缩')
  })

  it('scales a single tool result budget with the model context window', () => {
    expect(toolResultContextTokenBudget(256000)).toBe(8000)
    expect(toolResultContextTokenBudget(32000)).toBe(1920)
    expect(toolResultContextTokenBudget(900)).toBe(128)
    expect(compactToolResultForContext('short result', 128)).toBe('short result')
  })
})
