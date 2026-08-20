# dsh 插件开发指引（dev-guidance）

<!-- whale-tank-knowledge-pack: v0.1.6 -->
> 上下文预算：**不要一次读完**。先看下面的形态选择表，按你的任务跳到对应主题。细节文件都短小，按需查。
> 版本锚定：本包以 dsh **0.1.0-rc.8** 实测契约为准（2026-08-20 实证，见 02）。0811 私有 registry 时代的写法只在相关文件标注为"演进方向"，不当作默认。

## 形态选择（先看这个）

| 你的需求 | 官方路径 | 安装通道 | 起点 |
|---|---|---|---|
| 纯 skill 包（无代码） | npm 包 + 运行时 `ctx.skills.register`（rc.8 实测；`dsh.skills` 字段 rc.7/rc.8 不读） | bundle（entry 挂载即注册，随装随卸） | 03 |
| MCP server | per-server `@deepseek-ai/dsh-mcp-client` 插件行（`dsh.mcpServers` 字段官方不读） | insert 行 | 03、05 |
| Node 工具 / 事件 / 服务 | npm 包 + Cordis entry（`main`） | insert 行（实时） | 03、04 |
| Node + 浏览器 UI | npm 包 + Cordis entry + `dsh.client` | bundle | 02、09/10 |
| 带组合层（多行 insert/config/disabled） | npm 包 + `dsh.bundle` | bundle 层栈（重启生效） | 02、06 |

核心判据：包是否声明 `dsh.bundle.patch`。声明 = 一层组合 patch → `dsh plugin add` 进层栈、**重启生效**；无声明 = 单个 Cordis 插件 → profile `cordis.patch.yml` insert 行、**配置 HMR 实时生效**。

## 阅读顺序建议

- 新插件起步：02 → 03 → 01 → 06。
- 加一个工具：04；改模型行为：05（扩展点）或 08（测试纪律）。
- 做 web 界面：09（settings 卡）/ 10（会话节点）；接新模型供应商：11。
- 遇到装不上/挂不上：06（排查顺序）→ 07（gotchas）。

## 文件清单（按需查）

| 文件 | 内容 | 何时读 |
|---|---|---|
| 01-plugin-shapes.md | 插件形态与判定 | 起步 |
| 02-package-contract.md | package.json 的 `dsh.*` 契约（rc.8） | 起步 |
| 03-entry-contract.md | Cordis entry（name/inject/apply、严格注入） | 起步 |
| 04-tool-contract.md | defineTool 工具契约与 UI card | 加工具 |
| 05-extension-points.md | 扩展点机制表（feature → mechanism） | 找扩展点 |
| 06-install-and-verify.md | 安装双通道、验证按改动面、挂载排查 | 装/验证 |
| 07-gotchas.md | 踩坑清单（合并实测） | 遇坑 |
| 08-testing-discipline.md | 三层测试纪律 | 写测试 |
| 09-web-settings-card.md | 设置卡（web 插件） | 做 UI 设置 |
| 10-conversation-nodes.md | 会话业务节点（web 插件） | 做 UI 业务行 |
| 11-llm-adapter.md | LLM 适配器 | 接模型供应商 |
| 12-client-build-discipline.md | 客户端构建纪律（`DSH_CLIENT_*`、依赖声明） | 做 client 半边 |

## 来源与维护

- 静态快照：内容源自官方 cookbook、社区实践总结以及实测结论，按 rc.8 校准。
- 升级：重跑蒸馏（@swell05/dsh-whale-tank 后续版本），本目录文件带版本头，更新时按 merge-spec 增量合并。
