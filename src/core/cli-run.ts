import { applyDependency, classifyDependency } from './deps.ts'
import { plug, unplug } from './plug.ts'
import { plugTest } from './plug-test.ts'
import { restore } from './restore.ts'
import { runTest } from './run-test.ts'
import { upgradeKnowledgePack } from './upgrade-knowledge.ts'
import { collectStatus } from './status.ts'
import { globalNodeModulesDir } from './proc.ts'
import { resetSandbox } from './sandbox.ts'

export interface CliInvocation {
  verb: string
  flags: Record<string, string | boolean | undefined>
  cwd: string
}

export interface CliOutcome {
  text: string
  exitCode: number
}

/** 三形态共用的核心分派（agent 工具 / 独立 bin / dsh whale-tank 命令）。 */
export async function runCliInvocation(inv: CliInvocation): Promise<CliOutcome> {
  const globalRoot = await globalNodeModulesDir('dsh')
  if (globalRoot === null) {
    return { text: '错误：无法定位全局 dsh 安装（需要 dsh 在 PATH 中）。', exitCode: 2 }
  }
  const f = inv.flags
  const project = stringFlag(f, 'project') ?? inv.cwd

  try {
    switch (inv.verb) {
      case 'status': {
        const status = collectStatus(project, { globalRoot })
        if (status.plugState === 'not-initialized') {
          return { text: '未初始化：缺少 .sandbox/state.json（先 whale-tank init）。', exitCode: 1 }
        }
        const lines = [
          `项目：${status.project}（${status.projectType}）`,
          `版本模式：${status.versionMode} ｜ 声明 ${status.declaredDshVersion} ｜ 实际 ${status.actualDshVersion}`,
          `漂移：${status.versionDrift ? '是 ⚠' : '否'} ｜ 混合版本：${status.mixedVersion ? '是 ⚠' : '否'}`,
          `profile：${status.profile} ｜ plugState：${status.plugState}`,
          `知识包：${status.knowledgePack.anchoredVersion ?? '-'}（当前模板 ${status.knowledgePack.currentTemplateVersion}）${status.knowledgePack.stale ? ' ⚠ 建议 upgrade-knowledge' : ''}`,
        ]
        if (status.knowledgePack.dshBaselineDrift !== null) {
          lines.push(`提示：${status.knowledgePack.dshBaselineDrift}`)
        }
        if (status.dirtyDetail !== null && !status.dirtyDetail.clean) {
          lines.push(
            `快照 diff（${status.plugState}）：` +
              status.dirtyDetail.items
                .map((item) => `[${item.category}] ${item.kind} ${item.path}`)
                .join('；'),
          )
        }
        for (const warning of status.warnings) lines.push(`⚠ ${warning}`)
        return { text: lines.join('\n'), exitCode: status.plugState === 'clean' ? 0 : 1 }
      }
      case 'init': {
        // CLI 不提供 init（grill 决策）：项目由 /whale-tank-init 创建。
        return {
          text:
            'CLI 不提供 init：项目由 web 里的 /whale-tank-init skill 创建（写盘前有 ask_user 确认）。' +
            '\nCLI 只保留沙盒工作区命令；初始化请走 skill 或直接调 core 的 runInit。',
          exitCode: 2,
        }
      }
      case 'deps': {
        const description = stringFlag(f, 'add')
        let channel: 'plugin' | 'npm' | undefined =
          f.channel === 'plugin' || f.channel === 'npm' ? f.channel : undefined
        let name = stringFlag(f, 'pkg')
        let version = stringFlag(f, 'version') ?? null
        if ((name === undefined || channel === undefined) && description !== undefined) {
          const classified = classifyDependency(description)
          channel = classified.channel
          name = classified.name
          version = classified.version ?? version
        }
        if (name === undefined || channel === undefined) {
          return { text: '用法：whale-tank deps --add <包名>（可带 @版本，自动识别 dsh 插件走 plugin 通道）｜或 --pkg <包名> --channel plugin|npm', exitCode: 2 }
        }
        const result = await applyDependency({
          project,
          globalRoot,
          channel,
          name,
          version,
          section: f.section as 'dependencies' | 'devDependencies' | 'peerDependencies' | undefined,
          remove: f.remove === true,
          yes: f.yes === true,
        })
        const lines = [
          `${result.action === 'added' ? '安装' : '移除'} ${result.name}（${result.channel} 通道）`,
        ]
        if (result.smoke !== null && !result.smoke.ok) lines.push(`⚠ 冒烟：${result.smoke.reason}`)
        for (const warning of result.warnings) lines.push(`⚠ ${warning}`)
        return { text: lines.join('\n'), exitCode: 0 }
      }
      case 'plug': {
        const result = await plug(project, { globalRoot, build: f.build !== false })
        return {
          text: `plug 完成：快照 ${result.snapshotId}，冒烟 ${result.smoke.ok ? '通过' : `失败：${result.smoke.reason}`}`,
          exitCode: result.smoke.ok ? 0 : 1,
        }
      }
      case 'plug-test': {
        const result = await plugTest(project, {
          globalRoot,
          noRestore: f['no-restore'] === true,
          build: f.build !== false,
        })
        const lines = [...result.report]
        if (result.residualItems.length > 0) {
          lines.push('残留清单：')
          lines.push(...result.residualItems.map((line) => `- ${line}`))
        }
        if (!result.ok) {
          lines.push(result.restored ? '结果：测试失败，已自动复原。' : '结果：测试失败。')
        }
        return { text: lines.join('\n'), exitCode: result.exitCode }
      }
      case 'run-test': {
        const portRaw = typeof f.port === 'string' ? Number(f.port) : undefined
        const result = await runTest(project, {
          globalRoot,
          profile: stringFlag(f, 'profile'),
          port: portRaw !== undefined && Number.isFinite(portRaw) ? portRaw : undefined,
          noBuild: f['no-build'] === true,
        })
        const lines = [...result.report]
        if (result.residualItems.length > 0) {
          lines.push('残留清单：')
          lines.push(...result.residualItems.map((line) => `- ${line}`))
        }
        lines.push(
          result.status === 'clean'
            ? 'run-test 结束：profile 已复原（diff=0）。'
            : result.restored
              ? 'run-test 结束：有残留，已自动复原该 profile。'
              : 'run-test 结束：有残留且未复原，请手动 restore / reset。',
        )
        return { text: lines.join('\n'), exitCode: result.ok ? 0 : 1 }
      }
      case 'unplug': {
        const result = await unplug(project, { globalRoot })
        return {
          text:
            result.diff.clean
              ? 'unplug 完成：diff=0，状态 clean'
              : `unplug 完成：diff≠0，状态 dirty。\n${result.warnings.join('\n')}`,
          exitCode: result.diff.clean ? 0 : 1,
        }
      }
      case 'restore': {
        if (f.full === true) {
          const reset = await resetSandbox(project, { globalRoot, yes: f.yes === true })
          return {
            text: `reset 完成：沙盒重建，自检 ${reset.selfCheck.ok ? '通过' : `未通过（${reset.selfCheck.reason}）`}`,
            exitCode: reset.selfCheck.ok ? 0 : 1,
          }
        }
        const result = await restore(project, { globalRoot, yes: f.yes === true })
        return {
          text: `restore 完成（快照 ${result.snapshotId}）：冒烟 ${result.smoke.ok ? '通过' : `失败：${result.smoke.reason}`}`,
          exitCode: result.smoke.ok ? 0 : 1,
        }
      }
      case 'reset': {
        const reset = await resetSandbox(project, { globalRoot, yes: f.yes === true })
        return {
          text: `reset 完成：沙盒重建，自检 ${reset.selfCheck.ok ? '通过' : `未通过（${reset.selfCheck.reason}）`}`,
          exitCode: reset.selfCheck.ok ? 0 : 1,
        }
      }
      case 'upgrade-knowledge': {
        const report = upgradeKnowledgePack(project)
        return {
          text:
            `upgrade-knowledge → ${report.version}：新增 ${report.added.length}、更新 ${report.updated.length}、跳过 ${report.skipped.length}` +
            (report.conflicts.length > 0 ? `\n冲突告警：\n${report.conflicts.join('\n')}` : ''),
          exitCode: 0,
        }
      }
      default:
        return {
          text: `未知命令：${inv.verb}。可用：status / deps / plug / plug-test / run-test / unplug / restore / reset / upgrade-knowledge（init 不提供，走 /whale-tank-init；vet 仅 web skill：/whale-tank-vet）`,
          exitCode: 2,
        }
    }
  } catch (error) {
    return { text: `错误：${String(error)}`, exitCode: 1 }
  }
}

export function parseCliArgs(args: string[]): CliInvocation {
  const verb = args[0]
  const flags: Record<string, string | boolean | undefined> = {}
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = args[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next
      i++
    } else {
      flags[key] = true
    }
  }
  return { verb: verb ?? '', flags, cwd: process.cwd() }
}

function stringFlag(
  flags: Record<string, string | boolean | undefined>,
  key: string,
): string | undefined {
  const value = flags[key]
  return typeof value === 'string' ? value : undefined
}
