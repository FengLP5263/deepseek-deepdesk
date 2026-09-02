export type McpAgentToolName = `mcp__${string}`

export type AgentInteractionMode = 'execute' | 'plan'

export type AgentToolName =
  | 'run_command'
  | 'read_file'
  | 'write_file'
  | 'edit_file'
  | 'list_files'
  | 'search_content'
  | 'search_feishu_user'
  | 'send_feishu_message'
  | 'browser_pages'
  | 'browser_navigate'
  | 'browser_snapshot'
  | 'browser_click'
  | 'browser_type'
  | 'browser_hover'
  | 'browser_scroll'
  | 'browser_debug'
  | 'browser_evaluate'
  | 'inspect_mcp_server'
  | 'install_mcp_server'
  | 'search_mcp_tools'
  | McpAgentToolName

export interface McpInstallApproval {
  candidateId: string
  name: string
  source: string
  serverVersion?: string
  toolNames: string[]
}

export interface AgentQueuedMessage {
  id: string
  text: string
  createdAt: number
}

export type AgentSessionSource =
  | { type: 'desktop' }
  | {
    type: 'connector'
    connectorId: 'lark' | 'wechat'
    externalThreadId: string
    externalUserName?: string
    externalConversationName?: string
    externalReplyToken?: string
    lastSyncAt?: number
  }

export interface AgentToolCall {
  id: string
  name: AgentToolName
  args: Record<string, unknown>
}

export interface AgentRunRequest {
  runId: string
  providerId: string
  modelId: string
  workdir: string
  task: string
  temperature: number
  interactionMode?: AgentInteractionMode
  history?: Array<Record<string, unknown>>
  memoryContext?: string
}

export interface AgentToolResult {
  ok: boolean
  content: string
  summary: string
}

export type AgentEventType = 'thinking' | 'text' | 'tool_call' | 'tool_result' | 'approval_request' | 'done' | 'error'

export interface AgentEvent {
  runId: string
  type: AgentEventType
  text?: string
  message?: string
  call?: AgentToolCall
  callId?: string
  summary?: string
  output?: string
  ok?: boolean
  command?: string
  cwd?: string
  target?: string
  reason?: string
  mcpInstall?: McpInstallApproval
  history?: Array<Record<string, unknown>>
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
}

export type AgentStepKind = 'task' | 'thinking' | 'text' | 'tool' | 'error'

export interface AgentStep {
  kind: AgentStepKind
  text?: string
  callId?: string
  name?: string
  args?: string
  status?: 'running' | 'ok' | 'error' | 'denied' | 'cancelled'
  summary?: string
  result?: string
  message?: string
  feedback?: 'positive' | 'negative'
  sourceActivityId?: string
  sourceConnectorId?: 'lark' | 'wechat'
}

export interface AgentSession {
  id: string
  task: string
  workdir: string
  providerId?: string
  modelId: string
  createdAt: number
  updatedAt: number
  steps: AgentStep[]
  history: Array<Record<string, unknown>>
  queuedMessages?: AgentQueuedMessage[]
  hasUnread?: boolean
  source?: AgentSessionSource
}
