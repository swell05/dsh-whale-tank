import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { globalNodeModulesDir } from '../../src/core/proc.ts'
import { initSandbox } from '../../src/core/sandbox.ts'
import { readState } from '../../src/core/state.ts'
import { standaloneDshVersion } from '../../src/core/versions.ts'
import { runDshProfile } from '../../src/core/dsh.ts'

describe('standalone version mode (ticket 09)', () => {
  let globalRoot: string | null = null
  let project: string

  beforeAll(async () => {
    globalRoot = await globalNodeModulesDir('dsh')
    if (globalRoot === null) throw new Error('无法定位全局 dsh 安装')
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-standalone-spec-'))
  })

  afterAll(async () => {
    if (project !== undefined) {
      const { removeTree } = await import('../../src/core/fsutil.ts')
      removeTree(project)
    }
  })

  it('installs a pinned dsh copy and boots the baseline from it', async () => {
    const init = await initSandbox({
      project,
      projectName: 'whale-tank-standalone-spec',
      projectType: 'host',
      requestedVersion: '0.1.0-rc.6',
      globalRoot: globalRoot!,
      knowledgePackVersion: 'v0.1.0',
    })
    expect(init.selfCheck.ok).toBe(true)
    const state = readState(project)
    expect(state.dsh.mode).toBe('standalone')
    expect(state.dsh.version).toBe('0.1.0-rc.6')
    expect(state.sandbox.dshInstall).toContain('.sandbox')
    expect(standaloneDshVersion(project)).toBe('0.1.0-rc.6')
  }, 300_000)

  it('standalone runtime boots from the copy with its own closure', async () => {
    const state = readState(project)
    const boot = await runDshProfile({
      project,
      globalRoot: globalRoot!,
      mode: state.dsh.mode,
      profile: 'headless',
      argv: ['say ok'],
      timeoutMs: 30_000,
    })
    expect(boot.stderr).toContain('MISSING_CREDENTIAL')
    expect(boot.stderr).not.toContain('plugin tree failed to load')
  })

  it('status detects drift when the copy version differs from the state record', async () => {
    const { collectStatus } = await import('../../src/core/status.ts')
    const status = collectStatus(project, { globalRoot: globalRoot! })
    expect(status.versionMode).toBe('standalone')
    expect(status.actualDshVersion).toBe('0.1.0-rc.6')
    expect(status.versionDrift).toBe(false)
  })
})
