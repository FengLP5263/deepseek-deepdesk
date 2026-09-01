# .agents/AGENTS.md

`.agents/` 存放项目内 AI 协作资产。这里的内容用于帮助 Codex、Claude Code、DeepDesk Agent 等快速理解本仓库。

## 目录职责

- `skills/`：项目级 Skill。
- `skills/deepdesk-engineering/`：DeepDesk 工程化开发、测试、打包、发布流程。
- `skills/deepdesk-engineering/references/architecture-quality.md`：文件预算、分层边界和模块拆分工作流。

## 规则

- Skill 必须保持短而可执行。
- 详细流程放 `references/`，不要堆在 `SKILL.md`。
- 更新开发/测试/发布流程时，同步更新 Skill、`AGENTS.md`、`docs/engineering.md`。
- 更新架构预算或例外时，同步更新 `docs/architecture-quality.md`；禁止仅为通过 CI 调高上限。
- 不在这里存密钥、token、个人授权二维码或运行时产物。

## 验证

运行：

```sh
python C:\Users\FengLP5263\.codex\skills\.system\skill-creator\scripts\quick_validate.py .\.agents\skills\deepdesk-engineering
```
