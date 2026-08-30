import { useState } from 'react'
import { Pencil, RefreshCw, Check, Copy, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { ChatMessage } from '@shared/types'
import Markdown from './Markdown'
import ThinkingBlock from './ThinkingBlock'
import { useThrottledText } from '../../hooks'
import { useChatStore } from '../../stores/useChatStore'
import { copyText } from '../../lib/utils'
import clsx from 'clsx'

export default function MessageItem({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  const streaming = !!message.streaming
  const updateMessage = useChatStore(s => s.updateMessage)
  const editAndResend = useChatStore(s => s.editAndResend)
  const regenerate = useChatStore(s => s.regenerate)
  const setMessageFeedback = useChatStore(s => s.setMessageFeedback)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const [copied, setCopied] = useState(false)
  const display = useThrottledText(message.content, streaming)

  const onSave = (): void => {
    const text = draft.trim()
    if (!text) return
    setEditing(false)
    updateMessage(message.id, text)
  }

  const onCancel = (): void => {
    setDraft(message.content)
    setEditing(false)
  }

  const onResend = async (): Promise<void> => {
    const text = draft.trim()
    if (!text) return
    setEditing(false)
    await editAndResend(message.id, text)
  }

  const onCopy = async (): Promise<void> => {
    const ok = await copyText(message.content)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className={clsx('msg-row', isUser ? 'user' : 'assistant')}>
      <div className='msg-body'>
        <div className='msg-meta'>
          <span className='msg-role'>{isUser ? '你' : 'DeepDesk'}</span>
          {!isUser && message.model && <span className='mono'>{message.model}</span>}
          {message.error && <span style={{ color: 'var(--danger)' }}>出错</span>}
          {streaming && <span className='muted'>生成中…</span>}
        </div>
        {isUser && editing ? (
          <div className='msg-editor-wrap'>
            <textarea className='textarea' value={draft} onChange={e => setDraft(e.target.value)} rows={Math.min(8, Math.max(2, draft.split(String.fromCharCode(10)).length))} autoFocus onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSave() } if (e.key === 'Escape') onCancel() }} />
            <div className='msg-edit-actions'>
              <button className='message-edit-button secondary' type='button' onClick={onCancel}>取消</button>
              <button className='message-edit-button secondary' type='button' onClick={onSave} disabled={!draft.trim()}>保存</button>
              <button className='message-edit-button primary' type='button' onClick={() => void onResend()} disabled={!draft.trim() || streaming}>重新发送</button>
            </div>
          </div>
        ) : isUser ? (
          <div className='msg-content user'>{message.content}</div>
        ) : (
          <div className='msg-content'>
            {message.reasoning && message.reasoning.trim().length > 0 && <ThinkingBlock text={message.reasoning} streaming={streaming} />}
            {display.length > 0 ? <Markdown text={display} /> : streaming ? (
              <div className='typing-dots'><span /><span /><span /></div>
            ) : null}
            {streaming && display.length > 0 && <span className='stream-cursor' />}
          </div>
        )}
        {!editing && <div className='msg-actions'>
          {!streaming && isUser && (
            <>
              <button className='message-action' aria-label='复制消息' title='复制消息' onClick={() => void onCopy()}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>
              <button className='message-action' aria-label='编辑消息' title='编辑消息' onClick={() => { setDraft(message.content); setEditing(true) }}><Pencil size={15} /></button>
            </>
          )}
          {!streaming && !isUser && (
            <>
              <button className='message-action' aria-label='复制消息' title='复制消息' onClick={() => void onCopy()}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>
              <button className='message-action' aria-label='重新生成' title='重新生成' onClick={() => void regenerate()}><RefreshCw size={15} /></button>
              <button className={clsx('message-action', message.feedback === 'positive' && 'active')} aria-label='喜欢' aria-pressed={message.feedback === 'positive'} title='喜欢' onClick={() => setMessageFeedback(message.id, 'positive')}><ThumbsUp size={15} /></button>
              <button className={clsx('message-action', message.feedback === 'negative' && 'active')} aria-label='不喜欢' aria-pressed={message.feedback === 'negative'} title='不喜欢' onClick={() => setMessageFeedback(message.id, 'negative')}><ThumbsDown size={15} /></button>
            </>
          )}
        </div>}
      </div>
    </div>
  )
}
