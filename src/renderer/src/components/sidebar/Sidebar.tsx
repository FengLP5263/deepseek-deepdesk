import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Blocks, ChevronDown, Link2, MoreHorizontal, Search, Settings, SquarePen, UserRound } from 'lucide-react'
import DeepSeekLogo from '../DeepSeekLogo'
import { useAgentStore } from '../../stores/useAgentStore'
import { formatTime } from '../../lib/format'
import { orderSidebarSessions } from '../../lib/session-order'
import { APP_VERSION } from '@shared/app-meta'
import type { SettingsTab } from '../settings/SettingsView'
import clsx from 'clsx'

type AppView = 'chat' | 'settings' | 'connectors' | 'skills' | 'more'

function SessionRunningIndicator() {
  const dots = [
    { cx: 7, cy: 1.5, opacity: 1 },
    { cx: 10.9, cy: 3.1, opacity: 0.86 },
    { cx: 12.5, cy: 7, opacity: 0.72 },
    { cx: 10.9, cy: 10.9, opacity: 0.6 },
    { cx: 7, cy: 12.5, opacity: 0.48 },
    { cx: 3.1, cy: 10.9, opacity: 0.38 },
    { cx: 1.5, cy: 7, opacity: 0.3 },
    { cx: 3.1, cy: 3.1, opacity: 0.22 }
  ]
  return (
    <svg className='session-running-indicator spin' style={{ animationDuration: '1.8s' }} width='14' height='14' viewBox='0 0 14 14' role='status' aria-label='任务进行中'>
      {dots.map(dot => <circle key={`${dot.cx}-${dot.cy}`} cx={dot.cx} cy={dot.cy} r='1.15' fill='currentColor' opacity={dot.opacity} />)}
    </svg>
  )
}

function SessionUnreadIndicator() {
  return <span className='session-unread-indicator' style={{ width: '0.5em', height: '0.5em', flex: 'none', borderRadius: '50%', background: '#34c759', boxShadow: '0 0 0 2px rgba(52, 199, 89, 0.16)' }} role='status' aria-label='未读更新' />
}

