import { ChevronsDown } from 'lucide-react'

function formatTokens(value?: number): string {
  if (value === undefined) return '未知'
  return value >= 1000 ? `${Math.round(value / 100) / 10}K` : String(value)
}

export default function ContextCompactionNotice({ beforeTokens, afterTokens }: { beforeTokens?: number; afterTokens?: number }) {
  return (
    <div className='agent-context-compaction' role='status'>
      <ChevronsDown size={14} aria-hidden />
      <span>已自动整理上下文</span>
      <span className='agent-context-compaction-count'>{formatTokens(beforeTokens)} → {formatTokens(afterTokens)}</span>
    </div>
  )
}
