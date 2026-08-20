// 插件运行时：持有生命周期 effect，disable 时清理。
import type { Context } from '@deepseek-ai/cordis'
import { DEFAULT_CONFIG, type Config } from './config.ts'

export function installRuntime(ctx: Context, config?: Config): () => void {
  const greeting = config?.greeting ?? DEFAULT_CONFIG.greeting
  ctx.logger?.info?.(`${greeting} from {{name}}`)
  return () => {
    ctx.logger?.info?.(`{{name}} disabled`)
  }
}
