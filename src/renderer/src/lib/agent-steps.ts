import type { AgentStep } from '@shared/agent-types'

export function appendAgentStep(steps: AgentStep[], step: AgentStep): AgentStep[] {
  const next = [...steps]
  const previous = next.at(-1)

  if (step.kind === 'thinking' && previous?.kind === 'thinking') {
    if (!step.text) return steps
    next[next.length - 1] = {
      ...previous,
      text: (previous.text ?? '') + step.text,
      status: 'running'
    }
    return next
  }

  if (step.kind !== 'thinking' && previous?.kind === 'thinking') {
    if (previous.text?.trim()) next[next.length - 1] = { ...previous, status: 'ok' }
    else next.pop()
  }
  next.push(step)
  return next
}

export function finishAgentThinking(steps: AgentStep[]): AgentStep[] {
  const next = [...steps]
  const last = next.at(-1)
  if (last?.kind !== 'thinking') return next
  if (!last.text?.trim()) next.pop()
  else next[next.length - 1] = { ...last, status: 'ok' }
  return next
}
