# 扩展点机制表（feature → mechanism）

<!-- whale-tank-knowledge-pack: v0.1.6 -->

> 要改的行为 90% 有官方钩子——先查这张表，不要 fork 核心。

| 产品功能 | 插件机制 |
|---|---|
| Hook（用户/项目级） | `agent/session-start`、`agent/pre-step`、`agent/request`、`tools/pre-execute`、`tools/post-execute`、`agent/turn-stopping` |
| 权限门 | `tools/pre-execute` 返回 `{kind:'deny'}` / `{kind:'ask'}`（经 ctx.approval） |
| 工具过滤保持对齐 | `ctx.tools.restrict()`（展示/查找/执行三面一致） |
| 系统提示词 | `ctx.systemPrompt.section()`（排序 + 局部 shadowing） |
| AGENTS.md（根/子目录） | section provider / 文件变更监听 + `agent.inject()` |
| 内置工具 | `ctx.tools.register()`（dsh-tool-* 家族是样例） |
| 会话事件/UI | `session/event`（assistant/chunk 等）；输入回 `agent.followup()` / `agent.steer()` |
| Web Chat 业务节点 | `ConversationNodeDefinition` + `conversation.chat.node` 渲染槽（见 10） |
| 子代理 | `ctx.subagents` provider 注册表 + `dsh-tool-subagent` |
| MCP | 每 server 一个插件：发现工具 → `ctx.tools.register()` |
| Skills | `ctx.skills.register`（插件级，随装随卸）或文件系统根（`~/.dsh/skills` 等）；user-invocable → 用户 `/name` 触发注入 `<skill_content>`；model-invocable → `skill` 工具按需加载（见 03） |
| 记忆 | section provider + tool |
| 定时任务 | 插件注册调度工具；timer 触发 → idle 时 `followup(..., {source:{kind:'cron'}})` / busy 时 `inject()` |
| 模型适配器 | `LlmAdapter` 子类 + `registerAdapter`（见 11） |
| 插件热重载 | 所有注册都是 `ctx.effect` → HMR 天然可用 |

## 通用纪律

waterfall 监听器返回 typed decision 并 `return next()`（漏 `await next()` 会静默丢字段——见 07/08）；只在需要时用 wrapper（`tools/execute`），观察用 `tools/result`。
