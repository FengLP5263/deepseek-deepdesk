import type { AgentStep } from '@shared/agent-types'
import { appendAgentStep, finishAgentThinking } from './agent-steps'

export type AgentStreamChunkKind = 'text' | 'thinking'

export interface AgentStreamChunk {
  kind: AgentStreamChunkKind
  text: string
}

export interface AgentStreamBufferState {
  chunks: AgentStreamChunk[]
  timer: number | null
}

export function createAgentStreamBuffer(): AgentStreamBufferState {
  return { chunks: [], timer: null }
}

export function bufferAgentStreamChunk(buffer: AgentStreamBufferState, kind: AgentStreamChunkKind, text: string): void {
  if (!text) return
  const previous = buffer.chunks.at(-1)
  if (previous?.kind === kind) previous.text += text
  else buffer.chunks.push({ kind, text })
}

export function drainAgentStreamBuffer(buffer: AgentStreamBufferState): AgentStreamChunk[] {
  const chunks = buffer.chunks
  buffer.chunks = []
  return chunks
}

export function applyAgentStreamChunks(steps: AgentStep[], chunks: AgentStreamChunk[]): AgentStep[] {
  let next = steps
  for (const chunk of chunks) {
    if (chunk.kind === 'thinking') {
      next = appendAgentStep(next, { kind: 'thinking', text: chunk.text, status: 'running' })
      continue
    }

    next = finishAgentThinking(next)
    const previous = next.at(-1)
    if (previous?.kind === 'text') {
      next = [...next.slice(0, -1), { ...previous, text: (previous.text ?? '') + chunk.text }]
    } else {
      next = [...next, { kind: 'text', text: chunk.text }]
    }
  }
  return next
}
