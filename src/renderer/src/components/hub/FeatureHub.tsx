import { useCallback, useEffect, useMemo, useState } from 'react'
import { Blocks, Check, ChevronDown, ExternalLink, Globe2, Link2, MessageSquare, MoreHorizontal, Plus, PlugZap, QrCode, RefreshCw, Search, Settings, Sparkles, UserRoundCog, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import { useAgentStore } from '../../stores/useAgentStore'
import type { SettingsTab } from '../settings/SettingsView'
import type { ConnectorActionResult, ConnectorActivityFeed, ConnectorAuthSession, ConnectorConfigPatch, ConnectorId, ConnectorState, ConnectorStatus } from '@shared/types'
import { Modal } from '../ui'
import feishuIcon from '../../assets/icons/feishu.svg'
import wechatIcon from '../../assets/icons/wechat.svg'

type HubView = 'connectors' | 'skills' | 'more'

interface FeatureHubProps {
  view: HubView
  onNavigate: (view: HubView) => void
  onOpenChat: () => void
  onOpenSettings: (tab?: SettingsTab) => void
}

interface BuiltInSkill {
  id: string
  title: string
  desc: string
  category: string
  avatar: string
  tone: 'blue' | 'green' | 'orange' | 'purple' | 'rose' | 'slate'
  featured?: boolean
  task: string
}

const categories = ['全部', '开发工具', '效率工具', '内容创作', '数据分析', '知识学习', '商业运营']

const connectorStateLabels: Record<ConnectorState, string> = {
  connected: '已连接',
  available: '可连接',
  needs_setup: '需配置',
  unavailable: '不可用'
}

const connectorMeta: Record<ConnectorId, { desc: string; icon?: LucideIcon; iconSrc?: string }> = {
  lark: {
    desc: '飞书消息与群聊任务',
    iconSrc: feishuIcon
  },
  wechat: {
    desc: '微信消息与任务触发',
    iconSrc: wechatIcon
  },
  browser: {
    desc: '网页操作与信息采集',
    icon: Globe2
  }
}

function formatActivityTime(value: number): string {
  const date = new Date(value)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

function emptyConnectorDraft(id: ConnectorId): ConnectorConfigPatch {
  return {
    id,
    enabled: false,
    endpoint: '',
    token: '',
    appId: '',
    appSecret: '',
    verificationToken: '',
    encryptKey: ''
  }
}

const builtInSkills: BuiltInSkill[] = [
  {
    id: 'code-review',
    title: '代码审查与修复建议',
    desc: '检查 TypeScript、React、Electron 分层和潜在回归，输出可执行修复建议。',
    category: '开发工具',
    avatar: '审',
    tone: 'blue',
    featured: true,
    task: '请对当前工作区做一次代码审查，重点检查 TypeScript 类型、Electron 分层、UI 回归风险和需要补充的测试。'
  },
  {
    id: 'ui-polish',
    title: 'UI 走查',
    desc: '检查界面对齐、间距、圆角、悬浮态、弹层尺寸和灰阶一致性。',
    category: '开发工具',
    avatar: 'UI',
    tone: 'purple',
    featured: true,
    task: '请对当前客户端 UI 做一次走查，重点检查对齐、间距、圆角、悬浮态、弹层尺寸和颜色使用。'
  },
  {
    id: 'e2e-composer',
    title: 'E2E 测试补全',
    desc: '围绕按钮、菜单、拖拽、持久化和窗口行为补齐可自动运行的验收测试。',
    category: '开发工具',
    avatar: '测',
    tone: 'green',
    featured: true,
    task: '请检查当前 UI 和交互改动，补充必要的 E2E 测试，并运行对应工程化命令验证。'
  },
  {
    id: 'release-gate',
    title: '发布质量门禁',
    desc: '按发布前标准执行版本、测试、构建、打包和风险检查。',
    category: '效率工具',
    avatar: '发',
    tone: 'orange',
    featured: true,
    task: '请按发布前标准检查当前项目质量门禁、构建产物、版本号和潜在发布风险。'
  },
  {
    id: 'project-brief',
    title: '项目结构说明',
    desc: '快速梳理目录、核心模块、启动命令、测试命令和下一步开发入口。',
    category: '知识学习',
    avatar: '图',
    tone: 'slate',
    task: '请阅读当前工作区，整理项目结构、核心模块、运行命令、测试命令和下一步开发建议。'
  },
  {
    id: 'markdown-writer',
    title: '技术文档生成',
    desc: '把实现方案、测试流程、发布说明整理成清晰的 Markdown 文档。',
    category: '内容创作',
    avatar: '文',
    tone: 'rose',
    task: '请基于当前改动整理一份技术说明文档，包含背景、实现点、测试方式和注意事项。'
  },
  {
    id: 'bug-repro',
    title: '缺陷复现脚本',
    desc: '把手工复现路径沉淀为稳定脚本或 E2E 用例，降低回归成本。',
    category: '开发工具',
    avatar: 'Bug',
    tone: 'orange',
    task: '请把当前问题整理为可复现步骤，并补充一个自动化测试或脚本来覆盖这个回归场景。'
  },
  {
    id: 'data-summary',
    title: '数据表分析',
    desc: '读取 CSV/表格类文件，生成字段解释、异常值、统计摘要和图表建议。',
    category: '数据分析',
    avatar: '数',
    tone: 'green',
    task: '请检查当前工作区的数据文件，提取字段说明、异常值、统计摘要，并给出可视化建议。'
  },
  {
    id: 'lark-message',
    title: '飞书消息助手',
    desc: '把结果整理成适合发送给同事的简洁说明，必要时走审批后发送。',
    category: '商业运营',
    avatar: '飞',
    tone: 'blue',
    task: '请把当前工作成果整理成一段适合发给同事的飞书消息，包含完成内容、验证结果和下一步。'
  },
  {
    id: 'test-baseline',
    title: '质量基线巡检',
    desc: '执行工程化质量基线，归纳失败项、原因和优先修复路径。',
    category: '效率工具',
    avatar: '基',
    tone: 'purple',
    task: '请运行当前项目的质量基线，记录通过项、失败项、原因和下一步修复建议。'
  },
  {
    id: 'dependency-scan',
    title: '依赖与脚本巡检',
    desc: '检查 package 脚本、依赖版本、工程化入口和 AI 友好说明是否完整。',
    category: '开发工具',
    avatar: '依',
    tone: 'slate',
    task: '请检查 package 脚本、依赖版本、工程化入口和 AI 协作说明，指出需要补齐或统一的地方。'
  },
  {
    id: 'meeting-summary',
    title: '会议纪要整理',
    desc: '把零散讨论整理成结论、任务、负责人、风险和时间线。',
    category: '内容创作',
    avatar: '纪',
    tone: 'rose',
    task: '请把我提供的讨论内容整理成会议纪要，包含结论、待办、负责人、风险和时间线。'
  }
]

export default function FeatureHub({ view, onNavigate, onOpenChat, onOpenSettings }: FeatureHubProps) {
  const clear = useAgentStore(s => s.clear)
  const setDraftTask = useAgentStore(s => s.setDraftTask)
  const refreshSessions = useAgentStore(s => s.refreshSessions)
  const [skillQuery, setSkillQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('全部')
  const [showInstalledOnly, setShowInstalledOnly] = useState(false)
  const [featuredOffset, setFeaturedOffset] = useState(0)
  const [installedSkillIds, setInstalledSkillIds] = useState<Set<string>>(() => new Set(['code-review', 'ui-polish', 'e2e-composer', 'release-gate']))
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([])
  const [connectorsLoading, setConnectorsLoading] = useState(false)
  const [busyConnectorId, setBusyConnectorId] = useState<ConnectorId | null>(null)
  const [connectorAction, setConnectorAction] = useState<ConnectorActionResult | null>(null)
  const [qrConnectorId, setQrConnectorId] = useState<ConnectorId | null>(null)
  const [showConnectorAdvanced, setShowConnectorAdvanced] = useState(false)
  const [connectorAuth, setConnectorAuth] = useState<ConnectorAuthSession | null>(null)
  const [connectorAuthLoading, setConnectorAuthLoading] = useState(false)
  const [connectorFeed, setConnectorFeed] = useState<ConnectorActivityFeed | null>(null)
  const [connectorFeedLoading, setConnectorFeedLoading] = useState(false)
  const [connectorDrafts, setConnectorDrafts] = useState<Record<ConnectorId, ConnectorConfigPatch>>({
    lark: emptyConnectorDraft('lark'),
    wechat: emptyConnectorDraft('wechat'),
    browser: emptyConnectorDraft('browser')
  })

  const refreshConnectors = useCallback(async (): Promise<void> => {
    setConnectorsLoading(true)
    try {
      const next = await window.api.connectors.list()
      setConnectors(next)
      setConnectorDrafts(current => {
        const drafts = { ...current }
        for (const connector of next) {
          if (connector.config) drafts[connector.id] = { ...connector.config }
        }
        return drafts
      })
    } catch (error) {
      setConnectorAction({
        id: 'browser',
        ok: false,
        message: '连接器检测失败',
        detail: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setConnectorsLoading(false)
    }
  }, [])

  const refreshConnectorActivities = useCallback(async (): Promise<void> => {
    setConnectorFeedLoading(true)
    try {
      const feed = await window.api.connectors.activities()
      setConnectorFeed(feed)
      await refreshSessions()
    } catch (error) {
      setConnectorFeed({
        items: [],
        syncedAt: Date.now(),
        message: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setConnectorFeedLoading(false)
    }
  }, [refreshSessions])

  useEffect(() => {
    if (view !== 'connectors') return
    void refreshConnectors()
    void refreshConnectorActivities()
  }, [refreshConnectorActivities, refreshConnectors, view])

  const startWithDraft = (task: string): void => {
    clear()
    setDraftTask(task)
    onOpenChat()
  }

  const toggleInstall = (id: string): void => {
    setInstalledSkillIds(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runConnectorAction = async (id: ConnectorId): Promise<void> => {
    setBusyConnectorId(id)
    try {
      const result = await window.api.connectors.connect(id)
      setConnectorAction(result)
      setConnectors(await window.api.connectors.list())
      await refreshConnectorActivities()
    } catch (error) {
      setConnectorAction({
        id,
        ok: false,
        message: '连接器操作失败',
        detail: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusyConnectorId(null)
    }
  }

  const saveConnector = async (id: ConnectorId): Promise<void> => {
    setBusyConnectorId(id)
    try {
      const saved = await window.api.connectors.save(connectorDrafts[id])
      setConnectorDrafts(current => ({ ...current, [id]: { ...saved } }))
      setConnectorAction({ id, ok: true, message: '连接器配置已保存', detail: id === 'wechat' ? '微信接入信息已保存。' : '飞书接入信息已保存。' })
      await refreshConnectors()
    } catch (error) {
      setConnectorAction({
        id,
        ok: false,
        message: '保存连接器配置失败',
        detail: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusyConnectorId(null)
    }
  }

  const disconnectConnector = async (id: ConnectorId): Promise<void> => {
    setBusyConnectorId(id)
    try {
      const result = await window.api.connectors.disconnect(id)
      setConnectorAction(result)
      await refreshConnectors()
      await refreshConnectorActivities()
    } catch (error) {
      setConnectorAction({
        id,
        ok: false,
        message: '断开连接器失败',
        detail: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusyConnectorId(null)
    }
  }

  const updateConnectorDraft = (id: ConnectorId, key: keyof ConnectorConfigPatch, value: string): void => {
    setConnectorDrafts(current => ({ ...current, [id]: { ...current[id], [key]: value } }))
  }

  const openConnectorQr = (id: ConnectorId): void => {
    setQrConnectorId(id)
    setShowConnectorAdvanced(false)
    setConnectorAction(null)
    setConnectorAuth(null)
  }

  const closeConnectorQr = (): void => {
    setQrConnectorId(null)
    setShowConnectorAdvanced(false)
    setConnectorAuth(null)
  }

  const requestConnectorQr = useCallback(async (id: ConnectorId): Promise<void> => {
    setConnectorAuthLoading(true)
    try {
      const connectorApi = window.api.connectors as typeof window.api.connectors & {
        startAuth?: (connectorId: ConnectorId) => Promise<ConnectorAuthSession>
      }
      if (typeof connectorApi.startAuth !== 'function') {
        setConnectorAuth({
          id,
          ok: false,
          state: 'failed',
          message: '请重启 DeepDesk',
          detail: '连接器能力已更新，当前窗口仍在使用旧 preload。请停止 pnpm dev 后重新启动。'
        })
        setShowConnectorAdvanced(false)
        return
      }
      const session = await connectorApi.startAuth(id)
      setConnectorAuth(session)
      if (!session.ok) setShowConnectorAdvanced(true)
    } catch (error) {
      setConnectorAuth({
        id,
        ok: false,
        state: 'failed',
        message: '获取二维码失败',
        detail: error instanceof Error ? error.message : String(error)
      })
      setShowConnectorAdvanced(true)
    } finally {
      setConnectorAuthLoading(false)
    }
  }, [])

  const refreshConnectorAuth = useCallback(async (id: ConnectorId, sessionId: string): Promise<void> => {
    try {
      const connectorApi = window.api.connectors as typeof window.api.connectors & {
        authStatus?: (connectorId: ConnectorId, connectorSessionId: string) => Promise<ConnectorAuthSession>
      }
      if (typeof connectorApi.authStatus !== 'function') return
      const session = await connectorApi.authStatus(id, sessionId)
      setConnectorAuth(session)
      if (session.state === 'connected') await refreshConnectors()
    } catch (error) {
      setConnectorAuth(current => ({
        id,
        ok: false,
        state: 'failed',
        sessionId: current?.sessionId,
        message: '查询授权状态失败',
        detail: error instanceof Error ? error.message : String(error)
      }))
    }
  }, [refreshConnectors])

  const filteredSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase()
    return builtInSkills.filter(skill => {
      const matchesInstalled = !showInstalledOnly || installedSkillIds.has(skill.id)
      const matchesCategory = activeCategory === '全部' || skill.category === activeCategory
      const matchesQuery = !query || `${skill.title} ${skill.desc} ${skill.category}`.toLowerCase().includes(query)
      return matchesInstalled && matchesCategory && matchesQuery
    })
  }, [activeCategory, installedSkillIds, showInstalledOnly, skillQuery])

  const featuredSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase()
    const featured = builtInSkills.filter(skill => {
      const matchesInstalled = !showInstalledOnly || installedSkillIds.has(skill.id)
      const matchesQuery = !query || `${skill.title} ${skill.desc} ${skill.category}`.toLowerCase().includes(query)
      return skill.featured && matchesInstalled && matchesQuery
    })
    if (featured.length === 0) return []
    return Array.from({ length: Math.min(5, featured.length) }, (_, index) => featured[(featuredOffset + index) % featured.length])
  }, [featuredOffset, installedSkillIds, showInstalledOnly, skillQuery])

  const qrConnector = qrConnectorId ? connectors.find(connector => connector.id === qrConnectorId) : undefined

  useEffect(() => {
    if (!qrConnectorId || qrConnectorId === 'browser') return
    void requestConnectorQr(qrConnectorId)
  }, [qrConnectorId, requestConnectorQr])

  useEffect(() => {
    if (!qrConnectorId || !connectorAuth?.sessionId) return
    if (connectorAuth.state !== 'pending' && connectorAuth.state !== 'scanned') return
    const timer = window.setInterval(() => {
      void refreshConnectorAuth(qrConnectorId, connectorAuth.sessionId!)
    }, 2500)
    return () => window.clearInterval(timer)
  }, [connectorAuth?.sessionId, connectorAuth?.state, qrConnectorId, refreshConnectorAuth])

  if (view === 'connectors') {
    return (
      <div className='hub-view connector-view'>
        <div className='hub-header'>
          <div className='hub-icon'><PlugZap size={20} /></div>
          <h1>连接器</h1>
          <p>连接消息工具和浏览器能力。</p>
        </div>
        <div className='connector-toolbar'>
          <button className='btn btn-ghost btn-sm' onClick={() => void refreshConnectorActivities()} disabled={connectorFeedLoading}>
            <MessageSquare size={14} /> {connectorFeedLoading ? '刷新中' : '刷新消息'}
          </button>
          <button className='btn btn-ghost btn-sm' onClick={() => void refreshConnectors()} disabled={connectorsLoading}>
            <RefreshCw size={14} /> {connectorsLoading ? '检测中' : '重新检测'}
          </button>
        </div>
        <div className='connector-grid'>
          {connectors.map(connector => {
            const meta = connectorMeta[connector.id]
            const Icon = meta.icon
            return (
              <section key={connector.id} className={clsx('connector-card', `state-${connector.state}`)}>
                <div className='connector-card-head'>
                  <div className={clsx('connector-icon', `brand-${connector.id}`)}>
                    {meta.iconSrc ? <img src={meta.iconSrc} alt={`${connector.name} 图标`} /> : Icon ? <Icon width={19} height={19} /> : null}
                  </div>
                  <div className='connector-title-block'>
                    <div className='connector-title'>{connector.name}</div>
                    <div className='connector-subtitle'>{meta.desc}</div>
                  </div>
                  <span className='connector-state'>{connectorStateLabels[connector.state]}</span>
                </div>
                <div className='connector-summary'>{connector.summary}</div>
                <div className='connector-actions'>
                  {connector.state === 'connected' && connector.disconnectAction ? (
                    <button className='btn btn-ghost btn-sm' onClick={() => void disconnectConnector(connector.id)} disabled={busyConnectorId === connector.id}>
                      {busyConnectorId === connector.id ? '处理中' : connector.disconnectAction}
                    </button>
                  ) : connector.id === 'browser' || connector.primaryAction === '连接' ? (
                    <button className='btn btn-primary btn-sm' onClick={() => void runConnectorAction(connector.id)} disabled={busyConnectorId === connector.id}>
                      {busyConnectorId === connector.id ? '处理中' : connector.primaryAction}
                    </button>
                  ) : (
                    <button className='btn btn-primary btn-sm' onClick={() => openConnectorQr(connector.id)} disabled={busyConnectorId === connector.id}>
                      扫码接入
                    </button>
                  )}
                </div>
              </section>
            )
          })}
          {connectorsLoading && connectors.length === 0 && (
            <div className='connector-empty'>正在检测本机连接器状态…</div>
          )}
          {!connectorsLoading && connectors.length === 0 && (
            <div className='connector-empty'>暂时没有可展示的连接器。</div>
          )}
        </div>
        <section className='connector-activity-panel'>
          <div className='connector-activity-head'>
            <div>
              <h2>连接器消息</h2>
              <p>微信和飞书接入服务收到的消息会显示在这里；浏览器连接后会显示可自动化页面。</p>
            </div>
            <span>{connectorFeed ? '更新于 ' + formatActivityTime(connectorFeed.syncedAt) : '未刷新'}</span>
          </div>
          {connectorFeed?.message && <div className='connector-activity-hint'>{connectorFeed.message}</div>}
          <div className='connector-activity-list'>
            {connectorFeedLoading && !connectorFeed && <div className='connector-activity-empty'>正在读取连接器消息…</div>}
            {connectorFeed && connectorFeed.items.length === 0 && <div className='connector-activity-empty'>还没有收到连接器消息。微信或飞书扫码接入后，请确认接入服务已开启消息事件转发。</div>}
            {connectorFeed?.items.map(item => {
              const meta = connectorMeta[item.connectorId]
              const Icon = meta.icon
              return (
                <article key={item.id} className='connector-activity-item'>
                  <div className={clsx('connector-activity-icon', `brand-${item.connectorId}`)}>
                    {meta.iconSrc ? <img src={meta.iconSrc} alt='' /> : Icon ? <Icon width={16} height={16} /> : null}
                  </div>
                  <div className='connector-activity-main'>
                    <div className='connector-activity-meta'>
                      <strong>{item.sourceName || connectorStateLabels.connected}</strong>
                      {item.conversationName && <span>{item.conversationName}</span>}
                      <time>{formatActivityTime(item.createdAt)}</time>
                    </div>
                    <div className='connector-activity-text'>{item.text}</div>
                  </div>
                  <span className={clsx('connector-activity-status', item.status)}>{item.status === 'handled' ? '已处理' : item.status === 'failed' ? '失败' : '新消息'}</span>
                </article>
              )
            })}
          </div>
        </section>
        {connectorAction && !qrConnector && (
          <div className={clsx('connector-result', connectorAction.ok ? 'ok' : 'warn')}>
            <div>
              <strong>{connectorAction.message}</strong>
              {connectorAction.detail && <span>{connectorAction.detail}</span>}
            </div>
          </div>
        )}
        <div className='connector-note'>
          <ExternalLink size={14} />
          模型服务仍在“更多 / 设置 / 模型服务”中管理；这里仅管理办公工具和浏览器能力。
        </div>
        {qrConnector && qrConnector.id !== 'browser' && (
          <Modal
            title={`${qrConnector.name}扫码接入`}
            onClose={closeConnectorQr}
            width={420}
            footer={(
              <>
                <button className='btn btn-ghost' onClick={closeConnectorQr}>关闭</button>
                {connectorAuth?.sessionId && connectorAuth.state !== 'connected' && (
                  <button className='btn btn-ghost' onClick={() => void refreshConnectorAuth(qrConnector.id, connectorAuth.sessionId!)} disabled={connectorAuthLoading}>
                    刷新状态
                  </button>
                )}
                <button className='btn btn-primary' onClick={() => void requestConnectorQr(qrConnector.id)} disabled={connectorAuthLoading}>
                  {connectorAuthLoading ? '获取中' : '获取二维码'}
                </button>
              </>
            )}
          >
            <div className='connector-qr-panel'>
              <div className='connector-qr-box' aria-label={`${qrConnector.name}扫码接入二维码`}>
                {connectorAuth?.qrDataUrl ? (
                  <img src={connectorAuth.qrDataUrl} alt={`${qrConnector.name}扫码接入二维码`} />
                ) : (
                  <>
                    <QrCode size={42} />
                    <span>{connectorAuthLoading ? '获取中' : '未生成二维码'}</span>
                  </>
                )}
              </div>
              <p className='connector-qr-caption'>
                {connectorAuth?.message ?? '配置接入服务后获取二维码。'}
                {connectorAuth?.detail ? ` ${connectorAuth.detail}` : ''}
              </p>
              <button className='connector-advanced-toggle' onClick={() => setShowConnectorAdvanced(value => !value)}>
                高级配置 <ChevronDown size={14} className={clsx(showConnectorAdvanced && 'open')} />
              </button>
              {showConnectorAdvanced && (
                <div className='connector-form connector-form-modal'>
                  {qrConnector.id === 'lark' && (
                    <>
                      <input value={String(connectorDrafts.lark.endpoint ?? '')} onChange={event => updateConnectorDraft('lark', 'endpoint', event.target.value)} placeholder='飞书接入服务地址' />
                      <input value={String(connectorDrafts.lark.token ?? '')} onChange={event => updateConnectorDraft('lark', 'token', event.target.value)} placeholder='访问令牌（可选）' type='password' />
                      <input value={String(connectorDrafts.lark.appId ?? '')} onChange={event => updateConnectorDraft('lark', 'appId', event.target.value)} placeholder='飞书应用 ID' />
                      <input value={String(connectorDrafts.lark.appSecret ?? '')} onChange={event => updateConnectorDraft('lark', 'appSecret', event.target.value)} placeholder='飞书应用密钥' type='password' />
                      <input value={String(connectorDrafts.lark.verificationToken ?? '')} onChange={event => updateConnectorDraft('lark', 'verificationToken', event.target.value)} placeholder='事件校验令牌（可选）' />
                      <input value={String(connectorDrafts.lark.encryptKey ?? '')} onChange={event => updateConnectorDraft('lark', 'encryptKey', event.target.value)} placeholder='消息加密密钥（可选）' type='password' />
                    </>
                  )}
                  {qrConnector.id === 'wechat' && (
                    <>
                      <input value={String(connectorDrafts.wechat.endpoint ?? '')} onChange={event => updateConnectorDraft('wechat', 'endpoint', event.target.value)} placeholder='微信接入服务地址' />
                      <input value={String(connectorDrafts.wechat.token ?? '')} onChange={event => updateConnectorDraft('wechat', 'token', event.target.value)} placeholder='访问令牌' type='password' />
                    </>
                  )}
                  <div className='connector-modal-actions'>
                    <button className='btn btn-ghost btn-sm' onClick={() => void saveConnector(qrConnector.id)} disabled={busyConnectorId === qrConnector.id}>保存配置</button>
                    <button className='btn btn-primary btn-sm' onClick={() => void runConnectorAction(qrConnector.id)} disabled={busyConnectorId === qrConnector.id}>
                      {qrConnector.id === 'lark' ? '启用飞书' : '启用微信'}
                    </button>
                  </div>
                </div>
              )}
              {connectorAction?.id === qrConnector.id && (
                <div className={clsx('connector-modal-result', connectorAction.ok ? 'ok' : 'warn')}>
                  <strong>{connectorAction.message}</strong>
                  {connectorAction.detail && <span>{connectorAction.detail}</span>}
                </div>
              )}
            </div>
          </Modal>
        )}
      </div>
    )
  }

  if (view === 'skills') {
    return (
      <div className='hub-view skill-market'>
        <div className='skill-market-top'>
          <div className='skill-top-tabs' aria-label='功能类型'>
            <button className='skill-top-tab' onClick={() => startWithDraft('请作为专家顾问，帮我拆解当前项目下一步最应该解决的问题。')}><UserRoundCog size={15} /> 专家</button>
            <button className='skill-top-tab active'><Blocks size={15} /> 技能</button>
            <button className='skill-top-tab' onClick={() => onNavigate('connectors')}><Link2 size={15} /> 连接器</button>
          </div>
          <div className='skill-market-actions'>
            <label className='skill-search'>
              <Search size={15} />
              <input value={skillQuery} onChange={event => setSkillQuery(event.target.value)} placeholder='搜索技能' />
            </label>
            <button className={clsx('skill-pill', showInstalledOnly && 'active')} onClick={() => setShowInstalledOnly(value => !value)}>
              <Check size={15} /> 我安装的 <span>{installedSkillIds.size}</span>
            </button>
            <button className='skill-pill' onClick={() => startWithDraft('请帮我设计一个新的 DeepDesk 技能，包含使用场景、触发词、执行步骤和测试方式。')}>
              <Plus size={15} /> 添加技能
            </button>
          </div>
        </div>

        <section className='skill-section'>
          <div className='skill-section-head'>
            <h1>精选技能</h1>
            <button className='skill-text-button' onClick={() => setFeaturedOffset(offset => (offset + 1) % builtInSkills.filter(skill => skill.featured).length)}>
              <RefreshCw size={14} /> 换一换
            </button>
          </div>
          <div className='featured-skill-grid'>
            {featuredSkills.map(skill => (
              <article key={skill.id} className='skill-card featured'>
                <button className={clsx('skill-install', installedSkillIds.has(skill.id) && 'installed')} title={installedSkillIds.has(skill.id) ? '取消安装' : '安装技能'} onClick={() => toggleInstall(skill.id)}>
                  {installedSkillIds.has(skill.id) ? <Check size={15} /> : <Plus size={15} />}
                </button>
                <div className={clsx('skill-avatar', `tone-${skill.tone}`)}>{skill.avatar}</div>
                <div className='skill-card-title'>{skill.title}</div>
                <div className='skill-card-desc'>{skill.desc}</div>
                <button className='skill-use-button' onClick={() => startWithDraft(skill.task)}>使用技能</button>
              </article>
            ))}
          </div>
        </section>

        <section className='skill-section'>
          <div className='skill-tabs'>
            <button className='skill-tab strong'>推荐</button>
            <button className='skill-tab'>SkillHub</button>
            <button className='skill-tab'>套件</button>
          </div>
          <div className='skill-category-row'>
            {categories.map(category => (
              <button key={category} className={clsx('skill-category', activeCategory === category && 'active')} onClick={() => setActiveCategory(category)}>
                {category}
              </button>
            ))}
          </div>
          <div className='skill-grid'>
            {filteredSkills.map(skill => (
              <article key={skill.id} className='skill-card'>
                <button className={clsx('skill-install', installedSkillIds.has(skill.id) && 'installed')} title={installedSkillIds.has(skill.id) ? '取消安装' : '安装技能'} onClick={() => toggleInstall(skill.id)}>
                  {installedSkillIds.has(skill.id) ? <Check size={15} /> : <Plus size={15} />}
                </button>
                <div className={clsx('skill-avatar', `tone-${skill.tone}`)}>{skill.avatar}</div>
                <div className='skill-card-title'>{skill.title}</div>
                <div className='skill-card-desc'>{skill.desc}</div>
                <div className='skill-card-foot'>
                  <span>{skill.category}</span>
                  <button className='skill-use-button' onClick={() => startWithDraft(skill.task)}>使用技能</button>
                </div>
              </article>
            ))}
            {filteredSkills.length === 0 && (
              <div className='skill-empty'>
                没有找到匹配的技能。可以切换分类、清空搜索，或点击“添加技能”创建新的技能模板。
              </div>
            )}
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className='hub-view'>
      <div className='hub-header'>
        <div className='hub-icon'><MoreHorizontal size={20} /></div>
        <h1>更多</h1>
        <p>常用管理入口和工程化操作集中放在这里。</p>
      </div>
      <div className='hub-grid'>
        <section className='hub-card'>
          <div className='hub-card-icon'><Settings size={18} /></div>
          <div className='hub-card-title'>设置</div>
          <div className='hub-card-desc'>配置权限、主题、默认模型和本地数据。</div>
          <button className='btn btn-ghost btn-sm' onClick={() => onOpenSettings('general')}>打开设置</button>
        </section>
        <section className='hub-card'>
          <div className='hub-card-icon'><PlugZap size={18} /></div>
          <div className='hub-card-title'>模型服务</div>
          <div className='hub-card-desc'>维护 DeepSeek 和 OpenAI 兼容模型服务。</div>
          <button className='btn btn-ghost btn-sm' onClick={() => onOpenSettings('providers')}>管理模型</button>
        </section>
        <section className='hub-card'>
          <div className='hub-card-icon'><Sparkles size={18} /></div>
          <div className='hub-card-title'>新建任务</div>
          <div className='hub-card-desc'>清空当前任务上下文，回到输入页开始新的任务。</div>
          <button className='btn btn-ghost btn-sm' onClick={() => { clear(); onOpenChat() }}>新建任务</button>
        </section>
      </div>
    </div>
  )
}
