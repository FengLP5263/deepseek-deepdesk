# DeepDesk Git Flow

DeepDesk 使用 `main` 与 `develop` 两个常驻分支。日常开发集成在 `develop`，达到发布标准的版本通过 Squash Merge 进入 `main`；正式发布时再创建版本标签。

## 常驻分支

| 分支 | 用途 | 允许进入的内容 |
| --- | --- | --- |
| `main` | 已发布或可立即发布的稳定版本 | 仅接受从 `develop` 发起的发布 PR |
| `develop` | 下一版本的日常开发与集成 | 功能、修复、文档、测试和工程化改动 |

任何开发开始前先确认当前分支。除明确执行发布流程外，不在 `main` 上修改或提交代码。

## 日常开发

维护者可以直接在 `develop` 上进行小范围协作；多人协作、外部贡献或风险较高的改动使用从 `develop` 创建的短期分支：

- `feature/<topic>`：新功能。
- `fix/<topic>`：缺陷修复。
- `docs/<topic>`：文档与规范。
- `chore/<topic>`：工程化与维护。

短期分支通过 PR 合入 `develop`，建议使用 Squash Merge。PR 合并前必须通过 `docs/ci.md` 定义的门禁。

## 发布流程

1. 在 `develop` 完成版本号、发布说明和必要文档更新。
2. 在目标系统运行完整发布门禁：

   ```sh
   pnpm flow -- check --include-build --include-smoke --include-e2e
   ```

3. 创建 `develop` → `main` 的发布 PR 并完成 Code Review。
4. 发布 PR 使用 Squash Merge，使 `main` 为本次版本保留一个发布提交；`develop` 上原有的详细提交历史保持不变。
5. 获取合并后的 `main`，并立即用普通 Merge Commit 回合到 `develop`，恢复共同祖先关系。禁止用 rebase、reset 或 force push 代替回合：

   ```sh
   git switch main
   git pull --ff-only github main
   git switch develop
   git merge --no-ff main -m "chore: 同步 vX.Y.Z 发布提交"
   ```

6. 将 `main` 与回合后的 `develop` 同步到 Gitee、GitHub：

   ```sh
   git push origin main
   git push github main
   git push origin develop
   git push github develop
   ```

7. 正式发布时，在 `main` 的发布提交上创建与 `package.json` 一致的注解标签：

   ```sh
   git tag -a vX.Y.Z -m "DeepDesk vX.Y.Z"
   ```

8. 将正式发布标签同步到 Gitee、GitHub：

   ```sh
   git push origin vX.Y.Z
   git push github vX.Y.Z
   ```

9. 切回 `develop` 继续下一版本开发。如果正式发布前只是在 `main` 同步发布候选，不执行第 7、8 步，也不提前创建标签。

## 标签规则

- 标签格式固定为 `v<package.json version>`，例如版本为 `X.Y.Z` 时标签为 `vX.Y.Z`。
- 标签只能指向 `main` 上通过发布门禁的提交。
- 标签创建后不移动、不复用；发布内容有误时通过新版本修复。
- 稳定版前继续遵循 `0.x.y` 版本规则。

## 分支保护

GitHub 与 Gitee 应同时保护 `main` 和 `develop`：

- 禁止 force push 和删除常驻分支。
- 合并前要求 CI 通过和至少 1 名维护者批准。
- `main` 禁止日常功能 PR，只接受 `develop` 发起的发布 PR。
- 外部贡献默认以 `develop` 为 PR 目标分支。
- 发布 PR Squash Merge 后必须将新的 `main` 回合到 `develop`，再继续下一轮开发。
