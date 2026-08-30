import { Monitor, Moon, Sun } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useSettingsStore } from '../../stores/useSettingsStore'
import type { AgentPermissionMode, AppFont } from '@shared/types'
import { Button, Select, Switch } from '../ui'
import { useChatStore } from '../../stores/useChatStore'
import clsx from 'clsx'

export default function GeneralTab() {
  const settings = useSettingsStore(s => s.settings)
  const providers = useSettingsStore(s => s.providers)
  const updateSettings = useSettingsStore(s => s.updateSettings)
  const conversations = useChatStore(s => s.conversations)
  const deleteConversation = useChatStore(s => s.deleteConversation)

  if (!settings) return null

  const defaultProvider = providers.find(p => p.id === settings.defaultProviderId) ?? providers[0]
  const models = defaultProvider?.models ?? []

  const themes: Array<{ key: 'dark' | 'light' | 'system'; label: string; icon: LucideIcon }> = [
    { key: 'dark', label: '深色', icon: Moon },
    { key: 'light', label: '浅色', icon: Sun },
    { key: 'system', label: '跟随系统', icon: Monitor }
  ]
  const fonts: Array<{ key: AppFont; label: string; desc: string }> = [
    { key: 'default', label: '默认字体', desc: '当前 UI 风格' },
    { key: 'system', label: '系统字体', desc: '跟随系统界面' },
    { key: 'microsoft', label: '微软雅黑', desc: 'Windows 常用' },
    { key: 'serif', label: '宋体', desc: '文档阅读' },
    { key: 'mono', label: '等宽字体', desc: '代码优先' }
  ]

  return (
    <div className='settings-section'>
      <div className='settings-section-title'>权限</div>
      <div className='settings-card'>
        <div className='settings-row'>
          <div>
            <div className='settings-row-label'>Agent 权限模式</div>
            <div className='settings-row-desc'>决定 Agent 执行命令、访问工作目录外文件时的批准策略</div>
          </div>
          <div className='tabs'>
            {([
              { key: 'ask', label: '每次询问' },
              { key: 'auto', label: '替我审批' },
              { key: 'full', label: '完全访问' }
            ] as Array<{ key: AgentPermissionMode; label: string }>).map(o => (
              <button key={o.key} className={clsx('tab', settings.agentPermissionMode === o.key && 'active')} onClick={() => void updateSettings({ agentPermissionMode: o.key })}>{o.label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className='settings-section-title'>常规</div>
      <div className='settings-card'>
        <div className='settings-row'>
          <div>
            <div className='settings-row-label'>默认模型服务</div>
            <div className='settings-row-desc'>新任务默认使用的服务，可在输入框随时切换</div>
          </div>
          <Select value={settings.defaultProviderId} onChange={e => void updateSettings({ defaultProviderId: e.target.value })} style={{ width: 220 }}>
            {providers.map(p => <option key={p.id} value={p.id}>{p.name}{p.apiKey ? '' : '（未配置）'}</option>)}
          </Select>
        </div>
        <div className='settings-row'>
          <div>
            <div className='settings-row-label'>默认模型</div>
            <div className='settings-row-desc'>{defaultProvider ? '来自 ' + defaultProvider.name + ' 的模型列表' : '请先添加模型服务'}</div>
          </div>
          <Select value={settings.defaultModelId} onChange={e => void updateSettings({ defaultModelId: e.target.value })} style={{ width: 220 }}>
            {models.map(m => <option key={m.id} value={m.id}>{m.name ?? m.id}</option>)}
          </Select>
        </div>
        <div className='settings-row'>
          <div>
            <div className='settings-row-label'>主题</div>
            <div className='settings-row-desc'>界面外观</div>
          </div>
          <div className='tabs'>
            {themes.map(t => (
              <button key={t.key} className={clsx('tab', settings.theme === t.key && 'active')} onClick={() => void updateSettings({ theme: t.key })}>
                <t.icon size={13} style={{ marginRight: 4, verticalAlign: -2 }} />{t.label}
              </button>
            ))}
          </div>
        </div>
        <div className='settings-row'>
          <div>
            <div className='settings-row-label'>界面字体</div>
            <div className='settings-row-desc'>默认使用当前 DeepDesk 风格字体，也可以切换成系统、微软雅黑、宋体或等宽字体</div>
          </div>
          <div className='font-options' aria-label='界面字体'>
            {fonts.map(font => (
              <button key={font.key} type='button' className={clsx('font-option', settings.appFont === font.key && 'active')} onClick={() => void updateSettings({ appFont: font.key })}>
                <span>{font.label}</span>
                <small>{font.desc}</small>
              </button>
            ))}
          </div>
        </div>
        <div className='settings-row'>
          <div>
            <div className='settings-row-label'>Enter 发送消息</div>
            <div className='settings-row-desc'>关闭后使用 Ctrl+Enter 发送，Enter 换行</div>
          </div>
          <Switch checked={settings.enterToSend} onChange={v => void updateSettings({ enterToSend: v })} />
        </div>
      </div>

      <div className='settings-section-title'>数据</div>
      <div className='settings-card danger-zone'>
        <div className='settings-row'>
          <div>
            <div className='settings-row-label'>任务记录</div>
            <div className='settings-row-desc'>当前共 {conversations.length} 条记录，全部存储在本地</div>
          </div>
          <Button variant='danger' size='sm' onClick={() => { conversations.forEach(c => void deleteConversation(c.id)) }}>清空全部</Button>
        </div>
      </div>
    </div>
  )
}
