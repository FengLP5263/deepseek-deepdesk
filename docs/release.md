# DeepDesk 发布流程

本文档定义发版前检查、平台打包和产物交付规则。

## 发布分支与标签

1. 日常改动先合入 `develop`，并在 `develop` 完成版本号与发布说明更新。
2. 完整发布门禁通过后，创建 `develop` → `main` 的发布 PR。
3. 发布 PR 使用 Squash Merge，使 `main` 为本次版本保留一个发布提交。
4. 合并后立即将新的 `main` 通过普通 Merge Commit 回合到 `develop`，并将两个常驻分支同步到 Gitee、GitHub。
5. 正式发布时，在 `main` 的发布提交上创建与 `package.json` 一致的 `vX.Y.Z` 注解标签，并将标签同步到两个远端；仅同步发布候选分支时不打标签。详细命令见 `docs/git-flow.md`。

## 本地发布候选

Windows：

```sh
pnpm flow -- release --target win
```

macOS（Apple Silicon）：

```sh
pnpm flow -- release --target mac
```

该命令会执行：

1. `typecheck`
2. `lint`
3. `test`
4. `build`
5. `smoke`
6. `e2e`
7. 对应目标的 `package:win` 或 `package:mac`

## CI 发布候选

GitHub Actions 提供：

- `.github/workflows/ci.yml`：PR / push 质量门禁。
- `.github/workflows/release.yml`：推送 `v*` 标签时自动打包两个平台，也可在 `main` 手动选择 Windows、macOS 或两个平台。

macOS 包必须在 macOS runner 上打，不能在 Windows 本机生成。

## 发版检查清单

- [ ] `package.json` 版本正确。
- [ ] 当前发布内容已经从 `develop` 通过发布 PR 合入 `main`。
- [ ] 发布 PR 已使用 Squash Merge，且新的 `main` 已通过普通 Merge Commit 回合到 `develop`。
- [ ] `main` 的发布提交已创建与版本号一致的 `vX.Y.Z` 注解标签。
- [ ] `pnpm flow -- check --include-build --include-smoke --include-e2e` 通过。
- [ ] Windows：`pnpm flow -- package --target win` 通过。
- [ ] macOS：在 macOS 执行 `pnpm flow -- package --target mac`。
- [ ] 产物位于 `release/`。
- [ ] 更新发布说明。
- [ ] 确认安装包不包含本地密钥、token、用户数据。

## 产物命名

当前由 `electron-builder` 生成：

- Windows：`DeepDesk Setup <version>.exe`
- macOS arm64：`.dmg`

## 不做的事

- 不自动上传第三方分发平台。
- 不自动给用户发飞书消息。
- 不在 CI 中使用真实 API Key。
