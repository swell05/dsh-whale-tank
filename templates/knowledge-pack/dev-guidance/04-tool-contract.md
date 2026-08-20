# 工具契约（defineTool）

<!-- whale-tank-knowledge-pack: v0.1.6 -->

## 最小形状

```js
ctx.tools.register(defineTool({
  name: 'my_tool',
  description: '模型看到的描述',
  parameters: { path: { type: 'string', required: true, description: '绝对路径' } },
  output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
  async execute(args, exec) { return readFile(args.path, { encoding: 'utf8', signal: exec.signal }) },
}))
```

## execute 契约

- 参数已按 schema 校验（类型/必填/literal/union/嵌套），execute 内只需手查 DSL 表达不了的规则（非空、正数、跨字段）。
- 返回**唯一 canonical JSON 值**（output.schema 校验后冻结）；不要返回内容块、不要让调用方解析散文取 id。
- 抛错或返回非法值 = isError；基础设施故障抛错，业务非理想状态用 canonical 值表达。
- 尊重 `exec.signal`（取消时中止在途工作）。
- `exec.agent.inject({...})` 追加**下一条**模型请求看到的上下文（不是唤醒，idle agent 保持 idle；防 disposed agent 用 try/catch）。

## UI card（presentCall/presentResult/presentationMeta）

- 卡片类型：`generic`（默认）、`terminal`（命令）、`diff`（写文件）、`search`（grep/glob 结果）、`web`（检索/抓取）。
- **纯函数纪律**：presenter 在直播与 replay 都会跑——禁止 I/O、禁止读 session、禁止 clock/random；diff 只能从 args 推导。
- UI 格式不进模型结果：`output.render` 管模型侧散文，presentationMeta + card presenter 管可重放 UI 状态。

## 长任务

`run_in_background`（配置门控）→ `ctx.jobs.start({ kind, label, owner: exec.agent, run })`；发布后生命周期归任务控制信号（`job_kill`/owner 清理），不再跟外层 `exec.signal`。

## 执行策略扩展点

`tools/pre-execute`（allow/deny/ask 策略）、`ctx.tools.guard()`（单调最终拒绝）、`tools/execute`（deadline/retry/metrics）、`tools/post-execute`（改写结果/展示）、`tools/result`（只读观察最终结果）。
