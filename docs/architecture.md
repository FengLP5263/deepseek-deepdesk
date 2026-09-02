# DeepDesk 架构说明

## 1. 总体分层

```
+----------------+        +----------------+        +----------------+
|  Renderer      |  IPC   |  Main Process  |  HTTP  |  LLM / MCP     |
|  React UI      | <----> | store/llm/mcp  | <----> |  Providers     |
|  zustand       |        |  ipc handlers  |  SSE   |  MCP Servers   |
+----------------+        +----------------+        +----------------+
        |                        |
        +-------- preload (contextBridge) ---------+
```

## 2. 数据流：一次流式对话

1. 用户在 Composer 输入消息，`useChatStore.sendMessage` 创建 user + assistant 占位消息
2. 渲染进程通过 `window.api.memories.capture` 请求主进程本地提取显式记忆和高置信长期偏好；主进程过滤敏感信息并按内容去重
3. 渲染进程通过 `window.api.memories.search` 检索本地长期记忆，并把命中的记忆格式化为临时 system 上下文
4. 渲染进程通过 `window.api.chat.start` 发起 IPC，主进程 `startChat` 创建 `AbortController`
5. 主进程按服务协议调用 OpenAI 兼容、OpenAI Responses 或 Anthropic Messages 流式适配器（fetch + ReadableStream + SSE 解析），统一产出正文、思考、工具调用与用量；收到响应前的临时网络错误、限流和服务端短暂故障会有限重试，余额不足与鉴权错误不会重试
6. 主进程按 24ms 短时间窗合并连续同类文本，再经 `webContents.send(chat:chunk)` 推回渲染进程；工具、结束、错误和停止事件前强制刷新，保证事件顺序
7. 渲染进程按 runId 匹配，写入 50ms 节流的 pending buffer，`useThrottledText` 控制 Markdown 重渲染频率，避免 IPC 和 React 更新被细碎 token 放大
8. 结束（done / error / abort）时 flush 剩余内容、持久化会话、清理流状态

Agent 工具调用流同样保留模型的 `reasoning_content`，渲染层将连续推理分片合并为可折叠步骤并随会话持久化。每次任务开始时，主进程先从工作目录根部读取 `AGENTS.override.md` 或 `AGENTS.md`（覆盖文件优先、拒绝符号链接、最多读取 24 KiB），再由独立装配层按“稳定系统与项目指令 → 当轮检索记忆 → 已修复历史 → 当前输入”重建上下文；检索记忆不会写回持久历史，旧版重复记忆和系统指令会被替换。工具结果在界面中保留完整内容，送入模型上下文时则按模型窗口动态限制单次占用，并保留开头、错误等关键状态行和结尾。预算计算同时计入消息封装开销、工具调用名称与参数、当轮实际发送的工具 schema，并预留输出空间；主进程把这一真实组成同步给上下文面板。Max 模式把 Agent 单次输出预算由 8192 提升到最高 32768 tokens，同时按上下文窗口的 25% 封顶，并让上下文装配预留相同空间。接近窗口上限时，压缩器优先保留目标、约束、关键决定、错误、路径、工具调用与结果，并单独限制摘要 token 预算；压缩完成后只向渲染层发送前后 token 估算提示，该提示不进入模型历史。Agent 在每次请求模型前还会校验工具调用链：孤立的工具结果会被移除，异常或停止导致缺少结果的 `tool_calls` 会补为明确的未完成结果。异常历史也会按修复后的结构持久化，避免切换模型服务后因协议校验差异导致请求失败。

## 3. 进程职责

### Main

