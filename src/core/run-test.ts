import fs from 'node:fs'
import path from 'node:path'
import { runDshForeground, runDshPlugin } from './dsh.ts'
import { resolveNpmEntry, runNodeScript } from './proc.ts'
import { dshHomeDir, profileDir } from './paths.ts'
import { collectSnapshot, diffSnapshot } from './snapshot.ts'
import { readState } from './state.ts'
import { removeProfileInsertFromDisk, writeProfileInsert } from './plug.ts'
import { restoreProfileFiles } from './restore.ts'
import { readRuntimeVersionFromTree } from './versions.ts'
import type { DiffSummary, ToolContextLike } from './types.ts'

/**
 * run-test（grill 决策）：挂载正在开发的插件进沙盒 profile 并**前台实跑**。
 * profile 由开发者指定（任意沙盒 profile 名，不限定 web/headless 预设），
 * run-test 只负责 构建 → 注入 → 启动 → 复原，不做按类型魔法。
 *
 * 铁律 1/2：注入/boot 全程显式 DSH_HOME=沙盒 dsh-home（runDsh* 内置），
 * 且 profile 名做路径断言——绝不允许逃逸到真实 ~/.dsh。
 */
export interface RunTestOptions {
  globalRoot: string
  /** 目标 profile 名；缺省 = web（grill 决策）。 */
  profile?: string
  /** web 端口覆盖；缺省且 profile=web 时用 13080。 */
  port?: number
  noBuild?: boolean
  ctx?: ToolContextLike
}

export interface RunTestResult {
  ok: boolean
  profile: string
  built: boolean
  boot: { exitCode: number; interrupted: boolean }
  diff: DiffSummary | null
  status: 'clean' | 'dirty'
  residualItems: string[]
  restored: boolean
  report: string[]
}

/** 防逃逸（铁律 1/2）：profile 名不得含路径分隔符/相对遍历。 */
function assertProfileName(profile: string): void {
  if (
    profile === '' ||
    profile.includes('/') ||
    profile.includes('\\') ||
    profile === '.' ||
    profile === '..' ||
    profile === 'node_modules'
  ) {
    throw new Error(`非法 profile 名：${JSON.stringify(profile)}。`)
  }
}