export default function Sidebar({
  view,
  onNavigate,
  onNewTask,
  onSearch,
  onOpenSettings,
  collapsed
}: {
  view: AppView
  onNavigate: (view: AppView) => void
  onNewTask: () => void
  onSearch: () => void
  onOpenSettings: (tab?: SettingsTab) => void
  collapsed: boolean
}) {
  const sessions = useAgentStore(s => s.sessions)
  const activeSessionId = useAgentStore(s => s.activeSessionId)
  const runningSessions = useAgentStore(s => s.runningSessions)
  const loadSession = useAgentStore(s => s.loadSession)
  const deleteSession = useAgentStore(s => s.deleteSession)
  const renameSession = useAgentStore(s => s.renameSession)
  const toggleSessionPinned = useAgentStore(s => s.toggleSessionPinned)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [tasksOpen, setTasksOpen] = useState(true)
  const [connectorSessionsOpen, setConnectorSessionsOpen] = useState(true)
  const menuRef = useRef<HTMLDivElement>(null)
  const settingsShortcut = window.api.platform.id === 'macos' ? '⌘,' : 'Ctrl+,'
  const searchShortcut = window.api.platform.id === 'macos' ? '⌘ K' : 'Ctrl K'
  const orderedSessions = orderSidebarSessions(sessions)
  const normalSessions = orderedSessions.filter(session => session.source?.type !== 'connector')
  const connectorSessions = orderedSessions.filter(session => session.source?.type === 'connector')

  useEffect(() => {
    const closeMenu = (event: PointerEvent): void => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        setMenuId(null)
        setConfirmId(null)
      }
    }
    document.addEventListener('pointerdown', closeMenu)
    return () => document.removeEventListener('pointerdown', closeMenu)
  }, [])

  useLayoutEffect(() => {
    if (view === 'chat' && activeSessionId && sessions.find(session => session.id === activeSessionId)?.hasUnread) loadSession(activeSessionId)
  }, [activeSessionId, loadSession, sessions, view])

  const commitRename = (id: string): void => {
    const t = renameText.trim()
    if (t) void renameSession(id, t)
    setRenamingId(null)
    setMenuId(null)
  }

  const openSession = (id: string): void => {
    if (renamingId || confirmId) return
    loadSession(id)
    onNavigate('chat')
  }

  const beginRename = (id: string, task: string): void => {
    setConfirmId(null)
    setMenuId(null)
    setRenamingId(id)
    setRenameText(task)
  }

  const confirmDelete = async (id: string): Promise<void> => {
    await deleteSession(id)
    setConfirmId(null)
    setMenuId(null)
  }

  const exportSession = async (id: string, format: 'markdown' | 'json'): Promise<void> => {
    const result = await window.api.agent.exportSession(id, format)
    if (!result.ok && !result.canceled) console.warn('Failed to export session', result.message)
    setMenuId(null)
  }

  const connectorLabel = (session: (typeof sessions)[number]): string => {
    if (session.source?.type !== 'connector') return ''
    return session.source.connectorId === 'wechat' ? '微信' : '飞书'
  }

  const renderSessionItem = (s: (typeof sessions)[number]) => (
    <div key={s.id} className={clsx('conv-item', s.source?.type === 'connector' && 'connector', activeSessionId === s.id && view === 'chat' && 'active', menuId === s.id && 'menu-open')} onClick={() => openSession(s.id)}>
      {renamingId === s.id ? (
        <input className='conv-rename-input' aria-label='编辑会话标题' autoFocus value={renameText} onChange={e => setRenameText(e.target.value)} onClick={e => e.stopPropagation()} onBlur={() => commitRename(s.id)} onKeyDown={e => { if (e.key === 'Enter') commitRename(s.id); if (e.key === 'Escape') setRenamingId(null) }} />
      ) : (
        <div className='conv-title'>
          {s.source?.type === 'connector' && <span className='conv-source'>{connectorLabel(s)}</span>}
          <span className='conv-title-text'>{s.task}</span>
          {runningSessions[s.id] && !(activeSessionId === s.id && view === 'chat') && <SessionRunningIndicator />}
          {!runningSessions[s.id] && s.hasUnread && !(activeSessionId === s.id && view === 'chat') && <SessionUnreadIndicator />}
        </div>
      )}
      {renamingId !== s.id && <div className='conv-time'>{formatTime(s.updatedAt)}</div>}
      {renamingId !== s.id && (
        <button
          type='button'
          className='conv-action'
          aria-label={'会话操作：' + s.task}
          aria-expanded={menuId === s.id}
          onClick={e => {
            e.stopPropagation()
            setConfirmId(null)
            setMenuId(menuId === s.id ? null : s.id)
          }}
        >
          <MoreHorizontal size={15} />
        </button>
      )}
      {menuId === s.id && (
        <div className='conv-menu' ref={menuRef} role='menu' aria-label='会话操作' onClick={e => e.stopPropagation()}>
          {confirmId === s.id ? (
            <>
              <div className='conv-menu-confirm'>删除这个会话？</div>
              <div className='conv-menu-actions'>
                <button type='button' className='conv-menu-button' onClick={() => setConfirmId(null)}>取消</button>
                <button type='button' className='conv-menu-button danger' onClick={() => void confirmDelete(s.id)}>确认删除</button>
              </div>
            </>
          ) : (
            <>
              <button type='button' className='conv-menu-item' role='menuitem' onClick={() => { toggleSessionPinned(s.id); setMenuId(null) }}>{s.pinnedAt ? '取消置顶' : '置顶会话'}</button>
              <button type='button' className='conv-menu-item' role='menuitem' onClick={() => beginRename(s.id, s.task)}>编辑标题</button>
              <button type='button' className='conv-menu-item' role='menuitem' onClick={() => void exportSession(s.id, 'markdown')}>导出 Markdown</button>
              <button type='button' className='conv-menu-item' role='menuitem' onClick={() => void exportSession(s.id, 'json')}>导出 JSON</button>
              <button type='button' className='conv-menu-item danger' role='menuitem' onClick={() => setConfirmId(s.id)}>删除会话</button>
            </>
          )}
        </div>
      )}
    </div>
  )

  return (
    <aside className={clsx('sidebar', collapsed && 'collapsed')}>
      {!collapsed && (
        <>
          <div className='sidebar-header'>
            <div className='brand'>
              <div className='brand-logo'><DeepSeekLogo width={22} height={22} /></div>
              <span className='brand-copy'>
                <span className='brand-name'>DeepDesk</span>
                <span className='brand-version'>v{APP_VERSION}</span>
              </span>
            </div>
          </div>
          <div className='sidebar-nav'>
            <button className={clsx('sidebar-nav-item', view === 'chat' && !activeSessionId && 'active')} onClick={onNewTask}><SquarePen className='sidebar-nav-icon' size={17} strokeWidth={1.9} /> 新建任务</button>
            <button className='sidebar-nav-item' onClick={onSearch} title={'搜索任务 (' + searchShortcut + ')'}><Search className='sidebar-nav-icon' size={17} strokeWidth={1.9} /> 搜索任务 <span className='sidebar-shortcut'>{searchShortcut}</span></button>
            <button className={clsx('sidebar-nav-item', view === 'connectors' && 'active')} onClick={() => onNavigate('connectors')}><Link2 className='sidebar-nav-icon' size={17} strokeWidth={1.9} /> 连接器</button>
            <button className={clsx('sidebar-nav-item', view === 'skills' && 'active')} onClick={() => onNavigate('skills')}><Blocks className='sidebar-nav-icon' size={17} strokeWidth={1.9} /> 技能广场</button>
            <button className={clsx('sidebar-nav-item', view === 'more' && 'active')} onClick={() => onNavigate('more')}><MoreHorizontal className='sidebar-nav-icon' size={17} strokeWidth={1.9} /> 更多</button>
          </div>
          <button className='sidebar-section-toggle' aria-expanded={tasksOpen} onClick={() => setTasksOpen(open => !open)}>
            <span>最近任务 ({normalSessions.length})</span>
            <ChevronDown size={13} className={clsx('section-chevron', !tasksOpen && 'collapsed')} />
          </button>
          {tasksOpen && (normalSessions.length > 0 || connectorSessions.length === 0) && (
            <div className='sidebar-scroll'>
              {normalSessions.length === 0 && connectorSessions.length === 0 && (
                <div className='muted fs-xs' style={{ textAlign: 'center', padding: '24px 8px' }}>
                  还没有任务，点击新建任务开始
                </div>
              )}
              {normalSessions.map(renderSessionItem)}
            </div>
          )}
          {connectorSessions.length > 0 && (
            <>
              <button className='sidebar-section-toggle' aria-expanded={connectorSessionsOpen} onClick={() => setConnectorSessionsOpen(open => !open)}>
                <span>连接器会话 ({connectorSessions.length})</span>
                <ChevronDown size={13} className={clsx('section-chevron', !connectorSessionsOpen && 'collapsed')} />
              </button>
              {connectorSessionsOpen && <div className='sidebar-scroll compact'>{connectorSessions.map(renderSessionItem)}</div>}
            </>
          )}
          {!tasksOpen && !connectorSessionsOpen && <div className='sidebar-spacer' />}
          <div className='sidebar-footer'>
            <div className='account-chip' title='个人账户'>
              <span className='account-avatar'><UserRound size={15} /></span>
              <span className='account-meta'>
                <span className='account-name'>个人账户</span>
              </span>
            </div>
            <button className='icon-btn' title={'设置 (' + settingsShortcut + ')'} aria-label='设置' onClick={() => onOpenSettings('general')}><Settings size={15} /></button>
          </div>
        </>
      )}
    </aside>
  )
}
