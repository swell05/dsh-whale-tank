# 踩坑清单（实测合并）

<!-- whale-tank-knowledge-pack: v0.1.6 -->

## 依赖解析

- rc.1 依赖断裂：`@deepseek-ai/dsh-type-meta@0.0.1-rc.1` 从未发布 → 用 `^0.1.0-rc.6` 线。
- 官方包公共 npm 不存在（或私有 rc 预发布匹配规则）→ **不要声明官方包为 dependencies**；peerDeps（rc.8 线）实测可声明。
- pnpm 元数据探测失败（`ERR_PNPM_META_FETCH_FAIL`）→ file: 依赖仍可从 store 硬链接安装；npm 源依赖需 registry 可达。
- 全局 `core.hooksPath` 冲突 → pnpm lefthook postinstall 失败：临时 `git config --global --unset core.hooksPath`，装完恢复。

## 安装格式

- GitHub 源（`github:作者/仓库`）：只加依赖，**不自动 append 挂载行**——记得手动补 `- insert:`，否则装了不加载。
- 本地路径：`link:C:\path\to\plugin`（Windows）/ `file:`（推荐）——开发调试用；路径斜杠按平台。
- 含空格路径（Windows）：`dsh plugin` 内部 `spawnSync("pnpm", args, {shell:true})` 按空格拼接参数，空格路径被拆断——路径避免空格，或修复方向 `shell:false`/先转义。
- allowBuilds：pnpm≥10 默认阻止 git 依赖的 prepare/build——按 dsh 提示把精确 key（**含冒号，写 yaml 必须加引号**）加入 profile `pnpm-workspace.yaml`。

## 运行时/契约

- 事件 handler 忘 `await next()` → 请求丢失 provider/model 报错；必须 `await` 后 spread。
- 类型报 `'agent/request' is not assignable to keyof Events` → npm 类型未 re-export 官方增强：边界用宽松签名（`ctx.on as unknown as ...`）。
- client 产物依赖 `window.__ModuleLoader__` → jsdom 跑不了 client 组件测试；组件级测试需 web 运行时。
- 预设挂载单例冲突（tool-cordis #1415/#1827）：同进程 tool-cordis 只挂载一次，否则 provider ID 重复注册 `already registered`。
- koffi（Windows）：锁 `3.1.2`（3.1.3/3.1.4 预编译损坏 → 目录选择器崩溃/服务静默挂；STA 线程 CoUninitialize 段错误）。
- ESM 缓存：Node half 源码改动后 disable/enable/CLI 重装都不生效——**只能重启 web**；重启后日志无 `plugin tree failed to load`。
- 宿主 CSS 覆盖插件注入样式 → 关键 UI 样式用 **JS 内联**，别依赖 class 注入。
- `dsh --dump-config` 只证结构不证激活——冒烟要真实 boot（见 06）。

## 网络/代理

- npm/pnpm 走代理可能超时卡死——必要时 `env -u http_proxy -u https_proxy ...` 直连（本机已见 registry 探测失败）。

## rc.8 变更坑（2026-08-20 实测定稿）

- **web boot 默认自动开浏览器**：`dsh web` / `dsh --profile web` 在 Loader 树结算后打开默认浏览器（SSH 会话自动跳过）。CI/无头脚本一律显式 `--no-open`。注意 `--no-open` 是 web 应用 flag，`--dump-config` 模式下不可用（报 "config dumps take no app arguments"）。
- **`.env` 拒绝名单**：项目 `.env` 或 `$DSH_HOME/.env` 里声明 `BROWSER`/`EDITOR`/`PAGER`（以及 `PATH`/`SHELL`/`NODE_OPTIONS`/`DSH_*`/proxy/CA）→ **启动即 exit 1**，不区分大小写、无逃生门。插件开关别放 `.env`，改 shell export。
- **`web_search` schema 破坏性变更**：`query: string` → `queries: string[]`（1–4 项必填数组，并发查询）。按旧 `query` 写的调用方/提示词全部要改。
- **`tool-subagent-report.reportDelivery` 取值改名**：`wakeup` 删除，用 `next-step`（新默认，或 `quiet`）。
- **实验性包前缀**：`packages/experimental/` 的包 npm 名强制 `@deepseek-ai/dsh-experimental-*`，不进正式 tarball，**promotion 重命名且无别名**——生产组合不要持久依赖。
- **subagent bundle 化装法**：`dsh-subagent-codex`/`dsh-subagent-claude-code` 从普通 provider 变为 Profile Bundle——装法 `dsh plugin --profile <p> add <包>` + 重启 + Agent Preset 里启用工具行并对齐 `providerName`/`permissionMode`/`toolName`（每行唯一）；**删掉旧手动 insert 行**避免同 id 并存；不再从宿主 PATH 解析 `codex`/`claude`。
- **skill/AGENTS 项目根判定**：`findProjectRoot` 以 `.git` 目录为标记（package.json 不算）——项目级 `.agents/skills`、AGENTS.md 注入都要求 `.git` 存在；新 init 的项目记得 `git init`。
- **`~/.agents/skills` 不受 DSH_HOME 隔离**：用户级 skill 根按真实用户家目录解析——沙盒/隔离环境的 skill 目录仍会含用户级技能（不影响候选评测，报告边界声明即可）。
- **cookbook 文档漂移**：官方 `docs/cookbook/*` 追赶不及（尤其 `web_search`、subagent bundle 化）——契约以 `docs/config-catalog` / `docs/tool-catalog` 为准。
