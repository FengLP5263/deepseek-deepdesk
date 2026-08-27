import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowDown, Check, ChevronDown, Copy, FolderOpen, Gauge, Pencil, RefreshCw, Square, Terminal, ThumbsDown, ThumbsUp, X, ShieldQuestion, ShieldCheck, Unlock } from 'lucide-react'
import { useAgentStore } from '../../stores/useAgentStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import type { AgentStep } from '@shared/agent-types'
import clsx from 'clsx'
import { formatTokens } from '../../lib/format'
import Markdown from '../chat/Markdown'
import { copyText } from '../../lib/utils'
import DeepSeekLogo from '../DeepSeekLogo'
import zhipuIcon from '../../assets/icons/zhipu.svg'
import '../../assets/agent.css'

function estimateTokens(history: Array<Record<string, unknown>>): number {
  let tokens = 0
  for (const m of history) {
    const parts: string[] = []
    if (typeof m.content === 'string') parts.push(m.content)
    if (Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls as Array<Record<string, unknown>>) {
        const fn = tc.function as Record<string, unknown> | undefined
        if (fn && typeof fn.arguments === 'string') parts.push(fn.arguments)
      }
    }
    for (const part of parts) {
      for (const ch of part) {
        const code = ch.charCodeAt(0)
        tokens += (code >= 0x2e80 && code <= 0x9fff) ? 1 : 0.25
      }
    }
  }
  return Math.max(1, Math.round(tokens))
}

function formatWorkdirName(workdir: string): string {
  const normalized = workdir.trim().replace(/[\\/]+$/, '')
  if (!normalized) return ''
  const parts = normalized.split(/[\\/]+/).filter(Boolean)
  return parts.at(-1) ?? normalized
}

function ContextMeter({ history, contextWindow, open, onToggle }: { history: Array<Record<string, unknown>>; contextWindow: number; open: boolean; onToggle: () => void }) {
  const used = estimateTokens(history)
  const percent = Math.min(100, Math.round(used / contextWindow * 100))
  const RADIUS = 5.5
  const CIRC = 2 * Math.PI * RADIUS
  return (
    <span className='ctx-meter'>
      <button className='ctx-trigger' aria-expanded={open} onClick={onToggle} title='上下文用量'>
        <svg viewBox='0 0 14 14' width='14' height='14' aria-hidden>
          <circle className='ctx-track' cx='7' cy='7' r={RADIUS} />
          <circle className='ctx-fill' cx='7' cy='7' r={RADIUS} strokeDasharray={CIRC * percent / 100 + ' ' + CIRC} transform='rotate(-90 7 7)' />
        </svg>
      </button>
      {open && (
        <div className='ctx-panel'>
          <div className='ctx-header'>
            <span>上下文已用</span>
            <span className='ctx-percent'>{percent}%</span>
            <span className='ctx-figures'>~{formatTokens(used)} / {formatTokens(contextWindow)}</span>
          </div>
          <div className='ctx-bar'><div className='ctx-bar-fill' style={{ width: percent + '%' }} /></div>
        </div>
      )}
    </span>
  )
}

function parseArgs(args?: string): Record<string, unknown> {
  if (!args) return {}
  try { return JSON.parse(args) as Record<string, unknown> } catch { return {} }
}

function ToolCard({ step }: { step: AgentStep }) {
  const [open, setOpen] = useState(false)
  const a = parseArgs(step.args)
  const title = step.name === 'run_command' ? String(a.command ?? '')
    : step.name === 'read_file' ? '读取 ' + String(a.path ?? '')
    : step.name === 'write_file' ? '写入 ' + String(a.path ?? '')
    : step.name === 'edit_file' ? '编辑 ' + String(a.path ?? '')
    : step.name === 'list_files' ? '列出 ' + String(a.path ?? '工作目录')
    : step.name === 'search_content' ? '搜索 ' + String(a.pattern ?? '')
    : step.name === 'search_feishu_user' ? '搜索飞书通讯录 ' + String(a.name ?? '')
    : step.name === 'send_feishu_message' ? '发送飞书消息'
    : String(step.name ?? '工具')
  const statusText = step.status === 'running' ? '运行中…' : step.status === 'ok' ? '完成' : step.status === 'error' ? '出错' : step.status === 'denied' ? '已拒绝' : ''
  return (
    <div className={clsx('agent-tool', step.status)}>
      <div className='agent-tool-head' onClick={() => setOpen(o => !o)}>
        <Terminal size={13} />
        <span className='agent-tool-title mono'>{title}</span>
        <span className='agent-tool-status'>{statusText}</span>
        {step.result && <ChevronDown size={13} className='agent-tool-chev' style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />}
      </div>
      {open && step.result && <pre className='agent-tool-result'>{step.result}</pre>}
    </div>
  )
}

