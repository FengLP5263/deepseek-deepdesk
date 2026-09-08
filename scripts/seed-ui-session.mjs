#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'vite'

const help = `Seed a local DeepDesk UI review session.

Usage:
  node scripts/seed-ui-session.mjs [--user-data-dir <dir>]

Options:
  --user-data-dir <dir>   Write a UI session under this userData directory (close DeepDesk first).
                          Defaults to the existing DeepDesk app data directory,
                          or %APPDATA%/DeepDesk on Windows.
  --help                  Show this help.
`

const DEFAULT_SETTINGS = {
  version: 1,
  defaultProviderId: 'deepseek',
  defaultModelId: 'deepseek-v4-flash',
  temperature: 1,
  theme: 'light',
  enterToSend: true,
  agentWorkdir: '',
  agentPermissionMode: 'ask'
}

function parseArgs(argv) {
  const flags = new Map()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const name = arg.slice(2)
    if (name === 'help') {
      flags.set(name, true)
      continue
    }
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) throw new Error(`Missing value for --${name}`)
    flags.set(name, next)
    i++
  }
  return flags
}

function defaultUserDataDir() {
  const candidates = []
  if (process.env.DEEPDESK_USER_DATA_DIR) candidates.push(process.env.DEEPDESK_USER_DATA_DIR)
  if (process.platform === 'win32' && process.env.APPDATA) {
    candidates.push(join(process.env.APPDATA, 'DeepDesk'))
    candidates.push(join(process.env.APPDATA, 'deepseek-desktop'))
  }

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'deepdesk.json'))) return candidate
  }
  if (candidates.length > 0) return candidates[0]
  throw new Error('Cannot resolve app data directory. Pass --user-data-dir <dir>.')
}

