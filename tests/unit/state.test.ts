import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  initialState,
  mixedVersionDetail,
  readState,
  resolveVersionMode,
  setKnowledgePackVersion,
  setPlugStatus,
  versionDrift,
  writeInitialState,
  writeState,
  StateError,
} from '../../src/core/state.ts'

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-state-'))
}

const BASE = {
  projectName: 'dsh-demo',
  projectType: 'host' as const,
  profile: 'headless' as const,
  baselineBundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
  dshHome: 'E:/demo/.sandbox/dsh-home',
  dshInstall: null,
  knowledgePackVersion: 'v0.1.0',
}

describe('resolveVersionMode', () => {
  it('defaults to local when no version is requested', () => {
    expect(resolveVersionMode({ requested: null, local: '0.1.0-rc.7' })).toEqual({
      mode: 'local',
      version: '0.1.0-rc.7',
      override: null,
    })
  })

  it('stays local when the requested version equals the local install', () => {
    expect(
      resolveVersionMode({ requested: '0.1.0-rc.7', local: '0.1.0-rc.7' }),
    ).toEqual({
      mode: 'local',
      version: '0.1.0-rc.7',
      override: '0.1.0-rc.7',
    })
  })

  it('upgrades to standalone when the requested version differs', () => {
    expect(
      resolveVersionMode({ requested: '0.1.0-rc.6', local: '0.1.0-rc.7' }),
    ).toEqual({
      mode: 'standalone',
      version: '0.1.0-rc.6',
      override: '0.1.0-rc.6',
    })
  })
})

describe('state read/write', () => {
  it('round-trips a schema-v2 state file', () => {
    const project = tempProject()
    const state = writeInitialState({
      ...BASE,
      root: project,
      resolution: resolveVersionMode({ requested: null, local: '0.1.0-rc.7' }),
    })
    const loaded = readState(project)
    expect(loaded).toEqual(state)
    expect(loaded.schemaVersion).toBe(2)
    expect(loaded.plugState.status).toBe('clean')
  })

  it('maps a legacy schema-v1 state (type web) to both in memory without rewriting', () => {
    const project = tempProject()
    fs.mkdirSync(path.join(project, '.sandbox'), { recursive: true })
    const v1 = {
      schemaVersion: 1,
      project: { name: 'dsh-demo', type: 'web', root: project },
      dsh: { version: '0.1.0-rc.8', mode: 'local', override: null },
      sandbox: { dshHome: 'x', profile: 'web', baselineBundles: [], dshInstall: null },
      dependencies: { profilePlugins: [], projectDeps: {} },
      plugState: { status: 'clean', lastPluggedAt: null, lastSnapshotId: null },
      knowledgePack: { version: 'v0.1.2', lastWrittenAt: null },
      notes: { lastGeneratedAt: null, noteCount: 0 },
    }
    fs.writeFileSync(path.join(project, '.sandbox', 'state.json'), JSON.stringify(v1), 'utf8')
    const loaded = readState(project)
    expect(loaded.schemaVersion).toBe(2)
    expect(loaded.project.type).toBe('both')
    // 无强制迁移回写：磁盘文件仍是 schema 1 / type web。
    const onDisk = JSON.parse(fs.readFileSync(path.join(project, '.sandbox', 'state.json'), 'utf8'))
    expect(onDisk.schemaVersion).toBe(1)
    expect(onDisk.project.type).toBe('web')
  })

  it('rejects a state file with an unsupported schema version', () => {
    const project = tempProject()
    fs.mkdirSync(path.join(project, '.sandbox'), { recursive: true })
    fs.writeFileSync(
      path.join(project, '.sandbox', 'state.json'),
      JSON.stringify({ schemaVersion: 99 }),
      'utf8',
    )
    expect(() => readState(project)).toThrow(StateError)
  })

  it('reports a missing state file clearly', () => {
    const project = tempProject()
    expect(() => readState(project)).toThrow(/state.json 不存在/)
  })

  it('keeps user edits outside managed fields intact', () => {
    const project = tempProject()
    const state = writeInitialState({
      ...BASE,
      root: project,
      resolution: resolveVersionMode({ requested: null, local: '0.1.0-rc.7' }),
    })
    const next = setPlugStatus(state, 'plugged', 'snap-1')
    writeState(project, next)
    expect(readState(project).plugState).toMatchObject({
      status: 'plugged',
      lastSnapshotId: 'snap-1',
    })
  })
})

describe('drift / mixed-version helpers', () => {
  it('detects declared vs actual drift', () => {
    expect(versionDrift('0.1.0-rc.7', '0.1.0-rc.7')).toBe(false)
    expect(versionDrift('0.1.0-rc.7', '0.1.0-rc.8')).toBe(true)
  })

  it('flags profile plugins whose version differs from the sandbox runtime', () => {
    const project = tempProject()
    let state = writeInitialState({
      ...BASE,
      root: project,
      resolution: resolveVersionMode({ requested: null, local: '0.1.0-rc.7' }),
    })
    expect(mixedVersionDetail(state)).toBeNull()
    state = {
      ...state,
      dependencies: {
        ...state.dependencies,
        profilePlugins: [
          {
            name: '@deepseek-ai/dsh-tool-fs',
            version: '0.1.0-rc.6',
            addedBy: 'deps',
            addedAt: new Date().toISOString(),
          },
        ],
      },
    }
    expect(mixedVersionDetail(state)).toMatch(/0\.1\.0-rc\.6/)
  })

  it('updates the knowledge-pack anchor version', () => {
    const project = tempProject()
    const state = writeInitialState({
      ...BASE,
      root: project,
      resolution: resolveVersionMode({ requested: null, local: '0.1.0-rc.7' }),
    })
    const upgraded = setKnowledgePackVersion(state, 'v0.2.0')
    expect(upgraded.knowledgePack.version).toBe('v0.2.0')
  })
})

describe('initialState', () => {
  it('writes all schema-v1 sections (design §5.1)', () => {
    const state = initialState({
      ...BASE,
      root: 'E:/demo',
      resolution: { mode: 'standalone', version: '0.1.0-rc.6', override: '0.1.0-rc.6' },
      dshInstall: 'E:/demo/.sandbox/dsh-install',
    })
    expect(state.dsh.mode).toBe('standalone')
    expect(state.sandbox.dshInstall).toBe('E:/demo/.sandbox/dsh-install')
    expect(state.dependencies).toEqual({
      profilePlugins: [],
      projectDeps: {
        dependencies: {},
        devDependencies: {},
        peerDependencies: {},
      },
    })
  })
})
