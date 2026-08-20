# LLM 适配器（二级参考）

<!-- whale-tank-knowledge-pack: v0.1.6 -->

## 形状

```js
class MyAdapter extends LlmAdapter {
  async * stream(options) { /* yield StreamChunk */ }
}
ctx.llm.registerAdapter(['my-provider'], new MyAdapter(...))
```

## 协议义务

- `usage` 必须在 `finish` **之前**；`finish` 后不再输出（缓冲到 provider 流尾再 flush）。
- 工具调用 `arguments` 全程是 RAW JSON 字符串，增量走 `argumentsDelta`；provider 给对象要在 block-end 重新 stringify。
- block `index` 按首现流序分配，同一 block 的 delta 复用。
- 错误只有两条路：`stream()` THROW（传输/协议，`LlmError` 稳定 code）或流尾 `finish {kind:'error'|'aborted'}`。
- 尊重 `options.signal`；不支持的能力字段（如 stop 列表）抛 `LlmError(..., 'UNSUPPORTED')`，不静默丢弃。
- 响应 id/签名等原生元数据 → `finish.replayState` 最小无损投影；跨 provider 恢复合法性由适配器自判，无 state 时禁止仅凭名称推断。
- 思考档位：`resolveModel()` 能力缝（provider/model identity + context/reasoning），`defaultEffort` 仅在确实存在时声明；适配器保持权威可选列表（含 `off`），wire 拼写不暴露。

## 结构

wire 类型 / 请求序列化 / 传输解析 / chunk 翻译 / 适配器类分离开（参考 `llm-deepseek`：直接 HTTP + SSE）。
