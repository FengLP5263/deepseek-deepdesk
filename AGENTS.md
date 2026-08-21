# AGENTS.md

这是 DeepDesk 桌面客户端（Electron + React + TypeScript）的项目说明书。任何 AI 编码助手（Codex / Claude Code / DeepDesk Agent 本身）在本仓库工作时，都应先读本文件，再动手改代码。

## 项目概览

DeepDesk 是一款对标 Codex / Claude 的桌面 AI 客户端，包含两块核心能力：

- **聊天**：流式对话、Markdown 渲染、多模型服务管理、会话持久化
- **编码 Agent**：工具调用循环（执行命令 / 读写编辑文件 / 列目录 / 搜索 / 飞书消息），三档权限模式

## 目录结构

```
src/
├── shared/        # 主进程/渲染进程共享：类型、IPC 通道、LLM 客户端、Agent 类型
├── main/          # Electron 主进程：窗口、JSON 存储、IPC、Agent 循环、工具执行
├── preload/       # contextBridge 安全桥接（window.api）
└── renderer/      # React 界面：chat / agent / settings / sidebar / titlebar
tests/             # vitest 测试
scripts/           # 图标生成等脚本
docs/              # 架构说明
.agents/           # 项目级 AI 协作资产（Skills / 规则沉淀）
.github/           # CI / Release 工作流
```

关键子目录均有局部 `AGENTS.md`，目录级索引见 `docs/folder-map.md`。

## 命令

```sh
pnpm install      # 安装依赖（node >= 18.18，pnpm 10）
pnpm flow -- help # 查看统一工程化命令入口
pnpm doctor       # 环境与关键文件诊断
pnpm ci           # CI 等价门禁：typecheck + lint + test + build
pnpm quality      # typecheck + lint + test + build
pnpm e2e          # E2E 隔离模式：每条用例独立启动客户端，CI 默认使用
pnpm e2e:session  # E2E 会话模式：一个客户端窗口连续跑完整验收流
pnpm flow -- seed-ui-session # 写入本地 UI 检查 mock 会话（UI会话）
pnpm dev          # 开发模式（热更新）
pnpm start        # 运行已构建版本
pnpm test         # vitest 单元测试
pnpm typecheck    # TypeScript 类型检查
pnpm lint         # oxlint
pnpm build        # electron-vite 构建
pnpm smoke        # 构建 + Electron 冒烟测试
pnpm package:win  # 打 Windows NSIS 安装包
pnpm package:mac  # 打 macOS Apple Silicon DMG
pnpm release:win  # 完整门禁 + Windows 打包
pnpm release:mac  # 完整门禁 + macOS 打包
```

优先使用统一入口：`pnpm flow -- <command> [options]`。详见 `docs/engineering.md`。

## 架构约定

- **网络请求一律在主进程**（src/main）执行；渲染层只通过 preload 暴露的 `window.api` 走 IPC，禁止渲染层直接 fetch。
- 新增 IPC 的固定步骤：`ipc-channels.ts` 加通道常量 → `api.ts` 加类型 → `preload` 暴露 → `main/ipc.ts` 注册 handler。
- 新增 Agent 工具：`agent-tools.ts` 加 schema → `tools.ts` 加 `executeTool` 分支 → `agent.ts` 的 `evaluatePermission` 决定是否需批准。
- Windows/macOS 差异统一放在 `src/main/platform`；业务代码禁止直接写死 PowerShell、zsh 或平台窗口行为。
- 共享代码放 `src/shared`，不要跨层直接 import Electron。

## 安全约束（改动前必读）

- API Key 存本地 `userData/deepdesk.json`，绝不上传第三方。
- Agent 文件操作默认限定工作目录；越界、发飞书消息按权限模式审批。
- 危险命令（rm -rf / format / shutdown 等）在「每次询问/替我审批」下强制询问。
- 改动权限/安全/持久化逻辑，必须同步补测试。

## 代码风格

- TypeScript strict；不引入 `any`（用 `unknown`/`never` + 类型收窄）。
- 字符串与 JSX 属性用单引号。
- 异步副作用显式 `void fn()` 标记，避免浮空 Promise。
- 提交信息用 Conventional Commits：`feat` / `fix` / `chore` / `docs` / `refactor` / `test`。
- 功能和修复必须同步更新语义化版本号；正式稳定版发布前主版本号固定为 `0`：`feat` 升 minor，`fix` 升 patch，破坏性变更升 minor 并在 PR / Release notes 标明。第一个稳定对外版本才允许升到 `1.0.0`；`package.json` 与 `src/shared/app-meta.ts` 必须保持一致。

## 测试

- 核心逻辑都有 vitest 测试；改行为必须同步改测试。
- 测试用 mock（vi.mock / mock LLM / mock window.api），不联网、不真发飞书消息、不真执行危险命令。
- `pnpm test` 全绿才能提交。
- 提交前建议跑 `pnpm quality`；发版前跑 `pnpm release:win`。
- PR / CI 规则见 `docs/ci.md`；E2E 模式见 `docs/e2e.md`；发布流程见 `docs/release.md`。
- 外部贡献、Code Review 和合并准入规则见 `CONTRIBUTING.md`。

## AI 协作沉淀

- 项目工程化 Skill 位于 `.agents/skills/deepdesk-engineering/SKILL.md`。
- 修改开发、测试、打包、发布流程时，同步更新 `docs/engineering.md`、`docs/testing.md` 和该 Skill。
- 修改具体目录下文件时，先读取最近的局部 `AGENTS.md`；目录索引见 `docs/folder-map.md`。