- `store.ts`：AppStore 持有 `{ settings, providers, mcpServers, connectors, conversations, agentSessions, memories }`，写盘走「tmp + rename」原子替换，写队列串行化避免并发覆盖
- `llm.ts`：流式会话注册表 `Map<runId, AbortController>`，支持取消 / 全局清理；根据 `finish_reason` 区分正常结束、长度截断、网络异常和内容审核终止，并在缺少终止标记时识别异常断流
- `desktop-presence.ts`：管理系统托盘、全局唤起快捷键和退出清理；托盘发出的新建任务事件通过受控 IPC 交给 Renderer
- `shared/llm/openai.ts` / `openai-responses.ts` / `anthropic.ts`：将三类模型协议统一为 DeepDesk 流事件；Responses 适配器使用无状态请求，在本地回放服务返回的加密推理项并统一转换工具历史；Anthropic 适配器负责顶层系统指令、工具定义、工具历史、流式事件与终止原因转换，使用官方鉴权头和自动 prompt caching，并将未缓存、缓存创建与缓存命中 token 合并为真实输入用量
- `shared/llm/stream.ts`：普通聊天与 Agent 共用的流恢复策略；模型请求默认预留 8192 个输出 token，并对以枚举顿号、逗号、斜杠、破折号或未闭合代码块结束的明显残句做保守续写；保留已接收内容，最多自动续写 3 次，并合并多次请求的 token usage
- `agent.ts`：Agent 工具循环；执行模式按权限策略运行完整工具集，规划模式只向模型暴露只读工具并在执行入口二次校验；同一轮全部为无需审批的只读工具时并行执行并按原始调用顺序回填结果，包含写入、交互或审批时保持串行；单个工具异常归一化为失败结果返回模型，取消和终态事件负责清理运行中工具状态
- `project-instructions.ts`：有界读取工作目录中的 `AGENTS.override.md` / `AGENTS.md`，拒绝符号链接和目录项，把项目协作约定交给 Agent 上下文装配
- `mcp.ts`：MCP Host 运行时；管理 stdio 子进程和 Streamable HTTP 会话、工具发现、Agent 工具名映射、结果收敛与退出清理
- `ipc.ts`：全部 IPC handler；`providers:test` 按服务协议使用 Bearer 或 Anthropic 鉴权头，通过 `GET /models` 校验凭据并导入模型名称与上下文窗口
- `platform/`：Windows/macOS 平台适配层；统一窗口参数、原生菜单、应用生命周期、命令 Shell 与参数引用
- `browser-runtime.ts`：浏览器连接器运行时；读取持久化启用状态、检查当前浏览器扩展连接，并在离线时阻止工具调用
- `browser-extension-bridge.ts`：当前浏览器扩展桥接；在本机回环地址提供带随机路径令牌的 CDP 兼容接口
- `browser-cdp.ts` / `browser-element-locator.ts` / `browser-cursor.ts`：在滚动稳定后优先按可见文字或图标定位无遮挡操作点，通过 CDP 原生输入事件执行交互，并让可视指针热点与事件坐标一致；文本输入和可见按钮提交保持为两个独立工具动作
- `platform/browser.ts`：系统默认浏览器识别、进程检测、按需启动与扩展管理页入口；支持 Edge、Chrome、Brave 和 Chromium

### Preload

仅暴露类型化的 `window.api`，不泄漏 Node 能力；事件监听返回解绑函数，防止内存泄漏。`window.api.platform` 只读暴露当前平台、Shell 名称和是否使用原生窗口按钮。

### Renderer

