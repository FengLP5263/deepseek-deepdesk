import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, Blocks, Check, ChevronDown, FolderOpen, ListChecks, Pencil, Terminal, X, ShieldQuestion, ShieldCheck, Unlock } from 'lucide-react'
import { useAgentStore } from '../../stores/useAgentStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import clsx from 'clsx'
import { formatWorkdirName } from '../../lib/format'
import { shouldSubmitComposer } from '../../lib/composer-keyboard'
import useSessionDraft from '../../hooks/useSessionDraft'
import { DEFAULT_CONTEXT_WINDOW } from '@shared/context-manager'
import { outputTokenBudget } from '@shared/llm/stream'
import AgentModelPicker from './AgentModelPicker'
import AgentContextMeter from './AgentContextMeter'
import WindowedAgentSteps from './WindowedAgentSteps'
import AgentStepItem from './AgentStepItem'
import '../../assets/agent.css'

function QueuedMessages() {
  const queuedMessages = useAgentStore(s => s.queuedMessages)
  const updateQueuedMessage = useAgentStore(s => s.updateQueuedMessage)
  const removeQueuedMessage = useAgentStore(s => s.removeQueuedMessage)
  const sendQueuedNow = useAgentStore(s => s.sendQueuedNow)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  if (queuedMessages.length === 0) return null

  const beginEdit = (id: string, text: string): void => {
    setEditingId(id)
    setDraft(text)
  }
  const cancelEdit = (): void => {
    setEditingId(null)
    setDraft('')
  }
  const saveEdit = (): void => {
    if (!editingId || !draft.trim()) return
    updateQueuedMessage(editingId, draft)
    cancelEdit()
  }

  return (
    <section className='agent-queue' aria-label='待发送消息队列'>
      <div className='agent-queue-list'>
        {queuedMessages.map((message, index) => (
          <div className='agent-queue-item' key={message.id}>
            {editingId === message.id ? (
              <div className='agent-queue-editing'>
                <textarea
                  className='agent-queue-editor'
                  value={draft}
                  autoFocus
                  rows={2}
                  onChange={event => setDraft(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault()
                      saveEdit()
                    }
                    if (event.key === 'Escape') cancelEdit()
                  }}
                />
                <div className='agent-queue-edit-actions'>
                  <button type='button' className='queue-text-button' onClick={cancelEdit}>取消</button>
                  <button type='button' className='queue-text-button primary' disabled={!draft.trim()} onClick={saveEdit}>保存</button>
                </div>
              </div>
            ) : (
              <>
                <div className='agent-queue-copy'>
                  <span className='agent-queue-label'>待发送{queuedMessages.length > 1 ? ` · ${index + 1}/${queuedMessages.length}` : ''}</span>
                  <span className='agent-queue-text'>{message.text}</span>
                </div>
                <div className='agent-queue-actions'>
                  <button type='button' className='queue-icon-button queue-send-now' aria-label='立即发送' title='立即发送并中断当前回复' onClick={() => void sendQueuedNow(message.id)}><ArrowUp size={14} /></button>
                  <button type='button' className='queue-icon-button' aria-label='编辑待发送消息' title='编辑' onClick={() => beginEdit(message.id, message.text)}><Pencil size={14} /></button>
                  <button type='button' className='queue-icon-button danger' aria-label='移除待发送消息' title='移除' onClick={() => removeQueuedMessage(message.id)}><X size={15} /></button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function AgentComposer({ onOpenSettings }: { onOpenSettings: () => void }) {
  const running = useAgentStore(s => s.running)
  const workdir = useAgentStore(s => s.workdir)
  const history = useAgentStore(s => s.history)
  const contextUsage = useAgentStore(s => s.sessions.find(session => session.id === s.currentSessionId)?.contextUsage)
  const draftTask = useAgentStore(s => s.draftTask)
  const currentProviderId = useAgentStore(s => s.currentProviderId)
  const currentModelId = useAgentStore(s => s.currentModelId)
  const currentSessionId = useAgentStore(s => s.currentSessionId)
  const start = useAgentStore(s => s.start)
  const enqueueMessage = useAgentStore(s => s.enqueueMessage)
  const stop = useAgentStore(s => s.stop)
  const pickDirectory = useAgentStore(s => s.pickDirectory)
  const setCurrentModel = useAgentStore(s => s.setCurrentModel)
  const setDraftTask = useAgentStore(s => s.setDraftTask)
  const settings = useSettingsStore(s => s.settings)
  const providers = useSettingsStore(s => s.providers)
  const updateSettings = useSettingsStore(s => s.updateSettings)
  const [text, setText] = useSessionDraft(currentSessionId || 'new-task')
  const [openMenu, setOpenMenu] = useState<'model' | 'interaction' | 'permission' | 'context' | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const autoModelMode = !currentProviderId || !currentModelId
  const effectiveProviderId = currentProviderId || (settings?.defaultProviderId ?? 'deepseek')
  const provider = providers.find(p => p.id === effectiveProviderId)
  const effectiveModelId = currentModelId || (settings?.defaultModelId ?? '')
  const contextWindow = provider?.models.find(m => m.id === effectiveModelId)?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
  const reserveTokens = outputTokenBudget(contextWindow, settings?.agentMaxMode ?? false)
  const interactionMode = settings?.agentInteractionMode ?? 'execute'
  const mode = settings?.agentPermissionMode ?? 'ask'
  const enterToSend = settings?.enterToSend ?? true
  const modeLabel = mode === 'full' ? '完全访问' : mode === 'auto' ? '替我审批' : '每次询问'
  const workdirLabel = formatWorkdirName(workdir)
  const workdirTitle = workdir ? `工作目录：${workdir}` : '未选择时使用系统用户主目录'

  useEffect(() => {
    const closeMenu = (event: PointerEvent): void => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpenMenu(null)
    }
    document.addEventListener('pointerdown', closeMenu)
    return () => document.removeEventListener('pointerdown', closeMenu)
  }, [])

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
    if (!text.trim()) return
    const task = text
    setText('')
    if (running) await enqueueMessage(task)
    else await start(task)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (shouldSubmitComposer(e, enterToSend)) { e.preventDefault(); void submit() }
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
        placeholder={running ? '输入下一条消息，将在当前回复完成后发送…' : '发消息，或让我帮你做点事…'}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
      />
      <div className='composer-actions'>
        <div className='composer-left'>
          <div className='composer-menu'>
            <button className='toolbar-item composer-menu-trigger' aria-expanded={openMenu === 'interaction'} onClick={() => setOpenMenu(openMenu === 'interaction' ? null : 'interaction')} title='选择工作模式'>
              {interactionMode === 'plan' ? <ListChecks size={13} /> : <Terminal size={13} />}
              <span>{interactionMode === 'plan' ? '规划' : '执行'}</span><ChevronDown size={12} />
            </button>
            {openMenu === 'interaction' && (
              <div className='composer-menu-popover' role='menu' aria-label='选择工作模式'>
                {([['execute', '执行任务'], ['plan', '规划方案']] as const).map(([value, label]) => (
                  <button key={value} className='composer-menu-option' role='menuitemradio' aria-checked={interactionMode === value} title={value === 'plan' ? '只读调研并输出计划，不执行修改' : '在权限规则内执行任务'} onClick={() => { void updateSettings({ agentInteractionMode: value }); setOpenMenu(null) }}>
                    <span>{label}</span>{interactionMode === value && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}
          </div>
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
            <FolderOpen size={13} /><span>{workdirLabel || '用户主目录'}</span>
          </button>
        </div>
        <div className='composer-right'>
          <AgentModelPicker
            providers={providers}
            selectedProviderId={effectiveProviderId}
            selectedModelId={effectiveModelId}
            auto={autoModelMode}
            maxMode={settings?.agentMaxMode ?? false}
            open={openMenu === 'model'}
            onToggle={() => setOpenMenu(openMenu === 'model' ? null : 'model')}
            onAuto={() => { setCurrentModel('', ''); setOpenMenu(null) }}
            onSelect={(providerId, modelId) => { setCurrentModel(providerId, modelId); setOpenMenu(null) }}
            onMaxModeChange={enabled => void updateSettings({ agentMaxMode: enabled })}
            onConfigure={() => { setOpenMenu(null); onOpenSettings() }}
          />
          <AgentContextMeter history={history} currentInput={text} contextWindow={contextWindow} reserveTokens={reserveTokens} measuredUsage={contextUsage} open={openMenu === 'context'} onToggle={() => setOpenMenu(openMenu === 'context' ? null : 'context')} />
          {running ? (
            <>
              {text.trim() && (
                <button className='send-btn queue-send-button' onClick={() => void submit()} title='加入待发送队列' aria-label='加入待发送队列'><svg viewBox='0 0 16 16' width='16' height='16' aria-hidden><path d='M8.3125 0.980183C8.66767 1.0531 8.97902 1.20418 9.2627 1.43233C9.48724 1.61297 9.73029 1.85793 9.97949 2.10714L14.707 6.83468L13.293 8.24874L9 3.95577V15.0417H7V3.95577L2.70703 8.24874L1.29297 6.83468L6.02051 2.10714C6.26971 1.85793 6.51277 1.61297 6.7373 1.43233C6.97662 1.23986 7.28445 1.04402 7.6875 0.980183C7.8973 0.947006 8.1031 0.95516 8.3125 0.980183Z' fill='currentColor' /></svg></button>
              )}
              <button className='stop-btn' onClick={stop} title='停止' aria-label='停止生成'><span className='stop-square' aria-hidden /></button>
            </>
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
  const activeSessionId = useAgentStore(s => s.activeSessionId)
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
  const workdirTitle = workdir ? `工作目录：${workdir}` : '未选择时使用系统用户主目录'

  return (
    <div className='agent-view'>
      {error && <div className='agent-error' style={{ margin: '10px 24px 0' }}>{error}</div>}
      {steps.length === 0 ? (
        <div className='agent-empty'>
          <div className='empty-title'>你好，我是 DeepDesk</div>
          <div className='empty-sub'>直接问我问题，或让我帮你写代码、执行命令、读写文件、发飞书消息。未选择目录时会使用系统用户主目录。</div>
          <div className='quick-chips'>
            <button className='quick-chip' onClick={() => void pickDirectory()} title={workdirTitle}><FolderOpen size={13} /> {workdirLabel || '用户主目录'}</button>
          </div>
          <div className='agent-empty-composer'>
            <AgentComposer onOpenSettings={onOpenSettings} />
          </div>
        </div>
      ) : (
        <div className='agent-scroll' ref={scrollRef}>
          <div className='agent-inner'>
            <WindowedAgentSteps sessionId={activeSessionId} steps={steps} renderStep={(step, index) => <AgentStepItem step={step} index={index} isLastMessage={index === lastMessageIndex} />} />
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
            <div className={clsx('agent-approval', { 'mcp-install': pendingApproval.mcpInstall })} role='dialog' aria-label={pendingApproval.mcpInstall ? '安装 MCP 服务' : '执行审批'}>
              {pendingApproval.mcpInstall ? (
                <>
                  <div className='agent-approval-title'><Blocks size={16} /> 安装 MCP 服务</div>
                  <div className='mcp-install-heading'>
                    <span>{pendingApproval.mcpInstall.name}</span>
                    {pendingApproval.mcpInstall.serverVersion && <span className='mcp-install-version'>v{pendingApproval.mcpInstall.serverVersion}</span>}
                  </div>
                  <div className='mcp-install-source' title={pendingApproval.mcpInstall.source}>{pendingApproval.mcpInstall.source}</div>
                  <div className='mcp-install-copy'>{pendingApproval.mcpInstall.transport === 'stdio'
                    ? '批准后，DeepDesk 将启动并验证这个本地 MCP 进程，连接成功后自动读取可用工具。'
                    : `安装后，DeepDesk 将连接该服务，并向 Agent 提供 ${pendingApproval.mcpInstall.toolNames.length} 个工具。`}</div>
                  {pendingApproval.mcpInstall.cwd && <div className='agent-approval-cwd'>工作目录：{pendingApproval.mcpInstall.cwd}</div>}
                  {pendingApproval.mcpInstall.toolNames.length > 0 && (
                    <div className='mcp-install-tools' aria-label='MCP 工具清单'>
                      {pendingApproval.mcpInstall.toolNames.slice(0, 6).map(name => <span className='mcp-install-tool' key={name}>{name}</span>)}
                      {pendingApproval.mcpInstall.toolNames.length > 6 && <span className='mcp-install-tool muted'>+{pendingApproval.mcpInstall.toolNames.length - 6}</span>}
                    </div>
                  )}
                  <div className='mcp-install-note'>此连接会保存到“设置 → MCP”，下次启动时自动恢复。</div>
                  <div className='agent-approval-actions'>
                    <button className='btn btn-secondary btn-sm' onClick={() => approve(false)}><X size={13} /> 取消</button>
                    <button className='btn btn-primary btn-sm' onClick={() => approve(true)}><Check size={13} /> 安装并连接</button>
                  </div>
                </>
              ) : (
                <>
                  <div className='agent-approval-title'>{pendingApproval.reason || '等待批准'}</div>
                  <pre className='agent-approval-cmd'>{pendingApproval.command || pendingApproval.target}</pre>
                  {pendingApproval.command && pendingApproval.cwd && <div className='agent-approval-cwd'>工作目录：{pendingApproval.cwd}</div>}
                  <div className='agent-approval-actions'>
                    <button className='btn btn-primary btn-sm' onClick={() => approve(true)}><Check size={13} /> 批准</button>
                    <button className='btn btn-danger btn-sm' onClick={() => approve(false)}><X size={13} /> 拒绝</button>
                  </div>
                </>
              )}
            </div>
          )}
          <div className='agent-composer-stack'>
            <QueuedMessages />
            <AgentComposer onOpenSettings={onOpenSettings} />
          </div>
        </div>
      )}
    </div>
  )
}
