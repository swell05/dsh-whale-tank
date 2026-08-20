import fs from 'node:fs'
import path from 'node:path'
import { runDshPlugin } from './dsh.ts'
import { runNodeScript, runProcessChecked } from './proc.ts'
import { profileDir, snapshotsDir } from './paths.ts'
import { profileManifestBundles } from './status.ts'
import { collectSnapshot, diffSnapshot } from './snapshot.ts'
import {
  mixedVersionDetail,
  readState,
  recordProfilePlugin,
  removeProfilePlugin,
  setPlugStatus,
  writeState,
} from './state.ts'
import { twoStepSmoke } from './sandbox.ts'
import { probeWebClientBundle } from './probe.ts'
import { addProfileInsert, removeProfileInsert } from './patch.ts'
import type { DiffSummary, ToolContextLike } from './types.ts'
import { readRuntimeVersionFromTree } from './versions.ts'

export interface PlugResult {
  snapshotId: string
  smoke: { ok: boolean; reason: string | null }
  built: boolean
}

export interface UnplugResult {
  diff: DiffSummary
  status: 'clean' | 'dirty'
  warnings: string[]
}

/** 状态机：clean --plug--> plugged（§5.1）。 */
export async function plug(
  project: string,
  opts: {
    globalRoot: string
    build?: boolean
    ctx?: ToolContextLike
  },
): Promise<PlugResult> {
  const state = readState(project)
  if (state.plugState.status !== 'clean') {
    throw new Error(
      `plug 前置检查失败：plugState = ${state.plugState.status}，必须先 restore/reset 回到 clean（铁律 6）。`,
    )
  }
  const mixed = mixedVersionDetail(state)
  if (mixed !== null) {
    throw new Error(`混合版本沙盒禁止操作：${mixed}`)
  }
  const pkgName = state.project.name
  const isClient = state.project.type === 'client'
  const profile = state.sandbox.profile
  const actualVersion = readRuntimeVersionFromTree({
    mode: state.dsh.mode,
    project,
    globalRoot: opts.globalRoot,
  })

  // 构建必须先于安装：`dsh plugin add file:<项目>` 会在安装时把包快照进
  // profile（含 lib/），否则冒烟会因入口缺失失败（dogfooding 实测）。
  let built = false
  const manifest = JSON.parse(
    fs.readFileSync(path.join(project, 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> }
  if (opts.build !== false && typeof manifest.scripts?.build === 'string') {
    const { resolveNpmEntry } = await import('./proc.ts')
    const npmEntry = await resolveNpmEntry()
    const result = await runNodeScript(npmEntry, ['run', 'build'], {
      cwd: project,
      timeoutMs: 300_000,
    })
    if (result.exitCode !== 0) {
      throw new Error(`项目构建失败（npm run build）：\n${result.stderr || result.stdout}`)
    }
    built = true
  }

  const collection = collectSnapshot({
    project,
    profile,
    trigger: 'plug',
    declaredVersion: state.dsh.version,
    actualVersion,
  })

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

  // client 型：写 profile 用户 patch 层 insert 行接入（不进层栈，§13.2/§13.4）。
  if (isClient) {
    writeProfileInsert(project, profile, pkgName)
  }

  // 分型冒烟：host/both 走 dump-config + boot；client 走 web boot + client bundle 加载断言。
  const smoke = isClient
    ? await probeWebClientBundle({
        project,
        globalRoot: opts.globalRoot,
        mode: state.dsh.mode,
        profile,
        pluginId: pkgName,
      })
    : await twoStepSmoke(project, {
        globalRoot: opts.globalRoot,
        profile,
        pluginId: pkgName,
        bundles: [...state.sandbox.baselineBundles, pkgName],
      })
  if (!smoke.ok) {
    throw new Error(`plug 冒烟失败：${smoke.reason}`)
  }

  const next = setPlugStatus(
    recordProfilePlugin(state, {
      name: pkgName,
      version: actualVersion,
      addedBy: 'plug',
      addedAt: new Date().toISOString(),
    }),
    'plugged',
    collection.id,
  )
  writeState(project, next)
  return { snapshotId: collection.id, smoke, built }
}

/** 状态机：plugged --unplug+diff=0--> clean；diff≠0 → dirty（§5.1/§6.4）。 */
export async function unplug(
  project: string,
  opts: {
    globalRoot: string
  },
): Promise<UnplugResult> {
  const state = readState(project)
  if (state.plugState.status !== 'plugged' || state.plugState.lastSnapshotId === null) {
    throw new Error(`unplug 前置检查失败：plugState = ${state.plugState.status}（需要 plugged）。`)
  }
  const pkgName = state.project.name
  const isClient = state.project.type === 'client'
  const profile = state.sandbox.profile
  // client 型：先移除用户 patch 层 insert 行，再 remove 依赖（对账）。
  if (isClient) {
    removeProfileInsertFromDisk(project, profile, pkgName)
  }
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

  // State must reflect the reconciliation before the diff's alignment check.
  const reconciled = removeProfilePlugin(state, pkgName)
  writeState(project, reconciled)

  const snapshotDir = path.join(
    snapshotsDir(project),
    state.plugState.lastSnapshotId,
  )
  const diff = diffSnapshot({
    project,
    profile,
    snapshotDir,
    allowRemoved: [pkgName],
  })
  const warnings: string[] = []
  if (!diff.clean) {
    warnings.push(
      `检测到副作用残留：\n${diff.items
        .map((item) => `- [${item.category}] ${item.kind} ${item.path}：${item.detail}`)
        .join('\n')}\n建议 restore 回拷快照并重建。`,
    )
  }
  const status = diff.clean ? 'clean' : 'dirty'
  writeState(
    project,
    setPlugStatus(reconciled, status, diff.clean ? null : state.plugState.lastSnapshotId),
  )
  return { diff, status, warnings }
}

/** Bundles in the profile after any operation (used by status/deps). */
export function currentProfileBundles(project: string, profile: string): string[] {
  return profileManifestBundles(project, profile)
}

/** 用户 patch 层路径（client 插拔挂载点）。 */
export function profilePatchPath(project: string, profile: string): string {
  return path.join(profileDir(project, profile), 'cordis.patch.yml')
}

/** 写 client insert 行到用户 patch 层（幂等）。 */
export function writeProfileInsert(project: string, profile: string, pkgName: string): void {
  const file = profilePatchPath(project, profile)
  const current = fs.readFileSync(file, 'utf8')
  const next = addProfileInsert(current, pkgName)
  if (next !== current) fs.writeFileSync(file, next, 'utf8')
}

/** 从用户 patch 层移除 client insert 行。 */
export function removeProfileInsertFromDisk(
  project: string,
  profile: string,
  pkgName: string,
): void {
  const file = profilePatchPath(project, profile)
  const current = fs.readFileSync(file, 'utf8')
  const next = removeProfileInsert(current, pkgName)
  if (next !== current) fs.writeFileSync(file, next, 'utf8')
}
