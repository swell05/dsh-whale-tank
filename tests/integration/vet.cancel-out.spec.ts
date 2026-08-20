import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { globalNodeModulesDir } from '../../src/core/proc.ts'
import { vetStatic, vetDynamic, vetReport } from '../../src/core/vet.ts'

describe('vet.cancel-out (replica + plug/unplug + local zero-change)', () => {
  let workspace: string
  let globalRoot: string | null
  let localHome: string

  beforeAll(async () => {
    globalRoot = await globalNodeModulesDir('dsh')
    if (globalRoot === null) throw new Error('无法定位全局 dsh 安装')
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-vet-cancel-'))
    localHome = fakeDshHome()
  })

  afterAll(() => {
    if (workspace !== undefined) fs.rmSync(workspace, { recursive: true, force: true })
  })

  it('runs the full dynamic pipeline: replica → gate → cancel-out → local zero-change', async () => {
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
      globalRoot: globalRoot!,
      localHome,
      profile: 'headless',
      vetDir: staticResult.vetDir,
    })
    expect(dynamic.executed).toBe(true)
    expect(dynamic.cancelOut.checked).toBe(true)
    expect(dynamic.cancelOut.clean).toBe(true)
    const result = await vetReport({
      workspace,
      localHome,
      profile: 'headless',
      vetDir: staticResult.vetDir,
    })
    expect(result.localUntouched.clean).toBe(true)
    expect(result.conclusion).toBe('recommended')
    // Default lifecycle: the vetting sandbox is burned, reports remain.
    expect(result.reportPaths.vetDir).toBeNull()
    expect(fs.existsSync(result.reportPaths.report)).toBe(true)
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
