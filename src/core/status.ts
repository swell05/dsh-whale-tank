import fs from 'node:fs'
import path from 'node:path'
import { KNOWLEDGE_PACK_VERSION } from './knowledge-pack.ts'
import { profileDir, snapshotsDir } from './paths.ts'
import { diffSnapshot } from './snapshot.ts'
import { hasState, mixedVersionDetail, readState, versionDrift } from './state.ts'
import type { DiffSummary, StatusReport } from './types.ts'
import { dshBaselineDrift, readRuntimeVersionFromTree } from './versions.ts'

export function latestSnapshotDir(project: string): string | null {
  const dir = snapshotsDir(project)
  if (!fs.existsSync(dir)) return null
  const candidates = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith('snap-'))
    .sort((a, b) => {
      const timeA = fs.statSync(path.join(dir, a)).mtimeMs
      const timeB = fs.statSync(path.join(dir, b)).mtimeMs
      return timeB - timeA || a.localeCompare(b)
    })
  return candidates.length === 0 ? null : path.join(dir, candidates[0])
}

export function collectStatus(
  project: string,
  opts: { globalRoot: string },
): StatusReport {
  const empty: StatusReport = {
    project: null,
    projectType: null,
    versionMode: null,
    declaredDshVersion: null,
    actualDshVersion: null,
    versionDrift: false,
    mixedVersion: false,
    mixedVersionDetail: null,
    profile: null,
    profilePlugins: [],
    plugState: 'not-initialized',
    lastSnapshotId: null,
    knowledgePack: {
      anchoredVersion: null,
      currentTemplateVersion: KNOWLEDGE_PACK_VERSION,
      stale: false,
      dshBaseline: null,
      dshBaselineDrift: null,
    },
    dirtyDetail: null,
    warnings: [],
  }
  if (!hasState(project)) return empty

  const state = readState(project)
  const warnings: string[] = []
  let actualDshVersion: string | null = null
  try {
    actualDshVersion = readRuntimeVersionFromTree({
      mode: state.dsh.mode,
      project,
      globalRoot: opts.globalRoot,
    })
  } catch (error) {
    warnings.push(`无法读取运行时 dsh 版本（${state.dsh.mode}）：${String(error)}`)
  }

  const drift =
    actualDshVersion !== null && versionDrift(state.dsh.version, actualDshVersion)
  if (drift) {
    warnings.push(
      `版本漂移：state 声明 ${state.dsh.version}，实际运行时 ${actualDshVersion}。` +
        `local 模式请重跑 init 或显式钉版；standalone 模式请重装副本。`,
    )
  }

  const mixed = mixedVersionDetail(state)
  if (mixed !== null) {
    warnings.push(`混合版本沙盒：${mixed}`)
  }

  const stale = state.knowledgePack.version !== KNOWLEDGE_PACK_VERSION
  if (stale) {
    warnings.push(
      `知识包可能过时（锚定 ${state.knowledgePack.version}，当前模板 ${KNOWLEDGE_PACK_VERSION}），建议 upgrade-knowledge。`,
    )
  }

  // dshBaseline 软提示：本机 dsh 比知识包锚新时提示，不进 warnings。
  const baseline = state.knowledgePack.dshBaseline ?? null
  const baselineDrift = dshBaselineDrift(baseline, actualDshVersion)

  let dirtyDetail: DiffSummary | null = null
  if (
    (state.plugState.status === 'plugged' || state.plugState.status === 'dirty') &&
    state.plugState.lastSnapshotId !== null
  ) {
    const snapshotDir = path.join(snapshotsDir(project), state.plugState.lastSnapshotId)
    if (fs.existsSync(snapshotDir)) {
      dirtyDetail = diffSnapshot({
        project,
        profile: state.sandbox.profile,
        snapshotDir,
      })
    }
  }

  return {
    project: state.project.name,
    projectType: state.project.type,
    versionMode: state.dsh.mode,
    declaredDshVersion: state.dsh.version,
    actualDshVersion,
    versionDrift: drift,
    mixedVersion: mixed !== null,
    mixedVersionDetail: mixed,
    profile: state.sandbox.profile,
    profilePlugins: state.dependencies.profilePlugins,
    plugState: state.plugState.status,
    lastSnapshotId: state.plugState.lastSnapshotId,
    knowledgePack: {
      anchoredVersion: state.knowledgePack.version,
      currentTemplateVersion: KNOWLEDGE_PACK_VERSION,
      stale,
      dshBaseline: baseline,
      dshBaselineDrift: baselineDrift,
    },
    dirtyDetail,
    warnings,
  }
}

/** Baseline profile manifest bundles used by status/plug consumers. */
export function profileManifestBundles(project: string, profile: string): string[] {
  const manifest = path.join(profileDir(project, profile), 'package.json')
  try {
    const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
      dsh?: { profile?: { bundles?: string[] } }
    }
    return parsed.dsh?.profile?.bundles ?? []
  } catch {
    return []
  }
}
