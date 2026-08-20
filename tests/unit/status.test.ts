import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectStatus, latestSnapshotDir } from '../../src/core/status.ts'
import { KNOWLEDGE_PACK_VERSION } from '../../src/core/knowledge-pack.ts'
import {
  writeInitialState,
  resolveVersionMode,
  setPlugStatus,
  writeState,
} from '../../src/core/state.ts'
import { writeState as writeStateDirect } from '../../src/core/state.ts'
import { collectSnapshot } from '../../src/core/snapshot.ts'
import { profileDir, snapshotsDir, statePath } from '../../src/core/paths.ts'

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-status-'))
}

function globalRootWith(version: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-global-'))
  const pkgDir = path.join(dir, '@deepseek-ai', 'dsh')
  fs.mkdirSync(pkgDir, { recursive: true })
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh', version }),
    'utf8',
  )
  return dir
}

function initProject(opts: { localVersion: string; mode?: 'local' | 'standalone' }) {
  const project = tempProject()
  const globalRoot = globalRootWith(opts.localVersion)
  const resolution =
    opts.mode === 'standalone'
      ? { mode: 'standalone' as const, version: '0.1.0-rc.6', override: '0.1.0-rc.6' }
      : resolveVersionMode({ requested: null, local: opts.localVersion })
  const state = writeInitialState({
    projectName: 'dsh-demo',
    projectType: 'host',
    root: project,
    resolution,
    profile: 'headless',
    baselineBundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
    dshHome: path.join(project, '.sandbox', 'dsh-home'),
    dshInstall: null,
    knowledgePackVersion: KNOWLEDGE_PACK_VERSION,
  })
  // Baseline profile manifest mirroring the sandbox layout.
  const pdir = profileDir(project, 'headless')
  fs.mkdirSync(pdir, { recursive: true })
  fs.writeFileSync(
    path.join(pdir, 'package.json'),
    JSON.stringify({
      name: 'dsh-profile-headless',
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } },
    }),
    'utf8',
  )
  fs.writeFileSync(path.join(pdir, 'cordis.patch.yml'), '# patch\n', 'utf8')
  fs.writeFileSync(path.join(pdir, 'pnpm-workspace.yaml'), 'nodeLinker: hoisted\n', 'utf8')
  fs.mkdirSync(path.join(pdir, 'node_modules', '@deepseek-ai'), { recursive: true })
  return { project, globalRoot, state }
}

describe('collectStatus', () => {
  it('reports not-initialized when state.json is absent', () => {
    const project = tempProject()
    const status = collectStatus(project, { globalRoot: globalRootWith('0.1.0-rc.7') })
    expect(status.project).toBeNull()
    expect(status.plugState).toBe('not-initialized')
  })

  it('reports clean local state with no drift', () => {
    const { project, globalRoot } = initProject({ localVersion: '0.1.0-rc.7' })
    const status = collectStatus(project, { globalRoot })
    expect(status.projectType).toBe('host')
    expect(status.versionMode).toBe('local')
    expect(status.declaredDshVersion).toBe('0.1.0-rc.7')
    expect(status.actualDshVersion).toBe('0.1.0-rc.7')
    expect(status.versionDrift).toBe(false)
    expect(status.plugState).toBe('clean')
    expect(status.knowledgePack.stale).toBe(false)
  })

  it('flags version drift when the local runtime differs from the declared version', () => {
    const { project, globalRoot } = initProject({ localVersion: '0.1.0-rc.7' })
    // Simulate a global upgrade: write a newer version into the global tree.
    const pkgDir = path.join(globalRoot, '@deepseek-ai', 'dsh')
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.8' }),
      'utf8',
    )
    const status = collectStatus(project, { globalRoot })
    expect(status.versionDrift).toBe(true)
    expect(status.actualDshVersion).toBe('0.1.0-rc.8')
    expect(status.warnings.some((w) => w.includes('漂移'))).toBe(true)
  })

  it('reports a dirty plugState with the latest snapshot diff', () => {
    const { project, globalRoot, state } = initProject({ localVersion: '0.1.0-rc.7' })
    const collection = collectSnapshot({
      project,
      profile: 'headless',
      trigger: 'plug',
      declaredVersion: '0.1.0-rc.7',
      actualVersion: '0.1.0-rc.7',
    })
    fs.writeFileSync(
      path.join(profileDir(project, 'headless'), 'cordis.patch.yml'),
      '# changed\n',
      'utf8',
    )
    const plugged = setPlugStatus(state, 'dirty', collection.id)
    writeState(project, plugged)
    const status = collectStatus(project, { globalRoot })
    expect(status.plugState).toBe('dirty')
    expect(status.dirtyDetail).not.toBeNull()
    expect(status.dirtyDetail?.clean).toBe(false)
  })

  it('flags mixed versions when profile plugins mismatch the runtime', () => {
    const { project, globalRoot, state } = initProject({ localVersion: '0.1.0-rc.7' })
    const withPlugin = {
      ...state,
      dependencies: {
        ...state.dependencies,
        profilePlugins: [
          {
            name: '@deepseek-ai/dsh-tool-fs',
            version: '0.1.0-rc.6',
            addedBy: 'deps' as const,
            addedAt: new Date().toISOString(),
          },
        ],
      },
    }
    writeState(project, withPlugin)
    const status = collectStatus(project, { globalRoot })
    expect(status.mixedVersion).toBe(true)
    expect(status.mixedVersionDetail).toMatch(/0\.1\.0-rc\.6/)
  })

  it('reports a stale knowledge pack when the anchor version is behind', () => {
    const { project, globalRoot, state } = initProject({ localVersion: '0.1.0-rc.7' })
    writeState(project, {
      ...state,
      knowledgePack: { version: 'v0.0.9', lastWrittenAt: new Date().toISOString() },
    })
    const status = collectStatus(project, { globalRoot })
    expect(status.knowledgePack.stale).toBe(true)
    expect(status.warnings.some((w) => w.includes('upgrade-knowledge'))).toBe(true)
  })
})

