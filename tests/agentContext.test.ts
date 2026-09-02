import { describe, expect, it } from 'vitest'
import {
  AGENT_MEMORY_CONTEXT_MARKER,
  AGENT_SYSTEM_PROMPT_MARKER,
  assembleAgentMessages,
  persistableAgentHistory
} from '../src/shared/agent-context'

describe('agent-context', () => {
  it('按稳定顺序装配系统指令、当轮记忆、历史与当前输入', () => {
    const messages = assembleAgentMessages({
      systemPrompt: '当前系统指令',
      memoryContext: '当前命中的记忆',
      history: [
        { role: 'system', content: '你是 DeepDesk Agent，一个旧版本提示。' },
        { role: 'system', content: `${AGENT_MEMORY_CONTEXT_MARKER}\n上一轮记忆` },
        { role: 'user', content: '上一问' },
        { role: 'assistant', content: '上一答' }
      ],
      task: '当前问题'
    })

    expect(messages).toEqual([
      { role: 'system', content: `${AGENT_SYSTEM_PROMPT_MARKER}\n当前系统指令` },
      { role: 'system', content: `${AGENT_MEMORY_CONTEXT_MARKER}\n当前命中的记忆` },
      { role: 'user', content: '上一问' },
      { role: 'assistant', content: '上一答' },
      { role: 'user', content: '当前问题' }
    ])
  })

  it('续聊历史缺失系统指令时自动补齐，并修复不完整工具调用链', () => {
    const messages = assembleAgentMessages({
      systemPrompt: '系统指令',
      history: [{
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_file', arguments: '{}' } }]
      }],
      task: '继续'
    })

    expect(messages[0]).toEqual({ role: 'system', content: `${AGENT_SYSTEM_PROMPT_MARKER}\n系统指令` })
    expect(messages).toContainEqual({ role: 'tool', tool_call_id: 'call-1', content: '工具调用结果缺失；DeepDesk 已将其标记为未完成。' })
    expect(messages.at(-1)).toEqual({ role: 'user', content: '继续' })
  })

  it('持久化时移除只属于当前请求的检索记忆', () => {
    const history = persistableAgentHistory([
      { role: 'system', content: `${AGENT_SYSTEM_PROMPT_MARKER}\n系统指令` },
      { role: 'system', content: `${AGENT_MEMORY_CONTEXT_MARKER}\n临时记忆` },
      { role: 'user', content: '问题' },
      { role: 'assistant', content: '回答' }
    ])

    expect(history).toEqual([
      { role: 'system', content: `${AGENT_SYSTEM_PROMPT_MARKER}\n系统指令` },
      { role: 'user', content: '问题' },
      { role: 'assistant', content: '回答' }
    ])
  })
})
