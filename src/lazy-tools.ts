import type { Context } from '@deepseek-ai/cordis'
import {
  initTool,
  upgradeTool,
  vetDynamicTool,
  vetReportTool,
  vetStaticTool,
} from './tools/definitions.ts'

/**
 * 用户手动触发 skill 的那一轮，把对应工具按 agent 惰性注册进作用域。
 *
 * 实机修正（2026-08-19）：注册必须发生在 **`agent/inbox/inserted`**（消息
 * 入队时），而不是 `agent/pre-step`——`dsh-agent-loop` 的 `preStep()` 里
 * `systemPrompt.assemble()`（工具目录快照）先于 pre-step waterfall 执行，
 * pre-step 里注册对本轮目录无效。inbox/inserted 由 fused dispatcher 注入
 * `agent` 主体，且早于 assemble。
 *
 * 每 agent 幂等一次，disposer 随 agent.ctx 生命周期（会话结束）注销。
 */

export const SKILL_TOKENS = ['whale-tank-init', 'whale-tank-vet'] as const
export type SkillTrigger = (typeof SKILL_TOKENS)[number]

/** 与 dsh-tool-skill 的 gesture boundary 一致：消息里空白边界的 /name 标记。 */
export function detectSkillTrigger(
  messages: Array<{ content?: unknown; source?: { kind?: string } }>,
): SkillTrigger | null {
  for (const message of messages) {
    if (message.source?.kind !== undefined && message.source.kind !== 'user') continue
    const match = /(?:^|\s)\/(whale-tank-init|whale-tank-vet)(?=\s|$)/.exec(messageText(message))
    if (match !== null) return match[1] as SkillTrigger
  }
  return null
}

/** UserMessage.content 是 ContentBlock[]（dsh-llm 实测）；兼容字符串输入。 */
function messageText(message: { content?: unknown }): string {
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => (block as { type?: string }).type === 'text')
    .map((block) => (block as { text?: string }).text ?? '')
    .join('\n')
}

const TOOLS_BY_SKILL: Record<SkillTrigger, unknown[]> = {
  'whale-tank-init': [initTool, upgradeTool],
  'whale-tank-vet': [vetStaticTool, vetDynamicTool, vetReportTool],
}

export function registerLazyTools(ctx: Context): void {
  const registered = new Set<object>()
  const host = ctx as unknown as {
    on: (name: string, listener: (...args: unknown[]) => unknown) => void
    logger?: { warn?: (message: string) => void }
  }
  host.on('agent/inbox/inserted', (payload) => {
    const { agent, message } = payload as {
      agent: { ctx: Context }
      message?: { content?: unknown; source?: { kind?: string } }
    }
    if (message === undefined) return
    const trigger = detectSkillTrigger([message])
    if (trigger === null || registered.has(agent)) return
    const registry = (agent.ctx as unknown as {
      tools?: { register: (tool: unknown) => unknown }
    }).tools
    if (registry === undefined) {
      host.logger?.warn?.('whale-tank: agent.ctx.tools 不可用，惰性注册已跳过')
      return
    }
    for (const tool of TOOLS_BY_SKILL[trigger]) registry.register(tool)
    registered.add(agent)
  })
}
