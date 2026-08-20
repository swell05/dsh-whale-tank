// DSH both plugin host half (contract A: main → lib/index.js).
// 注册都是 effect：用 ctx.on / ctx.effect 持有生命周期，disable 时清理。
import type { Context } from '@deepseek-ai/cordis'
import type { Config } from './config.ts'
import { installRuntime } from './runtime.ts'
import type { EchoRequest } from './types/shared.ts'

export const name = '{{name}}'

export const inject: string[] = [{{inject_list}}]

export function apply(ctx: Context, config?: Config) {
  ctx.effect(() => installRuntime(ctx, config))
}

// 共享类型仅类型零运行时：host 侧消费示例（编译期校验，无运行时产物）。
export type { EchoRequest, EchoResponse } from './types/shared.ts'
