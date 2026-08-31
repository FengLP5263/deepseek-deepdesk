# .github/AGENTS.md

`.github/` 存放 GitHub 平台工程化配置，主要是 CI、Release、Issue/PR 模板。

## 规则

- Workflow 必须调用仓库内脚本，优先 `pnpm flow -- ...`。
- CI 不使用真实模型、飞书或密钥。
- CI 必须覆盖 `develop`、`main` 和 Pull Request；普通 PR 目标为 `develop`，发布 PR 才能目标 `main`。
- Release workflow 只产出构建产物，不自动发布到外部渠道。
- Release workflow 只允许从 `main` 或 `v*` 版本标签运行。
- macOS 包必须在 `macos-*` runner 上构建。
- Windows 包必须在 `windows-*` runner 上构建。

## 验证

本地至少运行：

```sh
pnpm flow -- doctor
pnpm flow -- check
```