- `App.tsx`：首屏只同步加载聊天工作区；设置页与技能/连接器功能页使用独立动态 chunk，在首次访问时按需加载，减少启动阶段的脚本解析量
- `components/agent/AgentModelPicker.tsx`：统一展示所有已配置服务的模型，并在渲染前按服务名、地址、模型名和模型 ID 本地过滤；搜索不发起网络请求
- `components/agent/AgentView.tsx`：只负责 Agent 工作区、滚动区、审批与输入区组合；消息渲染、编辑、反馈和工具卡片由 `AgentStepItem.tsx` 独立管理
- `hooks/useSessionDraft.ts`：在 Chromium 本地存储中维护会话级未发送草稿，限制条目数与单条长度，并以短延迟合并连续键入产生的写入
- `stores/useChatStore.ts`：会话列表 + 流式状态机（pending buffer / flush timer / finish 归并）
- `stores/useAgentStore.ts`：Agent 多会话运行态；正文与思考分片进入同一有序缓冲区，按帧批量提交，避免高频流式输出放大 React / Zustand 更新成本
- `stores/useSettingsStore.ts`：服务与设置，变更后回读保持一致
- `stores/useMemoryStore.ts`：长期记忆的本地管理；聊天和 Agent 发送前先经 Main 捕获高置信记忆，再只注入命中的临时上下文，不写入原始会话消息
- `stores/useMcpStore.ts`：MCP 服务器配置和运行状态；所有连接动作通过 preload IPC 交给主进程执行
- `components/sidebar/Sidebar.tsx`：后台 Agent 会话运行时显示低速旋转状态，完成后显示持久化的绿色未读标记；进入会话后清除未读状态，当前可见会话不显示冗余状态。会话先按持久化的置顶时间、再按最近更新时间确定性排序，排序纯函数位于 `lib/session-order.ts`
- `components/sidebar/SessionSearch.tsx`：通过 `Ctrl/Cmd+K` 或侧边栏入口搜索任务标题与消息内容，支持最近任务、键盘选择和连接器会话跳转；空查询复用侧边栏置顶与最近排序，关键词查询按匹配相关性排序，逻辑位于纯函数 `lib/session-search.ts`
- `components/agent/WindowedAgentSteps.tsx`：长会话默认只挂载最近 60 条步骤，更早内容按 60 条批量加载并保持当前阅读位置；该裁剪仅作用于 DOM 渲染，不修改 store、磁盘历史或模型上下文
- `components/chat/ThinkingBlock.tsx`：普通聊天与 Agent 共用的推理过程组件；生成中使用文字扫光反馈，完成后默认收起并允许展开查看真实推理文本
- `components/chat/Markdown.tsx`：覆盖 `pre` 渲染器实现代码块外壳 + 复制；链接经 `shell.openExternal` 打开；Markdown、GFM 与代码高亮依赖由 Agent 正文通过动态 chunk 首次按需加载，空白首屏不解析这组模块

## 4. 存储

| 键 | 说明 |
| --- | --- |
| `settings` | 默认服务 / 模型 / 温度 / 主题 / Agent 工作模式、权限模式与 Max 模式 / Enter 发送 |
| `providers` | 模型服务（含协议类型、baseUrl、apiKey、models） |
| `mcpServers` | MCP 服务器配置、传输方式、自动恢复意图和本地凭据 |
| `connectors` | 飞书、微信和浏览器连接器配置与启用状态 |
| `connectorActivities` | 连接器消息和浏览器调试页面活动 |
| `conversations` | 会话与消息历史 |
| `agentSessions` | Agent 任务步骤与工具调用历史 |
| `memories` | 本地长期记忆（范围、类型、标签、启用状态、来源） |

文件位于 Electron `userData` 目录，带 `version` 字段便于未来迁移。主进程将短时间内的连续更新合并为一次序列化和原子写入；原子替换遇到 Windows `EPERM` / `EACCES` / `EBUSY` 瞬时锁时按短退避有界重试，其他错误立即保留为失败。退出前强制 flush，启动时若主文件缺失或损坏则尝试从已完整写出的 `.tmp` 文件恢复。长期记忆默认本地捕获、保存和检索，不联网、不上传第三方；启动时会回扫已有本地会话补录高置信记忆，敏感凭据不自动记录。真正发给模型的只有本次请求命中的格式化上下文。未选择 Agent 工作目录时使用系统用户主目录。API Key、MCP Token、环境变量、请求头、连接器令牌和回复令牌写盘前统一经 Electron `safeStorage` 加密，运行时内存快照保持明文供主进程使用；系统安全存储不可用时保持兼容并输出警告。详细行为见 [memory.md](./memory.md)。

## 5. 浏览器连接器生命周期

1. DeepDesk 启动后，`browser-extension-bridge.ts` 在 `127.0.0.1` 的受限端口范围启动本地桥接服务；CDP 兼容接口使用每次启动随机生成的不可猜测路径令牌。
2. 用户点击“连接”后，客户端立即持久化启用意图，并优先检测已打开的默认浏览器；没有浏览器进程时才启动默认浏览器。若扩展尚未安装，客户端显示应用内引导。用户按浏览器要求完成一次安装确认后，扩展通过固定扩展身份连接本地桥接服务，连接器轮询自动完成激活，不需要第二次点击“连接”。
3. 扩展使用浏览器 `debugger` 权限按需附加当前 Edge / Chrome 标签页，因此网页任务直接使用该配置中的 Cookie、站点存储和登录状态；扩展不读取或复制已保存密码。
4. 如果扩展未安装或离线，`browser-runtime.ts` 会拒绝浏览器工具调用并提示用户完成连接；运行时不会启动备用浏览器或创建独立浏览器配置。
5. 用户停用连接器时，主进程通知扩展解除当前调试目标；再次启用前不会建立新的页面调试会话。
6. 浏览器工具连接页面时会在网页顶层注入不拦截交互、带 `AI` 标识的常驻指针；新版注入会清理旧版页面指针，页面导航完成后也会自动重新注入。页面读取与调试会把指针移动到交替的阅读位置；悬停、点击和输入在目标控件内优先选择真实可见的文字或图标矩形，只有没有可见内容时才回退到控件几何点；滚动会移动到页面滚动区域。到达位置后均有摆动或活动反馈。点击、输入、悬停和滚动通过 CDP `Input` 域派发浏览器原生事件，不使用 DOM 脚本交互；`browser_evaluate` 仅用于只读调试，并拦截常见 DOM 修改、滚动和导航表达式。网站仍可能基于账号、网络或风控策略要求用户手动完成验证码。
7. DeepDesk 退出时，扩展解除调试附加，主进程同时关闭本地桥接服务。

