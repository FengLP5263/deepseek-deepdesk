# AGENTS.md

这是 DeepDesk 桌面客户端（Electron + React + TypeScript）的项目说明书。任何 AI 编码助手（Codex / Claude Code / DeepDesk Agent 本身）在本仓库工作时，都应先读本文件，再动手改代码。

## 项目概览

DeepDesk 是一个基于 Electron、React 和 TypeScript 的开源桌面 AI 客户端，包含两块核心能力：

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
pnpm architecture # 文件规模与进程分层门禁
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
- 新文件必须满足 `scripts/architecture-budget.json` 的规模预算；历史例外不得继续增长。禁止仅为过门禁而调高预算，拆分规则见 `docs/architecture-quality.md`。

## 安全约束（改动前必读）

- API Key 存本地 `userData/deepdesk.json` 并通过 Electron `safeStorage` 加密，绝不上传第三方。
- Agent 文件操作默认限定工作目录；越界、发飞书消息按权限模式审批。
- 危险命令（rm -rf / format / shutdown 等）在「每次询问/替我审批」下强制询问。
- 改动权限/安全/持久化逻辑，必须同步补测试。

## 代码风格

- TypeScript strict；不引入 `any`（用 `unknown`/`never` + 类型收窄）。
- 字符串与 JSX 属性用单引号。
- 异步副作用显式 `void fn()` 标记，避免浮空 Promise。
- 提交信息用 Conventional Commits：`feat` / `fix` / `chore` / `docs` / `refactor` / `test`。
- 功能和修复必须同步更新语义化版本号；正式稳定版发布前主版本号固定为 `0`：`feat` 升 minor，`fix` 升 patch，破坏性变更升 minor 并在 PR / Release notes 标明。第一个稳定对外版本才允许升到 `1.0.0`；`package.json` 与 `src/shared/app-meta.ts` 必须保持一致。

## Git Flow

- `main` 与 `develop` 是两个常驻分支。`main` 只保存已发布或可立即发布的稳定版本，`develop` 用于日常开发集成。
- 开始普通开发前必须确认当前位于 `develop`，或从 `develop` 创建的短期分支；除明确执行发布流程外，禁止在 `main` 上修改或提交代码。
- 功能、修复和普通工程改动以 `develop` 为 PR 目标；只有发布 PR 才允许从 `develop` 合入 `main`。
- 发布前在 `develop` 完成版本更新和完整门禁；发布 PR 使用 Squash Merge 合入 `main`，随后立即将新的 `main` 普通合并回 `develop`，并将两个常驻分支同步到 Gitee、GitHub。
- 只有正式发布时才在 `main` 的发布提交上创建与 `package.json` 一致的 `vX.Y.Z` 注解标签并同步到两个远端；仅同步发布候选分支时不提前打标签。
- 详细流程见 `docs/git-flow.md`。分支、合并或发布规则变化时，同步更新 `CONTRIBUTING.md`、`docs/ci.md`、`docs/release.md` 和项目工程化 Skill。

## 文档同步

- 架构、目录职责或跨进程数据流变化时，同步更新 `docs/architecture.md` 和 `docs/folder-map.md`。
- 用户可见功能、配置方式、平台支持范围或安全边界变化时，同步更新 `README.md` 及对应专项文档。
- 开发命令、测试策略、CI、Git Flow 或发布流程变化时，同步更新 `AGENTS.md`、`CONTRIBUTING.md`、`docs/` 和项目工程化 Skill 中受影响的内容。
- 文档必须描述当前已经实现的行为；不得保留与代码冲突的旧说明，也不得把尚未实现的计划写成现有能力。
- 功能、修复和重构应在同一 PR 中完成相关文档更新；确认无需更新时，在 PR 描述中说明原因。

## 测试

- 核心逻辑都有 vitest 测试；改行为必须同步改测试。
- Ctrl + 滚轮整体界面缩放的 Electron 回归测试位于 `e2e/font-scale.spec.ts`，覆盖文字、图标和弹窗布局，并纳入 isolated E2E 清单。
- 可见 UI 改动通过自动化后，Windows 环境优先使用 Computer Use 走查真实客户端；不可用时必须检查已构建 Electron 客户端的多状态截图，并在交付时说明。
- 测试用 mock（vi.mock / mock LLM / mock window.api），不联网、不真发飞书消息、不真执行危险命令。
- `pnpm test` 全绿才能提交。
- 提交前建议跑 `pnpm quality`；发版前跑 `pnpm release:win`。
- PR / CI 规则见 `docs/ci.md`；E2E 模式见 `docs/e2e.md`；发布流程见 `docs/release.md`。
- 分支与标签规则见 `docs/git-flow.md`。
- 外部贡献、Code Review 和合并准入规则见 `CONTRIBUTING.md`。

## AI 协作沉淀

- 项目工程化 Skill 位于 `.agents/skills/deepdesk-engineering/SKILL.md`；架构质量流程见其 `references/architecture-quality.md`。
- 修改开发、测试、打包、发布流程时，同步更新 `docs/engineering.md`、`docs/testing.md` 和该 Skill。
- 修改具体目录下文件时，先读取最近的局部 `AGENTS.md`；目录索引见 `docs/folder-map.md`。
