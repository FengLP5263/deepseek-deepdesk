import type { AgentSession, AgentStep } from '../shared/agent-types'
import type { Conversation } from '../shared/types'
import { repairToolCallHistory } from '../shared/context-manager'

function validateRecords(value: unknown, field: string): void {
  // Early versions omitted empty arrays. Non-array data is corruption, not an empty session.
  if (value == null) return
  if (!Array.isArray(value) || value.some(item => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new Error(`会话数据格式无效（${field}），已停止加载，请保留原始数据以便恢复`)
  }
}

function historyFromSteps(steps: AgentStep[]): Array<Record<string, unknown>> {
  const history: Array<Record<string, unknown>> = []
  for (const step of steps) {
    if ((step.kind === 'task' || step.kind === 'text') && typeof step.text === 'string' && step.text) {
      history.push({ role: step.kind === 'task' ? 'user' : 'assistant', content: step.text })
    } else if (step.kind === 'tool' && typeof step.callId === 'string' && step.callId && typeof step.name === 'string' && step.name) {
      history.push({ role: 'assistant', content: null, tool_calls: [{
        id: step.callId, type: 'function',
        function: { name: step.name, arguments: typeof step.args === 'string' ? step.args : '{}' }
      }] })
      history.push({ role: 'tool', tool_call_id: step.callId,
        content: typeof step.result === 'string' ? step.result : '旧会话未保存工具返回内容；无法确认执行结果。' })
    }
  }
  // Thinking, errors and UI compaction notices are not model answers or system instructions.
  return history
}

export function recoverAgentSession(session: AgentSession): AgentSession {
  validateRecords(session.steps, 'steps')
  validateRecords(session.history, 'history')
  const steps = (session.steps ?? []).map(step => step.status === 'running'
    ? { ...step, status: 'cancelled' as const, message: '上次运行已中断，未自动重试' }
    : step)
  return { ...session, steps, history: repairToolCallHistory(session.history ?? historyFromSteps(steps)) }
}

export function recoverConversation(conversation: Conversation): Conversation {
  validateRecords(conversation.messages, 'messages')
  return { ...conversation, messages: (conversation.messages ?? []).map(message => message.streaming
    ? { ...message, streaming: false, error: true }
    : message) }
}
