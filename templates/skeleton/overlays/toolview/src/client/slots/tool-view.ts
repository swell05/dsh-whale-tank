// Toolview 视图槽（capability: toolview）。
// slot key 与工具名一致：工具 `hello` 的视图用 key `hello`。
// 接线：客户端运行时把视图注册到对应 slot（dsh.client inject 需含 UI 槽服务，
// 骨架不硬依赖官方 UI 包——开发者接线时按需追加）。
export const TOOL_VIEW_KEY = 'hello'

export interface ToolViewSlot {
  key: string
  render: () => unknown
}

export const toolViewSlot: ToolViewSlot = {
  key: TOOL_VIEW_KEY,
  render: () => null,
}
