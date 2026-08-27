import { useMemo, useState } from 'react'
import { Blocks, Check, FolderOpen, Link2, MoreHorizontal, Plus, PlugZap, RefreshCw, Search, Settings, Sparkles, TerminalSquare, UserRoundCog } from 'lucide-react'
import clsx from 'clsx'
import { useAgentStore } from '../../stores/useAgentStore'
import { useSettingsStore } from '../../stores/useSettingsStore'
import type { SettingsTab } from '../settings/SettingsView'

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

function getWorkdirName(workdir: string): string {
  const normalized = workdir.trim().replace(/[\\/]+$/, '')
  if (!normalized) return '默认工作区'
  return normalized.split(/[\\/]+/).filter(Boolean).at(-1) ?? normalized
}

export default function FeatureHub({ view, onNavigate, onOpenChat, onOpenSettings }: FeatureHubProps) {
  const providers = useSettingsStore(s => s.providers)
  const settings = useSettingsStore(s => s.settings)
  const workdir = useAgentStore(s => s.workdir)
  const pickDirectory = useAgentStore(s => s.pickDirectory)
  const clear = useAgentStore(s => s.clear)
  const setDraftTask = useAgentStore(s => s.setDraftTask)
  const [skillQuery, setSkillQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState('全部')
  const [showInstalledOnly, setShowInstalledOnly] = useState(false)
  const [featuredOffset, setFeaturedOffset] = useState(0)
  const [installedSkillIds, setInstalledSkillIds] = useState<Set<string>>(() => new Set(['code-review', 'ui-polish', 'e2e-composer', 'release-gate']))
  const currentProvider = providers.find(provider => provider.id === settings?.defaultProviderId)
  const configuredProviders = providers.filter(provider => provider.apiKey.trim()).length

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

  if (view === 'connectors') {
    return (
      <div className='hub-view'>
        <div className='hub-header'>
          <div className='hub-icon'><PlugZap size={20} /></div>
          <h1>连接器</h1>
          <p>管理 DeepDesk 可以调用的模型服务、工作区和本地能力。</p>
        </div>
        <div className='hub-grid'>
          <section className='hub-card'>
            <div className='hub-card-icon'><Sparkles size={18} /></div>
            <div className='hub-card-title'>模型服务</div>
            <div className='hub-card-desc'>当前默认：{currentProvider?.name ?? '未配置'}，已配置 {configuredProviders} 个服务。</div>
            <button className='btn btn-ghost btn-sm' onClick={() => onOpenSettings('providers')}>打开模型服务设置</button>
          </section>
          <section className='hub-card'>
            <div className='hub-card-icon'><FolderOpen size={18} /></div>
            <div className='hub-card-title'>工作区</div>
            <div className='hub-card-desc'>当前任务默认使用：{getWorkdirName(workdir)}。不选择时仍可使用默认工作区。</div>
            <button className='btn btn-ghost btn-sm' onClick={() => void pickDirectory()}>选择工作区</button>
          </section>
          <section className='hub-card'>
            <div className='hub-card-icon'><TerminalSquare size={18} /></div>
            <div className='hub-card-title'>本地工具</div>
            <div className='hub-card-desc'>Agent 已支持命令执行、文件读写、目录列表、内容搜索和飞书消息工具。</div>
            <button className='btn btn-ghost btn-sm' onClick={() => startWithDraft('请检查当前工作区的项目结构，并给出可以继续开发的建议。')}>用工具开始任务</button>
          </section>
        </div>
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
