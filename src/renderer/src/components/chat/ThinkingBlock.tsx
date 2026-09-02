import { useId, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import '../../assets/thinking.css'

export default function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  const display = text.trim()
  if (!display && !streaming) return null
  return (
    <div className={`thinking${streaming ? ' is-streaming' : ''}${open ? ' is-open' : ''}`}>
      <button type='button' className='thinking-header' aria-expanded={display ? open : false} aria-controls={display ? bodyId : undefined} onClick={() => { if (display) setOpen(value => !value) }}>
        <span className='thinking-status'>{streaming ? '思考中' : '已思考'}</span>
        {display.length > 0 && <span className='muted fs-2xs'>{display.length} 字</span>}
        {display.length > 0 && <ChevronDown size={14} className='thinking-chevron' aria-hidden />}
      </button>
      {open && display && <div className='thinking-body' id={bodyId}>{display}</div>}
    </div>
  )
}
