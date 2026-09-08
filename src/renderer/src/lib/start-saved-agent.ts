import type { AgentRunRequest, AgentSession } from '@shared/agent-types'

export async function startSavedAgent(session: AgentSession, request: AgentRunRequest, isCurrent: () => boolean = () => true): Promise<{ ok: boolean; message?: string }> {
  try {
    await window.api.agent.saveSession(session)
    if (!isCurrent()) return { ok: false, message: '已停止' }
    return await window.api.agent.start(request)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '会话保存或启动失败' }
  }
}
