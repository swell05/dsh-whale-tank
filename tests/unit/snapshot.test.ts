import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  collectSnapshot,
  diffSnapshot,
  topLevelNodeModules,
  type SnapshotCollection,
} from '../../src/core/snapshot.ts'

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-snap-'))
}

function setupProfile(project: string, profile = 'headless'): string {
  const dir = path.join(project, '.sandbox', 'dsh-home', 'profiles', profile)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'dsh-profile', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } }),
    'utf8',
  )
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), '# patch\n', 'utf8')
  fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'nodeLinker: hoisted\n', 'utf8')
  fs.mkdirSync(path.join(dir, 'node_modules', 'pkg-a'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'node_modules', 'pkg-b'), { recursive: true })
  return dir
}

function writeState(project: string): void {
  fs.mkdirSync(path.join(project, '.sandbox'), { recursive: true })
  fs.writeFileSync(
    path.join(project, '.sandbox', 'state.json'),
    JSON.stringify({ schemaVersion: 2, plugState: { status: 'clean' } }),
    'utf8',
  )
}

function sha(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

describe('topLevelNodeModules', () => {
  it('lists only first-level package directories sorted', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-nm-'))
    fs.mkdirSync(path.join(dir, 'node_modules', '@scope', 'pkg'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'node_modules', 'zebra'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'node_modules', '.bin'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'node_modules', 'alpha'), { recursive: true })
    expect(topLevelNodeModules(dir)).toEqual(['.bin', '@scope', 'alpha', 'zebra'])
  })
})