describe('latestSnapshot', () => {
  it('picks the most recent snapshot directory', () => {
    const { project } = initProject({ localVersion: '0.1.0-rc.7' })
    fs.mkdirSync(snapshotsDir(project), { recursive: true })
    fs.mkdirSync(path.join(snapshotsDir(project), 'snap-old'))
    fs.mkdirSync(path.join(snapshotsDir(project), 'snap-new'))
    expect(latestSnapshotDir(project)).toMatch(/snap-new$/)
  })
})

describe('dshBaseline 软提示（票03）', () => {
  function projectWith(localVersion: string, baseline: string | null) {
    const project = tempProject()
    const globalRoot = globalRootWith(localVersion)
    const state = writeInitialState({
      projectName: 'dsh-demo',
      projectType: 'host',
      root: project,
      resolution: resolveVersionMode({ requested: null, local: localVersion }),
      profile: 'headless',
      baselineBundles: [],
      dshHome: path.join(project, '.sandbox', 'dsh-home'),
      dshInstall: null,
      knowledgePackVersion: KNOWLEDGE_PACK_VERSION,
      ...(baseline === null ? {} : { knowledgePackDshBaseline: baseline }),
    })
    return { project, globalRoot, state }
  }

  it('hints softly when the local dsh is newer than the anchor', () => {
    const { project, globalRoot } = projectWith('0.1.0-rc.9', '0.1.0-rc.8')
    const status = collectStatus(project, { globalRoot })
    expect(status.knowledgePack.dshBaselineDrift).toContain('rc.9')
    // 软提示不进告警通道、不影响 plugState。
    expect(status.warnings.some((w) => w.includes('知识包可能滞后'))).toBe(false)
    expect(status.plugState).toBe('clean')
  })

  it('stays silent when the local dsh equals the anchor', () => {
    const { project, globalRoot } = projectWith('0.1.0-rc.8', '0.1.0-rc.8')
    expect(collectStatus(project, { globalRoot }).knowledgePack.dshBaselineDrift).toBeNull()
  })

  it('stays silent when the local dsh is older than the anchor', () => {
    const { project, globalRoot } = projectWith('0.1.0-rc.7', '0.1.0-rc.8')
    expect(collectStatus(project, { globalRoot }).knowledgePack.dshBaselineDrift).toBeNull()
  })

  it('stays silent for v1 states without a dshBaseline field', () => {
    const { project, globalRoot, state } = projectWith('0.1.0-rc.9', '0.1.0-rc.8')
    const legacy = { ...state, knowledgePack: { version: state.knowledgePack.version, lastWrittenAt: state.knowledgePack.lastWrittenAt } }
    writeStateDirect(project, legacy as typeof state)
    expect(collectStatus(project, { globalRoot }).knowledgePack.dshBaselineDrift).toBeNull()
  })
})

describe('票04 v1 旧 state 兼容读出', () => {
  it('reads a schema-v1 web project as both semantics without rewriting', () => {
    const project = tempProject()
    const globalRoot = globalRootWith('0.1.0-rc.8')
    fs.mkdirSync(path.dirname(statePath(project)), { recursive: true })
    const v1 = {
      schemaVersion: 1,
      project: { name: 'dsh-demo', type: 'web', root: project },
      dsh: { version: '0.1.0-rc.8', mode: 'local', override: null },
      sandbox: {
        dshHome: path.join(project, '.sandbox', 'dsh-home'),
        profile: 'web',
        baselineBundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
        dshInstall: null,
      },
      dependencies: { profilePlugins: [], projectDeps: {} },
      plugState: { status: 'clean', lastPluggedAt: null, lastSnapshotId: null },
      knowledgePack: { version: 'v0.1.2', lastWrittenAt: null },
      notes: { lastGeneratedAt: null, noteCount: 0 },
    }
    fs.writeFileSync(statePath(project), JSON.stringify(v1), 'utf8')
    const status = collectStatus(project, { globalRoot })
    expect(status.projectType).toBe('both')
    expect(status.plugState).toBe('clean')
    expect(status.profile).toBe('web')
    // 磁盘未被强制迁移。
    const onDisk = JSON.parse(fs.readFileSync(statePath(project), 'utf8'))
    expect(onDisk.schemaVersion).toBe(1)
    expect(onDisk.project.type).toBe('web')
  })
})