function MessageActions({
  text,
  isUser,
  feedback,
  onEdit,
  onRegenerate,
  onFeedback,
  isLastMessage
}: {
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
    const ok = await copyText(text)
    if (!ok) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className={clsx('agent-message-actions', isLastMessage && 'last-message-actions')}>
      <button className='message-action' aria-label='复制消息' title='复制消息' onClick={() => void onCopy()}>
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
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
  const updateStep = useAgentStore(s => s.updateStep)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(step.text ?? '')
  const save = (): void => {
    const text = draft.trim()
    if (!text) return
    updateStep(index, { text })
    setEditing(false)
  }
  return (
    <div className={clsx('agent-message', 'user', isLastMessage && 'is-last-message')}>
      {editing ? (
        <textarea
          className='agent-message-editor'
          value={draft}
          autoFocus
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              save()
            }
            if (event.key === 'Escape') setEditing(false)
          }}
        />
      ) : <div className='agent-task'>{step.text}</div>}
      <MessageActions text={step.text ?? ''} isUser isLastMessage={isLastMessage} onEdit={() => { setDraft(step.text ?? ''); setEditing(true) }} />
    </div>
  )
}

function TextStep({ step, index, isLastMessage }: { step: AgentStep; index: number; isLastMessage: boolean }) {
  const regenerateFrom = useAgentStore(s => s.regenerateFrom)
  const setStepFeedback = useAgentStore(s => s.setStepFeedback)
  return (
    <div className={clsx('agent-message', 'assistant', isLastMessage && 'is-last-message')}>
      <Markdown text={step.text ?? ''} />
      <MessageActions
        text={step.text ?? ''}
        isUser={false}
        feedback={step.feedback}
        isLastMessage={isLastMessage}
        onRegenerate={() => void regenerateFrom(index)}
        onFeedback={feedback => setStepFeedback(index, feedback)}
      />
    </div>
  )
}

function StepItem({ step, index, isLastMessage }: { step: AgentStep; index: number; isLastMessage: boolean }) {
  switch (step.kind) {
    case 'task': return <TaskStep step={step} index={index} isLastMessage={isLastMessage} />
    case 'thinking': return <div className='agent-thinking'><span className='thinking-icon' />思考中…</div>
    case 'text': return <TextStep step={step} index={index} isLastMessage={isLastMessage} />
    case 'tool': return <ToolCard step={step} />
    case 'error': return <div className='agent-error'>{step.message}</div>
    default: return null
  }
}