function readState(file) {
  if (!existsSync(file)) {
    return {
      settings: { ...DEFAULT_SETTINGS },
      providers: [],
      conversations: [],
      agentSessions: []
    }
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  return {
    ...parsed,
    settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
    providers: Array.isArray(parsed.providers) ? parsed.providers : [],
    conversations: Array.isArray(parsed.conversations) ? parsed.conversations : [],
    agentSessions: Array.isArray(parsed.agentSessions) ? parsed.agentSessions : []
  }
}

function buildUiSession(workdir) {
  const now = Date.now()
  const steps = [
    {
      kind: 'task',
      text: '请帮我做一次 DeepDesk UI 会话视觉验收：覆盖短消息、长消息、列表、表格、代码块、工具调用和错误状态。'
    },
    {
      kind: 'text',
      text: `下面是一组用于检查会话 UI 的复杂输出样例。

## 一、整体观察

这段内容用于观察 AI 回复的行高、段落间距、粗体、列表和代码块的视觉层级。

> 这是一段引用文本。它应该看起来轻，不应该像错误提示，也不应该和正文挤在一起。

### 检查点

- 消息正文是否足够清晰
- 段落之间是否有自然呼吸感
- 按钮是否只在需要时出现
- 代码块的复制、下载按钮是否稳妥对齐
- 长内容滚动时底部输入框是否保持稳定

| 场景 | 期望效果 | 当前检查点 |
| --- | --- | --- |
| 短用户气泡 | 宽度随内容变化 | 不应撑满整行 |
| 长 AI 回复 | 阅读区稳定 | 不应出现横向滚动 |
| 代码块 | 灰色面板、按钮右上角 | 复制/下载可见 |
| 工具调用 | 状态清楚 | 完成/错误颜色克制 |

\`\`\`tsx
type ButtonState = 'idle' | 'hover' | 'active' | 'disabled'

export function PrimaryAction({ state }: { state: ButtonState }) {
  return (
    <button className={\`primary-action \${state}\`}>
      发送
    </button>
  )
}
\`\`\`

\`\`\`css
.primary-action {
  height: 32px;
  border-radius: 999px;
  padding: 0 14px;
  font-weight: 650;
}
\`\`\``
    },
    {
      kind: 'task',
      text: '这个是一条短消息'
    },
    {
      kind: 'text',
      text: '短消息用于检查 AI 回复区域的最小高度和操作按钮占位。'
    },
    {
      kind: 'task',
      text: '再给我一个较长的用户消息，用来检查右侧气泡是不是会根据内容自动换行，并且不会挤压主内容区域。这里特意写得长一些，包含中文、English words、数字 12345，以及一些路径 C:\\\\Users\\\\FengLP5263\\\\Desktop\\\\deepseek-desktop。'
    },
    {
      kind: 'text',
      text: `可以。长用户消息右对齐时主要检查三点：

1. 气泡最大宽度是否合理。
2. 文本换行后左右内边距是否一致。
3. 下方复制/编辑按钮是否跟随气泡右侧，而不是跑到正文区中间。

\`\`\`json
{
  "session": "UI会话",
  "purpose": "visual-regression",
  "checks": ["bubble-width", "markdown", "codeblock", "tool-card"]
}
\`\`\``
    },
    {
      kind: 'tool',
      name: 'run_command',
      args: JSON.stringify({ command: 'pnpm flow -- check', cwd: workdir }),
      status: 'ok',
      summary: '质量门禁通过',
      result: `typecheck passed
typecheck:e2e passed
lint passed
tests passed: 52

Flow completed successfully.`
    },
    {
      kind: 'text',
      feedback: 'positive',
      text: `工具调用完成后，下面这段用于检查成功状态后的回复样式。

- 工具卡片应可展开/收起。
- 工具结果里的等宽字体要清楚。
- 状态文案“完成”不要过亮。

\`\`\`bash
pnpm flow -- e2e --mode session
\`\`\``
    },
    {
      kind: 'tool',
      name: 'read_file',
      args: JSON.stringify({ path: 'src/renderer/src/assets/app.css' }),
      status: 'error',
      summary: '读取样式片段失败',
      result: 'ENOENT: no such file or directory, open src/renderer/src/assets/missing.css'
    },
    {
      kind: 'error',
      message: '这是一个错误状态示例：用于检查错误块颜色是否克制、边距是否正常、不会破坏阅读流。'
    },
    {
      kind: 'task',
      text: '继续扩展一下，帮我覆盖更复杂的 Markdown：二级标题、三级标题、表格、任务列表、长链接、行内代码、连续代码块都要有。'
    },
    {
      kind: 'text',
      text: `## 二、复杂 Markdown 压力样例

### 2.1 文本密度

这是一段较长的说明文字，用于观察中文段落在宽阅读区内的字距、行距和换行节奏。UI 不应该因为内容变长就显得拥挤，也不应该把正文拉得过宽。行内代码例如 \`pnpm flow -- check --include-build\` 应该和正文融合，不要像按钮一样突出。

这是一条很长的链接文本，用于观察自动换行：https://example.com/deepdesk/visual-review/very/long/path/with/query?tab=conversation&case=markdown&viewport=desktop

### 2.2 任务列表

- [x] 用户气泡右对齐
- [x] AI 回复无外框
- [ ] 代码块按钮位置
- [ ] 工具调用展开状态
- [ ] 长文本滚动体验

### 2.3 对齐表格

| 模块 | UI 风险 | 需要观察的细节 | 严重程度 |
| --- | --- | --- | --- |
| 侧边栏 | 宽度过大或列表拥挤 | 标题截断、时间对齐、hover 状态 | 中 |
| 输入框 | 工具栏按钮过多 | 模型选择、权限选择、发送按钮 | 高 |
| 回复正文 | 层级混乱 | 标题、列表、引用、代码块间距 | 高 |
| 工具卡片 | 状态难辨认 | 完成、错误、拒绝、运行中 | 中 |

\`\`\`markdown
# 今日总结

今天学习了 **HTTPS 证书验证**，主要内容包括：
- DV 证书 vs OV 证书
- 证书中的组织字段
\`\`\`

\`\`\`diff
diff --git a/src/renderer/src/assets/app.css b/src/renderer/src/assets/app.css
@@
-  --titlebar-h: 40px;
+  --titlebar-h: 34px;
@@
- .agent-composer { border-color: var(--accent); }
+ .agent-composer { border-color: var(--border-strong); }
\`\`\``
    },
    {
      kind: 'tool',
      name: 'list_files',
      args: JSON.stringify({ path: 'src/renderer/src/components' }),
      status: 'ok',
      summary: '列出组件目录',
      result: `src/renderer/src/components
├── DeepSeekLogo.tsx
├── agent
│   └── AgentView.tsx
├── chat
│   ├── Composer.tsx
│   └── Markdown.tsx
├── settings
│   └── SettingsView.tsx
└── sidebar
    └── Sidebar.tsx`
    },
    {
      kind: 'text',
      text: `这个工具结果用于检查树形输出、缩进和等宽字体。

下面继续给几个不同语言的代码块，主要看代码块之间的间距、顶部语言标签、复制和下载按钮是否稳定。

\`\`\`sql
SELECT
  username,
  client_addr,
  backend_start,
  state
FROM pg_stat_activity
WHERE client_addr IN ('33.2.3.182', '33.2.5.223')
ORDER BY backend_start;
\`\`\`

\`\`\`yaml
name: deepdesk-ui-review
checks:
  - shell
  - sidebar
  - composer
  - markdown
  - tool-card
threshold:
  visual_noise: low
  color_count: restrained
\`\`\`

\`\`\`python
from dataclasses import dataclass

@dataclass
class UiCase:
    name: str
    severity: str
    done: bool = False

cases = [
    UiCase('message-actions', 'high'),
    UiCase('code-block-download', 'medium'),
]
\`\`\``
    },
    {
      kind: 'task',
      text: '再加一些极端输入：超短、超长、包含英文、数字、路径、emoji 和一段很长但不能破坏布局的字符串。'
    },
    {
      kind: 'text',
      text: `下面是边界样例：

- 超短：OK
- 混排：DeepDesk UI review 2026-08-20 build #1042
- Windows 路径：\`C:\\Users\\FengLP5263\\Desktop\\deepseek-desktop\\src\\renderer\\src\\assets\\app.css\`
- 长 token：\`deepdesk_visual_regression_case_with_a_very_long_identifier_that_should_wrap_or_truncate_without_breaking_layout_1234567890\`
- emoji：✅ ⚠️ 🔁 🧪

> 注意：emoji 不是设计主视觉，只是用于观察字体回退和行高是否稳定。`
    },
    {
      kind: 'tool',
      name: 'send_feishu_message',
      args: JSON.stringify({ user: '王光意', content: 'UI mock 会话验收消息，不会真实发送。' }),
      status: 'denied',
      summary: '发送飞书消息被拒绝',
      result: '权限模式为“每次询问”，用户拒绝发送外部消息。'
    },
    {
      kind: 'thinking'
    },
    {
      kind: 'text',
      feedback: 'negative',
      text: `这条回复带有“不喜欢”反馈状态，用于检查反馈按钮的选中样式。

如果这个状态过于显眼，说明按钮视觉权重需要继续降低。`
    },
    {
      kind: 'task',
      text: '最后再输出一个 checklist，方便我逐项核对。'
    },
    {
      kind: 'text',
      text: `## UI 验收 Checklist

- [ ] 顶部栏高度是否协调
- [ ] 侧边栏和顶部栏是否像一个整体
- [ ] 空会话输入框是否在中部
- [ ] 有会话内容时输入框是否固定底部
- [ ] 用户气泡是否右对齐且宽度自适应
- [ ] AI 回复是否无多余边框
- [ ] 代码块复制/下载按钮是否可用
- [ ] 模型选择菜单是否简洁、不花
- [ ] 回到底部按钮是否不遮挡正文

这条会话是本地 mock 数据，不会调用模型，也不会发送飞书消息。`
    }
  ]

  return {
    id: 'ui-session',
    task: 'UI会话',
    workdir,
    modelId: 'deepseek-v4-flash',
    createdAt: now,
    updatedAt: now,
    steps,
    history: steps
      .filter(step => step.kind === 'task' || step.kind === 'text')
      .map(step => ({
        role: step.kind === 'task' ? 'user' : 'assistant',
        content: step.text ?? ''
      }))
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  if (flags.get('help')) {
    console.log(help)
    return 0
  }

  const userDataDir = resolve(String(flags.get('user-data-dir') ?? defaultUserDataDir()))
  mkdirSync(userDataDir, { recursive: true })

  const file = join(userDataDir, 'deepdesk.json')
  const state = readState(file)
  const session = buildUiSession(process.cwd())
  if (state.sessionStorageVersion === 1) {
    const bundle = await build({ configFile: false, logLevel: 'silent', build: {
      ssr: resolve('src/main/session-journal.ts'), write: false, minify: false,
      rollupOptions: { output: { format: 'es' } }
    } })
    const code = bundle.output.find(item => item.type === 'chunk').code
    const { SessionJournal } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
    const journal = new SessionJournal(userDataDir, { protect: value => value, reveal: value => value })
    await journal.load()
    journal.upsert('agent', session)
    await journal.flush()
    console.log(`Seeded UI session: ${session.task}\nUser data: ${userDataDir}`)
    return 0
  }
  const sessions = state.agentSessions.filter(item => item?.id !== session.id && item?.task !== session.task)
  state.agentSessions = [session, ...sessions]
  state.settings = { ...DEFAULT_SETTINGS, ...state.settings, agentWorkdir: state.settings.agentWorkdir || process.cwd() }

  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  renameSync(tmp, file)
  console.log(`Seeded UI session: ${session.task}`)
  console.log(`User data: ${userDataDir}`)
  console.log(`State file: ${file}`)
  return 0
}

try {
  process.exitCode = await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
