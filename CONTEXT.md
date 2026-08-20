# @swell05/dsh-whale-tank 上下文

@swell05/dsh-whale-tank 是一个 DSH 插件（agent 工具 + CLI 薄壳），为插件开发者提供沙盒化的初始化、依赖安装、插拔测试与复原能力，并为第三方插件提供不污染本地环境的体检（vet）能力。

## Language

**地图**:
一次大型工作的决策路线图（wayfinder 产物，位于 `.scratch/<effort>/map.md`），指向一个明确的"终点"。
_Avoid_: 计划书、roadmap

**终点**:
地图结束时交付的东西。本项目 = 一份可直接开工的 v1 开发计划——非玩具，须经真实环境验证可跑。
_Avoid_: 目标、愿景

**知识包**:
init 时写入被初始化工作区的提炼后开发约束集，来自 `.doc/` 的官方契约、踩坑记录与测试纪律。是本插件的核心价值之一。写入采用**增量合并**：不覆盖工作区已有内容，只在缺失时写入、保留用户改动、冲突时告警。带 [[dshBaseline]] 版本锚。
_Avoid_: 注意事项文档、参考资料

**三形态**:
插件运行时归属的官方三分类：host（仅 Node 后端，`dsh.bundle.patch`）/ client（仅浏览器，仅 `dsh.client`，不进 host 层栈）/ both（两端都声明）。v1 的 `web` = both 的废弃别名（带 host stub，映射 both，行为零漂移）。
_Avoid_: 类型（泛化时）、web（已废弃的旧值）

**capabilities（能力）**:
正交于三形态的能力维度枚举（skills/tools/commands/mcp-client/mcp-server/cli/toolview）。init 时由调用 agent 从描述推导传入，计划回显接线说明，非法形态组合硬校验拒绝。
_Avoid_: 特性、功能开关

**惰性对齐**:
init 骨架生成策略：命名与分层全面采纳官方模板（config/runtime/invariant/src/host|client|cli|types/tests/harness），但只生成 type+capabilities 实际用到的文件，不预生成空占位目录。
_Avoid_: 全量模板

**dshBaseline**:
知识包的版本锚元数据（当前 rc.8）。status 检测本机 dsh 更新时软提示"知识包可能滞后"，不告警、不阻断。
_Avoid_: 版本锁定

**纯净体检**:
vet 的 clean 环境：官方模板原样基线（零本地插件、零用户 patch）验证候选插件自身质量（vanilla 可用 + 插拔无残留）；永远运行，失败即结论"不建议"并跳过复刻体检。
_Avoid_: 干净环境、白盒测试

**复刻体检**:
vet 的 replica 环境：复刻本地 profile（含自定义插件）测候选与现有环境的冲突。本地已装同名同版（按 profile 判定）时跳过，三处提示 + `--env both` 强制。
_Avoid_: 环境复刻（泛化）

**升级模式**:
复刻体检在"本地已装同名但版本不同"时的形态：同名依赖条目被候选版本覆写（pnpm 同名 add 是替换语义，非并存），其余本地插件原样保留；嵌套钉版冲突（其他插件 pin 旧版）如实报告不掩盖。
_Avoid_: 版本替换、并存测试

**plug-test**:
一发插拔复原合成命令：plug → 分型冒烟 → unplug → diff；diff≠0 时残留证据先落袋再自动 restore（`--no-restore` 保留现场）。日常开发主循环命令；plug/unplug 降为真实会话长测的基元。
_Avoid_: 自检（与内部复原自检区分）、循环测试

**启动通道**:
whale-tank 的启动形态：skill 惰性触发（agent 面，主通道：init/vet）/ 项目内 `.wttools` 工作区工具（人类日常入口）。`dsh whale-tank` boot 参数与独立 bin 不在用户面提供（保留作排障/脚本兜底）；CLI 不提供 init——项目由 skill 创建。
_Avoid_: 入口（泛化）

