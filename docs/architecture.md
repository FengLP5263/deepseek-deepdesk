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
2. 渲染进程通过 `window.api.chat.start` 发起 IPC，主进程 `startChat` 创建 `AbortController`
3. 主进程调用 `streamOpenAICompatible`（fetch + ReadableStream + SSE 解析），逐块产出 `content` / `reasoning_content`
4. 每个数据块经 `webContents.send(chat:chunk)` 推回渲染进程
5. 渲染进程按 runId 匹配，写入 50ms 节流的 pending buffer，`useThrottledText` 控制 Markdown 重渲染频率，保证长文本流畅
6. 结束（done / error / abort）时 flush 剩余内容、持久化会话、清理流状态

## 3. 进程职责

### Main

- `store.ts`：AppStore 持有 `{ settings, providers, conversations }`，写盘走「tmp + rename」原子替换，写队列串行化避免并发覆盖
- `llm.ts`：流式会话注册表 `Map<runId, AbortController>`，支持取消 / 全局清理
- `ipc.ts`：全部 IPC handler；`providers:test` 通过 `GET /models` 校验凭据并导入模型
- `platform/`：Windows/macOS 平台适配层；统一窗口参数、原生菜单、应用生命周期、命令 Shell 与参数引用

### Preload

仅暴露类型化的 `window.api`，不泄漏 Node 能力；事件监听返回解绑函数，防止内存泄漏。`window.api.platform` 只读暴露当前平台、Shell 名称和是否使用原生窗口按钮。

### Renderer

- `stores/useChatStore.ts`：会话列表 + 流式状态机（pending buffer / flush timer / finish 归并）
- `stores/useSettingsStore.ts`：服务与设置，变更后回读保持一致
- `components/chat/Markdown.tsx`：覆盖 `pre` 渲染器实现代码块外壳 + 复制；链接经 `shell.openExternal` 打开

## 4. 存储

| 键 | 说明 |
| --- | --- |
| `settings` | 默认服务 / 模型 / 温度 / 主题 / Enter 发送 |
| `providers` | 模型服务（含 baseUrl、apiKey、models） |
| `conversations` | 会话与消息历史 |

文件位于 Electron `userData` 目录，带 `version` 字段便于未来迁移。API Key 当前明文存储于本地；后续可切换到 `safeStorage` 加密（见路线图）。

## 5. 安全

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`（preload 需要）
- CSP 限制 script 来源
- 外部链接只允许 `http/https` 且交给系统浏览器
- `will-navigate` 拦截非白名单导航
- Windows Agent 命令通过 PowerShell 执行，macOS 通过登录 zsh 执行；两端共用工作目录边界、超时、输出截断和权限审批

## 6. 双平台边界

- Windows：无边框窗口、右侧自定义窗口按钮、PowerShell、NSIS x64。
- macOS：`hiddenInset` 标题栏、原生交通灯、Dock/原生菜单、zsh、DMG arm64。
- 聊天、LLM、IPC、存储、Agent 循环和 React 界面只有一份源码；平台差异不得复制完整应用目录。

## 7. 路线图

- [ ] Anthropic / 非 OpenAI 协议适配器
- [ ] safeStorage 加密 API Key
- [ ] 对话导出（Markdown / JSON）
- [ ] 多会话并行（分页 Tab）
- [ ] 系统托盘与全局快捷键唤起
- [ ] 函数调用 / MCP 工具支持
