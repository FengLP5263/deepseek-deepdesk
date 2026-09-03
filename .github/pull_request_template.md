## 变更摘要

-

## 影响范围

-

## 目标分支

- [ ] 普通功能 / 修复 / 文档 PR 目标为 `develop`
- [ ] 发布 PR 为 `develop` → `main`
- [ ] 如果不符合以上两项，已说明原因

## 验证

- [ ] 已运行 `pnpm flow -- check`
- [ ] UI / 交互变更已运行 `pnpm flow -- e2e`
- [ ] 打包 / 发版变更已运行 `pnpm flow -- release --target win`
- [ ] 不适用项已在下方说明

## 截图或录屏

UI 变更必须提供；非 UI 变更可写“不涉及”。

## 风险与回滚

-

## 合并前自查

- [ ] 遵循 Conventional Commits
- [ ] 行为变更已补测试
- [ ] 安全 / 权限 / 持久化 / IPC / Agent 工具变更已有对应测试
- [ ] 版本号已按 `0.x.y` 规则更新，且 `package.json` 与 `src/shared/app-meta.ts` 一致
- [ ] README、专项文档、AGENTS 或 Skill 已按影响范围同步更新；不适用时已说明原因
- [ ] 未提交密钥、私有文档、用户数据、构建产物或测试产物
