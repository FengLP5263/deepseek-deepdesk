# 贡献指南

感谢参与 DeepDesk。这个项目已经开源，但仍处于 `0.x` 预稳定阶段；在第一个稳定对外版本发布前，主版本号不应升到 `1`。

## 开发环境

- Node.js `>= 18.18.0`
- pnpm `10.14.0`
- Windows 是当前主要开发和打包环境；macOS 安装包必须在 macOS 上构建。

安装依赖：

```sh
pnpm install
```

开发启动：

```sh
pnpm dev
```

统一工程入口：

```sh
pnpm flow -- help
```

## 分支与提交

- `main` 与 `develop` 是两个常驻分支：`main` 只保存发布版本，`develop` 是日常开发集成分支。
- 外部贡献和多人协作从 `develop` 创建 `feature/*`、`fix/*`、`docs/*` 或 `chore/*` 短期分支，并以 `develop` 为 Pull Request 目标。
- 不直接向 `main` 提交功能代码；只有经过完整发布门禁的 `develop` 才能通过发布 PR 合入 `main`。
- 每个 PR 聚焦一个明确问题，避免把无关重构、格式化和功能混在一起。
- 提交信息使用 Conventional Commits：`feat` / `fix` / `docs` / `test` / `refactor` / `chore`。
- 提交说明可以使用中文，但类型前缀必须规范，例如：`fix: 修复模型菜单关闭逻辑`。
- 完整分支、合并和标签规则见 `docs/git-flow.md`。

## 版本规则

当前版本线是 `0.x.y`：

- 稳定版前主版本号固定为 `0`。
- `feat`：升 minor，例如 `0.5.8` → `0.6.0`。
- `fix`：升 patch，例如 `0.5.8` → `0.5.9`。
- 破坏性变更：稳定版前升 minor，并在 PR 描述和发布说明中明确写出 breaking change。
- 第一个稳定对外版本才允许发布 `1.0.0`。
- 修改版本时必须同时更新 `package.json` 和 `src/shared/app-meta.ts`。

## 本地验证

提交 PR 前至少运行：

```sh
pnpm flow -- check
```

涉及 UI、交互、Electron 窗口、菜单、弹窗或会话流程时，追加：

```sh
pnpm flow -- e2e
```

涉及打包或发版时，运行：

```sh
pnpm flow -- release --target win
```

macOS 包需要在 macOS 上运行：

```sh
pnpm flow -- package --target mac
```

## 必须补测试的改动

以下改动没有测试时不应合并：

- 权限、安全策略、命令执行、文件读写边界。
- IPC 通道、preload API、主进程处理器。
- Agent 工具 schema、工具执行、审批逻辑。
- 会话持久化、配置存储、版本迁移。
- 用户可见行为变化。

测试必须使用 mock，不允许真实调用模型、飞书或危险命令。

## PR 描述要求

PR 描述需要包含：

- 变更摘要。
- 影响范围。
- 已执行的验证命令。
- UI 变更的截图或录屏。
- 潜在风险和回滚方式。
- 是否涉及版本号、文档、Skill 或测试更新。

涉及以下内容时，必须在同一 PR 中更新对应文档：

- 用户可见功能、配置方式、快捷键、平台支持范围或安全边界。
- 架构、目录职责、IPC、Agent 工具或跨进程数据流。
- 开发命令、测试策略、CI、分支流程、打包或发布方式。

如果确认不需要更新文档，请在 PR 描述中填写“不适用”并简要说明原因。文档不得把规划中的能力描述为已实现功能。

仓库提供了 `.github/pull_request_template.md`，提交 PR 时请按模板填写。

## Code Review 规则

合并前必须满足：

- CI 全绿。
- 至少 1 名维护者批准。
- 所有 review comment 已处理或明确达成共识。
- 关键路径改动由熟悉对应模块的人 review。
- 安全、权限、持久化、Agent 工具、发版流程改动需要更严格审查。
- README、架构说明和专项文档与实际实现保持一致。

普通功能 PR 合入 `develop` 时建议使用 Squash Merge。`develop` → `main` 的发布 PR 同样使用 Squash Merge，使 `main` 每个版本只保留一个清晰的发布提交；合并后维护者必须立即将新的 `main` 通过普通 Merge Commit 合并回 `develop`，恢复两个常驻分支的共同祖先关系。禁止用 rebase、reset 或 force push 代替回合。

## 保护分支建议

GitHub / Gitee 的 `main` 和 `develop` 分支建议开启：

- 禁止直接 push。
- 合并前必须通过 PR。
- 合并前必须通过 CI status checks。
- 至少 1 个 approval。
- 新提交推送后自动取消旧 approval。
- 禁止 force push；只有维护者在历史清理等明确场景下临时打开。

此外，`main` 只接受来自 `develop` 的发布 PR；普通贡献 PR 的目标分支必须是 `develop`。

## 不要提交的内容

- API Key、token、cookie、授权二维码。
- 用户本地数据、私有文档、聊天记录。
- `out/`、`release/`、`test-results/`、Playwright 报告等构建或测试产物。
- 与本 PR 无关的大规模格式化。
