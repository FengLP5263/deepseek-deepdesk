import { describe, expect, it } from 'vitest'
import { estimateContextUsage, getModelContextWindow, manageContextMessages } from '../src/shared/context-manager'
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

  it('keeps messages unchanged when they are inside the safe budget', () => {
    const messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'hello' }
    ]

    const result = manageContextMessages(messages, { contextWindow: 1000, threshold: 1, reserveTokens: 0 })

    expect(result.compressed).toBe(false)
    expect(result.messages).toEqual(messages)
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
})
