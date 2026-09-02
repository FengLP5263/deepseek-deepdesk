import { repairToolCallHistory } from './context-manager'

export const AGENT_SYSTEM_PROMPT_MARKER = '[DeepDesk Agent 系统指令]'
export const AGENT_MEMORY_CONTEXT_MARKER = '[DeepDesk 当轮检索记忆]'

interface AgentContextAssemblyOptions {
  history?: Array<Record<string, unknown>>
  systemPrompt: string
  memoryContext?: string
  task: string
}

function messageContent(message: Record<string, unknown>): string {
  return typeof message.content === 'string' ? message.content.trim() : ''
}

function isDeepDeskSystemPrompt(message: Record<string, unknown>): boolean {
  if (message.role !== 'system') return false
  const content = messageContent(message)
  return content.startsWith(AGENT_SYSTEM_PROMPT_MARKER) || content.startsWith('你是 DeepDesk Agent，')
}

export function isAgentMemoryContext(message: Record<string, unknown>): boolean {
  if (message.role !== 'system') return false
  const content = messageContent(message)
  return content.startsWith(AGENT_MEMORY_CONTEXT_MARKER)
    || content.startsWith('以下是用户允许 DeepDesk 在本地保存并用于本次回答的长期记忆。')
}

export function markAgentSystemPrompt(prompt: string): string {
  const content = prompt.trim()
  return content.startsWith(AGENT_SYSTEM_PROMPT_MARKER)
    ? content
    : `${AGENT_SYSTEM_PROMPT_MARKER}\n${content}`
}

export function assembleAgentMessages(options: AgentContextAssemblyOptions): Array<Record<string, unknown>> {
  const repairedHistory = repairToolCallHistory(options.history ?? [])
  const retainedHistory = repairedHistory.filter(message => !isDeepDeskSystemPrompt(message) && !isAgentMemoryContext(message))
  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: markAgentSystemPrompt(options.systemPrompt) }
  ]
  const memory = options.memoryContext?.trim()
  if (memory) messages.push({ role: 'system', content: `${AGENT_MEMORY_CONTEXT_MARKER}\n${memory}` })
  messages.push(...retainedHistory)
  const task = options.task.trim()
  if (task) messages.push({ role: 'user', content: task })
  return messages
}

export function persistableAgentHistory(messages: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return messages.filter(message => !isAgentMemoryContext(message)).map(message => ({ ...message }))
}
