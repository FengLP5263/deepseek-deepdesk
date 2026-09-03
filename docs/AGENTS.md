# docs/AGENTS.md

`docs/` 是项目工程和架构知识库。文档用于降低人和 AI 的接手成本。

## 文件职责

- `architecture.md`：系统架构、数据流、安全边界。
- `engineering.md`：统一工程脚本和开发/测试/发布流程。
- `git-flow.md`：`main` / `develop` 分支职责、PR 与发布标签流程。
- `testing.md`：测试分层、覆盖规则、E2E 路线。
- `folder-map.md`：目录级职责和局部 AGENTS 索引。
- `ci.md`：GitHub Actions CI 规则。
- `e2e.md`：Playwright Electron E2E 规则。
- `release.md`：发布候选和产物规则。

## 规则

- 文档要可执行：命令必须能在 `package.json` 或 `scripts/flow.mjs` 找到。
- 改脚本同步改文档。
- 改架构边界同步改 `architecture.md`。
- 改测试策略同步改 `testing.md`。

## 验证

文档改动至少运行 `pnpm flow -- doctor`，涉及命令时运行 `pnpm flow -- check`。