## 6. MCP 生命周期

1. 用户可在“设置 → MCP”保存服务器配置，也可在会话中要求安装一个直接可连接的 HTTP MCP 地址；渲染层不启动进程、不直连远程 MCP。
2. 会话安装先由主进程短暂检查服务器身份与工具清单，再生成与当前运行绑定的 10 分钟短时凭证；所有权限模式下都必须经用户确认，确认后才持久化并正式连接。
3. 本地服务器由主进程通过 stdio 启动；远程服务器通过 MCP Streamable HTTP 连接，可附带 Bearer Token 或自定义请求头。
4. 连接完成后主进程调用 `tools/list`，为每个外部工具生成长度受控且防冲突的 `mcp__*` Agent 工具名；断开连接后立即移除对应动态工具。
5. 小型工具目录完整注入模型；工具数量或 schema 体积超过阈值时，仅注入与当前任务相关或已由 `search_mcp_tools` 命中的定义，避免每轮重复发送整份目录。
6. Agent 调用时，主进程把模型参数原样路由到原始 MCP 工具；文本和结构化结果返回模型，图片、音频和二进制资源仅返回元数据摘要，避免把大段 Base64 写入上下文。
7. “每次询问”会审批所有 MCP 工具；“替我审批”只自动放行明确声明 `readOnlyHint: true` 且非破坏性的工具；“完全访问”直接执行。
7. 启用的服务器会在下次启动时自动恢复连接；退出应用时关闭 stdio 子进程并终止可终止的 HTTP 会话。

详细配置和安全说明见 [mcp.md](./mcp.md)。

## 7. 安全

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`（preload 需要）
- CSP 限制 script 来源
- 外部链接只允许 `http/https` 且交给系统浏览器
- `will-navigate` 拦截非白名单导航
- Windows Agent 命令通过 PowerShell 执行，macOS 通过登录 zsh 执行；两端共用工作目录边界、超时、输出截断和权限审批
- 浏览器高风险工具（点击、输入和脚本执行）继续遵循 Agent 权限模式；扩展桥接只接受固定扩展身份，并使用随机路径令牌隔离本机其他进程；扩展离线时禁止工具调用，不启动备用浏览器进程
- MCP 服务器及其输出按外部不可信来源处理；未声明为只读的工具不会在“替我审批”模式下自动执行，MCP 返回内容也不得覆盖系统规则
- `pnpm architecture` 强制 Renderer 网络边界、跨层依赖和文件规模预算；详细规则见 [architecture-quality.md](./architecture-quality.md)

## 8. 双平台边界

- Windows：无边框窗口、右侧自定义窗口按钮、PowerShell、NSIS x64。
- macOS：`hiddenInset` 标题栏、原生交通灯、Dock/原生菜单、zsh、DMG arm64。
- 聊天、LLM、IPC、存储、Agent 循环和 React 界面只有一份源码；平台差异不得复制完整应用目录。

## 9. 路线图

- [x] Anthropic Messages 协议适配器
- [x] OpenAI Responses 无状态协议适配器
- [x] safeStorage 加密 API Key
- [x] 对话导出（Markdown / JSON）
- [x] 本地记忆近义合并与冲突更新标记
- [ ] 多会话并行（分页 Tab）
- [x] 系统托盘与全局快捷键唤起
