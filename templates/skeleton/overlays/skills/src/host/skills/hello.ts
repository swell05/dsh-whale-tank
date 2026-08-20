// 插件级 skill（capability: skills；结论：包内嵌 .agents/skills 不被 dsh 发现，
// 官方形态是运行时 ctx.skills.register）。
// 开发者接线：inject 已含 'skills'，在入口 apply 里注册。
export const HELLO_SKILL = {
  name: 'hello-skill',
  description: '样例 skill：在入口注册到 ctx.skills',
} as const
