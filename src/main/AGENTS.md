# src/main/AGENTS.md

`src/main/` 是 Electron 主进程。这里负责所有高权限能力：窗口、文件系统、网络、持久化、命令执行、Agent 工具。

## 文件职责

- `index.ts`：Electron 生命周期、单实例、退出 flush、smoke-test。
- `window.ts`：窗口创建、安全导航、外部链接策略。
- `store.ts`：本地 JSON 存储、原子写、迁移入口。
- `ipc.ts`：IPC handler 注册。
- `llm.ts`：聊天流式调度、取消、主进程网络调用。
- `agent.ts`：Agent 工具循环、权限判断。
- `agent-tools.ts`：Agent 工具 schema。
- `tools.ts`：工具执行实现。
- `platform/`：Windows/macOS 窗口、Shell、菜单和生命周期差异；其余主进程代码不得写死平台行为。

## 安全规则

- API Key 只留在主进程存储，不传第三方。
- 外部网络请求只在 main 发生。
- 文件/命令工具必须限制工作目录。
- 飞书消息、越界文件操作、危险命令必须走权限判断。
- 改权限、安全、持久化必须补测试。

## Agent 工具修改路径

1. `agent-tools.ts` 加 schema。
2. `tools.ts` 加执行分支。
3. `agent.ts` 更新 `evaluatePermission`。
4. `tests/agent.test.ts` / `tests/tools.test.ts` 补允许、拒绝、需审批用例。

## 验证

运行 `pnpm flow -- check --include-build`。
