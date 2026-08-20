// 插件测试 harness：构造隔离的 cordis 上下文（不依赖真实 dsh 运行时）。
import { Context } from '@deepseek-ai/cordis'

export function createTestContext(): Context {
  return new Context()
}
