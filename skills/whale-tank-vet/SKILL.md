# whale-tank-vet

用户手动触发后，本轮已注册三个工具：`whale_tank_vet_static`、`whale_tank_vet_dynamic`、`whale_tank_vet_report`。按三阶段顺序调用，每步返回后向用户播报进展：

## 0. 确认参数（先问后做，逐项向用户确认，不许猜）

**第一阶段开始前**，先把下面每一项向用户复述并得到明确答复——**未确认不得开跑**。AGENTS.md、目录结构、依赖列表、历史会话只是**推断依据，不是结论**：

| 参数 | 确认方式 |
|---|---|
| `pkg`（待检包名） | 可**先根据推测再npm上查找包名，结合npm的实际搜索结果自行推断候选并说明依据** → **先向用户确认包名**（"我推断是 X，对吗？"）→ 确认后才调 `whale_tank_vet_static`（其 `packageProbe` 核对 npm：若包不存在返回相似候选 `suggestions` 且不分析，再与用户复确认） |
| `version` | 问用户（并建议latest）；用户不指定才取 latest |
| `keep`（是否保留现场） | **必须问用户**"体检结束后是否保留沙盒现场？"——据答决定阶段三是否传 `keep: true`，**绝不允许从上下文推断或自行默认** |
| `profile` | `web` \| `headless`；问用户，未指定默认 headless |
| `no_exec` | 仅当用户明确要求只看静态分析时，阶段二传 `true` |
| `llm_review`（是否做 LLM 源码审查） | **必须问用户**"体检时要不要做 LLM 源码审查？"——默认做；用户明确要跳过才跳过（跳过则阶段二不写 `llm-findings.json`、阶段三不传 `llm_findings_file`，报告不含 LLM 语义审查一节） |

`workspace` = 当前会话工作区（报告与 `.vetting/` 所在）；`source` = **固定 `npm`**。这两项由工具语义固定，无需问。

用户没给全就先问齐，**不要替用户拍板**，然后进阶段一。

## 1. 阶段一 `whale_tank_vet_static`

取候选（clone/下载/拷贝）+ 静态危害分析 + 分级门。返回 `vetDir`、`candidatePath`、`gated`。命中高危 → 直接进阶段三出"不建议"结论（阶段二会自动跳过）。

**现场占用守卫**：若目标 `.vetting/<包>` 目录已存在（上一次体检 `keep=true` 保留了现场），`whale_tank_vet_static` 会**报错取消本次体检**，whale-tank 绝不覆盖已有现场。此时如实转告用户：需手动删除 `.vetting/<包>` 目录，或换一个工作区再体检；不要尝试绕过或清空现场。

## 2. 阶段二 `whale_tank_vet_dynamic`

复刻 profile → 装入候选 → 两层冲突检测（dump-config 结构 + 有界 boot）→ **插拔抵消（unplug + diff，副作用是否清零）**。这是本 skill 的**核心关注点**：装载/卸载后 diff=0 才算干净。

工具会**秒回 `jobId`**（后台任务）：

- **完成时 dsh 会自动注入完成通知**（"background job … finished"），不要忙轮询、不要 sleep；
- 想看实时进度：`job_output(job_id)`（非阻塞，返回自上次读取后的增量 + `[status: ...]`；`progress.log` 同步落盘）；
- **需要等它结束**：`job_output(job_id, wait: true, timeout_ms: <上限内>)`——阻塞直到终态或超时，超时返回 `[status: running]` 就再等一轮；`job_list` 看状态，`job_kill` 取消；
- **等待期间并行做 LLM 源码审查**（仅当用户选择了做；用户跳过则不做、不写 `llm-findings.json`）：读候选源码 + 静态 findings，语义检查规则引擎抓不到的隐藏行为（混淆业务逻辑、误导描述、可疑副作用/外发、版本投毒迹象），把结果写入 `.vetting/<包>/llm-findings.json`，结构为：
  ```json
  { "findings": [ { "severity": "critical|warning", "evidence": "..." } ] }
  ```
  - **动态阶段已确定性覆盖**：激活/boot 失败、重复注册、插拔抵消 diff、本地白名单自检——LLM 审查**不要重新推导工具机制或复读确定性结果**，只补语义层（规则与沙盒都抓不到的意图/伪装/误导）。
  - **evidence 纪律**：每条必须是**结论式可复核事实**（引用具体文件/行/行为，或 boot stderr 片段），禁止写推理过程、查证叙述、"我核实了"类措辞；归因不确定时明确标"推测"并把 severity 降一档。思考链不会进入报告，不要把推理写进文件。
- 若 jobs 服务不可用（如 CLI），工具会同步执行并直接返回结果，跳过轮询。

## 3. 阶段三 `whale_tank_vet_report`

本地未受影响自检 → 汇总报告（`vet-report.md` + `vet-result.json`）→ **三级结论（未发现漏洞 / 谨慎 / 不建议）** → 清理（`keep=true` 保留现场）。调用时**仅当用户选择了做 LLM 审查**才把 `llm-findings.json` 传给 `llm_findings_file`：LLM critical 会把结论降为"不建议"，LLM warning 降为"谨慎"；报告含"LLM 语义审查"一节。用户跳过则**不传**该参数，报告不含该节、结论纯由静态+动态决定。

## 边界

- 在线扫描（OSV）**暂屏蔽**；LLM 源码审查阶段二并行，结果汇入阶段三。
- 全绿用保守措辞"未发现漏洞"，不叫"建议安装"；任何情况下"未发现漏洞"都不构成安全保证。