describe('collectSnapshot / diffSnapshot', () => {
  it('collects profile files + SHA, node_modules list, state, metadata', () => {
    const project = tempProject()
    const profileDir = setupProfile(project)
    writeState(project)
    const collection = collectSnapshot({
      project,
      profile: 'headless',
      trigger: 'plug',
      declaredVersion: '0.1.0-rc.7',
      actualVersion: '0.1.0-rc.7',
    })
    expect(collection.id).toMatch(/^snap-/)
    const metaPath = path.join(collection.dir, 'snapshot.json')
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
      trigger: string
      declaredDshVersion: string
      actualDshVersion: string
    }
    expect(meta.trigger).toBe('plug')
    expect(meta.declaredDshVersion).toBe('0.1.0-rc.7')
    expect(fs.existsSync(path.join(collection.dir, 'files', 'package.json'))).toBe(true)
    const shaFile = path.join(collection.dir, 'sha256.json')
    const shas = JSON.parse(fs.readFileSync(shaFile, 'utf8')) as Record<string, string>
    expect(shas['files/package.json']).toBe(sha(path.join(profileDir, 'package.json')))
    const nmList = fs.readFileSync(path.join(collection.dir, 'node-modules.txt'), 'utf8')
    expect(nmList).toContain('pkg-a')
    expect(fs.existsSync(path.join(collection.dir, 'state.json'))).toBe(true)
  })

  it('reports a clean diff when nothing changed', () => {
    const project = tempProject()
    setupProfile(project)
    writeState(project)
    const collection = collectSnapshot({
      project,
      profile: 'headless',
      trigger: 'plug',
      declaredVersion: '0.1.0-rc.7',
      actualVersion: '0.1.0-rc.7',
    })
    const diff = diffSnapshot({ project, profile: 'headless', snapshotDir: collection.dir })
    expect(diff.clean).toBe(true)
    expect(diff.items).toEqual([])
  })

  it('flags a modified profile file', () => {
    const project = tempProject()
    const profileDir = setupProfile(project)
    writeState(project)
    const collection = collectSnapshot({
      project,
      profile: 'headless',
      trigger: 'plug',
      declaredVersion: '0.1.0-rc.7',
      actualVersion: '0.1.0-rc.7',
    })
    fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), '# changed\n', 'utf8')
    const diff = diffSnapshot({ project, profile: 'headless', snapshotDir: collection.dir })
    expect(diff.clean).toBe(false)
    expect(diff.items.some((i) => i.category === 'profile-file' && i.kind === 'modified')).toBe(true)
  })

  it('flags extra and missing node_modules entries, honoring allowed removals', () => {
    const project = tempProject()
    const profileDir = setupProfile(project)
    writeState(project)
    const collection = collectSnapshot({
      project,
      profile: 'headless',
      trigger: 'plug',
      declaredVersion: '0.1.0-rc.7',
      actualVersion: '0.1.0-rc.7',
    })
    // Simulate unplug: the target plugin was removed (allowed), one residual
    // package remains (not allowed).
    fs.rmSync(path.join(profileDir, 'node_modules', 'pkg-a'), { recursive: true, force: true })
    fs.mkdirSync(path.join(profileDir, 'node_modules', 'pkg-residual'), { recursive: true })
    const diff = diffSnapshot({
      project,
      profile: 'headless',
      snapshotDir: collection.dir,
      allowRemoved: ['pkg-a'],
    })
    expect(diff.clean).toBe(false)
    expect(
      diff.items.some(
        (i) => i.category === 'node-modules' && i.kind === 'added' && i.path.includes('pkg-residual'),
      ),
    ).toBe(true)
    expect(
      diff.items.some((i) => i.category === 'node-modules' && i.kind === 'removed' && i.path.includes('pkg-a')),
    ).toBe(false)
  })

  it('ignores the pnpm virtual store (.pnpm) as infrastructure', () => {
    const project = tempProject()
    const profileDirPath = setupProfile(project)
    writeState(project)
    const collection = collectSnapshot({
      project,
      profile: 'headless',
      trigger: 'plug',
      declaredVersion: '0.1.0-rc.7',
      actualVersion: '0.1.0-rc.7',
    })
    fs.mkdirSync(path.join(profileDirPath, 'node_modules', '.pnpm'), { recursive: true })
    const diff = diffSnapshot({ project, profile: 'headless', snapshotDir: collection.dir })
    expect(diff.clean).toBe(true)
  })

  it('ignores the .bin shim dir pnpm leaves after removing a bin-package', () => {
    const project = tempProject()
    const profileDirPath = setupProfile(project)
    writeState(project)
    const collection = collectSnapshot({
      project,
      profile: 'headless',
      trigger: 'plug',
      declaredVersion: '0.1.0-rc.7',
      actualVersion: '0.1.0-rc.7',
    })
    // pnpm 卸载带 bin 的插件后留下 .bin 目录（含旧 shim），属基础设施。
    fs.mkdirSync(path.join(profileDirPath, 'node_modules', '.bin'), { recursive: true })
    const diff = diffSnapshot({ project, profile: 'headless', snapshotDir: collection.dir })
    expect(diff.clean).toBe(true)
  })

  it('ignores the empty @scope/ dir pnpm leaves after removing a scoped package', () => {
    const project = tempProject()
    const profileDirPath = setupProfile(project)
    writeState(project)
    const collection = collectSnapshot({
      project,
      profile: 'headless',
      trigger: 'plug',
      declaredVersion: '0.1.0-rc.7',
      actualVersion: '0.1.0-rc.7',
    })
    // pnpm 卸载 @swell05/dsh-whale-tank 后留下空的 @swell05/ 目录（永不清理）。
    fs.mkdirSync(path.join(profileDirPath, 'node_modules', '@swell05'), { recursive: true })
    const diff = diffSnapshot({ project, profile: 'headless', snapshotDir: collection.dir })
    expect(diff.clean).toBe(true)
  })

  it('flags a non-empty @scope/ dir (real residue, not a pnpm artifact)', () => {
    const project = tempProject()
    const profileDirPath = setupProfile(project)
    writeState(project)
    const collection = collectSnapshot({
      project,
      profile: 'headless',
      trigger: 'plug',
      declaredVersion: '0.1.0-rc.7',
      actualVersion: '0.1.0-rc.7',
    })
    fs.mkdirSync(path.join(profileDirPath, 'node_modules', '@scope', 'leftover'), {
      recursive: true,
    })
    const diff = diffSnapshot({ project, profile: 'headless', snapshotDir: collection.dir })
    expect(diff.clean).toBe(false)
    expect(
      diff.items.some(
        (i) => i.category === 'node-modules' && i.kind === 'added' && i.path.includes('@scope'),
      ),
    ).toBe(true)
  })

  it('flags new sessions entries created after the snapshot', () => {
    const project = tempProject()
    setupProfile(project)
    writeState(project)
    const sessions = path.join(project, '.sandbox', 'dsh-home', 'sessions')
    fs.mkdirSync(sessions, { recursive: true })
    const collection = collectSnapshot({
      project,
      profile: 'headless',
      trigger: 'plug',
      declaredVersion: '0.1.0-rc.7',
      actualVersion: '0.1.0-rc.7',
    })
    fs.writeFileSync(path.join(sessions, 'session-new.jsonl'), '', 'utf8')
    const diff = diffSnapshot({ project, profile: 'headless', snapshotDir: collection.dir })
    expect(diff.clean).toBe(false)
    expect(diff.items.some((i) => i.category === 'sessions' && i.path.includes('session-new'))).toBe(
      true,
    )
  })
})

describe('SnapshotCollection', () => {
  it('metadata carries declared vs actual runtime versions (drift trap)', () => {
    const project = tempProject()
    setupProfile(project)
    writeState(project)
    const collection: SnapshotCollection = collectSnapshot({
      project,
      profile: 'headless',
      trigger: 'unplug',
      declaredVersion: '0.1.0-rc.6',
      actualVersion: '0.1.0-rc.7',
    })
    const meta = JSON.parse(fs.readFileSync(path.join(collection.dir, 'snapshot.json'), 'utf8'))
    expect(meta.declaredDshVersion).toBe('0.1.0-rc.6')
    expect(meta.actualDshVersion).toBe('0.1.0-rc.7')
  })
})
