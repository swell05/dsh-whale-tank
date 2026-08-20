# 三层测试纪律

<!-- whale-tank-knowledge-pack: v0.1.6 -->

插件测试不能停在"模块能加载"。

## 第一层：纯函数单测（vitest）

业务规则全分支、零运行时依赖、毫秒级。决策/计算逻辑与 dsh 解耦成纯函数（如 `decideEffort`），覆盖：全新提示基线 / 降档 / 禁用降档 / 超大载荷 / 混合工具等分支。

## 第二层：waterfall 契约测试

最小 Context 替身捕获监听器，不启动 dsh、不需要 API Key。必测：

- `await next()` 透传，seed 的 provider/model/tools 字段保留；
- 只注册一个监听器、只读取相关事件窗口；
- 下游 waterfall 抛错原样上抛，不静默吞错。

```js
const result = await runRegisteredHandler(ctxStub, async () => seed)
expect(result).toEqual({ ...seed, reasoningEffort: 'high' })
```

## 第三层：实机验证（真实 agent 循环）

契约测试证明边界正确，但不替代真实运行时：挂载 → 重启 → 发任务 → 看 dsh 进程日志（如 `[speed-plugin] agent/request: calls=[] => reasoningEffort=high`）。真实会话验证留人工（凭据一次性注入、用后即清）。

## 模型能力表适配（真实踩坑）

降档目标先查当前适配器能力表（如 deepseek-official 只有 off/high/max）——`low` 不支持时回退 `high`，否则请求报 `does not support reasoning effort "low"`（适配器缺口，非插件 bug）。