function AgentComposer({ onOpenSettings }: { onOpenSettings: () => void }) {
  const running = useAgentStore(s => s.running)
  const workdir = useAgentStore(s => s.workdir)
  const history = useAgentStore(s => s.history)
  const draftTask = useAgentStore(s => s.draftTask)
  const currentModelId = useAgentStore(s => s.currentModelId)
  const start = useAgentStore(s => s.start)
  const stop = useAgentStore(s => s.stop)
  const pickDirectory = useAgentStore(s => s.pickDirectory)
  const setCurrentModel = useAgentStore(s => s.setCurrentModel)
  const setDraftTask = useAgentStore(s => s.setDraftTask)
  const settings = useSettingsStore(s => s.settings)
  const providers = useSettingsStore(s => s.providers)
  const updateSettings = useSettingsStore(s => s.updateSettings)
  const [text, setText] = useState('')
  const [openMenu, setOpenMenu] = useState<'model' | 'permission' | 'context' | null>(null)
  const [maxMode, setMaxMode] = useState(false)
  const [autoModelMode, setAutoModelMode] = useState(true)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const provider = providers.find(p => p.id === (settings?.defaultProviderId ?? 'deepseek'))
  const effectiveModelId = currentModelId || (settings?.defaultModelId ?? '')
  const contextWindow = provider?.models.find(m => m.id === effectiveModelId)?.contextWindow ?? 128000
  const mode = settings?.agentPermissionMode ?? 'ask'
  const modeLabel = mode === 'full' ? '完全访问' : mode === 'auto' ? '替我审批' : '每次询问'
  const models = provider?.models ?? []
  const selectedModel = models.find(item => item.id === effectiveModelId)
  const selectedModelLabel = selectedModel?.name ?? (effectiveModelId || '选择模型')
  const modelButtonLabel = autoModelMode ? 'Auto' : selectedModelLabel
  const workdirLabel = formatWorkdirName(workdir)
  const workdirTitle = workdir ? `工作目录：${workdir}` : '选择工作目录'
  const isDeepSeekModel = (model: { id: string; name?: string }): boolean => {
    const text = (model.id + ' ' + (model.name ?? '')).toLowerCase()
    return text.includes('deepseek')
  }
  const isZhipuModel = (model: { id: string; name?: string }): boolean => {
    const text = [
      provider?.name,
      provider?.baseUrl,
      model.id,
      model.name
    ].filter(Boolean).join(' ').toLowerCase()
    return text.includes('智谱') || text.includes('zhipu') || text.includes('bigmodel') || text.includes('glm')
  }
  const modelButtonIcon = autoModelMode ? <RefreshCw size={14} /> : selectedModel && isDeepSeekModel(selectedModel)
    ? <DeepSeekLogo className='model-logo' width={15} height={15} aria-hidden />
    : selectedModel && isZhipuModel(selectedModel)
      ? <img src={zhipuIcon} className='model-logo model-logo-img compact' alt='' aria-hidden />
    : <span className='model-mark compact'>{selectedModelLabel.trim().charAt(0).toUpperCase()}</span>

  useEffect(() => {
    const closeMenu = (event: PointerEvent): void => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpenMenu(null)
    }
    document.addEventListener('pointerdown', closeMenu)
    return () => document.removeEventListener('pointerdown', closeMenu)
  }, [])

  useEffect(() => {
    setAutoModelMode(!currentModelId)
  }, [currentModelId])

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }, [text])

  useEffect(() => {
    if (!draftTask) return
    setText(draftTask)
    setDraftTask('')
    window.setTimeout(() => taRef.current?.focus(), 0)
  }, [draftTask, setDraftTask])

  const submit = async (): Promise<void> => {
    if (!text.trim() || running) return
    setText('')
    await start(text)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() }
  }

  const closeFloatingOnComposerBackground = (event: React.PointerEvent<HTMLDivElement>): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('.composer-menu, .ctx-meter')) return
    setOpenMenu(null)
  }

  return (
    <div className='agent-composer' ref={menuRef} onPointerDownCapture={closeFloatingOnComposerBackground}>
      <textarea
        ref={taRef}
        className='composer-textarea'
        placeholder='发消息，或让我帮你做点事…'
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
      />
      <div className='composer-actions'>
        <div className='composer-left'>
          <div className='composer-menu'>
            <button className='toolbar-item composer-menu-trigger' aria-expanded={openMenu === 'permission'} onClick={() => setOpenMenu(openMenu === 'permission' ? null : 'permission')} title='选择权限模式'>
              {mode === 'full' ? <Unlock size={13} /> : mode === 'auto' ? <ShieldCheck size={13} /> : <ShieldQuestion size={13} />}
              <span>{modeLabel}</span><ChevronDown size={12} />
            </button>
            {openMenu === 'permission' && (
              <div className='composer-menu-popover' role='menu' aria-label='选择权限模式'>
                {([['ask', '每次询问'], ['auto', '替我审批'], ['full', '完全访问']] as const).map(([value, label]) => (
                  <button key={value} className='composer-menu-option' role='menuitemradio' aria-checked={mode === value} onClick={() => { void updateSettings({ agentPermissionMode: value }); setOpenMenu(null) }}>
                    <span>{label}</span>{mode === value && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className='toolbar-item' onClick={() => void pickDirectory()} title={workdirTitle}>
            <FolderOpen size={13} /><span>{workdirLabel || '选择工作目录'}</span>
          </button>
        </div>
        <div className='composer-right'>
          <div className='composer-menu'>
            <button className='toolbar-item composer-menu-trigger composer-model-trigger' aria-expanded={openMenu === 'model'} onClick={() => setOpenMenu(openMenu === 'model' ? null : 'model')} title='选择模型'>
              {modelButtonIcon}
              <span>{modelButtonLabel}</span><ChevronDown size={12} />
            </button>
            {openMenu === 'model' && (
              <div className='composer-menu-popover composer-model-popover' role='menu' aria-label='选择模型'>
                <div className='model-menu-header'>
                  <div className='model-menu-title'><Gauge size={15} /> Max 模式</div>
                  <button type='button' className={clsx('model-max-switch', maxMode && 'on')} role='switch' aria-checked={maxMode} aria-label='Max 模式' onClick={() => setMaxMode(value => !value)}>
                    <span />
                  </button>
                </div>
                <button className='model-menu-option auto' role='menuitemradio' aria-checked={autoModelMode} onClick={() => { setAutoModelMode(true); setCurrentModel(''); setOpenMenu(null) }}>
                  <span className='model-option-main'><RefreshCw size={16} /><span>Auto</span></span>
                  {autoModelMode && <Check size={15} />}
                </button>
                <div className='model-menu-list'>
                {models.map(item => (
                  <button key={item.id} className='model-menu-option' role='menuitemradio' aria-checked={!autoModelMode && effectiveModelId === item.id} onClick={() => { setAutoModelMode(false); setCurrentModel(item.id); setOpenMenu(null) }}>
                    <span className='model-option-main'>
                      {isDeepSeekModel(item) ? <DeepSeekLogo className='model-logo' width={18} height={18} aria-hidden /> : isZhipuModel(item) ? <img src={zhipuIcon} className='model-logo model-logo-img' alt='' aria-hidden /> : <span className='model-mark'>{(item.name ?? item.id).trim().charAt(0).toUpperCase()}</span>}
                      <span className='model-name'>{item.name ?? item.id}</span>
                    </span>
                    {!autoModelMode && item.id === effectiveModelId && <span className='model-check'><Check size={15} /></span>}
                  </button>
                ))}
                </div>
                <button className='model-menu-config' role='menuitem' onClick={() => { setOpenMenu(null); onOpenSettings() }}>
                  <Pencil size={15} />
                  <span>配置自定义模型</span>
                </button>
              </div>
            )}
          </div>
          <ContextMeter history={history} contextWindow={contextWindow} open={openMenu === 'context'} onToggle={() => setOpenMenu(openMenu === 'context' ? null : 'context')} />
          {running ? (
            <button className='stop-btn' onClick={stop} title='停止'><Square size={13} /></button>
          ) : (
            <button className='send-btn' disabled={!text.trim()} onClick={() => void submit()} title='发送'><svg viewBox='0 0 16 16' width='16' height='16' aria-hidden><path d='M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z' fill='currentColor' /></svg></button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AgentView({ onOpenSettings }: { onOpenSettings: () => void }) {
  const steps = useAgentStore(s => s.steps)
  const workdir = useAgentStore(s => s.workdir)
  const pendingApproval = useAgentStore(s => s.pendingApproval)
  const error = useAgentStore(s => s.error)
  const approve = useAgentStore(s => s.approve)
  const pickDirectory = useAgentStore(s => s.pickDirectory)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const lastMessageIndex = steps.reduce((last, step, index) => step.kind === 'task' || step.kind === 'text' ? index : last, -1)

  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'auto' })
      setShowScrollToBottom(false)
    }
  }, [steps, pendingApproval])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const updateScrollToBottom = (): void => {
      setShowScrollToBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 96)
    }

    updateScrollToBottom()
    el.addEventListener('scroll', updateScrollToBottom)
    return () => el.removeEventListener('scroll', updateScrollToBottom)
  }, [steps.length])

  const scrollToBottom = (): void => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setShowScrollToBottom(false)
  }
  const workdirLabel = formatWorkdirName(workdir)
  const workdirTitle = workdir ? `工作目录：${workdir}` : '选择工作目录'

  return (
    <div className='agent-view'>
      {error && <div className='agent-error' style={{ margin: '10px 24px 0' }}>{error}</div>}
      {steps.length === 0 ? (
        <div className='agent-empty'>
          <div className='empty-title'>你好，我是 DeepDesk</div>
          <div className='empty-sub'>直接问我问题，或让我帮你写代码、执行命令、读写文件、发飞书消息。先选个工作目录，然后告诉我做什么。</div>
          <div className='quick-chips'>
            <button className='quick-chip' onClick={() => void pickDirectory()} title={workdirTitle}><FolderOpen size={13} /> {workdirLabel || '选择工作目录'}</button>
          </div>
          <div className='agent-empty-composer'>
            <AgentComposer onOpenSettings={onOpenSettings} />
          </div>
        </div>
      ) : (
        <div className='agent-scroll' ref={scrollRef}>
          <div className='agent-inner'>
            {steps.map((st, i) => <StepItem key={i} step={st} index={i} isLastMessage={i === lastMessageIndex} />)}
          </div>
        </div>
      )}
      {steps.length > 0 && (
        <div className='agent-footer'>
          {showScrollToBottom && (
            <button type='button' className='scroll-to-bottom' title='回到底部' aria-label='回到底部' onClick={scrollToBottom}>
              <ArrowDown size={17} />
            </button>
          )}
          {pendingApproval && (
            <div className='agent-approval' role='dialog' aria-label='执行审批'>
              <div className='agent-approval-title'>{pendingApproval.reason || '等待批准'}</div>
              <pre className='agent-approval-cmd'>{pendingApproval.command || pendingApproval.target}</pre>
              {pendingApproval.command && <div className='agent-approval-cwd'>工作目录：{pendingApproval.cwd}</div>}
              <div className='agent-approval-actions'>
                <button className='btn btn-primary btn-sm' onClick={() => approve(true)}><Check size={13} /> 批准</button>
                <button className='btn btn-danger btn-sm' onClick={() => approve(false)}><X size={13} /> 拒绝</button>
              </div>
            </div>
          )}
          <AgentComposer onOpenSettings={onOpenSettings} />
        </div>
      )}
    </div>
  )
}
