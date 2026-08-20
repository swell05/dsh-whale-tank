import readline from 'node:readline/promises'
import { planInit, runInit } from './init.ts'
import { parseCapabilities, validateCapabilities } from './capability.ts'
import type { Capability } from './capability.ts'
import type { CliOutcome } from './cli-run.ts'
import type { ProjectType } from './types.ts'

/** npm 包名规范校验（实时校验；小写、无空格、可含 -/._）。 */
export function isValidPackageName(name: string): boolean {
  return /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(name) && !name.includes('__')
}

const TYPE_HELP: Record<ProjectType, string> = {
  host: 'host：仅 Node 后端（工具/命令/服务），无浏览器半边',
  client: 'client：仅浏览器 client 半边（无 host 业务逻辑）',
  both: 'both：host 半边 + client 半边 + 共享类型',
  web: 'web：both 的旧别名（已弃用）',
}

/** 每类型的合法能力列表（非法组合在向导内就选不到）。 */
export function capabilitiesForType(type: Exclude<ProjectType, 'web'>): Capability[] {
  const all: Capability[] = ['skills', 'tools', 'commands', 'mcp-client', 'mcp-server', 'cli', 'toolview']
  const validation = validateCapabilities(type, all)
  if (validation.ok) return all
  const rejected = new Set<string>()
  for (const reason of validation.reasons) {
    const match = /能力 (\S+) 属于/.exec(reason)
    if (match !== null) rejected.add(match[1])
  }
  return all.filter((cap) => !rejected.has(cap))
}

export interface WizardAnswers {
  name: string
  type: Exclude<ProjectType, 'web'>
  description: string
  capabilities: Capability[]
  version: string
  knowledgePack: boolean
}

export interface WizardCollectOptions {
  /** step ⑦ 确认前展示（用已收集的答案生成计划三件套预览）。 */
  beforeConfirm?: (answers: {
    name: string
    type: Exclude<ProjectType, 'web'>
    description: string
    capabilities: Capability[]
    version: string
    knowledgePack: boolean
  }) => string
}

/**
 * 7 步收集向导答案（可注入 ask 以单测）。返回 null = 用户中途放弃。
 */
export async function collectWizardAnswers(
  ask: (prompt: string) => Promise<string>,
  options: WizardCollectOptions = {},
): Promise<WizardAnswers | null> {
  // ① 项目名（实时校验 npm 包名规范）
  let name = ''
  while (name === '' || !isValidPackageName(name)) {
    name = await ask('① 项目名（npm 包名，小写；如 dsh-my-plugin）: ')
    if (!isValidPackageName(name)) {
      process.stderr.write('    ✗ 包名须小写、无空格、可含连字符/下划线。\n')
    }
  }

  // ② 类型单选（带人话说明）
  const typeAnswer = await ask(
    `② 插件类型（host | client | both，web 是 both 旧别名）:\n    ${Object.entries(TYPE_HELP)
      .filter(([k]) => k !== 'web')
      .map(([, v]) => `  - ${v}`)
      .join('\n')}\n  输入类型: `,
  )
  const type = (typeAnswer === 'web' ? 'both' : typeAnswer) as Exclude<ProjectType, 'web'>
  if (!['host', 'client', 'both'].includes(type)) {
    process.stderr.write(`    ✗ 类型 ${typeAnswer} 无效。\n`)
    return null
  }

  // ③ 描述（可选，回车跳过）
  const description = await ask('③ 功能描述（可选，回车跳过）: ')

  // ④ capabilities 多选（按已选类型过滤合法项）
  const legal = capabilitiesForType(type)
  const capsRaw = await ask(
    `④ capabilities（逗号分隔；可用: ${legal.length > 0 ? legal.join(', ') : '（无）'}；回车跳过）: `,
  )
  let capabilities: Capability[] = []
  if (capsRaw.trim() !== '') {
    try {
      capabilities = parseCapabilities(capsRaw).filter((cap) => legal.includes(cap))
    } catch (error) {
      process.stderr.write(`    ✗ ${String(error)}\n`)
      return null
    }
  }

  // ⑤ dsh 版本（默认 local 回车即过；输版本号 → standalone）
  const version = await ask('⑤ dsh 版本（回车用本机 local；输版本号将 standalone）: ')

  // ⑥ 三层知识包（默认写；n/N → 知识自由模式只生成骨架）
  const knowledgeRaw = await ask(
    '⑥ 写入三层知识包（AGENTS.md/NOTES.md/docs/dev-guidance）？(Y/n，回车默认写) : ',
  )
  const knowledgePack = !['n', 'N', 'no', 'NO'].includes(knowledgeRaw.trim())

  // ⑦ 计划展示 + 确认执行（CLI 面 ask_user 门）
  const preview = options.beforeConfirm?.({ name, type, description, capabilities, version, knowledgePack })
  process.stderr.write(`\n— 计划 —\n${preview ?? ''}\n`)
  const confirm = await ask(
    `生成 DSH ${type} 插件「${name}」${description !== '' ? `：${description}` : ''}，capabilities: ${capabilities.join(', ') || '（无）'}${knowledgePack ? '' : '（知识自由模式，不写知识包）'}。\n确认执行？(y/N): `,
  )
  if (!['y', 'Y', 'yes'].includes(confirm)) {
    return null
  }

  return { name, type, description, capabilities, version, knowledgePack }
}

/** 交互式 init 向导：无参 + TTY 时 7 步走通。 */
export async function runInitWizard(opts: {
  project: string
  globalRoot: string
}): Promise<CliOutcome> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  const ask = async (prompt: string): Promise<string> => (await rl.question(prompt)).trim()
  try {
    const answers = await collectWizardAnswers(ask, {
      beforeConfirm: (collected) => {
        const plan = planInit({
          name: collected.name,
          type: collected.type,
          description: collected.description,
          capabilities: collected.capabilities,
          knowledgePack: collected.knowledgePack,
        })
        return (
          `目录计划：\n- ${plan.directoryPlan.join('\n- ')}\n` +
          `依赖建议：\n- ${plan.dependencySuggestions.join('\n- ')}`
        )
      },
    })
    if (answers === null) {
      return { text: '向导中止：已放弃，未落盘。', exitCode: 1 }
    }
    const report = await runInit({
      project: opts.project,
      name: answers.name,
      type: answers.type,
      description: answers.description,
      capabilities: answers.capabilities,
      requestedVersion: answers.version === '' ? null : answers.version,
      globalRoot: opts.globalRoot,
      knowledgePack: answers.knowledgePack,
      yes: true,
    })
    const lines = [`init 完成：${report.skeletonFiles.length} 个骨架文件。`]
    for (const warning of report.warnings) lines.push(`⚠ ${warning}`)
    return { text: lines.join('\n'), exitCode: 0 }
  } finally {
    rl.close()
  }
}
