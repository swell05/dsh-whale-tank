// DSH host plugin entry (contract A: main → lib/index.js).
// 注册都是 effect：用 ctx.on / ctx.effect 持有生命周期，disable 时清理。
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config.ts'
import { installRuntime } from './runtime.ts'

export const name = '{{name}}'

export const inject: string[] = [{{inject_list}}]

export function apply(ctx: Context, config?: Config) {
  ctx.effect(() => installRuntime(ctx, config))
}
