import { useEffect, useState } from 'react'
import TitleBar from './components/titlebar/TitleBar'
import Sidebar from './components/sidebar/Sidebar'
import AgentView from './components/agent/AgentView'
import SettingsView from './components/settings/SettingsView'
import type { SettingsTab } from './components/settings/SettingsView'
import FeatureHub from './components/hub/FeatureHub'
import DeepSeekLogo from './components/DeepSeekLogo'
import { useSettingsStore } from './stores/useSettingsStore'
import { useAgentStore } from './stores/useAgentStore'
import { Loader2 } from 'lucide-react'
import { useAppFontScale } from './hooks/useAppFontScale'

type View = 'chat' | 'settings' | 'connectors' | 'skills' | 'more'
export default function App() {
  useAppFontScale()
  const ready = useSettingsStore(s => s.loaded)
  const [view, setView] = useState<View>('chat')
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    void useSettingsStore.getState().load()
  }, [])

  useEffect(() => {
    if (!ready) return
    useAgentStore.getState().init()
  }, [ready])

  useEffect(() => {
    if (!ready) return
    let disposed = false
    const wait = (ms: number): Promise<void> => new Promise(resolve => window.setTimeout(resolve, ms))
    const syncConnectorSessions = async (): Promise<boolean> => {
      try {
        const startedAt = Date.now()
        const feed = await window.api.connectors.activities('wechat')
        await useAgentStore.getState().refreshSessions()
        await useAgentStore.getState().processPendingConnectorSession()
        return Date.now() - startedAt > 1000 || (feed.message ?? '').startsWith('收到 ')
      } catch (error) {
        console.warn('Failed to sync connector sessions', error)
        return false
      }
    }
    void (async () => {
      while (!disposed) {
        const activeLongPoll = await syncConnectorSessions()
        await wait(activeLongPoll ? 250 : 10_000)
      }
    })()
    return () => {
      disposed = true
    }
  }, [ready])

  useEffect(() => {
    const applyAppearance = (): void => {
      const settings = useSettingsStore.getState().settings
      const t = settings?.theme ?? 'dark'
      const real = t === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : t
      document.documentElement.setAttribute('data-theme', real)
      document.documentElement.setAttribute('data-font', settings?.appFont ?? 'default')
    }
    applyAppearance()
    return useSettingsStore.subscribe(applyAppearance)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key === 'n') {
        e.preventDefault()
        useAgentStore.getState().clear()
        setView('chat')
      } else if (mod && e.key === ',') {
        e.preventDefault()
        setView(v => {
          if (v === 'settings') return 'chat'
          setSettingsTab('general')
          return 'settings'
        })
      } else if (e.key === 'Escape') {
        const agent = useAgentStore.getState()
        if (agent.running) agent.stop()
        else setView(v => (v === 'settings' ? 'chat' : v))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!ready) {
    return (
      <div className='splash'>
        <div className='splash-logo'>
          <div className='brand-logo'><DeepSeekLogo width={18} height={18} /></div>
          DeepDesk
        </div>
        <Loader2 className='spin' size={18} />
      </div>
    )
  }

  const openSettings = (tab: SettingsTab = 'general'): void => {
    setSettingsTab(tab)
    setView('settings')
  }

  const openChat = (): void => {
    setView('chat')
  }

  const newTask = (): void => {
    useAgentStore.getState().clear()
    setView('chat')
  }

  return (
    <div className='app-shell'>
      <TitleBar collapsed={collapsed} onNewTask={newTask} onToggleSidebar={() => setCollapsed(c => !c)} />
      <div className='app-body'>
        {view !== 'settings' && (
          <Sidebar
            view={view}
            onNavigate={setView}
            onNewTask={newTask}
            onOpenSettings={openSettings}
            collapsed={collapsed}
          />
        )}
        <main className={view === 'settings' ? 'app-main settings-main' : 'app-main'}>
          {view === 'chat' && <AgentView onOpenSettings={() => openSettings('providers')} />}
          {view === 'settings' && <SettingsView onBack={() => setView('chat')} tab={settingsTab} onTabChange={setSettingsTab} />}
          {(view === 'connectors' || view === 'skills' || view === 'more') && <FeatureHub view={view} onNavigate={setView} onOpenChat={openChat} onOpenSettings={openSettings} />}
        </main>
      </div>
    </div>
  )
}
