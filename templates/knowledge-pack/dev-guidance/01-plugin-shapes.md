# 插件形态（双轴判定）

<!-- whale-tank-knowledge-pack: v0.1.6 -->

> v0.1.4 起：运行时形态（host/client/both）× 分发形态（bundle / 纯 cordis insert）两轴独立。

## 轴 1：运行时形态（`--type`）

| 形态 | 声明 | 骨架结构（whale-tank 生成） | 加载方式 |
|---|---|---|---|
| **host** | `dsh.bundle.patch` | `src/index.ts + config.ts + runtime.ts + invariant.ts` + tests | `dsh plugin add` 进层栈，重启生效 |
| **client** | `dsh.client`（无 `dsh.bundle`） | host loader stub（`src/index.ts` 纯转发）+ `src/client/index.ts` + `invariant.ts` + tests | **不进层栈**——profile 用户 patch 层 insert 行接入（client 树扫描 loader entries 声明 `dsh.client` 的包） |
| **both** | `dsh.bundle.patch` + `dsh.client` | host 半边 + client 半边 + `src/types/`（共享类型，仅类型零运行时） | 层栈 + client 树双通道 |

> `web` 是 `both` 的废弃别名（v1 遗留），init 输出弃用提示按 both 处理。state 记录规范化值（both），读旧 state 内存映射不回写。

## 轴 2：分发形态

- **bundle 插件**（声明 `dsh.bundle.patch`）：组合层（可含多行 insert/config/disabled），`dsh plugin --profile <基线> add <包>` 进层栈，**重启生效**。client 半边经 `dsh.client` 双面。
- **纯 Cordis 插件**（不声明）：单个 entry，profile `cordis.patch.yml` insert 行挂载，配置 HMR 实时生效。client-only 就是此形态 + client 树 insert 接入。

## 快速判别流

```
要做什么？
├─ 只有浏览器 UI / client 逻辑（无 host 业务）→ client 型（--type client）
├─ 只有 host 后端（工具/命令/服务）→ host 型（--type host）
└─ 两端都要（RPC/共享类型）→ both 型（--type both）
再问"要不要组合层"：
├─ 是（多行 insert/config/disabled）→ bundle 分发（dsh.bundle.patch）
└─ 否（单 entry 即够）→ 纯 cordis insert
```

## 能力接线矩阵（whale-tank 覆盖层实际产物）

| 能力 | 生成文件 | package.json 字段 | seam |
|---|---|---|---|
| `skills` | `src/host/skills/` | `inject` 合并 `'skills'` | `ctx.skills.register`（**运行时注册**——包内嵌 `.agents/skills` 不被 dsh 发现，实测） |
| `tools` | `src/host/tools/` | `inject` 合并 `'tools'` + peerDeps `dsh-tools` | `ctx.tools.register` |
| `commands` | `src/host/commands/` | `inject` 合并 `'commands'` + peerDeps `dsh-commands` | commands seam |
| `mcp-server` | `src/host/mcp-server.ts` | — | MCP server 挂载点 |
| `cli` | `src/cli/` | `bin` 字段 + tsdown cli entry | 独立 bin（`lib/cli.js`） |
| `mcp-client` | `src/host/mcp-client.ts`（指引） | — | **per-server `@deepseek-ai/dsh-mcp-client` 插件行**（profile 用户 patch 层 insert，**绝不 `dsh.mcpServers`**） |
| `toolview` | `client/slots/`（`src/client/slots/`） | `dsh.client.inject` 接线（slot key 与工具名一致） | 客户端视图槽 |

非法组合：host 型不接受 client 族能力（toolview/mcp-client）、client 型不接受 host 族能力（skills/tools/commands/mcp-server/cli）——init 拒绝并指明归属形态。

## 能力面声明（`dsh.*`）

- ~~`dsh.skills`~~：**rc.7/rc.8 均不读取**（实测闭包无消费方）——skill 官方形态是运行时注册：entry `inject ['skills']` + `ctx.skills.register(SkillRegistration)`。
- ~~`dsh.mcpServers`~~：**rc.7/rc.8 均不读取**——MCP 官方形态是 per-server `@deepseek-ai/dsh-mcp-client` 插件行（`transport: stdio|streamable-http`、`serverName`、`command`/`url`），模型看到 `mcp__<serverName>__<rawName>` 工具。
- `dsh.bundle.patch` → `cordis.patch.yml`（组合层）。
- `dsh.client`：`platform: web` + `inject` 列表（web client 注入）。

## 一句话规则

`dsh` 字段是能力面声明，**strict**——声明什么就承诺什么；不声明就没有该通道。

## 形态判定补遗（skill）

- **插件级 skill（推荐，随插件装/卸，零文件系统残留）**：`ctx.skills.register({ name, description, content, invocation })`，见 03。
- **文件系统 skill（不随插件分发）**：`dsh-skill-filesystem` 扫 `<项目>/.dsh/skills`、`<项目>/.agents/skills`、`~/.dsh/skills`、`~/.agents/skills`（`~/.agents/skills` 不受 DSH_HOME 隔离，见 07）；frontmatter 用 `disable-model-invocation: true`（仅用户可调）与 `user-invocable: false`（仅模型可调）。项目根判定以 `.git` 目录为标记。
