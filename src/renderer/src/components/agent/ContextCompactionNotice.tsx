import { useEffect, useState } from 'react'
import { ChevronsDown } from 'lucide-react'

const MIN_PROGRESS_MS = 900

function formatTokens(value?: number): string {
  if (value === undefined) return '未知'
  return value >= 1000 ? `${Math.round(value / 100) / 10}K` : String(value)
}

export default function ContextCompactionNotice({ beforeTokens, afterTokens, status, startedAt }: { beforeTokens?: number; afterTokens?: number; status?: string; startedAt?: number }) {
  const remaining = Math.max(0, MIN_PROGRESS_MS - (Date.now() - (startedAt ?? 0)))
  const [showProgress, setShowProgress] = useState(status === 'running' || remaining > 0)
  useEffect(() => {
    if (status === 'running') { setShowProgress(true); return }
    if (remaining <= 0) { setShowProgress(false); return }
    const timer = window.setTimeout(() => setShowProgress(false), remaining)
    return () => window.clearTimeout(timer)
  }, [remaining, status])
  return (
    <div className={`agent-context-compaction${showProgress ? ' thinking is-streaming' : ''}`} role='status' aria-live='polite'>
      <ChevronsDown size={14} aria-hidden />
      <span className={showProgress ? 'thinking-status' : undefined}>{showProgress ? '正在整理上下文' : '已自动整理上下文'}</span>
      {!showProgress && <span className='agent-context-compaction-count'>{formatTokens(beforeTokens)} → {formatTokens(afterTokens)}</span>}
    </div>
  )
}
