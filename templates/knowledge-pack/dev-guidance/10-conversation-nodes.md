# 会话业务节点（web 插件，二级参考）

<!-- whale-tank-knowledge-pack: v0.1.6 -->

给 Web Chat 视图加一行业务数据。

## 设计可重放的事件族

- 选一个稳定业务 id（如 `reviewId`），所有相关事件携带或可独立推导；客户端绝不按"最新未完成 Context"乱认领。
- `(kind, id)` 至多一个 start 事件；增量事件可重放（按 log seq 升序确定性还原），不依赖 live 内存。
- 终端/检查点事件要带足整体 fallback 状态，别靠扫描无关事件恢复。

## Definition 骨架

`ConversationNodeDefinition`：`match`（身份提取器，只读当前事件）→ `start` / `update`（返回 State）→ `publication`（immediate / animation-frame / none）→ `buildLocationData` / `buildViewNode`（keyed 渲染数据）。`target: 'chat'` 与 `buildViewNode` 必须成对出现；节点发布后保持同 key，暂时离开用 `visibility: 'hidden'`。

## 三条摄取路径

replace（重建窗口重放）/ prepend（只重放新事件并重跑受影响 Context）/ append（每事件 D 次 match + 常量时间查 key）。**勿在 append 路径遍历事件窗口/Contexts/渲染节点**——用 State 累积、Location data 共享、`reader.previous()` 取前序业务状态。

## 验证清单（6 点）

完整窗口 replace 结果正确；update-only 尾保持 pending 且补 start 后一致；history + live append 与合并窗口重放一致；prepend 不替换未变化节点；动画帧节流；renderer 只用 `node.data` 与受限 hooks。
