# 🐋 @swell05/dsh-whale-tank —— 一个小巧的鲸鱼缸

<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/@swell05/dsh-whale-tank/cover/cover.jpg" alt="鲸鱼缸" width="40%">
</p>

<p align="center">
  <strong>中文</strong> · <a href="README_EN.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/ecosystem-dsh--plugin-orange" alt="dsh-plugin"></a>
  <a href="https://www.npmjs.com/package/@swell05/dsh-whale-tank"><img src="https://img.shields.io/npm/v/@swell05/dsh-whale-tank" alt="npm version"></a>
</p>

> 鲸鱼缸，为你提供两个功能：
>
> 🛠️ **① 造一个干净的插件开发专属“鱼缸”**
>
> 🩺 **② 把拿不准的插件丢进单独的“鱼缸”做个体检**
>
> 不动你真实的 `~/.dsh`。

## 🛠️ 创建插件开发沙盒

插件开发就像装修——总得先圈出工地，别把小鲸鱼的客厅弄脏。`init` 会：

- **建一个纯净沙盒**：独立的 `DSH_HOME` + 官方基线 profile + `state.json`，从此随便折腾，真身 `~/.dsh` 毫发无伤；
- **按类型生成能直接构建的骨架**（`host / client / both`，tsdown 双配置、`cordis.patch.yml`、测试桩一条龙），附带一个开发工具包；
- **可选载入开发知识包**（AGENTS.md / NOTES.md / docs/dev-guidance）——写给其它 Agent 看的参考书，按 merge-spec 增量合并，**绝不覆盖你写的内容**，冲突只告警不自动动手。

## 🩺 插件在线体检

直接装插件没把握，装之前先装进鲸鱼缸把把关。`vet` 会走三阶段：

1. **静态危害检查**：`npm pack` 拉发布产物 → 规则引擎扫 install 脚本、凭据引用、外联、eval/混淆——命中高危直接"不建议"，直接不执行；
2. **受限动态验证**：复刻 profile → 两层冲突检测 → 插拔抵消（diff=0 才算干净），全程**默认不执行不可信代码**；
3. **LLM 源码审查**：模型通读候选源码，找出规则引擎抓不到的"暗功夫"——混淆业务逻辑、误导性描述、可疑副作用/数据外发、版本投毒迹象，与规则引擎互相兜底；

体检结果放在本地文件：`vet-report.md`（人读）+ `vet-result.json`（机器读）落在 `.vetting/`，结论三选一——**未发现漏洞 / 谨慎 / 不建议**。

> ⚠️ 注意事项：vet 是**启发式预检，不是安全保证**。隔离靠独立 DSH_HOME + 受限执行，**防状态污染、不防本机执行**；网络行为只记录不阻断。而且它只在 web 里经 `/whale-tank-vet` 使用——CLI 暂不提供。

---

## 🚀 快速开始

npm 已发布，装进 DSH profile 即用。

### 安装 / 卸载

```powershell
# 装进 web profile
dsh plugin --profile web add @swell05/dsh-whale-tank

# 卸载
dsh plugin --profile web remove @swell05/dsh-whale-tank
```

装完**重启 web**（bundle 层栈在 boot 合成）。

### 在 dsh 里使用

装好重启后，在 dsh web 的空工作区对话里输入 skill 触发：

1. **初始化插件项目** —— 输入 `/whale-tank-init`：告诉它插件的主要功能，它会逐步确认细节后，在目标目录搭好沙盒 + 骨架 +（可选）知识包，写盘前 ask_user 确认，不覆盖已有内容；

<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/@swell05/dsh-whale-tank/cover/snap1.png" alt="操作截图1" width="75%">
</p>

2. **体检第三方插件** —— 输入 `/whale-tank-vet`：把想检查的 npm 包名丢给它，三阶段体检自动走完，结论落在 `.vetting/`（`vet-report.md` 人读 + `vet-result.json` 机器读）。

<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/@swell05/dsh-whale-tank/cover/snap2.png" alt="操作截图2" width="75%">
</p>



## 🧾 完整命令表（`.wttools` 工作区工具）

