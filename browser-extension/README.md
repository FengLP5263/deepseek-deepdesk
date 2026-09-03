# DeepDesk Browser Connector

该扩展通过浏览器 `debugger` 权限把 DeepDesk 连接到当前 Edge / Chrome 配置，从而沿用用户已有的 Cookie 和登录状态。

开发阶段安装方式：

1. 打开 Edge 的 `edge://extensions` 或 Chrome 的 `chrome://extensions`。
2. 启用“开发人员模式”。
3. 点击“加载解压缩的扩展”，选择本目录。
4. 保持 DeepDesk 运行，扩展会自动连接本机回环桥接服务。

扩展只连接 `127.0.0.1`，页面点击、输入和脚本执行仍遵循 DeepDesk 的 Agent 权限审批。
