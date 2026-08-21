# DeepDesk 发布流程

本文档定义发版前检查、平台打包和产物交付规则。

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
- `.github/workflows/release.yml`：手动打包 Windows、macOS 或两个平台。

macOS 包必须在 macOS runner 上打，不能在 Windows 本机生成。

## 发版检查清单

- [ ] `package.json` 版本正确。
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
