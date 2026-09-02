import { lazy, Suspense, useState } from 'react'
import { Check, ChevronDown, Copy, Pencil, RefreshCw, Terminal, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { AgentStep } from '@shared/agent-types'
import clsx from 'clsx'
import { useAgentStore } from '../../stores/useAgentStore'
import { copyText } from '../../lib/utils'
import ThinkingBlock from '../chat/ThinkingBlock'
import ContextCompactionNotice from './ContextCompactionNotice'

const Markdown = lazy(() => import('../chat/Markdown'))

function parseArgs(args?: string): Record<string, unknown> {
  if (!args) return {}
  try { return JSON.parse(args) as Record<string, unknown> } catch { return {} }
}

function ToolCard({ step }: { step: AgentStep }) {
  const [open, setOpen] = useState(false)
  const args = parseArgs(step.args)
  const title = step.name === 'run_command' ? String(args.command ?? '')
    : step.name === 'read_file' ? '读取 ' + String(args.path ?? '')
    : step.name === 'write_file' ? '写入 ' + String(args.path ?? '')
    : step.name === 'edit_file' ? '编辑 ' + String(args.path ?? '')
    : step.name === 'list_files' ? '列出 ' + String(args.path ?? '工作目录')
    : step.name === 'search_content' ? '搜索 ' + String(args.pattern ?? '')
    : step.name === 'search_feishu_user' ? '搜索飞书通讯录 ' + String(args.name ?? '')
    : step.name === 'send_feishu_message' ? '发送飞书消息'
    : step.name === 'browser_pages' ? '查看浏览器页面'
    : step.name === 'browser_navigate' ? '访问 ' + String(args.url ?? '')
    : step.name === 'browser_snapshot' ? '读取浏览器页面'
    : step.name === 'browser_click' ? '点击 ' + String(args.selector ?? '')
    : step.name === 'browser_type' ? '输入到 ' + String(args.selector ?? '')
    : step.name === 'browser_debug' ? '调试浏览器页面'
    : step.name === 'browser_evaluate' ? '执行浏览器调试脚本'
    : String(step.name ?? '工具')
  const statusText = step.status === 'running' ? '运行中…' : step.status === 'ok' ? '完成' : step.status === 'error' ? '出错' : step.status === 'denied' ? '已拒绝' : step.status === 'cancelled' ? '已停止' : ''
  return (
    <div className={clsx('agent-tool', step.status)}>
      <div className='agent-tool-head' onClick={() => setOpen(open => !open)}>
        <Terminal size={13} />
        <span className='agent-tool-title mono'>{title}</span>
        <span className='agent-tool-status'>{statusText}</span>
        {step.result && <ChevronDown size={13} className='agent-tool-chev' style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />}
      </div>
      {open && step.result && <pre className='agent-tool-result'>{step.result}</pre>}
    </div>
  )
}

function MessageActions({ text, isUser, feedback, onEdit, onRegenerate, onFeedback, isLastMessage }: {
  text: string
  isUser: boolean
  feedback?: AgentStep['feedback']
  onEdit?: () => void
  onRegenerate?: () => void
  onFeedback?: (feedback: 'positive' | 'negative') => void
  isLastMessage: boolean
}) {
  const [copied, setCopied] = useState(false)
  const onCopy = async (): Promise<void> => {
    if (!await copyText(text)) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className={clsx('agent-message-actions', isLastMessage && 'last-message-actions')}>
      <button className='message-action' aria-label='复制消息' title='复制消息' onClick={() => void onCopy()}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>
      {isUser ? (
        <button className='message-action' aria-label='编辑消息' title='编辑消息' onClick={onEdit}><Pencil size={15} /></button>
      ) : (
        <>
          <button className='message-action' aria-label='重新生成' title='重新生成' onClick={onRegenerate}><RefreshCw size={15} /></button>
          <button className={clsx('message-action', feedback === 'positive' && 'active')} aria-label='喜欢' aria-pressed={feedback === 'positive'} title='喜欢' onClick={() => onFeedback?.('positive')}><ThumbsUp size={15} /></button>
          <button className={clsx('message-action', feedback === 'negative' && 'active')} aria-label='不喜欢' aria-pressed={feedback === 'negative'} title='不喜欢' onClick={() => onFeedback?.('negative')}><ThumbsDown size={15} /></button>
        </>
      )}
    </div>
  )
}

function TaskStep({ step, index, isLastMessage }: { step: AgentStep; index: number; isLastMessage: boolean }) {
  const updateStep = useAgentStore(state => state.updateStep)
  const rerunTaskFrom = useAgentStore(state => state.rerunTaskFrom)
  const running = useAgentStore(state => state.running)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(step.text ?? '')
  const save = (): void => {
    const text = draft.trim()
    if (!text) return
    updateStep(index, { text })
    setEditing(false)
  }
  const cancel = (): void => {
    setDraft(step.text ?? '')
    setEditing(false)
  }
  const resend = (): void => {
    const text = draft.trim()
    if (!text || running) return
    setEditing(false)
    void rerunTaskFrom(index, text)
  }
  return (
    <div className={clsx('agent-message', 'user', isLastMessage && 'is-last-message')}>
      {editing ? (
        <div className='agent-message-editor-wrap'>
          <textarea className='agent-message-editor' value={draft} autoFocus onChange={event => setDraft(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save() }
            if (event.key === 'Escape') cancel()
          }} />
          <div className='agent-message-editor-actions'>
            <button className='message-edit-button secondary' type='button' onClick={cancel}>取消</button>
            <button className='message-edit-button secondary' type='button' onClick={save} disabled={!draft.trim()}>保存</button>
            <button className='message-edit-button primary' type='button' onClick={resend} disabled={!draft.trim() || running}>重新发送</button>
          </div>
        </div>
      ) : <div className='agent-task'>{step.text}</div>}
      {!editing && <MessageActions text={step.text ?? ''} isUser isLastMessage={isLastMessage} onEdit={() => { setDraft(step.text ?? ''); setEditing(true) }} />}
    </div>
  )
}

