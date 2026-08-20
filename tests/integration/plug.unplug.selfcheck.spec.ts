import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { globalNodeModulesDir } from '../../src/core/proc.ts'
import { profileDir } from '../../src/core/paths.ts'
import { plug, unplug } from '../../src/core/plug.ts'
import { initSandbox } from '../../src/core/sandbox.ts'
import { readState } from '../../src/core/state.ts'

describe('plug.unplug.selfcheck (real dsh, isolated DSH_HOME)', () => {
  let globalRoot: string | null = null
  let project: string
  const realHome = path.join(os.homedir(), '.dsh')
  const realHomeBefore = new Map<string, string>()

  beforeAll(async () => {
    globalRoot = await globalNodeModulesDir('dsh')
    if (globalRoot === null) {
      throw new Error('无法定位全局 dsh 安装（需要 dsh 在 PATH 中）')
    }
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-plug-spec-'))
    // The target is an existing plugin project (contract A) that receives a
    // whale-tank sandbox via initSandbox.
    copyFixture('demo-plugin', project)
    if (fs.existsSync(realHome)) {
      for (const [file, stat] of walkMeta(realHome)) {
        realHomeBefore.set(file, stat)
      }
    }
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
    if (project !== undefined) {
      fs.rmSync(project, { recursive: true, force: true })
    }
  })

  it('runs plug → smoke → unplug → diff=0 → clean (full lifecycle)', async () => {
    const plugged = await plug(project, { globalRoot: globalRoot! })
    expect(plugged.smoke.ok).toBe(true)
    expect(readState(project).plugState.status).toBe('plugged')

    const unplugged = await unplug(project, { globalRoot: globalRoot! })
    expect(unplugged.diff.clean).toBe(true)
    expect(unplugged.status).toBe('clean')
    expect(readState(project).plugState.status).toBe('clean')
    // The profile manifest must no longer list the plugin bundle.
    const manifest = JSON.parse(
      fs.readFileSync(path.join(profileDir(project, 'headless'), 'package.json'), 'utf8'),
    ) as { dsh?: { profile?: { bundles?: string[] } } }
    expect(manifest.dsh?.profile?.bundles).not.toContain('whale-tank-demo-plugin')
  })

  it('detects a manufactured residue as dirty', async () => {
    await plug(project, { globalRoot: globalRoot! })
    // Manufacture a residual: a stray top-level package in the profile.
    fs.mkdirSync(path.join(profileDir(project, 'headless'), 'node_modules', 'residual-pkg'), {
      recursive: true,
    })
    const unplugged = await unplug(project, { globalRoot: globalRoot! })
    expect(unplugged.status).toBe('dirty')
    expect(
      unplugged.diff.items.some(
        (item) => item.category === 'node-modules' && item.path.includes('residual-pkg'),
      ),
    ).toBe(true)
    expect(readState(project).plugState.status).toBe('dirty')
    // Clean up the manufactured residue so the suite stays hermetic.
    fs.rmSync(path.join(profileDir(project, 'headless'), 'node_modules', 'residual-pkg'), {
      recursive: true,
      force: true,
    })
    fs.rmSync(path.join(project, '.sandbox', 'snapshots'), { recursive: true, force: true })
    const { setPlugStatus, writeState } = await import('../../src/core/state.ts')
    writeState(project, setPlugStatus(readState(project), 'clean', null))
  })

  it('leaves the real ~/.dsh metadata untouched', async () => {
    if (!fs.existsSync(realHome)) return
    const after = new Map<string, string>()
    for (const [file, stat] of walkMeta(realHome)) {
      after.set(file, stat)
    }
    expect([...after.keys()].sort()).toEqual([...realHomeBefore.keys()].sort())
    for (const key of realHomeBefore.keys()) {
      expect(after.get(key)).toBe(realHomeBefore.get(key))
    }
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

function walkMeta(root: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      // lstatSync：dsh 的 profiles/node_modules 符号链接农场允许悬空链接
      // （指向已消失的旧 nvm 安装），statSync 跟随会 ENOENT 崩掉。
      const stat = fs.lstatSync(full)
      if (stat.isSymbolicLink()) {
        out.push([full, `link->${stat.size}:${stat.mtimeMs}:${fs.readlinkSync(full)}`])
      } else if (stat.isDirectory()) {
        stack.push(full)
      } else {
        out.push([full, `${stat.size}:${stat.mtimeMs}`])
      }
    }
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]))
}
