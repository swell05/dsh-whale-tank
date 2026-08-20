import { plug, unplug, type UnplugResult } from './plug.ts'
import { restore } from './restore.ts'
import { sandboxSelfCheck } from './sandbox.ts'
import { readState } from './state.ts'
import type { ToolContextLike } from './types.ts'

export interface PlugTestResult {
  ok: boolean
  exitCode: number
  stages: { plug: boolean; unplug: boolean; restore: boolean }
  smoke: { ok: boolean; reason: string | null }
  /** diff≠0 时的残留清单（证据先落袋，自动复原不吞诊断）。 */
  residualItems: string[]
  restored: boolean
  report: string[]
}

/**
 * plug-test（设计 §13.4）：一发插拔复原合成命令，日常开发主循环。
 *
 * 前置 status 须 clean → plug（快照/构建/分型冒烟）→ unplug（remove/diff）。
 * diff=0 → 报告各阶段，exit 0；diff≠0 → 残留清单完整进报告 →
 * 自动 restore（现场备份在 snapshots，证据不丢）→ 复验冒烟 → 终态 clean，
 * exit 1（测试仍算失败）。`--no-restore` 保留 dirty 现场。
 */
export async function plugTest(
  project: string,
  opts: {
    globalRoot: string
    noRestore?: boolean
    build?: boolean
    ctx?: ToolContextLike
  },
): Promise<PlugTestResult> {
  const state = readState(project)
  if (state.plugState.status !== 'clean') {
    throw new Error(
      `plug-test 前置检查失败：plugState = ${state.plugState.status}，必须先 restore/reset 回到 clean（铁律 6）。`,
    )
  }
  const report: string[] = []
  const residualItems: string[] = []

  let plugRes
  try {
    plugRes = await plug(project, {
      globalRoot: opts.globalRoot,
      build: opts.build,
      ctx: opts.ctx,
    })
    report.push(
      `plug：快照 ${plugRes.snapshotId}，冒烟 ${plugRes.smoke.ok ? '通过' : `失败：${plugRes.smoke.reason}`}${plugRes.built ? '（已构建）' : ''}`,
    )
  } catch (error) {
    report.push(`plug 失败：${String(error)}`)
    try {
      await restore(project, { globalRoot: opts.globalRoot })
      report.push('已尝试 restore 复原（plug 失败可能已改动沙盒）。')
    } catch {
      // 快照未采集或复原失败：保留现场，如实报告。
    }
    return {
      ok: false,
      exitCode: 1,
      stages: { plug: false, unplug: false, restore: false },
      smoke: { ok: false, reason: String(error) },
      residualItems,
      restored: false,
      report,
    }
  }

  let unplugRes: UnplugResult
  try {
    unplugRes = await unplug(project, { globalRoot: opts.globalRoot })
  } catch (error) {
    report.push(`unplug 失败：${String(error)}`)
    return {
      ok: false,
      exitCode: 1,
      stages: { plug: true, unplug: false, restore: false },
      smoke: plugRes.smoke,
      residualItems,
      restored: false,
      report,
    }
  }
  report.push(`unplug：diff=${unplugRes.diff.clean ? 0 : '≠0'}，状态 ${unplugRes.status}`)
  if (!unplugRes.diff.clean) {
    // 证据先落袋：残留清单进报告，绝不自动复原前吞诊断。
    for (const warning of unplugRes.warnings) residualItems.push(warning)
    for (const item of unplugRes.diff.items) {
      residualItems.push(`[${item.category}] ${item.kind} ${item.path}：${item.detail}`)
    }
    report.push(`检测到残留（${unplugRes.diff.items.length} 项）：\n${residualItems.join('\n')}`)
  }

  if (unplugRes.diff.clean) {
    return {
      ok: true,
      exitCode: 0,
      stages: { plug: true, unplug: true, restore: false },
      smoke: plugRes.smoke,
      residualItems,
      restored: false,
      report,
    }
  }

  if (opts.noRestore === true) {
    report.push('--no-restore：保留 dirty 现场，未自动复原（plug-test 仍判失败）。')
    return {
      ok: false,
      exitCode: 1,
      stages: { plug: true, unplug: true, restore: false },
      smoke: plugRes.smoke,
      residualItems,
      restored: false,
      report,
    }
  }

  // 自动复原：restore 回拷快照（现场已在 snapshots/pre-restore 备份），复验冒烟。
  await restore(project, { globalRoot: opts.globalRoot })
  const restoredSmoke = await sandboxSelfCheck(project, { globalRoot: opts.globalRoot })
  report.push(
    `自动复原：restore 完成，复验冒烟 ${restoredSmoke.ok ? '通过' : `失败：${restoredSmoke.reason}`}，终态 clean。`,
  )
  return {
    ok: false,
    exitCode: 1,
    stages: { plug: true, unplug: true, restore: true },
    smoke: plugRes.smoke,
    residualItems,
    restored: true,
    report,
  }
}
