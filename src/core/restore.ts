import fs from 'node:fs'
import path from 'node:path'
import { runPnpmIn } from './dsh.ts'
import { removeTree } from './fsutil.ts'
import { profileDir, sessionsDir } from './paths.ts'
import { latestSnapshotDir } from './status.ts'
import { PROFILE_FILES } from './snapshot.ts'
import { readState, writeState } from './state.ts'
import { twoStepSmoke } from './sandbox.ts'
import type { ToolContextLike } from './types.ts'

export interface RestoreResult {
  snapshotId: string
  smoke: { ok: boolean; reason: string | null }
}

/**
 * Profile 文件复原核心（restore 与 run-test 共用）：备份现场 → 回拷快照的
 * profile 文件 → 按快照重建 node_modules。不写 state、不冒烟——那是调用方的事。
 */
export async function restoreProfileFiles(
  project: string,
  profile: string,
  snapshotDir: string,
): Promise<void> {
  const target = profileDir(project, profile)

  // 回拷前备份当前现场（防误删现场，设计 §9.3）。
  const backupDir = path.join(snapshotDir, 'pre-restore')
  fs.mkdirSync(backupDir, { recursive: true })
  for (const name of PROFILE_FILES) {
    const src = path.join(target, name)
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(backupDir, name))
  }

  for (const name of PROFILE_FILES) {
    const snapshotFile = path.join(snapshotDir, 'files', name)
    if (fs.existsSync(snapshotFile)) {
      fs.copyFileSync(snapshotFile, path.join(target, name))
    }
  }

  // 重建 node_modules：快照有依赖 → pnpm install；快照为空 → 删除基础设施。
  const snapshotModules = fs
    .readFileSync(path.join(snapshotDir, 'node-modules.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
  if (snapshotModules.length === 0) {
    removeTree(path.join(target, 'node_modules'))
  } else {
    const install = await runPnpmIn(target, ['install'], {
      timeoutMs: 300_000,
    })
    if (install.exitCode !== 0) {
      throw new Error(`restore 重建 node_modules 失败（pnpm install）：\n${install.stderr}`)
    }
  }
}

/**
 * restore（快速复原，设计 §9.3）：回拷最近快照的 profile 文件 → 重建
 * node_modules → 清沙盒 sessions → 重写 state（clean）→ 冒烟确认。
 */
export async function restore(
  project: string,
  opts: {
    globalRoot: string
    yes?: boolean
    ctx?: ToolContextLike
  },
): Promise<RestoreResult> {
  const state = readState(project)
  const snapshotDir = latestSnapshotDir(project)
  if (snapshotDir === null) {
    throw new Error('没有可用快照：先 plug 才会采集插前快照。')
  }
  const profile = state.sandbox.profile

  await restoreProfileFiles(project, profile, snapshotDir)

  // 清沙盒 sessions。
  const sessions = sessionsDir(project)
  if (fs.existsSync(sessions)) {
    for (const entry of fs.readdirSync(sessions)) {
      if (entry === '.gitkeep') continue
      removeTree(path.join(sessions, entry))
    }
  }

  // 重写 state：优先用快照内的插前 state，再强制 clean。
  const snapshotState = readJsonOrNull(path.join(snapshotDir, 'state.json'))
  const restored =
    [1, 2].includes((snapshotState as { schemaVersion?: number } | null)?.schemaVersion ?? 0)
      ? (snapshotState as typeof state)
      : state
  writeState(project, {
    ...restored,
    plugState: {
      status: 'clean',
      lastPluggedAt: null,
      lastSnapshotId: null,
    },
  })

  const smoke = await twoStepSmoke(project, {
    globalRoot: opts.globalRoot,
    profile,
    pluginId: '@deepseek-ai/dsh-base',
    bundles: state.sandbox.baselineBundles,
  })
  if (!smoke.ok) {
    throw new Error(`restore 后冒烟失败：${smoke.reason}`)
  }
  return { snapshotId: path.basename(snapshotDir), smoke }
}

function readJsonOrNull(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
