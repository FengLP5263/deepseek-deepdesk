# DeepDesk 工程化流程

本文档定义 DeepDesk 的开发、测试、构建、打包和发布入口。目标是让人和 AI 都通过稳定脚本完成工作，避免依赖口头步骤。

## 统一入口

优先使用：

```sh
pnpm flow -- <command> [options]
```

底层脚本位于 `scripts/flow.mjs`，只编排现有命令，不替代业务代码。

## 常用命令

| 目标 | 命令 | 说明 |
| --- | --- | --- |
| 环境诊断 | `pnpm flow -- doctor` | 检查 Node、pnpm、关键配置文件 |
| CI 门禁 | `pnpm flow -- ci --include-build` | CI 等价命令 |
| 快速质量门禁 | `pnpm flow -- check` | typecheck + typecheck:e2e + lint + test |
| 完整本地门禁 | `pnpm flow -- check --include-build --include-smoke --include-e2e` | 追加 build、Electron smoke、E2E |
| E2E 隔离模式 | `pnpm flow -- e2e` | 每条用例独立启动客户端，CI 默认使用 |
| E2E 会话模式 | `pnpm flow -- e2e --mode session` | 一个客户端窗口连续跑完整验收流，适合本地人工观察 |
| E2E 全量模式 | `pnpm flow -- e2e --mode all` | 同时跑 isolated 和 session 测试 |
| 单元/集成测试 | `pnpm flow -- test --kind unit` | 等价于 `pnpm test` |
| Electron 冒烟测试 | `pnpm flow -- test --kind smoke` | 构建并启动 Electron 验证 renderer 加载 |
| UI Mock 会话 | `pnpm flow -- seed-ui-session` | 向本机 userData 写入 `UI会话`，用于人工检查复杂会话 UI |
| 生产构建 | `pnpm flow -- build` | 等价于 `pnpm build` |
| Windows 打包 | `pnpm flow -- package --target win` | 输出 NSIS 安装包 |
| macOS 打包 | `pnpm flow -- package --target mac` | 在 Apple Silicon Mac 输出 arm64 DMG |
| 发布候选 | `pnpm flow -- release --target <win-or-mac>` | 完整门禁 + 指定平台打包 |

## 流程分层

1. 开发前：`pnpm flow -- doctor`
2. 改代码中：按影响范围运行 `pnpm flow -- check`
3. 改安全、权限、持久化、IPC、Agent 工具：必须补或更新测试
4. 功能和修复改动：按语义化版本号同步更新 `package.json` 与 `src/shared/app-meta.ts`
5. 提交前：`pnpm flow -- check --include-build`
6. 发版前：在目标系统运行 `pnpm flow -- release --target win` 或 `pnpm flow -- release --target mac`

## 版本规则

DeepDesk 还没有发布第一个稳定对外版本，因此当前使用 `0.x.y` 版本线。

- 稳定版前：主版本号固定为 `0`，不要把功能迭代升到 `1.x.y`。
- `feat`：新增产品能力或可见功能，升 minor，例如 `0.5.8` → `0.6.0`。
- `fix`：修复缺陷且不改变兼容性，升 patch，例如 `0.5.8` → `0.5.9`。
- 破坏性变更：稳定版前升 minor，并在 PR / Release notes 中明确标注 breaking change；第一个稳定对外版本才允许发布 `1.0.0`。
- UI 读取 `src/shared/app-meta.ts` 的 `APP_VERSION`；测试会校验它与 `package.json` 版本一致。

## 远端工程化

- CI：见 `docs/ci.md` 和 `.github/workflows/ci.yml`。
- Release：见 `docs/release.md` 和 `.github/workflows/release.yml`。
- E2E：见 `docs/e2e.md`。
- 外部贡献、Code Review 和合并规则：见 `CONTRIBUTING.md` 与 `.github/pull_request_template.md`。

## 平台限制

- Windows 包可以在 Windows 上打。
- macOS arm64 包必须在 Apple Silicon macOS 上打，产物是 `.dmg`。
- 当前不提供 Linux 构建、测试或发布目标。

## AI 协作规则

- AI 进入仓库后先读 `AGENTS.md`。
- 需要工程化流程时再读 `.agents/skills/deepdesk-engineering/SKILL.md`。
- 修改具体目录下文件时，读取最近的局部 `AGENTS.md`；目录级索引见 `docs/folder-map.md`。
- 不直接记忆零散命令，优先调用 `pnpm flow -- ...`。
- 新增能力时同步更新：
  - `AGENTS.md`
  - `docs/engineering.md`
  - 相关测试
  - 必要时更新项目 Skill

## 当前缺口

- 已有 Electron smoke，不等价于完整 E2E。
- 尚未引入 Playwright Electron 或 WebdriverIO。
- 已接入 Playwright Electron isolated/session 两种 E2E；后续补聊天、Agent 审批、IPC 主链路用例。
