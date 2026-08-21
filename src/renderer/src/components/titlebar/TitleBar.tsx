import { PanelLeftClose, PanelLeftOpen, SquarePen } from 'lucide-react'
import WindowsControls from './WindowsControls'

export default function TitleBar({
  collapsed,
  onNewTask,
  onToggleSidebar
}: {
  collapsed: boolean
  onNewTask: () => void
  onToggleSidebar: () => void
}) {
  const platform = window.api.platform

  return (
    <div className={'titlebar drag platform-' + platform.id}>
      <div className='titlebar-tools no-drag' aria-label='窗口快捷操作'>
        <button type='button' className='titlebar-tool-btn' onClick={onToggleSidebar} title={collapsed ? '展开侧边栏' : '收起侧边栏'} aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}>
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <button type='button' className='titlebar-tool-btn' onClick={onNewTask} title='新建任务' aria-label='新建任务'>
          <SquarePen size={16} strokeWidth={1.9} />
        </button>
      </div>
      {!platform.nativeWindowControls && <WindowsControls />}
    </div>
  )
}
