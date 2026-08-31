# DeepDesk 架构说明

## 1. 总体分层

```
+----------------+        +----------------+        +----------------+
|  Renderer      |  IPC   |  Main Process  |  HTTP  |  LLM Provider  |
|  React UI      | <----> |  store / llm   | <----> |  OpenAI 兼容    |
|  zustand       |        |  ipc handlers  |  SSE   |  DeepSeek 等    |
+----------------+        +----------------+        +----------------+
        |                        |
        +-------- preload (contextBridge) ---------+
```

## 2. 数据流：一次流式对话

1. 用户在 Composer 输入消息，`useChatStore.sendMessage` 创建 user + assistant 占位消息
2. 渲染进程通过 `window.api.memories.search` 检索本地长期记忆，并把命中的记忆格式化为临时 system 上下文
3. 渲染进程通过 `window.api.chat.start` 发起 IPC，主进程 `startChat` 创建 `AbortController`
4. 主进程调用 `streamOpenAICompatible`（fetch + ReadableStream + SSE 解析），逐块产出 `content` / `reasoning_content`
5. 每个数据块经 `webContents.send(chat:chunk)` 推回渲染进程
6. 渲染进程按 runId 匹配，写入 50ms 节流的 pending buffer，`useThrottledText` 控制 Markdown 重渲染频率，保证长文本流畅
7. 结束（done / error / abort）时 flush 剩余内容、持久化会话、清理流状态

## 3. 进程职责

### Main

- `store.ts`：AppStore 持有 `{ settings, providers, conversations, agentSessions, memories }`，写盘走「tmp + rename」原子替换，写队列串行化避免并发覆盖
- `llm.ts`：流式会话注册表 `Map<runId, AbortController>`，支持取消 / 全局清理；根据 `finish_reason` 区分正常结束、长度截断、网络异常和内容审核终止，并在缺少终止标记时识别异常断流
- `shared/llm/stream.ts`：普通聊天与 Agent 共用的流恢复策略；兼容模型请求默认预留 8192 个输出 token，并对以枚举顿号、逗号、斜杠、破折号或未闭合代码块结束的明显残句做保守续写；保留已接收内容，最多自动续写 3 次，并合并多次请求的 token usage
- `agent.ts`：Agent 工具循环；单个工具异常归一化为失败结果返回模型，取消和终态事件负责清理运行中工具状态
- `ipc.ts`：全部 IPC handler；`providers:test` 通过 `GET /models` 校验凭据并导入模型
- `platform/`：Windows/macOS 平台适配层；统一窗口参数、原生菜单、应用生命周期、命令 Shell 与参数引用
- `browser-runtime.ts`：浏览器连接器运行时；读取持久化启用状态、检查当前浏览器扩展连接，并在离线时阻止工具调用
- `browser-extension-bridge.ts`：当前浏览器扩展桥接；在本机回环地址提供带随机路径令牌的 CDP 兼容接口
- `platform/browser.ts`：系统默认浏览器识别、进程检测、按需启动与扩展管理页入口；支持 Edge、Chrome、Brave 和 Chromium

### Preload

仅暴露类型化的 `window.api`，不泄漏 Node 能力；事件监听返回解绑函数，防止内存泄漏。`window.api.platform` 只读暴露当前平台、Shell 名称和是否使用原生窗口按钮。

### Renderer

- `stores/useChatStore.ts`：会话列表 + 流式状态机（pending buffer / flush timer / finish 归并）
- `stores/useSettingsStore.ts`：服务与设置，变更后回读保持一致
- `stores/useMemoryStore.ts`：长期记忆的本地管理；聊天和 Agent 请求前只注入命中的临时上下文，不写入原始会话消息
- `components/chat/Markdown.tsx`：覆盖 `pre` 渲染器实现代码块外壳 + 复制；链接经 `shell.openExternal` 打开

## 4. 存储

| 键 | 说明 |
| --- | --- |
| `settings` | 默认服务 / 模型 / 温度 / 主题 / Enter 发送 |
| `providers` | 模型服务（含 baseUrl、apiKey、models） |
| `connectors` | 飞书、微信和浏览器连接器配置与启用状态 |
| `connectorActivities` | 连接器消息和浏览器调试页面活动 |
| `conversations` | 会话与消息历史 |
| `agentSessions` | Agent 任务步骤与工具调用历史 |
| `memories` | 本地长期记忆（范围、类型、标签、启用状态、来源） |

文件位于 Electron `userData` 目录，带 `version` 字段便于未来迁移。长期记忆默认本地保存和本地检索，不联网、不上传第三方；真正发给模型的只有本次请求命中的格式化上下文。API Key 当前明文存储于本地；后续可切换到 `safeStorage` 加密（见路线图）。

## 5. 浏览器连接器生命周期

1. DeepDesk 启动后，`browser-extension-bridge.ts` 在 `127.0.0.1` 的受限端口范围启动本地桥接服务；CDP 兼容接口使用每次启动随机生成的不可猜测路径令牌。
2. 用户点击“连接”后，客户端立即持久化启用意图，并优先检测已打开的默认浏览器；没有浏览器进程时才启动默认浏览器。若扩展尚未安装，客户端显示应用内引导。用户按浏览器要求完成一次安装确认后，扩展通过固定扩展身份连接本地桥接服务，连接器轮询自动完成激活，不需要第二次点击“连接”。
3. 扩展使用浏览器 `debugger` 权限按需附加当前 Edge / Chrome 标签页，因此网页任务直接使用该配置中的 Cookie、站点存储和登录状态；扩展不读取或复制已保存密码。
4. 如果扩展未安装或离线，`browser-runtime.ts` 会拒绝浏览器工具调用并提示用户完成连接；运行时不会启动备用浏览器或创建独立浏览器配置。
5. 用户停用连接器时，主进程通知扩展解除当前调试目标；再次启用前不会建立新的页面调试会话。
6. 页面点击和输入通过 CDP `Input` 域派发浏览器原生鼠标、键盘事件，不使用 DOM `click()` 或直接修改输入框值。网站仍可能基于账号、网络或风控策略要求用户手动完成验证码。
7. DeepDesk 退出时，扩展解除调试附加，主进程同时关闭本地桥接服务。

## 6. 安全

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`（preload 需要）
- CSP 限制 script 来源
- 外部链接只允许 `http/https` 且交给系统浏览器
- `will-navigate` 拦截非白名单导航
- Windows Agent 命令通过 PowerShell 执行，macOS 通过登录 zsh 执行；两端共用工作目录边界、超时、输出截断和权限审批
- 浏览器高风险工具（点击、输入和脚本执行）继续遵循 Agent 权限模式；扩展桥接只接受固定扩展身份，并使用随机路径令牌隔离本机其他进程；扩展离线时禁止工具调用，不启动备用浏览器进程

## 7. 双平台边界

- Windows：无边框窗口、右侧自定义窗口按钮、PowerShell、NSIS x64。
- macOS：`hiddenInset` 标题栏、原生交通灯、Dock/原生菜单、zsh、DMG arm64。
- 聊天、LLM、IPC、存储、Agent 循环和 React 界面只有一份源码；平台差异不得复制完整应用目录。

## 8. 路线图

- [ ] Anthropic / 非 OpenAI 协议适配器
- [ ] safeStorage 加密 API Key
- [ ] 对话导出（Markdown / JSON）
- [ ] 记忆自动抽取、合并与冲突检测
- [ ] 多会话并行（分页 Tab）
- [ ] 系统托盘与全局快捷键唤起
- [ ] 函数调用 / MCP 工具支持