**工作区工具 (.wttools)**:
init 随沙盒打包进项目 `.wttools/` 的零依赖命令行工具：单文件 CLI（wttools/whale-tank.cjs，只留 node 内建）+ 每命令 shim（Windows .cmd + Unix sh，把项目根烘焙进 --project）。9 个 workspace 命令：status/deps/plug/plug-test/unplug/restore/reset/upgrade-knowledge/run-test。自包含——插件卸载后仍可用，取代「装一个全局 whale-tank 命令去敲」。
_Avoid_: CLI（不加"工作区工具"限定）、命令

**上下文预算**:
知识包的硬约束：被初始化工作区里 agent 的上下文不能塞满。必读入口（AGENTS.md）保持短小，细节全部下沉到 references 按需读取；宁可少写，不追求全量。
_Avoid_: 文档精简（不加"预算"语义时是通用概念）

**沙盒**:
插件项目内 `.sandbox/` 的独立 DSH_HOME 开发环境，隔离 sessions、凭据与自定义插件，服务于项目自身开发。基线**同时物化 web + headless 双 profile**（run-test 可任选其一实跑），`state.sandbox.profile` 仍是主 profile（status/plug/冒烟默认）。
_Avoid_: 测试环境、虚拟环境

**体检沙盒**:
`<调用时工作区>/.vetting/<包名>-<版本>/` 的临时复刻环境，用于第三方插件预检，默认验证完即焚（报告保留）。**现场占用守卫**：目标目录已存在（上一次 keep=true 保留了现场）时新体检直接取消，绝不覆盖现场——需手动删除或换工作区。
_Avoid_: 沙盒（不加限定词时仅指开发沙盒）

**铁律**:
7 条不可违反的沙盒纪律：只操作沙盒 DSH_HOME、显式覆盖 DSH_HOME、沙盒端口避开 3080、不写真实凭据、删除前 ask_user、版本一致性、vet 执行边界。
_Avoid_: 规则、约束（不加限定词）

**双通道依赖**:
依赖安装的两种去向：插件依赖 → 沙盒 profile（经 `dsh plugin add` 对账进 bundles）；普通 npm 库 → 项目 package.json。
_Avoid_: 依赖安装

**插拔**:
plug（把目标插件接入沙盒并冒烟）与 unplug（移除并对账）的合称；以"拔后状态 vs 插前快照"的 diff 判定 clean/dirty。
_Avoid_: 挂载/卸载（与 dsh 配置挂载语义混淆）

**run-test**:
实跑命令——把开发中的插件注入沙盒**指定 profile** 并前台 boot（profile 决定启动形态，不限定 web/headless 预设），Ctrl+C 结束自动 remove + diff 复原（diff≠0 证据落袋 + 复原该 profile）。默认 profile=web、端口 13080、可覆盖；全程显式沙盒 DSH_HOME + profile 路径断言，绝不允许逃逸到真实 ~/.dsh。
_Avoid_: 实机测试（泛化）、挂载运行

**快照**:
插拔前对 profile 文件、node_modules 顶层清单与 state.json 的采集；快照 diff 是副作用检测的唯一事实来源。
_Avoid_: 备份

**两级复原**:
restore（回拷最近快照并重建 node_modules）与 reset（删除 `.sandbox/` 整体重建）两种复原级别。
_Avoid_: 还原、回滚

**版本模式**:
沙盒运行 dsh 的两种模式：local（复用全局 dsh，版本只记录不强制）与 standalone（`.sandbox/dsh-install/` 内独立副本钉版）。
_Avoid_: 版本管理

**vet**:
第三方插件预检：复刻目标 profile → 静态危害分析 → 受限动态验证 → 冲突检测 → 插拔抵消 → 报告（建议安装/谨慎/不建议）。
_Avoid_: 安全扫描、体检（单独使用时与"体检沙盒"区分）

**状态机**:
沙盒的 plugState：`clean --plug--> plugged --unplug+diff=0--> clean`；任一步 diff≠0 即 dirty（告警并可 restore）。
_Avoid_: 状态

**自证（dogfooding）**:
用本插件自己初始化一个示例插件项目，并在沙盒里真实跑通 plug → 冒烟 → unplug → diff=0 → clean 的完整生命周期；v1 发布门禁，非可选。
_Avoid_: 端到端测试（不加"自证"限定）