init 后项目内有 `.wttools/`，是插件开发可用的工具包，在项目文件夹里直接敲命令调用（Windows 用 `.wttools\`，Unix 用 `./.wttools/`）。`.wttools` 是自包含工具（零依赖单文件），插件卸载后仍可用。

| 命令 | 作用 |
|---|---|
| `.wttools\status` | 沙盒状态体检（插拔是否 dirty、知识包是否过时） |
| `.wttools\deps` | 双通道装依赖（插件 → 沙盒 profile；普通库 → 项目 package.json） |
| `.wttools\plug` | 把项目插件接入沙盒 profile（快照 → 构建 → 注入 → 冒烟） |
| `.wttools\unplug` | 取出并对账（diff=0 → clean） |
| `.wttools\plug-test` | 一发插拔复原合成测试（日常开发主循环） |
| `.wttools\run-test` | **挂载 + 前台实跑**开发中的插件，Ctrl+C 结束自动复原 |
| `.wttools\restore` | 回拷最近快照复原（`--full` 走 reset） |
| `.wttools\reset` | 删除 `.sandbox/` 整体重建（删除前 ask_user） |
| `.wttools\upgrade-knowledge` | 升级沙盒里的知识包（幂等） |

### `status`

沙盒状态体检，无参数。

```
.wttools\status
```

输出：项目名/类型、版本模式（local/standalone）、声明与实际 dsh 版本、漂移与混合版本告警、profile、plugState（clean/plugged/dirty）、知识包锚定版本与当前模板（过时提示）。dirty 时附快照 diff 明细。退出码：clean=0，否则 1。

### `deps`

双通道依赖安装。**插件依赖 → 沙盒 profile**（对账进 bundles）；**普通 npm 库 → 项目 package.json** + `npm install`。

| 参数 | 作用 |
|---|---|
| `--add <包名>` | 直接给包名（可带 `@版本`，如 `@deepseek-ai/dsh-client-runtime`、`lodash@^4`）；智能抽取包名+版本并按包名判定通道（无 LLM） |
| `--pkg <包名>` | 显式包名（配合 `--channel` 用） |
| `--channel plugin\|npm` | 显式指定通道 |
| `--version <版本>` | 指定版本；npm 通道默认 `*`，plugin 通道默认 = 沙盒运行时 dsh 版本 |
| `--section <dependencies\|devDependencies\|peerDependencies>` | npm 通道写入 package.json 的区段（默认 dependencies） |
| `--remove` | 移除而不是添加 |
| `--yes` | 跳过确认 |

```powershell
.wttools\deps --add @deepseek-ai/dsh-tools          # 包名含 dsh → plugin 通道
.wttools\deps --add lodash@^4                       # 普通库 → npm 通道
.wttools\deps --pkg @deepseek-ai/dsh-tools --channel plugin
.wttools\deps --pkg lodash --channel npm --section devDependencies
```

通道判定规则（纯字符串，无语义解析）：包名含 `@deepseek-ai/`、`dsh-` 前缀或含 `dsh` → plugin；否则 → npm。plugin 通道强制**版本一致性**（铁律 6：≠ 沙盒运行时版本直接拒绝），装后 dump-config 冒烟。

### `plug`

把项目插件接入沙盒 profile。前置 plugState 必须 clean。

| 参数 | 作用 |
|---|---|
| `--no-build` | 跳过 `npm run build`（默认会先构建） |

流程：快照（插前基线）→ 构建 → `dsh plugin add file:<项目>` + 客户端 insert → 分型冒烟（host/both 走 dump-config+boot，client 走 web boot + client bundle 断言）。成功后 plugState → plugged。

### `unplug`

取出插件并对账，无参数。

```
.wttools\unplug
```

流程：`dsh plugin remove` → 快照 diff（对比插前基线）。diff=0 → clean（exit 0）；diff≠0 → dirty + 残留清单（exit 1）。

### `plug-test`

一发插拔复原合成测试（日常开发主循环）。

| 参数 | 作用 |
|---|---|
| `--no-build` | 跳过构建 |
| `--no-restore` | diff≠0 时保留现场不自动复原（仍判失败） |

流程：plug → 冒烟 → unplug → diff。diff=0 → 报告各阶段 + exit 0；diff≠0 → 残留清单完整进报告 → 自动 restore（现场备份在快照目录，证据不丢）→ 终态 clean + exit 1。

### `run-test`

**挂载 + 前台实跑**开发中的插件——把项目插件注入沙盒指定 profile 并真实启动，Ctrl+C 结束自动复原。

| 参数 | 作用 |
|---|---|
| `--profile <名>` | 目标 profile（沙盒内任意 profile，如 web/headless；**默认 web**） |
| `--port <n>` | web 端口覆盖（默认 13080；其他 profile 尊重自身配置） |
| `--no-build` | 跳过 `npm run build` |

```powershell
.wttools\run-test                       # 默认 web:13080，打开浏览器实跑
.wttools\run-test --profile headless    # 跑 headless profile
.wttools\run-test --port 8080
```

流程：构建 → 注入（`dsh plugin add file:`，全程显式沙盒 DSH_HOME + profile 路径断言，**不会逃逸到真实 ~/.dsh**）→ 前台 boot → Ctrl+C → remove + diff 复原（diff≠0 证据落袋 + 自动复原该 profile）。

> ⚠️ run-test 内部会先 `npm run build`——**新骨架先 `npm install` 再跑**，否则报 `tsc` 不存在。

### `restore`

两级复原。

| 参数 | 作用 |
|---|---|
| `--full` | 走 reset：删除 `.sandbox/` 整体重建 |
| `--yes` | 跳过删除确认 |

不带 `--full`：回拷最近快照的 profile 文件 → 重建 node_modules → 清沙盒 sessions → 重写 state（clean）→ 冒烟确认。

### `reset`

独立 verb：删除 `.sandbox/` 整体重建沙盒，删除前 ask_user（`--yes` 跳过）。适合沙盒彻底坏掉时用。

### `upgrade-knowledge`

把插件内置的更新版知识包按 merge-spec 增量合并进项目（幂等，绝不覆盖用户内容），无参数。

```
.wttools\upgrade-knowledge
```

新版本块追加、旧版本块保留（两版并存待人工清理）、冲突只告警不自动动手。

## 🌐 Skills & Tools（仅测试过dsh web模式）

| Skill | 作用 |
|---|---|
| `/whale-tank-init` | 初始化项目：已有 `.sandbox/state.json` → 升级知识包；空目录 → init；非空未初始化 → 拒绝 |
| `/whale-tank-vet` | 第三方插件体检，三阶段走完 |

工具是**惰性注册**的：skill 触发的那一轮才进作用域，随会话结束注销，其余时间**零**上下文注入——不打扰，无残留。

### 实机疑难排查

- **`.wttools` 命令不在 PATH 也没关系**：`.wttools` 是自包含工具（零依赖单文件），在项目文件夹里直接敲 `.wttools\status` 等即可，不需要全局安装。
- **骨架生成后 build 报 tsc 不存在**：脚手架不含依赖，先 `npm install`（或 `.wttools\deps`）再 `npm run build`。

## 📄 License

[MIT](LICENSE) © 2026 swell05
