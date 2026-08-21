# DeepDesk — DeepSeek 桌面客户端

一款对标 Codex / Claude / 智谱 / DeepSeek 前沿开发团队风格、操作丝滑的桌面 AI 客户端。
打开即用：填入 DeepSeek API Key 即可开始流式对话；也支持添加任意 **OpenAI 兼容** 模型服务（智谱、Kimi、OpenAI、本地 Ollama 等）。

![stack](https://img.shields.io/badge/Electron-33-blue) ![stack](https://img.shields.io/badge/React-18-61dafb) ![stack](https://img.shields.io/badge/TypeScript-5.7-3178c6) ![stack](https://img.shields.io/badge/Vite-6-646cff) ![stack](https://img.shields.io/badge/Tailwind-4-38bdf8)

## ✨ 特性

- **开箱即用**：默认内置 DeepSeek（deepseek-v4-flash / deepseek-v4-pro），只需粘贴 API Key
- **自定义模型服务**：任意 OpenAI 兼容 Base URL + API Key + 模型列表，支持「测试连接」一键导入模型
- **丝滑流式对话**：SSE 流式输出、50ms 节流渲染、打字光标、思考过程（reasoning_content）折叠展示
- **完整的 Markdown 渲染**：表格 / 代码块高亮 / 一键复制 / 外部链接安全打开
- **会话管理**：本地持久化历史、搜索、删除、自动标题、重新生成、编辑重发
- **编码 Agent**：像 Codex / Claude Code 一样，能读写编辑文件、执行 Windows PowerShell 或 macOS zsh 命令、递归搜索代码，逐步自主完成任务，命令默认需批准
- **安全架构**：contextIsolation + 无 nodeIntegration，网络请求全部在主进程执行

## 🚀 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 开发模式（热更新）
pnpm dev

# 3. 类型检查 + 构建
pnpm typecheck
pnpm build

# 4. 打包安装包
pnpm package:win   # Windows NSIS 安装包
pnpm package:mac   # macOS Apple Silicon DMG
```

## 📖 使用说明

1. 启动应用，进入 **设置 → 模型服务**
2. 在 DeepSeek 卡片中粘贴你的 API Key（前往 [platform.deepseek.com](https://platform.deepseek.com) 创建）
3. 点击 **测试连接** 校验，返回 **保存**
4. 回到对话页，直接输入问题，Enter 发送

### 添加自定义模型服务

点击「添加服务」，填写：

- 服务名称：如 `智谱 GLM`
- Base URL：服务商提供的 OpenAI 兼容地址，如 `https://open.bigmodel.cn/api/paas/v4`
- API Key：服务商密钥

保存后点击「测试连接」可自动拉取该服务的模型列表，或手动添加模型 ID。

本地模型：添加 `http://localhost:11434/v1`（Ollama）即可在客户端内使用本地模型，无需联网。

### 对话与 Agent 已统一

DeepDesk 只有一个对话界面，直接输入即可：可以随便聊天，也可以让它帮你写代码、执行命令、读写文件、发飞书消息——它会自己判断该直接回答还是调用工具。

- 对话记录统一显示在左侧栏，点选即可回看，完成任务自动保存
- 选择工作目录后，Agent 的读写都限定在该目录内
- 三档权限模式（**每次询问 / 替我审批 / 完全访问**）决定命令与文件访问是否弹窗确认，可在输入框左下角或 **设置 → 常规** 切换

## ⌨️ 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Enter` | 发送消息（可在设置中改为 Ctrl+Enter） |
| `Shift+Enter` | 换行 |
| `Esc` | 停止生成 / 返回对话 |
| `Ctrl+N` / `Cmd+N` | 新建对话 |
| `Ctrl+,` / `Cmd+,` | 打开 / 关闭设置 |

## 🗂 项目结构

```
deepseek-desktop/
├── electron.vite.config.ts     # electron-vite 三段式构建配置
├── electron-builder.yml        # 打包配置
├── src/
│   ├── shared/                 # 主进程 / 渲染进程共享层
│   │   ├── types.ts            # 领域模型（Provider / Conversation / Message）
│   │   ├── ipc-channels.ts     # IPC 通道常量
│   │   ├── api.ts              # preload 桥接的类型契约
│   │   └── llm/                # OpenAI 兼容流式客户端 + 内置提供商
│   ├── main/                   # Electron 主进程
│   │   ├── platform/           # Windows/macOS 窗口、Shell 与菜单适配
│   │   ├── index.ts            # 生命周期 / 单实例 / 冒烟测试
│   │   ├── window.ts           # 双平台窗口创建与安全导航
│   │   ├── store.ts            # 本地 JSON 原子持久化
│   │   ├── llm.ts              # 流式对话调度（SSE → IPC 推送）
│   │   └── ipc.ts              # IPC 处理器
│   ├── preload/                # contextBridge 安全桥接
│   └── renderer/               # React 界面
│       └── src/
│           ├── components/     # titlebar / sidebar / chat / settings / ui
│           ├── stores/         # zustand 状态（设置 / 聊天流式）
│           ├── hooks/          # 节流渲染 / 自动滚动
│           └── lib/            # 工具函数
└── scripts/gen-icon.mjs        # 程序化生成应用图标
```

## 🛠 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面壳 | Electron 33 + electron-vite |
| UI | React 18 + TypeScript（strict）+ Tailwind CSS 4 |
| 状态 | Zustand 5 |
| 渲染 | react-markdown + rehype-highlight（代码高亮） |
| 图标 | lucide-react |
| 存储 | 主进程原子写 JSON（userData/deepdesk.json） |
| 网络 | 主进程 fetch + SSE 流式解析（OpenAI 兼容协议） |

## 🤝 贡献

DeepDesk 当前处于 `0.x` 预稳定阶段。欢迎通过 Pull Request 参与，但合并前必须通过 CI、测试和 Code Review。

贡献流程、版本规则、PR 清单和合并门禁见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## ❓ FAQ

- **API Key 存在哪里？** Windows 位于应用的 `%APPDATA%` 用户数据目录，macOS 位于 `~/Library/Application Support/DeepDesk/deepdesk.json`，不会上传到任何第三方。
- **为什么网络请求放在主进程？** 避免渲染进程 CORS 限制与 XSS 面，符合 Electron 安全最佳实践。
- **支持非 OpenAI 协议的服务吗？** v1 面向 OpenAI 兼容协议（覆盖 DeepSeek / 智谱 / Kimi / 通义 / Ollama / vLLM 等绝大多数服务）；Anthropic 协议适配器已在路线图中。

## 📄 许可

MIT
