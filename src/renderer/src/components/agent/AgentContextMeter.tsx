import { estimateContextUsage, estimateTextTokens, type ContextUsage } from '@shared/context-manager'
import { formatTokens } from '../../lib/format'

interface AgentContextMeterProps {
  history: Array<Record<string, unknown>>
  currentInput: string
  contextWindow: number
  reserveTokens: number
  measuredUsage?: ContextUsage
  open: boolean
  onToggle: () => void
}

export default function AgentContextMeter({ history, currentInput, contextWindow, reserveTokens, measuredUsage, open, onToggle }: AgentContextMeterProps) {
  const baseUsage = measuredUsage ?? estimateContextUsage(history)
  const inputTokens = estimateTextTokens(currentInput)
  const parts = [
    ...baseUsage.parts,
    ...(inputTokens > 0 ? [{ label: '当前输入', tokens: inputTokens, tone: 'input' as const }] : []),
    { label: '回复预留', tokens: reserveTokens, tone: 'output-reserve' as const }
  ]
  const usage = { used: parts.reduce((sum, part) => sum + part.tokens, 0), parts }
  const used = usage.used
  const percent = Math.min(100, Math.round(used / contextWindow * 100))
  const radius = 5.5
  const circumference = 2 * Math.PI * radius
  return (
    <span className='ctx-meter'>
      <button className='ctx-trigger' aria-expanded={open} onClick={onToggle} title='上下文用量'>
        <svg viewBox='0 0 14 14' width='14' height='14' aria-hidden>
          <circle className='ctx-track' cx='7' cy='7' r={radius} />
          <circle className='ctx-fill' cx='7' cy='7' r={radius} strokeDasharray={circumference * percent / 100 + ' ' + circumference} transform='rotate(-90 7 7)' />
        </svg>
      </button>
      {open && (
        <div className='ctx-panel'>
          <div className='ctx-header'>
            <span>上下文占用</span>
            <span className='ctx-percent'>{percent}%</span>
            <span className='ctx-figures'>~{formatTokens(used)} / {formatTokens(contextWindow)}</span>
          </div>
          <div className='ctx-bar' aria-label='上下文组成进度'>
            {usage.parts.map(part => (
              <div className='ctx-bar-segment' data-tone={part.tone} key={part.label} style={{ width: Math.max(0.8, part.tokens / contextWindow * 100) + '%' }} title={`${part.label}：~${formatTokens(part.tokens)}`} />
            ))}
          </div>
          <div className='ctx-breakdown' aria-label='上下文组成'>
            {usage.parts.length > 0 ? usage.parts.map(part => (
              <div className='ctx-breakdown-row' data-tone={part.tone} key={part.label}>
                <span className='ctx-breakdown-label'><span className='ctx-breakdown-dot' aria-hidden />{part.label}</span>
                <span className='ctx-breakdown-value'>~{formatTokens(part.tokens)}</span>
              </div>
            )) : <div className='ctx-breakdown-empty'>暂无上下文内容</div>}
          </div>
        </div>
      )}
    </span>
  )
}