export async function runTest(
  project: string,
  opts: RunTestOptions,
): Promise<RunTestResult> {
  const state = readState(project)
  const profile = opts.profile ?? 'web'
  assertProfileName(profile)
  const profilePath = profileDir(project, profile)

  // 防逃逸：profile 目录必须落在沙盒 DSH_HOME 内（构造上必然，双保险）。
  const rel = path.relative(dshHomeDir(project), profilePath)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`profile 路径逃逸沙盒 DSH_HOME：${profilePath}`)
  }
  if (!fs.existsSync(path.join(profilePath, 'package.json'))) {
    throw new Error(
      `沙盒 profile「${profile}」不存在（${profilePath}）。` +
        `先用 dsh plugin --profile ${profile} add <package> 建好，或用沙盒自带的 web/headless。`,
    )
  }

  const report: string[] = []
  const residualItems: string[] = []
  const pkgName = state.project.name
  const isClient = state.project.type === 'client'
  const actualVersion = readRuntimeVersionFromTree({
    mode: state.dsh.mode,
    project,
    globalRoot: opts.globalRoot,
  })

  // 1) 构建（--no-build 跳过；无 build script 也跳过）。
  let built = false
  if (opts.noBuild !== true) {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(project, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> }
    if (typeof manifest.scripts?.build === 'string') {
      const npmEntry = await resolveNpmEntry()
      const result = await runNodeScript(npmEntry, ['run', 'build'], {
        cwd: project,
        timeoutMs: 300_000,
      })
      if (result.exitCode !== 0) {
        throw new Error(`项目构建失败（npm run build）：\n${result.stderr || result.stdout}`)
      }
      built = true
      report.push(`构建完成（npm run build）`)
    }
  }

  // 2) 快照目标 profile（注入前基线）。
  const collection = collectSnapshot({
    project,
    profile,
    trigger: 'run-test',
    declaredVersion: state.dsh.version,
    actualVersion,
  })
  report.push(`快照 ${collection.id}（profile=${profile}）`)

  // 3) 注入：`dsh plugin --profile <p> add file:<项目>` + client insert。
  try {
    const add = await runDshPlugin({
      project,
      globalRoot: opts.globalRoot,
      mode: state.dsh.mode,
      profile,
      argv: ['add', `file:${project}`],
      timeoutMs: 180_000,
    })
    if (add.exitCode !== 0) {
      throw new Error(`dsh plugin add 失败：\n${add.stderr || add.stdout}`)
    }
    if (isClient) writeProfileInsert(project, profile, pkgName)
    report.push(`已注入 ${pkgName} 到 profile「${profile}」`)
  } catch (error) {
    report.push(`注入失败：${String(error)}`)
    try {
      await restoreProfileFiles(project, profile, collection.dir)
      report.push('已尝试复原该 profile。')
    } catch {
      // 复原失败：保留现场，如实报告。
    }
    return {
      ok: false,
      profile,
      built,
      boot: { exitCode: -1, interrupted: false },
      diff: null,
      status: 'dirty',
      residualItems,
      restored: false,
      report,
    }
  }

  // 4) 前台 boot（Ctrl+C 结束并复原）。
  const bootArgs: string[] = []
  if (opts.port !== undefined) bootArgs.push('--port', String(opts.port))
  else if (profile === 'web') bootArgs.push('--port', '13080')
  report.push(`启动 profile「${profile}」…（Ctrl+C 结束，自动复原）`)
  const boot = await runDshForeground({
    project,
    globalRoot: opts.globalRoot,
    mode: state.dsh.mode,
    argv: ['--profile', profile, ...bootArgs],
  })
  report.push(`boot 结束（exit=${boot.exitCode}${boot.interrupted ? '，Ctrl+C' : ''}）`)

  // 5) 复原：remove + diff 对账。
  try {
    if (isClient) removeProfileInsertFromDisk(project, profile, pkgName)
    const remove = await runDshPlugin({
      project,
      globalRoot: opts.globalRoot,
      mode: state.dsh.mode,
      profile,
      argv: ['remove', pkgName],
      timeoutMs: 180_000,
    })
    if (remove.exitCode !== 0) {
      throw new Error(`dsh plugin remove 失败：\n${remove.stderr || remove.stdout}`)
    }
  } catch (error) {
    report.push(`复原（remove）失败：${String(error)}；可手动 whale-tank restore / reset。`)
    return {
      ok: false,
      profile,
      built,
      boot,
      diff: null,
      status: 'dirty',
      residualItems,
      restored: false,
      report,
    }
  }

  const diff = diffSnapshot({
    project,
    profile,
    snapshotDir: collection.dir,
    allowRemoved: [pkgName],
  })
  if (diff.clean) {
    report.push('复原对账干净（diff=0），profile 回到注入前基线。')
    return {
      ok: true,
      profile,
      built,
      boot,
      diff,
      status: 'clean',
      residualItems,
      restored: false,
      report,
    }
  }

  // diff≠0：证据先落袋，再自动复原。
  for (const item of diff.items) {
    residualItems.push(`[${item.category}] ${item.kind} ${item.path}：${item.detail}`)
  }
  report.push(`检测到残留（${diff.items.length} 项）：\n${residualItems.join('\n')}`)
  try {
    await restoreProfileFiles(project, profile, collection.dir)
    report.push('已自动复原该 profile（回拷快照 + 重建 node_modules）。')
    return {
      ok: false,
      profile,
      built,
      boot,
      diff,
      status: 'dirty',
      residualItems,
      restored: true,
      report,
    }
  } catch (error) {
    report.push(`自动复原失败：${String(error)}；现场保留在 ${collection.dir}。`)
    return {
      ok: false,
      profile,
      built,
      boot,
      diff,
      status: 'dirty',
      residualItems,
      restored: false,
      report,
    }
  }
}
