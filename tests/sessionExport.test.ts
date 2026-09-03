import { describe, expect, it } from 'vitest'
import type { AgentSession } from '../src/shared/agent-types'
import { sessionExportContent, sessionExportFilename } from '../src/shared/session-export'

function session(): AgentSession {
  return {
    id: 'session-1',
    task: '项目状态总结',
    workdir: 'C:\\workspace',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-pro',
    createdAt: 1,
    updatedAt: 2,
    steps: [
      { kind: 'task', text: '检查项目状态' },
      { kind: 'thinking', text: '先读取仓库。', status: 'ok' },
      { kind: 'context', beforeTokens: 146000, afterTokens: 82000 },
      { kind: 'tool', name: 'run_command', args: '{"command":"git status"}', status: 'ok', result: 'clean' },
      { kind: 'text', text: '项目状态正常。' }
    ],
    history: [{ role: 'user', content: '检查项目状态' }],
    source: { type: 'connector', connectorId: 'wechat', externalThreadId: 'thread-1', externalReplyToken: 'secret-reply-token' }
  }
}

describe('Agent 会话导出', () => {
  it('Markdown 保留可读步骤并移除连接器回复凭据', () => {
    const output = sessionExportContent(session(), 'markdown')

    expect(output).toContain('# 项目状态总结')
    expect(output).toContain('## 用户\n\n检查项目状态')
    expect(output).toContain('<summary>思考过程</summary>')
    expect(output).toContain('上下文已自动整理：146K → 82K')
    expect(output).toContain('## 工具 · run_command')
    expect(output).toContain('## DeepDesk\n\n项目状态正常。')
    expect(output).not.toContain('secret-reply-token')
  })

  it('JSON 可重新解析且不会导出短时回复令牌', () => {
    const parsed = JSON.parse(sessionExportContent(session(), 'json')) as AgentSession

    expect(parsed.steps).toHaveLength(5)
    expect(parsed.source?.type === 'connector' ? parsed.source.externalReplyToken : undefined).toBeUndefined()
  })

  it('生成跨平台安全文件名', () => {
    expect(sessionExportFilename('方案：A/B? ', 'markdown')).toBe('方案-A-B-.md')
    expect(sessionExportFilename('CON', 'json')).toBe('DeepDesk-CON.json')
  })
})
