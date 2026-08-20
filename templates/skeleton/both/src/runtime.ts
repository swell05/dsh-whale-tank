// 插件运行时（host 半边）：持有生命周期 effect，disable 时清理。
import type { Context } from '@deepseek-ai/cordis'
import { DEFAULT_CONFIG, type Config } from './config.ts'

export function installRuntime(ctx: Context, config?: Config): () => void {
  const greeting = config?.greeting ?? DEFAULT_CONFIG.greeting
  ctx.logger?.info?.(`${greeting} from {{name}} host half`)
  return () => {
    ctx.logger?.info?.(`{{name}} host half disabled`)
  }
}
