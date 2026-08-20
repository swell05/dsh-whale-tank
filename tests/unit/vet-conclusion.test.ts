import { describe, expect, it } from 'vitest'
import { conclusionLabel } from '../../src/core/vet.ts'

describe('conclusionLabel (conservative wording)', () => {
  it('labels all-green as 未发现漏洞, never 建议安装', () => {
    expect(conclusionLabel('recommended')).toBe('未发现漏洞')
    expect(conclusionLabel('recommended')).not.toBe('建议安装')
  })

  it('maps the other tiers', () => {
    expect(conclusionLabel('caution')).toBe('谨慎')
    expect(conclusionLabel('not-recommended')).toBe('不建议')
  })
})

import { conclude } from '../../src/core/vet.ts'
import type { VetFinding, VetResult } from '../../src/core/types.ts'

const cleanOk: VetResult['cleanRun'] = {
  ok: true,
  skipped: false,
  vanillaBoot: { ok: true, reason: null },
  cancelOut: { checked: true, clean: true, residual: [] },
  missingPeers: [],
  issues: [],
  degraded: [],
}
const cleanFail: VetResult['cleanRun'] = {
  ...cleanOk,
  ok: false,
  issues: [{ severity: 'critical', rule: 'clean-activation', file: null, evidence: 'x' }],
}
const replicaOk: VetResult['replicaRun'] = { ok: true, skipped: false, degraded: [] }
const replicaSkipped: VetResult['replicaRun'] = { ok: false, skipped: true, degraded: [] }

function run(overrides: {
  cleanRun?: VetResult['cleanRun']
  replicaRun?: VetResult['replicaRun']
  conflicts?: VetFinding[]
  findings?: VetFinding[]
  cancelOut?: VetResult['cancelOut']
  executed?: boolean
}) {
  return conclude({
    findings: overrides.findings ?? [],
    conflicts: overrides.conflicts ?? [],
    cancelOut: overrides.cancelOut ?? { checked: true, clean: true, residual: [] },
    executed: overrides.executed ?? true,
    cleanRun: overrides.cleanRun ?? cleanOk,
    replicaRun: overrides.replicaRun ?? replicaOk,
  })
}

describe('conclude 三分支（票15）', () => {
  it('clean 失败 → 不建议（即使无冲突）', () => {
    expect(run({ cleanRun: cleanFail })).toBe('not-recommended')
  })

  it('clean 过 + replica warning 冲突 → 谨慎', () => {
    const warning: VetFinding = { severity: 'warning', rule: 'activation', file: null, evidence: 'x' }
    expect(run({ conflicts: [warning] })).toBe('caution')
  })

  it('clean 过 + replica critical 冲突 → 不建议', () => {
    const critical: VetFinding = { severity: 'critical', rule: 'activation', file: null, evidence: 'x' }
    expect(run({ conflicts: [critical] })).toBe('not-recommended')
  })

  it('双过 → 建议', () => {
    expect(run({})).toBe('recommended')
  })

  it('replica 跳过（stage-gate）→ 谨慎（clean 过但未跑复刻）', () => {
    expect(run({ replicaRun: replicaSkipped })).toBe('caution')
  })
})

import { missingPeersOf } from '../../src/core/vet.ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('missingPeersOf（票15）', () => {
  it('exempts official peers (cordis/@deepseek-ai) injected by the profile', () => {
    const cand = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-peer-cand-'))
    fs.writeFileSync(
      path.join(cand, 'package.json'),
      JSON.stringify({ peerDependencies: { '@deepseek-ai/cordis': '^4.0.1', 'lodash': '^4' } }),
    )
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-peer-home-'))
    const moduleDir = path.join(home, 'profiles', 'headless', 'node_modules')
    fs.mkdirSync(moduleDir, { recursive: true })
    // 官方 cordis 由闭包注入豁免；lodash 未装 → 缺。
    expect(missingPeersOf(cand, home, 'headless')).toEqual(['lodash'])
  })

  it('reports nothing when the module dir is absent and only official peers exist', () => {
    const cand = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-peer-cand2-'))
    fs.writeFileSync(
      path.join(cand, 'package.json'),
      JSON.stringify({ peerDependencies: { '@deepseek-ai/cordis': '^4.0.1' } }),
    )
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-peer-home2-'))
    expect(missingPeersOf(cand, home, 'headless')).toEqual([])
  })
})

import { decideReplica, localInstalledInfo } from '../../src/core/vet.ts'

describe('decideReplica（票16）', () => {
  const local = (v: { present: boolean; version: string | null; reference: string | null }) => v

  it('same version installed locally → skip replica with a three-part hint', () => {
    const d = decideReplica('my-plugin', local({ present: true, version: '1.0.0', reference: '1.0.0' }), '1.0.0', false)
    expect(d.skip).toBe(true)
    expect(d.skipReason).toContain('replica 已跳过')
    expect(d.skipReason).toContain('--env both')
  })

  it('explicit --env ignores the auto-skip', () => {
    const d = decideReplica('my-plugin', local({ present: true, version: '1.0.0', reference: '1.0.0' }), '1.0.0', true)
    expect(d.skip).toBe(false)
  })

  it('older local version → upgrade mode with migration note', () => {
    const d = decideReplica('my-plugin', local({ present: true, version: '0.9.0', reference: '0.9.0' }), '1.0.0', false)
    expect(d.skip).toBe(false)
    expect(d.upgradeMode).not.toBeNull()
    expect(d.upgradeMode?.note).toContain('0.9.0 → 候选 1.0.0')
    expect(d.upgradeMode?.note).toContain('升级场景')
  })

  it('file: reference → overwritten with source-change note', () => {
    const d = decideReplica('my-plugin', local({ present: true, version: null, reference: 'file:../local' }), '1.0.0', false)
    expect(d.skip).toBe(false)
    expect(d.upgradeMode?.note).toContain('file:/link: 引用')
    expect(d.upgradeMode?.note).toContain('来源变化')
  })

  it('not installed → plain run', () => {
    const d = decideReplica('my-plugin', local({ present: false, version: null, reference: null }), '1.0.0', false)
    expect(d.skip).toBe(false)
    expect(d.upgradeMode).toBeNull()
  })
})

describe('localInstalledInfo（票16）', () => {
  it('reads the local profile dependencies read-only', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-li-'))
    const prof = path.join(home, 'profiles', 'headless')
    fs.mkdirSync(prof, { recursive: true })
    fs.writeFileSync(
      path.join(prof, 'package.json'),
      JSON.stringify({ dependencies: { 'my-plugin': '1.0.0', other: 'file:../x' } }),
    )
    const info = localInstalledInfo(home, 'headless', 'my-plugin')
    expect(info).toEqual({ present: true, version: '1.0.0', reference: '1.0.0' })
    const fileRef = localInstalledInfo(home, 'headless', 'other')
    expect(fileRef).toEqual({ present: true, version: null, reference: 'file:../x' })
    expect(localInstalledInfo(home, 'headless', 'absent')).toEqual({ present: false, version: null, reference: null })
  })
})
