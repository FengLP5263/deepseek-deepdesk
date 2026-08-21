# DeepDesk 目录级工程地图

本文档把工程化规则接到具体目录。AI 或开发者进入对应目录时，应优先读取该目录的 `AGENTS.md`。

## 目录索引

| 目录 | 局部说明 | 职责 |
| --- | --- | --- |
| `/` | `AGENTS.md` | 仓库总规则、命令、架构约束 |
| `src/` | `src/AGENTS.md` | 源码总分层 |
| `src/shared/` | `src/shared/AGENTS.md` | 跨进程类型、IPC、LLM 协议 |
| `src/main/` | `src/main/AGENTS.md` | Electron 主进程、高权限能力 |
| `src/main/platform/` | `src/main/AGENTS.md` | Windows/macOS 窗口、Shell、菜单和生命周期适配 |
| `src/preload/` | `src/preload/AGENTS.md` | `window.api` 安全桥 |
| `src/renderer/` | `src/renderer/AGENTS.md` | React UI 和前端状态 |
| `tests/` | `tests/AGENTS.md` | Vitest 测试规则 |
| `scripts/` | `scripts/AGENTS.md` | 工程化脚本 |
| `docs/` | `docs/AGENTS.md` | 架构和流程文档 |
| `.agents/` | `.agents/AGENTS.md` | 项目内 AI Skill 和协作资产 |
| `.github/` | `.github/AGENTS.md` | CI 和 Release 工作流 |

## AI 读取顺序

1. 读取根 `AGENTS.md`。
2. 如果任务命中工程化流程，读取 `.agents/skills/deepdesk-engineering/SKILL.md`。
3. 根据要改的文件读取最近的局部 `AGENTS.md`。
4. 修改后按局部说明运行验证命令。

## 典型任务路由

| 任务 | 主要目录 | 必读 |
| --- | --- | --- |
| 新增 IPC | `src/shared`、`src/preload`、`src/main`、`src/renderer` | 对应 4 个局部 `AGENTS.md` |
| 新增 Agent 工具 | `src/main`、`tests` | `src/main/AGENTS.md`、`tests/AGENTS.md` |
| 修改平台行为 | `src/main/platform`、`src/renderer`、`tests`、`e2e` | Main、Renderer、Tests、E2E 局部说明 |
| 调整聊天 UI | `src/renderer`、`tests` | `src/renderer/AGENTS.md`、`tests/AGENTS.md` |
| 改 LLM 协议 | `src/shared/llm`、`tests` | `src/shared/AGENTS.md`、`tests/AGENTS.md` |
| 改构建/发布流程 | `scripts`、`docs`、`.agents` | 三个局部 `AGENTS.md` |
| 改 CI/Release | `.github`、`scripts`、`docs` | 对应局部 `AGENTS.md` |

## 验证策略

- 文档/脚本映射改动：`pnpm flow -- doctor`
- 工程脚本改动：`pnpm flow -- check`
- 源码行为改动：`pnpm flow -- check --include-build`
- 发版流程改动：`pnpm flow -- check --include-build --include-smoke`
