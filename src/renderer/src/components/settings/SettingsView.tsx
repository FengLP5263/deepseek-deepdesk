import { Brain, ChevronLeft, PlugZap, Search, ServerCog, Settings as SettingsIcon } from 'lucide-react'
import ProvidersTab from './ProvidersTab'
import GeneralTab from './GeneralTab'
import MemoriesTab from './MemoriesTab'
import McpTab from './McpTab'
import clsx from 'clsx'

export type SettingsTab = 'providers' | 'general' | 'memories' | 'mcp'

const tabs: Array<{ key: SettingsTab; label: string; group: string; icon: typeof SettingsIcon; desc: string }> = [
  { key: 'general', label: '常规', group: '个人', icon: SettingsIcon, desc: '权限、模型默认值、主题和本地数据' },
  { key: 'memories', label: '记忆', group: '个人', icon: Brain, desc: '管理本地长期记忆和上下文注入' },
  { key: 'providers', label: '模型服务', group: 'AI', icon: PlugZap, desc: '配置 DeepSeek 和 OpenAI 兼容服务' },
  { key: 'mcp', label: 'MCP', group: 'AI', icon: ServerCog, desc: '连接 MCP 服务器并扩展 Agent 工具能力' }
]

export default function SettingsView({ onBack, tab, onTabChange }: { onBack: () => void; tab: SettingsTab; onTabChange: (tab: SettingsTab) => void }) {
  const active = tabs.find(item => item.key === tab) ?? tabs[0]
  return (
    <div className='settings-view'>
      <aside className='settings-nav'>
        <button className='settings-back' onClick={onBack} title='返回'><ChevronLeft size={17} /> 返回应用</button>
        <div className='settings-search'>
          <Search size={15} />
          <input aria-label='搜索设置' placeholder='搜索设置...' />
        </div>
        {['个人', 'AI'].map(group => (
          <div key={group} className='settings-nav-block'>
            <div className='settings-nav-label'>{group}</div>
            {tabs.filter(item => item.group === group).map(item => (
              <button key={item.key} className={clsx('settings-nav-item', tab === item.key && 'active')} onClick={() => onTabChange(item.key)}>
                <item.icon size={16} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </aside>
      <section className='settings-content'>
        <div className='settings-page-head'>
          <h1 className='settings-title'>{active.label}</h1>
          <p>{active.desc}</p>
        </div>
        <div className='settings-scroll'>
          <div className='settings-inner'>
            {tab === 'providers' && <ProvidersTab />}
            {tab === 'general' && <GeneralTab />}
            {tab === 'memories' && <MemoriesTab />}
            {tab === 'mcp' && <McpTab />}
          </div>
        </div>
      </section>
    </div>
  )
}