function TextStep({ step, index, isLastMessage }: { step: AgentStep; index: number; isLastMessage: boolean }) {
  const regenerateFrom = useAgentStore(state => state.regenerateFrom)
  const setStepFeedback = useAgentStore(state => state.setStepFeedback)
  return (
    <div className={clsx('agent-message', 'assistant', isLastMessage && 'is-last-message')}>
      <Suspense fallback={<div className='agent-text'>{step.text ?? ''}</div>}><Markdown text={step.text ?? ''} /></Suspense>
      <MessageActions text={step.text ?? ''} isUser={false} feedback={step.feedback} isLastMessage={isLastMessage} onRegenerate={() => void regenerateFrom(index)} onFeedback={feedback => setStepFeedback(index, feedback)} />
    </div>
  )
}

function ErrorStep({ step, index }: { step: AgentStep; index: number }) {
  const regenerateFrom = useAgentStore(state => state.regenerateFrom)
  const running = useAgentStore(state => state.running)
  return (
    <div className='agent-error agent-error-step' role='alert'>
      <span>{step.message}</span>
      <button type='button' className='btn btn-ghost btn-sm' disabled={running} onClick={() => void regenerateFrom(index)}><RefreshCw size={13} /> 重试</button>
    </div>
  )
}

export default function AgentStepItem({ step, index, isLastMessage }: { step: AgentStep; index: number; isLastMessage: boolean }) {
  switch (step.kind) {
    case 'task': return <TaskStep step={step} index={index} isLastMessage={isLastMessage} />
    case 'thinking': return <ThinkingBlock text={step.text ?? ''} streaming={step.status === 'running'} />
    case 'context': return <ContextCompactionNotice beforeTokens={step.beforeTokens} afterTokens={step.afterTokens} />
    case 'text': return <TextStep step={step} index={index} isLastMessage={isLastMessage} />
    case 'tool': return <ToolCard step={step} />
    case 'error': return <ErrorStep step={step} index={index} />
    default: return null
  }
}
