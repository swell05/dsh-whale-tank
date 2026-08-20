import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runDshPlugin, runDshProfile } from '../../src/core/dsh.ts'
import { globalNodeModulesDir } from '../../src/core/proc.ts'
import { initSandbox, twoStepSmoke } from '../../src/core/sandbox.ts'
import { readState } from '../../src/core/state.ts'
import { profileDir } from '../../src/core/paths.ts'

describe('sandbox.init (real dsh, isolated DSH_HOME)', () => {
  let globalRoot: string | null = null
  let project: string
  const realHome = path.join(os.homedir(), '.dsh')
  const realHomeBefore = new Map<string, string>()

  beforeAll(async () => {
    globalRoot = await globalNodeModulesDir('dsh')
    if (globalRoot === null) {
      throw new Error('无法定位全局 dsh 安装（需要 dsh 在 PATH 中）')
    }
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-init-spec-'))
    if (fs.existsSync(realHome)) {
      for (const [file, stat] of walkMeta(realHome)) {
        realHomeBefore.set(file, stat)
      }
    }
  })

  afterAll(() => {
    if (project !== undefined) {
      fs.rmSync(project, { recursive: true, force: true })
    }
  })

  it('initializes a headless baseline with state.json and a clean selfcheck', async () => {
    const result = await initSandbox({
      project,
      projectName: 'whale-tank-init-spec',
      projectType: 'host',
      requestedVersion: null,
      globalRoot: globalRoot!,
      knowledgePackVersion: 'v0.1.0',
    })
    expect(result.selfCheck.ok).toBe(true)
    const state = readState(project)
    expect(state.schemaVersion).toBe(2)
    expect(state.dsh.mode).toBe('local')
    expect(state.sandbox.profile).toBe('headless')
    expect(state.sandbox.baselineBundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-headless',
    ])
    const manifest = JSON.parse(
      fs.readFileSync(path.join(profileDir(project, 'headless'), 'package.json'), 'utf8'),
    ) as { dsh?: { profile?: { bundles?: string[] } } }
    expect(manifest.dsh?.profile?.bundles).toContain('@deepseek-ai/dsh-headless')
  })

  it('dump-config shows the headless composition tree', async () => {
    const state = readState(project)
    const dump = await runDshProfile({
      project,
      globalRoot: globalRoot!,
      mode: state.dsh.mode,
      profile: 'headless',
      argv: ['--dump-config'],
    })
    expect(dump.exitCode).toBe(0)
    expect(dump.stdout).toContain('@deepseek-ai/dsh-headless')
  })

  it('the bounded boot reaches MISSING_CREDENTIAL without LLM/credentials', async () => {
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

  it('two-step smoke rejects a plugin whose entry cannot load', async () => {
    const state = readState(project)
    const broken = path.resolve('tests/fixtures/broken-plugin')
    const add = await runDshPlugin({
      project,
      globalRoot: globalRoot!,
      mode: state.dsh.mode,
      profile: 'headless',
      argv: ['add', `file:${broken}`],
      timeoutMs: 120_000,
    })
    expect(add.exitCode).toBe(0)
    const smoke = await twoStepSmoke(project, {
      globalRoot: globalRoot!,
      profile: 'headless',
      pluginId: 'whale-tank-broken-plugin',
      bundles: [...state.sandbox.baselineBundles, 'whale-tank-broken-plugin'],
    })
    expect(smoke.ok).toBe(false)
    expect(smoke.reason).toContain('plugin tree failed to load')
  })

  it('leaves the real ~/.dsh metadata byte-for-byte untouched', async () => {
    if (!fs.existsSync(realHome)) return
    const after = new Map<string, string>()
    for (const [file, stat] of walkMeta(realHome)) {
      after.set(file, stat)
    }
    const beforeKeys = [...realHomeBefore.keys()].sort()
    const afterKeys = [...after.keys()].sort()
    expect(afterKeys).toEqual(beforeKeys)
    for (const key of beforeKeys) {
      expect(after.get(key)).toBe(realHomeBefore.get(key))
    }
  })
})

function walkMeta(root: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      // lstatSync：dsh 的 profiles/node_modules 符号链接农场允许悬空链接
      // （指向已消失的旧 nvm 安装），statSync 跟随会 ENOENT 崩掉。
      // 记录链接本体 + 目标，不跟随——"真实 home 未被 whale-tank 改动"
      // 的断言对链接自身的 size/mtime/target 同样有效。
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
