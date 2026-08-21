# DeepDesk CI 说明

CI 负责把本地工程化脚本放到远端执行，确保 PR 和发版不依赖个人机器状态。

## 工作流

| 文件 | 触发 | 作用 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | push / PR / 手动 | Windows/macOS 的 typecheck、lint、test、build、smoke 与 E2E |
| `.github/workflows/release.yml` | 手动 | 按平台打包并上传 artifact |

## 设计原则

- CI 调用 `pnpm flow -- ...`，不重复编码流程。
- 不使用真实 API Key。
- 不调用真实模型或飞书。
- macOS 包在 macOS runner 打。
- Windows 和 macOS 分别在对应 runner 跑 smoke 与 E2E。
- 当前 CI 不运行 Linux job。

## 本地等价命令

PR 门禁：

```sh
pnpm flow -- ci --include-build
```

发版候选：

```sh
pnpm flow -- release --target win
pnpm flow -- release --target mac
```

## PR 合并门禁

所有外部贡献和协作分支都应通过 PR 合并，不直接向 `main` 推送功能代码。合并前必须满足：

- CI 全绿：`quality`、`smoke`、`e2e` 均通过。
- 至少 1 名维护者完成 Code Review 并批准。
- PR 描述包含变更说明、影响范围、验证命令；UI 变更必须附截图或录屏。
- 行为变更必须同步补测试；安全、权限、持久化、IPC、Agent 工具变更必须有对应测试覆盖。
- 版本号遵循 `docs/engineering.md` 的 `0.x.y` 规则，且 `package.json` 与 `src/shared/app-meta.ts` 保持一致。
- 不包含 API Key、token、私有文档、构建产物、测试产物或用户本地数据。

建议在 GitHub / Gitee 开启 `main` 保护分支：

- Require pull request before merging。
- Require status checks to pass before merging。
- Require at least 1 approval。
- Dismiss stale approvals when new commits are pushed。
- Restrict force pushes；只有维护者在历史清理等明确场景下临时执行。
