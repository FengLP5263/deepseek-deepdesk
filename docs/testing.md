# DeepDesk 测试策略

DeepDesk 当前具备完整的基础质量门禁，并已接入真实 Electron UI 端到端测试。测试通过临时用户目录和本地 mock 服务覆盖聊天、Agent、设置、上下文、记忆与浏览器交互，不依赖外部模型或平台服务。

## 当前测试层级

| 层级 | 命令 | 当前状态 |
| --- | --- | --- |
| 类型检查 | `pnpm typecheck` | 已有 |
| E2E 类型检查 | `pnpm typecheck:e2e` | 已有 |
| 静态检查 | `pnpm lint` | 已有 |
| 架构检查 | `pnpm architecture` | 已有，文件预算与跨层边界 |
| 单元/集成测试 | `pnpm test` | 已有，Vitest |
| 构建验证 | `pnpm build` | 已有 |
| Electron smoke | `pnpm smoke` | 已有，验证 renderer 加载 |
| UI E2E isolated | `pnpm flow -- e2e` | 已接入，Playwright Electron，每条用例独立窗口 |
| UI E2E session | `pnpm flow -- e2e --mode session` | 已接入，单窗口连续验收 |

推荐统一执行：

```sh
pnpm flow -- check --include-build --include-smoke
```

GitHub CI 会在推送到 `develop`、`main` 以及所有 PR 时执行门禁。普通开发 PR 以 `develop` 为目标；`develop` → `main` 的发布 PR还必须满足 `docs/release.md` 的完整发布检查。

## 已覆盖重点

- OpenAI 兼容、OpenAI Responses 与 Anthropic Messages SSE 流式解析、鉴权头、无状态加密推理回放、prompt caching、缓存用量和工具协议转换
- LLM 错误、usage、reasoning 内容处理
- Agent 工具调用与权限审批
- 工作目录 `AGENTS.md` / `AGENTS.override.md` 的优先级、有界读取与系统上下文装配
- Windows PowerShell 与 macOS zsh 平台适配、提示词和参数引用
- 文件工具工作目录边界
- Zustand store 行为
- AppStore 持久化链路、临时文件恢复和 Windows 瞬时文件锁重试
- 长期记忆显式捕获、偏好提取、敏感信息过滤和去重
- 跨供应商模型搜索、键盘选择与会话级 provider/model 持久化，以及 Max 模式的输出预算透传、上下文面板回复预留、最终 AI 回复占用刷新和重启持久化
- 上下文预算计入工具定义与消息封装开销，主进程计算结果可在上下文面板中按类别展示
- 架构预算、Renderer 禁止直连网络和跨层导入失败用例
- Electron renderer 加载 smoke
- 工具结果卡片展开、复制反馈，以及复制操作不改变折叠状态
- Playwright Electron 覆盖启动、设置页、平台快捷键、Windows 自定义窗口按钮、macOS 原生交通灯布局、系统全局唤起快捷键、托盘新建任务事件、侧边栏、模型入口、权限模式、模拟工作目录选择、输入框发送状态、全局 Enter 发送偏好、未发送草稿重启恢复与发送后清理、失败任务原地重试、多行输入、上下文面板、Provider 增删改、API Key 显隐、常规设置重启读回、Ctrl + 滚轮整体界面缩放与持久化、高倍率下的图标和弹窗布局、窗口最大化、会话置顶与重启持久化、会话导出，以及长会话中的回到底部控件定位与滚动行为
- 可见 UI 改动在自动化测试后还需进行真实客户端视觉验收：Windows 优先使用 Computer Use 检查受影响页面、窗口边缘、弹窗以及最小/默认/最大状态；Computer Use 不可用时，改用已构建 Electron 客户端的多状态截图，并在交付说明中明确记录替代方式。
- E2E 同时支持 CI 友好的 isolated 模式和人工观察友好的 session 模式

## 不应在测试中做的事

- 不联网调用真实模型。
- 不发送真实飞书消息。
- 不执行危险命令。
- 不读写用户真实配置目录，测试应使用临时目录。
- 不在 E2E 中打开原生文件选择框；通过 `DEEPDESK_E2E_PICK_DIRECTORY` 返回临时工作目录。
- 平台命令测试只执行 `Write-Output` 或 `printf` 等安全输出命令。

## 端到端测试建设路线

第一阶段：最小 E2E（已完成）

- 引入 Playwright Electron。
- 使用已接入的 `pnpm e2e` / `pnpm flow -- e2e` 入口。
- 启动构建后的 Electron 应用。
- 验证首页、设置页、侧边栏可见。

第二阶段：核心 UI E2E（已完成基础覆盖）

- 验证输入框发送按钮状态。
- 验证多行输入。
- 验证上下文面板。
- 验证全局快捷键、侧边栏按钮和模型入口。
- 验证模型服务新增、编辑、添加模型、删除。
- 验证 API Key 显示/隐藏按钮。
- 验证常规设置重启持久化。
- 验证 isolated 和 session 两种运行模式。

第三阶段：核心业务 E2E

- 使用 mock LLM 服务。
- 设置 Provider。
- 发起一次聊天。
- 验证流式内容渲染和会话保存。

第四阶段：Agent E2E

- 设置临时工作目录。
- 发起安全的只读任务。
- 验证工具审批弹窗。
- 验证结果写入会话历史。

第五阶段：安装包 smoke

- 打包后启动 unpacked 应用。
- 可选：在 CI 虚拟机中安装 NSIS 包并启动应用。

## 测试补充规则

- 改 IPC：补 renderer/preload/main 合约测试或 store 集成测试。
- 改持久化：补重启读回测试。
- 改权限：补允许、拒绝、越界、危险命令测试。
- 改 LLM 协议：补 mock HTTP 流式测试。
- 改 UI 关键交互：至少补 store 测试；E2E 建好后补 UI 测试。
- 新增领域 E2E 时优先创建独立 `*.spec.ts`，不要继续扩张历史综合验收文件。
