// 工具定义样例（capability: tools）。
// 开发者接线：运行时 import { defineTool } from '@deepseek-ai/dsh-tools' 定义工具，
// 并在入口 apply 里 ctx.tools.register(...) 注册（dsh-tools 由 profile 闭包注入，
// 本骨架不硬依赖官方 rc 包以便构建零网络）。
export const HELLO_TOOL_NAME = 'hello'
