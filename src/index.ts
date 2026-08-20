import type { Context } from '@deepseek-ai/cordis'
import { runCliInvocation, parseCliArgs } from './core/cli-run.ts'
import { registerLazyTools } from './lazy-tools.ts'
import { SKILL_REGISTRATIONS } from './skills.ts'

/**
 * @swell05/dsh-whale-tank host half：不注册任何 agent 工具/本地命令。
 * 唯一职责：
 * 1. 消息入队监听——用户触发 `/whale-tank-init` / `/whale-tank-vet` 的
 *    那一轮把对应工具按 agent 惰性注册进作用域；
 * 2. `dsh whale-tank <verb>` 启动参数形态（保留，非 web 斜杠命令）。
 */
export const name = 'dsh-whale-tank'

export const inject = ['skills', 'cmdlineArgs']

export function apply(ctx: Context) {
  const skills = (ctx as unknown as {
    skills: { register: (reg: unknown) => () => void }
  })
  const effect = (ctx as unknown as {
    effect: (fn: () => () => void) => unknown
  }).effect
  for (const registration of SKILL_REGISTRATIONS) {
    effect(() => skills.skills.register(registration))
  }
  registerLazyTools(ctx)

  const cmdline = (ctx as unknown as { cmdlineArgs?: { get(): string[] } }).cmdlineArgs
  const argv: string[] = cmdline?.get() ?? []
  if (argv[0] === 'whale-tank') {
    void dispatch(argv.slice(1), ctx)
  }
}

async function dispatch(args: string[], ctx: Context): Promise<void> {
  try {
    const outcome = await runCliInvocation(parseCliArgs(args))
    console.log(outcome.text)
    process.exitCode = outcome.exitCode
  } catch (error) {
    console.error(`whale-tank 命令失败：${String(error)}`)
    process.exitCode = 1
  } finally {
    const probe = ctx as unknown as {
      get?: (key: string, strict?: boolean) => unknown
      fiber?: { state?: number }
    }
    const exit = probe.get?.('appExit')
    const code = process.exitCode ?? 0
    if (typeof exit === 'function') {
      exit(code)
    } else if (probe.fiber?.state === 4 || probe.fiber?.state === 5) {
      process.exit(code)
    } else {
      console.warn(`whale-tank 命令：未找到 appExit（fiber state=${probe.fiber?.state}），跳过显式退出。`)
    }
  }
}
