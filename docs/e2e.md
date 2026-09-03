# DeepDesk E2E 测试规划

当前项目已接入 Playwright Electron E2E，覆盖真实 Electron 窗口里的核心 UI 交互路径。E2E 用例不调用真实模型服务、不发送真实飞书消息，并通过临时 `DEEPDESK_USER_DATA_DIR` 隔离用户数据。

## 当前入口

```sh
pnpm flow -- e2e                 # 隔离模式，CI 默认
pnpm flow -- e2e --mode session  # 会话模式，本地人工观察
pnpm flow -- e2e --mode all      # 全量模式
```

这些命令都会先执行生产构建，再启动真实 Electron 应用运行 `e2e/` 测试。

## 两种模式

| 模式 | 命令 | 行为 | 适用场景 |
| --- | --- | --- | --- |
| isolated | `pnpm e2e` / `pnpm flow -- e2e` | 每条用例独立启动和关闭客户端 | CI、稳定性优先 |
| session | `pnpm e2e:session` / `pnpm flow -- e2e --mode session` | 一个客户端窗口连续跑完整验收流 | 本地人工观察 |
| all | `pnpm e2e:all` / `pnpm flow -- e2e --mode all` | 两类测试都跑 | 发版前人工确认 |

## 技术方案

当前方案：Playwright Electron。

原因：

- 能启动 Electron 应用。
- 能驱动真实 BrowserWindow。
- 能断言 DOM 状态。
- 能和 mock LLM 服务组合。

## 已有 E2E 用例覆盖

- 启动应用。
- 使用临时 `DEEPDESK_USER_DATA_DIR` 隔离用户数据。
- 断言主窗口和输入框可见。
- 断言输入区工具栏、模型选择和上下文入口可见。
- 打开设置页。
- 断言设置页基础 Tab 可见。
- 验证设置快捷键、Esc 返回和返回按钮。
- 验证侧边栏折叠、展开、新对话按钮。
- 验证 `Ctrl/Cmd+K` 搜索本地与连接器会话、内容命中、键盘打开及弹窗视口边界。
- 验证侧边栏底部模型服务入口能进入设置页。
- 验证输入框工具栏的 Agent 权限模式切换。
- 验证 Agent 工作目录选择结果会更新界面；E2E 使用临时目录模拟选择，不弹出系统文件夹对话框。
- 验证空输入时发送按钮禁用，输入内容后启用。
- 验证未配置 API Key 时发送消息展示本地错误提示，不调用外部服务。
- 验证 `Shift+Enter` 多行输入。
- 验证上下文用量面板可打开。
- 验证常规设置里的主题和 Agent 权限设置。
- 验证常规设置在重启后可读回。
- 验证添加服务弹窗的必填校验和关闭。
- 验证自定义模型服务新增、编辑、添加模型 ID、删除。
- 验证 Provider 卡片 API Key 显示/隐藏按钮。
- 验证窗口最大化按钮能改变真实 BrowserWindow 状态。
- 使用持久化的本地长会话夹具，验证“回到底部”按钮出现时位于输入区上方，且点击后能回到最新消息。
- 使用 180 条步骤的长会话夹具，验证首屏仅挂载最近 60 条、更早内容按批加载并保持阅读位置。

`e2e/app.spec.ts` 与 `e2e/sidebar.spec.ts` 等领域 spec 是隔离模式用例；`e2e/session.spec.ts` 是单窗口会话验收用例。isolated 入口会自动发现除 `session.spec.ts` 外的全部领域 spec；新增领域交互应使用独立 spec，避免继续扩张综合用例文件。

## 拖拽测试边界

标题栏拖拽属于系统窗口管理行为，Playwright 对 Electron 的 DOM 层拖拽不能稳定证明 OS 级窗口移动。当前用可验证的窗口控制按钮（最大化/还原）覆盖窗口交互主链路。

如果后续必须测拖拽，应单独做平台特定测试，并允许在 CI 中按平台跳过。

## 后续 E2E 用例

1. 使用 mock LLM 服务发起一条聊天。
2. 验证 assistant 消息流式渲染。
3. 重启后验证会话可读回。
4. 验证 Markdown 代码块、列表、链接等关键渲染。
5. 验证会话列表的重命名、切换和删除。

## Agent E2E 用例

1. 设置临时工作目录。
2. 发起只读 Agent 任务。
3. 验证工具审批 UI。
4. 点击批准。
5. 验证工具结果进入会话。

## 约束

- E2E 必须使用 mock 服务。
- E2E 启动时会设置 `DEEPDESK_E2E_PICK_DIRECTORY`，主进程直接返回临时目录，避免原生文件选择框阻断 Playwright。
- 不联网调用真实模型。
- 不发送真实飞书消息。
- 不写真实用户目录。
