// DSH client-only plugin host loader stub: 纯转发，无 host 业务逻辑。
// client-only 插件不进层栈（无 dsh.bundle）；由 profile 用户 patch 层的
// insert 行接入。此入口仅让包可被 host 加载、声明 dsh.client。
import type { Context } from '@deepseek-ai/cordis'

export const name = '{{name}}'

export const inject: string[] = [{{inject_list}}]

export function apply(ctx: Context) {
  ctx.effect(() => {
    ctx.logger?.info?.('{{name}} loader stub active')
    return () => {}
  })
}
