# {{project_name}} — 踩坑积累

<!-- whale-tank-knowledge-pack: v0.1.6 -->
> 本文件由 @swell05/dsh-whale-tank 维护/追加：只维护 `## dsh-whale-tank 踩坑积累` 区块及日志条目，不覆盖其他内容。工具追加带日期，人工可补。

## dsh-whale-tank 踩坑积累

### 环境

- 版本固定策略：沙盒默认 local（复用全局 dsh {{dsh_version}}）；standalone 见 `.sandbox/dsh-install/`；状态以 `.wttools\status` 为准。
- DSH_HOME 隔离：所有 dsh 子进程必须带 `DSH_HOME=.sandbox/dsh-home`（非空）；空白值视为未设置，会回落到真实 `~/.dsh`——危险。
- 端口：沙盒 web 冒烟避开 3080（真实 web GUI 占用）。

### 依赖（双通道）

- 插件依赖 → 沙盒 profile（`dsh plugin --profile <基线> add`，对账进 bundles）；普通 npm 库 → 项目 package.json；第三方包装前 ask_user。
- `autoInstallPeers: false`：peer 插件不会自动装，必须显式加。
- 本机 pnpm 对 registry.npmmirror 元数据探测可能失败（`ERR_PNPM_META_FETCH_FAIL`）；file: 依赖从 store 硬链接可离线完成，npm 源依赖需 registry 可达或代理放行。

### 插拔与复原

- 快照/diff 规则：拔后 vs 插前快照（profile 文件 SHA、node_modules 顶层清单、state.json、sessions 残留）；任何不匹配 → dirty + 告警清单。
- dirty 处置：先看 `.wttools\status` 详情 → `.wttools\restore`（回拷快照重建）→ 仍不行 `.wttools\reset`（删 `.sandbox/` 重建）。

### 体检（vet）

- 分级门：静态命中高危（install 脚本、敏感路径/凭据引用、外联、eval/混淆、可疑依赖）→ 直接"不建议"，不执行。
- allowBuilds：pnpm≥10 默认阻止 prepare/build 脚本；git 源插件按提示把精确 key（含冒号，**必须加引号**）加入 `pnpm-workspace.yaml` 的 `allowBuilds`。
- 执行边界：DSH_HOME 隔离防状态污染、不防本机执行；报告固定声明"启发式预检，非安全保证"。

### Windows 特定

- 含空格路径在 `dsh plugin` 转发层会被拆断（shell: true 按空格拼参数）——路径避免空格或用等价短路径。
- koffi 锁 `3.1.2`（3.1.3/3.1.4 预编译损坏，Windows 目录选择器崩溃）。
- 全局 `core.hooksPath` 冲突会导致 pnpm lefthook postinstall 失败——装完再恢复。
- 命令统一 PowerShell 语法；路径分隔按平台。

### 踩坑日志

格式：`YYYY-MM-DD | 现象 | 原因 | 解法`，新条目加在末尾。示例：

```text
2026-08-19 | dsh plugin add 报 ERR_PNPM_META_FETCH_FAIL | pnpm 探测 registry.npmmirror 失败（网络/代理） | file: 依赖不受影响；npm 源依赖需放行 registry
2026-08-19 | dump-config 有插件层但功能没生效 | dump-config 只证结构不证激活 | 冒烟用真实 boot + 激活断言（assertEntriesActivated / apply 日志标记）
```
