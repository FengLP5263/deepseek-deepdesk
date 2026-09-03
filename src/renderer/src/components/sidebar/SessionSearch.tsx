import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, MessageSquare, Search, X } from 'lucide-react'
import type { AgentSession } from '@shared/agent-types'
import { searchAgentSessions } from '../../lib/session-search'
import { formatTime } from '../../lib/format'

export default function SessionSearch({ open, sessions, onClose, onOpenSession }: {
  open: boolean
  sessions: AgentSession[]
  onClose: () => void
  onOpenSession: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const results = useMemo(() => searchAgentSessions(sessions, query), [query, sessions])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActiveIndex(0)
    window.requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => setActiveIndex(0), [query])

  if (!open) return null

  const openResult = (id: string): void => {
    onOpenSession(id)
    onClose()
  }

  return (
    <div className='session-search-backdrop' role='presentation' onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className='session-search-dialog' role='dialog' aria-modal='true' aria-label='搜索任务'>
        <div className='session-search-input-wrap'>
          <Search size={17} aria-hidden />
          <input
            ref={inputRef}
            className='session-search-input'
            value={query}
            placeholder='搜索任务或对话内容'
            aria-label='搜索任务或对话内容'
            aria-controls='session-search-results'
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex(index => Math.min(Math.max(0, results.length - 1), index + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex(index => Math.max(0, index - 1))
              } else if (event.key === 'Enter' && results[activeIndex]) {
                event.preventDefault()
                openResult(results[activeIndex].session.id)
              } else if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                onClose()
              }
            }}
          />
          {query && <button className='session-search-clear' aria-label='清空搜索' onClick={() => setQuery('')}><X size={15} /></button>}
          <kbd>Esc</kbd>
        </div>
        <div className='session-search-results' id='session-search-results' role='listbox' aria-label={query ? '搜索结果' : '最近任务'}>
          <div className='session-search-label'>{query ? `搜索结果 · ${results.length}` : '最近任务'}</div>
          {results.length === 0 ? (
            <div className='session-search-empty'>没有找到匹配的任务</div>
          ) : results.map((result, index) => {
            const connector = result.session.source?.type === 'connector'
            return (
              <button
                key={result.session.id}
                className={index === activeIndex ? 'session-search-result active' : 'session-search-result'}
                role='option'
                aria-selected={index === activeIndex}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => openResult(result.session.id)}
              >
                <span className='session-search-result-icon'>{connector ? <MessageSquare size={15} /> : <Bot size={15} />}</span>
                <span className='session-search-result-copy'>
                  <span className='session-search-result-title'>{result.session.task}</span>
                  <span className='session-search-result-snippet'>{result.snippet}</span>
                </span>
                <span className='session-search-result-time'>{formatTime(result.session.updatedAt)}</span>
              </button>
            )
          })}
        </div>
        <div className='session-search-footer'><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span></div>
      </section>
    </div>
  )
}
