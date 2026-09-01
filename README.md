# DeepDesk

DeepDesk 是一个基于 Electron、React 和 TypeScript 构建的开源桌面 AI 客户端。项目提供 OpenAI 兼容模型服务接入、本地多轮会话、编码 Agent、MCP、连接器、浏览器调试和本地记忆等能力，面向需要在桌面环境中完成对话、代码处理与工具调用的用户。

[![CI](https://github.com/FengLP5263/deepseek-deepdesk/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/FengLP5263/deepseek-deepdesk/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-2f363d.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.18-339933.svg)](https://nodejs.org/)
[![Platforms](https://img.shields.io/badge/platform-Windows%20x64%20%7C%20macOS%20arm64-555.svg)](#支持范围)

> DeepDesk 当前处于 `0.x` 预稳定阶段。功能、数据结构和配置接口在达到 `1.0.0` 前仍可能调整。

## 核心能力

### 模型与会话

- 接入 DeepSeek、智谱等 OpenAI 兼容模型服务，也可配置自定义 Base URL、API Key 和模型列表。
- 对话框模型菜单会汇总所有已配置服务的模型，可在同一会话入口直接跨供应商切换；会话同时持久化供应商和模型选择。
- 支持 SSE 流式响应、Markdown、表格、代码高亮、复制和安全外链。
- 模型请求默认预留 8192 个输出 token；识别输出长度上限、异常断流以及“正常结束但留下明显残句”的错误终态，可恢复时自动续写并合并为一条回复。
- 会话历史、本地设置和任务状态持久化到 Electron `userData` 目录。
- 提供上下文用量与组成可视化，并在接近模型窗口限制时压缩较早上下文。
- 生成期间的新消息以紧贴输入框的轻量卡片进入会话级待发送队列，可编辑、移除或立即发送。

### 编码 Agent

- 在用户选择的工作目录内读取、写入、编辑、列出和搜索文件；未选择时默认使用系统用户主目录。
- 在 Windows 使用 PowerShell、在 macOS 使用 zsh 执行命令。
- 通过“每次询问”“替我审批”“完全访问”三档权限模式控制工具执行。
- 支持取消模型流和运行中的工具调用；单个工具失败会作为结果返回模型以便恢复，终止后不会残留虚假的运行状态。

### 连接器与浏览器调试

- 飞书和微信消息可映射为独立连接器会话，并与桌面端会话同步。
- 浏览器连接器通过随客户端提供的 Edge / Chrome 扩展连接默认浏览器，沿用已有 Cookie 和登录状态，并提供页面读取、导航、原生鼠标键盘交互、控制台和网络诊断能力。点击“连接”时会优先使用已打开的浏览器；没有浏览器进程时才启动系统默认浏览器。
- 连接器的实际可用性取决于对应接入服务、账号权限和本地配置；仓库不包含第三方服务凭据。

### MCP 工具扩展

- DeepDesk 可作为 MCP Host，连接本地 stdio 服务器和远程 Streamable HTTP 服务器。
- 用户也可以在会话中提供可直接连接的 HTTP MCP 服务端点；DeepDesk 会先检查服务身份和工具清单，只有用户确认后才保存并连接。
- 连接成功后，服务器工具会动态加入编码 Agent；服务器断开后相应工具立即移除。
- 远程服务支持 Bearer Token 和自定义请求头。当前版本尚未实现交互式 OAuth 授权流程。
- MCP 工具遵循 Agent 审批模式：“替我审批”仅自动执行服务器明确标注为只读且非破坏性的工具，未标注或可写工具仍需确认。

### 本地记忆与技能

- 用户、项目和 Agent 记忆存储在本地；显式“记住”请求、高置信长期偏好和项目约定会自动捕获、去重，并按当前请求检索后注入模型上下文。敏感凭据不会被自动记录。
- 技能广场用于管理内置技能和可复用任务模板。
- API Key、会话、记忆和连接器配置不会写入仓库。

## 支持范围

| 平台 | 架构 | 开发运行 | 安装包 |
| --- | --- | --- | --- |
| Windows | x64 | 支持 | NSIS `.exe` |
| macOS | Apple Silicon arm64 | 支持 | `.dmg` |
| Linux | — | 当前不支持 | 当前不提供 |

macOS 安装包必须在 Apple Silicon macOS 环境构建；Windows 无法生成可验证的 macOS 安装包。

## 快速开始

### 环境要求

- Node.js `>= 18.18.0`
- pnpm `10.14.0`
- Windows x64 或 Apple Silicon macOS

### 本地运行

```sh
pnpm install
pnpm flow -- doctor
pnpm dev
```

首次启动后，在“设置 → 模型服务”中配置模型服务地址、API Key 和模型。配置通过连接测试并保存后，即可创建任务。

如需接入 MCP 工具，可以在“设置 → MCP”中添加本地进程或远程服务并点击“保存并连接”；也可以在会话中发送可直接连接的 HTTP MCP 服务端点，并明确要求 DeepDesk 安装。会话安装会先展示服务地址与工具清单，确认后才会持久化。GitHub、npm、MCP Registry 或普通介绍页不能作为 HTTP 端点直接安装，涉及本地命令、Token 或自定义请求头的服务仍需在设置页配置。本地服务器的启动命令、远程 Token 和请求头仅保存在当前系统账号的 Electron `userData` 中，请勿填写来源不可信的命令或凭据。

如需让浏览器任务沿用 Edge / Chrome 登录状态，请在“连接器 → 浏览器调试”点击“连接”。首次使用且扩展尚未安装时，客户端会显示应用内安装引导；用户按浏览器要求完成一次安装确认后，DeepDesk 会自动完成连接，无需再次点击“连接”。扩展只连接本机 DeepDesk，浏览器点击、输入和脚本执行仍遵循 Agent 权限审批。

## 常用工程命令

统一工程入口为 `pnpm flow -- <command>`：

| 目标 | 命令 |
| --- | --- |
| 查看命令帮助 | `pnpm flow -- help` |
| 环境诊断 | `pnpm flow -- doctor` |
| 类型、Lint 与单元测试 | `pnpm flow -- check` |
| 架构规模与分层检查 | `pnpm architecture` |
| 追加生产构建 | `pnpm flow -- check --include-build` |
| Electron E2E | `pnpm flow -- e2e` |
| Electron 冒烟测试 | `pnpm flow -- test --kind smoke` |
| Windows 打包 | `pnpm flow -- package --target win` |
| macOS arm64 打包 | `pnpm flow -- package --target mac` |
| 发布候选门禁与打包 | `pnpm flow -- release --target <win-or-mac>` |

详细说明见 [docs/engineering.md](./docs/engineering.md) 和 [docs/testing.md](./docs/testing.md)。

## 架构概览

```text
Renderer (React / Zustand)
        │ typed IPC
Preload (contextBridge)
        │
Main Process (LLM / Agent / MCP / Store / Connectors / Platform)
        │ HTTP + SSE / MCP / CDP / local filesystem
Model services and approved external integrations
```

- `renderer` 只负责界面和状态编排，不直接访问 Node.js、Electron 或外部模型服务。
- `preload` 通过类型化 `window.api` 暴露受控 IPC 能力。
- `main` 负责网络、持久化、Agent、MCP 生命周期与工具调用、命令执行、连接器和平台适配。
- `shared` 保存跨进程类型、IPC 契约和与 Electron 无关的协议代码。

完整架构与数据流见 [docs/architecture.md](./docs/architecture.md)，文件规模、分层边界和历史债务门禁见 [docs/architecture-quality.md](./docs/architecture-quality.md)。

## 项目结构

```text
src/
├── shared/        跨进程类型、IPC 契约、LLM 协议
├── main/          Electron 主进程与高权限能力
├── preload/       contextBridge 安全桥
└── renderer/      React 界面与 Zustand 状态
tests/             Vitest 单元与集成测试
e2e/               Playwright Electron 端到端测试
scripts/           统一工程入口和辅助脚本
docs/              架构、测试、CI、Git Flow 与发布文档
.agents/           项目级 AI 协作规则和 Skills
.github/           CI、Release 与 Pull Request 模板
```

目录级职责和必读规则见 [docs/folder-map.md](./docs/folder-map.md)。

## 数据与安全边界

- 渲染进程启用 `contextIsolation`，禁用 `nodeIntegration`。
- 模型、MCP 和连接器网络请求由主进程执行。
- 文件工具默认受工作目录边界约束；越界访问和高风险操作受权限模式控制。
- 本地数据存放于 Electron `userData/deepdesk.json`，测试使用独立临时目录。
- API Key、MCP Token 和自定义请求头当前保存在本地 JSON 配置中，尚未接入系统 `safeStorage` 加密；请避免在共享系统账号中保存生产密钥。
- 禁止提交 API Key、Token、Cookie、二维码、用户会话、私有文档和构建产物。

更完整的安全和持久化说明见 [docs/architecture.md](./docs/architecture.md)。

## 开发与贡献

项目使用 `main` 和 `develop` 两个常驻分支：

- 日常开发与普通 Pull Request 进入 `develop`。
- 只有通过发布门禁的版本才从 `develop` 合入 `main`。
- 发布提交在 `main` 创建与版本一致的 `vX.Y.Z` 注解标签。

分支流程见 [docs/git-flow.md](./docs/git-flow.md)，贡献、测试和 Code Review 要求见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [AGENTS.md](./AGENTS.md) | AI 编码助手和仓库级工程约束 |
| [docs/architecture.md](./docs/architecture.md) | 进程分层、数据流、存储和安全边界 |
| [docs/architecture-quality.md](./docs/architecture-quality.md) | 文件规模预算、分层约束和模块拆分规则 |
| [docs/memory.md](./docs/memory.md) | 本地记忆捕获、检索、安全和默认工作目录 |
| [docs/engineering.md](./docs/engineering.md) | 开发、构建与统一工程命令 |
| [docs/testing.md](./docs/testing.md) | 测试层级和覆盖要求 |
| [docs/e2e.md](./docs/e2e.md) | Electron E2E 运行方式 |
| [docs/ci.md](./docs/ci.md) | GitHub Actions 与合并门禁 |
| [docs/git-flow.md](./docs/git-flow.md) | 分支、发布 PR 和标签规则 |
| [docs/release.md](./docs/release.md) | 发布候选与安装包流程 |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | 外部贡献和 Code Review 标准 |

## 许可

本项目使用 [MIT License](./LICENSE)。
