# {{project_name}} — dsh 插件开发指引

<!-- whale-tank-knowledge-pack: v0.1.6 -->
> 本文件由 @swell05/dsh-whale-tank（`/whale-tank-init`）生成/维护：只写入 `## dsh-whale-tank 开发指引` 区块，其余内容一律不动。见 `docs/dev-guidance/README.md`。

**项目类型**：{{type}}（host / client / both） ｜ **版本模式**：{{mode}}（local / standalone） ｜ **基线 dsh**：{{dsh_version}} ｜ **沙盒基线 profile**：{{profile}} ｜ **知识包基线 dsh**：{{dsh_baseline}}

## dsh-whale-tank 开发指引

## 先做：看状态

任何操作前**由开发者在自己终端的项目文件夹里**跑 `.wttools\status`：检查版本漂移、混合版本告警、plugState（clean / plugged / dirty）。dirty 时先 `.wttools\restore` 再继续。⚠️ **agent 不要代跑** `.wttools` 命令——dsh 受限沙盒禁止创建子进程（spawn EPERM），只负责引导用户在自己终端执行。

沙盒布局：`.sandbox/dsh-home`（独立 DSH_HOME，隔离 sessions/凭据/自定义插件）+ `.sandbox/state.json`（机器状态）+ 本文件与 `NOTES.md`（人读状态）。

## 开发工作流（精确命令，PowerShell）

命令都走项目内 `.wttools\`（随沙盒打包的自包含工具，不需要全局安装）。

**日常主循环**：

```powershell
.wttools\status                                                               # 任何操作前（clean 才继续）
npm run build                                                                       # 改 src/ 后先构建
.wttools\run-test [--profile web] [--port <n>] [--no-build]                     # 挂载 + 前台实跑（默认 web:13080，Ctrl+C 自动复原）
```

**自动化复原测试**：`run-test` 是人盯着实跑的形态；要一发插拔自动验证用 `plug-test`。

```powershell
.wttools\plug-test [--no-restore]                                             # 一发插拔复原（残留自动复原 + exit 1）
.wttools\deps --add <包名>（可带 @版本，自动识别 dsh 插件走 plugin 通道）     # 加依赖（双通道）
.wttools\restore                                                              # 或 reset，删除前会 ask_user
```

> 本文件由 `/whale-tank-init` 生成；项目已初始化，`.wttools\` 即随沙盒打包的命令行工具。CLI 不提供 init，项目由 skill 创建。

## 阅读路由（按 {{type}} 类型）

`docs/dev-guidance/` 按需读，别一次读完（上下文预算）。

- **host**：01 → 02 → 03 → 04 → 08
- **client**：01 → 02 → 09 → 12 → 08
- **both**：01 → 02 → 03 → 09 → 10 → 08

## 铁律（7 条，代码审查红线）

1. 只操作沙盒 DSH_HOME（`.sandbox/dsh-home`），绝不读写真实 `~/.dsh` 的 profile/sessions/credentials/settings。
2. 所有 `dsh` 子进程显式带 `DSH_HOME=<沙盒>`（空白视为未设置，务必非空）。
3. 沙盒 web 冒烟端口避开 3080。
4. 不向沙盒写入真实凭据；自动化冒烟免 LLM。
5. 删除任何沙盒文件前先 ask_user（`--yes` 显式跳过）。
6. 版本一致性：沙盒运行时版本必须与 state.json 一致；混合版本视为 dirty，先处理再操作。
7. vet 执行边界：不可信代码默认不执行（install 脚本禁、高危不 boot、`--no-exec` 全程静态）；结束前必须跑"本地未受影响"自检。

## 测试怎么跑（三层）

- 纯函数单测：`npm test`（vitest）——业务规则全分支。
- waterfall 契约测试：`tests/plugin.spec.ts` 模式——`await next()` 透传、字段保留、错误原样上抛（不启动 dsh、无 API Key）。
- 实机验证（真实 agent 循环）：留给人工；临时给沙盒注入凭据，用后即清（见 `NOTES.md`）。
- 沙盒冒烟（自动）：`dsh --dump-config` 结构断言 + host 激活断言（boot 日志/`assertEntriesActivated`）+ web 独立端口 HTTP 断言。

## 知识包结构（按需读，不要一次读完）

- `docs/dev-guidance/README.md` —— 先读它（形态选择 + 阅读顺序）。
- `docs/dev-guidance/01-plugin-shapes.md` ~ `11-llm-adapter.md` —— 按任务主题按需查。
- `NOTES.md` —— 踩坑积累：遇坑先查、再记（追加日志条目）。

## vet（第三方插件体检）用法

第三方插件体检走 **`/whale-tank-vet` skill**（web 里触发，CLI/.wttools 不提供 vet）：复刻环境 → 静态危害分析 → 受限动态验证 → LLM 源码审查 → 报告（`.vetting/vet-report.md` + `vet-result.json`，三级结论）。默认不执行不可信代码；`.vetting/<包>` 已有保留现场时新体检会取消，需手动删除或换工作区。详细见 `docs/dev-guidance/06-install-and-verify.md` 与 `NOTES.md`。
