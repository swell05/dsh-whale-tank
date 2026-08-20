import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { globalNodeModulesDir } from '../../src/core/proc.ts'
import { profileDir } from '../../src/core/paths.ts'
import { plug, unplug } from '../../src/core/plug.ts'
import { restore } from '../../src/core/restore.ts'
import { initSandbox, sandboxSelfCheck } from '../../src/core/sandbox.ts'
import { readState, setPlugStatus, writeState } from '../../src/core/state.ts'

describe('restore (two-level recovery)', () => {
  let globalRoot: string | null = null
  let project: string

  beforeAll(async () => {
    globalRoot = await globalNodeModulesDir('dsh')
    if (globalRoot === null) throw new Error('无法定位全局 dsh 安装')
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-restore-spec-'))
    copyFixture('demo-plugin', project)
    const init = await initSandbox({
      project,
      projectName: 'whale-tank-demo-plugin',
      projectType: 'host',
      requestedVersion: null,
      globalRoot: globalRoot!,
      knowledgePackVersion: 'v0.1.0',
    })
    expect(init.selfCheck.ok).toBe(true)
  })

  afterAll(() => {
    if (project !== undefined) fs.rmSync(project, { recursive: true, force: true })
  })

  it('recovers a dirty sandbox back to clean', async () => {
    await plug(project, { globalRoot: globalRoot! })
    // Manufacture a residue to force dirty.
    fs.mkdirSync(path.join(profileDir(project, 'headless'), 'node_modules', 'residual-pkg'), {
      recursive: true,
    })
    const result = await unplug(project, { globalRoot: globalRoot! })
    expect(result.status).toBe('dirty')

    const restored = await restore(project, { globalRoot: globalRoot! })
    expect(restored.smoke.ok).toBe(true)
    const state = readState(project)
    expect(state.plugState.status).toBe('clean')
    const check = await sandboxSelfCheck(project, { globalRoot: globalRoot! })
    expect(check.ok).toBe(true)
  })

  it('reset rebuilds the sandbox from scratch after confirmation', async () => {
    const { resetSandbox } = await import('../../src/core/sandbox.ts')
    const reset = await resetSandbox(project, {
      globalRoot: globalRoot!,
      yes: true,
    })
    expect(reset.selfCheck.ok).toBe(true)
    expect(readState(project).plugState.status).toBe('clean')
  })
})

function copyFixture(name: string, target: string): void {
  const source = path.resolve('tests/fixtures', name)
  const stack = [source]
  while (stack.length > 0) {
    const current = stack.pop()!
    const rel = path.relative(source, current)
    const dest = path.join(target, rel)
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else {
        fs.mkdirSync(path.dirname(path.join(dest, entry.name)), { recursive: true })
        fs.copyFileSync(full, path.join(dest, entry.name))
      }
    }
  }
}
