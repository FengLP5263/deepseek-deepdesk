import type { AgentSession, AgentSessionExportFormat, AgentStep } from './agent-types'

function codeBlock(value: string): string {
  const fence = value.includes('```') ? '````' : '```'
  return `${fence}\n${value}\n${fence}`
}

function formatCount(value?: number): string {
  if (value === undefined) return '未知'
  return value >= 1000 ? `${Math.round(value / 100) / 10}K` : String(value)
}

function stepMarkdown(step: AgentStep): string {
  switch (step.kind) {
    case 'task': return `## 用户\n\n${step.text ?? ''}`
    case 'text': return `## DeepDesk\n\n${step.text ?? ''}`
    case 'thinking': return `<details>\n<summary>思考过程</summary>\n\n${step.text ?? ''}\n\n</details>`
    case 'context': return `> 上下文已自动整理：${formatCount(step.beforeTokens)} → ${formatCount(step.afterTokens)}`
    case 'error': return `> 错误：${step.message ?? '未知错误'}`
    case 'tool': {
      const status = step.status === 'ok' ? '完成' : step.status === 'running' ? '运行中' : step.status === 'cancelled' ? '已停止' : step.status === 'denied' ? '已拒绝' : '出错'
      const sections = [`## 工具 · ${step.name ?? '未知工具'}`, `状态：${status}`]
      if (step.args) sections.push(`参数\n\n${codeBlock(step.args)}`)
      if (step.result) sections.push(`结果\n\n${codeBlock(step.result)}`)
      return sections.join('\n\n')
    }
  }
}

function exportableSession(session: AgentSession): AgentSession {
  const copy = structuredClone(session)
  if (copy.source?.type === 'connector') delete copy.source.externalReplyToken
  return copy
}

export function sessionExportContent(session: AgentSession, format: AgentSessionExportFormat): string {
  const safe = exportableSession(session)
  if (format === 'json') return JSON.stringify(safe, null, 2) + '\n'
  const metadata = [
    `# ${safe.task}`,
    `- 导出时间：${new Date().toISOString()}`,
    `- 模型：${safe.modelId}`,
    safe.workdir ? `- 工作目录：${safe.workdir}` : '',
    safe.source?.type === 'connector' ? `- 来源：${safe.source.connectorId === 'wechat' ? '微信' : '飞书'}` : ''
  ].filter(Boolean)
  return [...metadata, '---', ...safe.steps.map(stepMarkdown)].join('\n\n').trim() + '\n'
}

export function sessionExportFilename(title: string, format: AgentSessionExportFormat): string {
  let name = Array.from(title.normalize('NFKC').replace(/[<>:"/\\|?*]/gu, '-'), (character) =>
    character.charCodeAt(0) < 32 ? '-' : character
  ).join('').replace(/[. ]+$/u, '').trim().slice(0, 80)
  if (!name) name = 'DeepDesk 会话'
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(name)) name = `DeepDesk-${name}`
  return `${name}.${format === 'markdown' ? 'md' : 'json'}`
}
