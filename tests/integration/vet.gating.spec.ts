import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { globalNodeModulesDir } from '../../src/core/proc.ts'
import { vetStatic, vetDynamic, vetReport } from '../../src/core/vet.ts'

describe('vet.gating (static rules, stage gate, reports)', () => {
  let workspace: string
  let localHome: string

  beforeAll(async () => {
    await globalNodeModulesDir('dsh') // sanity: dsh present
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-vet-gating-'))
    localHome = fakeDshHome()
  })

  afterAll(() => {
    if (workspace !== undefined) fs.rmSync(workspace, { recursive: true, force: true })
  })

  it('blocks a malicious fixture at the static gate (no execution)', async () => {
    const staticResult = await vetStatic({
      workspace,
      source: 'local',
      pkg: path.resolve('tests/fixtures/malicious-plugin'),
      version: null,
      localHome,
    })
    expect(staticResult.gated).toBe(true)
    const dynamic = await vetDynamic({
      workspace,
      globalRoot: (await globalNodeModulesDir('dsh'))!,
      localHome,
      vetDir: staticResult.vetDir,
    })
    expect(dynamic.staticGated).toBe(true)
    expect(dynamic.executed).toBe(false)
    const result = await vetReport({
      workspace,
      localHome,
      vetDir: staticResult.vetDir,
    })
    expect(result.conclusion).toBe('not-recommended')
    expect(result.findings.some((f) => f.rule === 'install-script')).toBe(true)
    expect(fs.existsSync(result.reportPaths.report)).toBe(true)
    expect(fs.existsSync(result.reportPaths.result)).toBe(true)
    const report = fs.readFileSync(result.reportPaths.report, 'utf8')
    expect(report).toContain('启发式预检，非安全保证')
    expect(report).toContain('不防本机执行')
  })

  it('runs a benign fixture statically with --no-exec and concludes caution', async () => {
    const staticResult = await vetStatic({
      workspace,
      source: 'local',
      pkg: path.resolve('tests/fixtures/benign-plugin'),
      version: null,
      localHome,
    })
    expect(staticResult.gated).toBe(false)
    const dynamic = await vetDynamic({
      workspace,
      globalRoot: (await globalNodeModulesDir('dsh'))!,
      localHome,
      vetDir: staticResult.vetDir,
      noExec: true,
    })
    expect(dynamic.executed).toBe(false)
    const result = await vetReport({
      workspace,
      localHome,
      vetDir: staticResult.vetDir,
    })
    expect(result.conclusion).toBe('caution')
    expect(result.degraded.some((d) => d.includes('--no-exec'))).toBe(true)
  })
})

function fakeDshHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-fakehome-'))
  const profile = path.join(home, 'profiles', 'headless')
  fs.mkdirSync(profile, { recursive: true })
  fs.writeFileSync(
    path.join(profile, 'package.json'),
    JSON.stringify({
      name: 'dsh-profile-headless',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] } },
    }),
    'utf8',
  )
  fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), '[]\n', 'utf8')
  fs.writeFileSync(
    path.join(profile, 'pnpm-workspace.yaml'),
    'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n',
    'utf8',
  )
  fs.writeFileSync(path.join(home, '.credentials.yaml'), '', 'utf8')
  fs.writeFileSync(path.join(home, 'settings.yaml'), '', 'utf8')
  return home
}
