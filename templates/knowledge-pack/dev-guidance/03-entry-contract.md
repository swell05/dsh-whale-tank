# Cordis entry 契约

<!-- whale-tank-knowledge-pack: v0.1.6 -->

## 最小形状

```js
export const name = 'my-plugin'
export const inject = ['tools']        // ctx.get 用到的全部服务必须声明
export function apply(ctx) {
  // 注册都是 effect：ctx.on / ctx.effect 持有生命周期，disable 时清理
}
```

## 要点

- **严格注入**：`ctx.get` 访问未在 `inject` 声明的服务 → `cannot get property without inject`，apply 开头即抛、整个 effect 不注册。
- 工具注册：`ctx.tools.register(defineTool({...}))`（见 04）；能力上限是完整 Cordis——事件（`ctx.on`）、服务（`ctx.provide`）、命令、system prompt 无需额外声明。
- 依赖解析：entry 可 import 官方包（`@deepseek-ai/*`、`cordis`），由 profile pnpm 闭包注入；**不要把这些包写进 `dependencies`**（公共 npm 解析不到反而失败）。
- patch 挂载：bundle 形态在包内 `cordis.patch.yml` 声明挂载自身；纯 cordis 插件在 profile `cordis.patch.yml` 写 insert 行。

## Skill 注册（runtime skill，rc.8 实测）

插件级 skill 的权威形态（vision-toolkit 同款）：正文打包在包内，`apply` 时经 `ctx.skills.register` 注册，随插件卸载自动注销（返回 disposer，用 `ctx.effect` 持有）。

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'

export const MY_SKILL: SkillRegistration = {
  name: 'my-skill',                 // kebab-case，/ 命令名
  description: '模型/发现 UI 看到的摘要',
  whenToUse: '可选：路由提示',
  source: 'runtime',
  resourceBase: { kind: 'directory', path: fileURLToPath(new URL('../skills/my-skill/', import.meta.url)) },
  content: readFileSync(new URL('../skills/my-skill/SKILL.md', import.meta.url), 'utf8'),
  invocation: { modelInvocable: false, userInvocable: true }, // 省略 = 两者都开
}
// inject: ['skills']；apply 内：
// ctx.effect(() => ctx.skills.register(MY_SKILL))
```

要点：
- **`invocation` 是两面开关**：`userInvocable: true` → web 输入框以 `/my-skill` 出现，用户敲下后 `dsh-tool-skill` 在 pre-step 把 `<skill_content>` 注入模型上下文；`modelInvocable: true` → 模型可在 `skill` 工具目录里按名加载（内容按需取，节省上下文）。
- **用户触发的那一轮要用的工具，需在消息入队时按 agent 惰性注册**（`agent.ctx.tools.register`，监听 `agent/inbox/inserted`）：skill 是纯指令，不能注册工具；且工具目录在 pre-step 内 `assemble()` 时已快照，pre-step 里注册对本轮无效（@swell05/dsh-whale-tank 的 `src/lazy-tools.ts` 即此模式，实机修正 2026-08-19）。
- 文件系统 skill 的 frontmatter 策略见 01；运行时注册的 invocation 不读 frontmatter。

## 挂载失败排查顺序（详见 06）

`exports["."]`/`main` 入口错误 → inject 缺失 → 依赖解析失败 → insert 行 `name:` 未加引号（YAML `@` 开头是保留指示符）。
