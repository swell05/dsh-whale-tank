import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { vetReport } from '../../src/core/vet.ts'

function tempWorkspace(): { workspace: string; home: string; vetDir: string } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-report-'))
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-fakehome-'))
  const vetDir = path.join(workspace, '.vetting', 'demo-plugin')
  fs.mkdirSync(vetDir, { recursive: true })
  return { workspace, home, vetDir }
}

function seed(vetDir: string, overrides: { llm?: unknown; dynamic?: unknown } = {}): void {
  fs.writeFileSync(
    path.join(vetDir, 'vet-progress.json'),
    JSON.stringify({
      package: 'demo-plugin',
      version: '1.0.0',
      source: 'local',
      phases: [{ phase: 'static', at: new Date().toISOString() }],
    }),
    'utf8',
  )
  fs.writeFileSync(path.join(vetDir, 'local-baseline.json'), '{}', 'utf8')
  fs.writeFileSync(
    path.join(vetDir, 'findings.json'),
    JSON.stringify({ findings: [], gated: false }),
    'utf8',
  )
  fs.writeFileSync(
    path.join(vetDir, 'conflicts.json'),
    JSON.stringify(
      overrides.dynamic ?? {
        executed: true,
        staticGated: false,
        conflicts: [],
        cancelOut: { checked: true, clean: true, residual: [] },
        degraded: [],
      },
    ),
    'utf8',
  )
  if (overrides.llm !== undefined) {
    fs.writeFileSync(path.join(vetDir, 'llm-findings.json'), JSON.stringify(overrides.llm), 'utf8')
  }
}

describe('vetReport LLM findings merge (恢复的 LLM 审查汇入结论)', () => {
  it('downgrades to not-recommended on an LLM critical finding', async () => {
    const { workspace, home, vetDir } = tempWorkspace()
    seed(vetDir, {
      llm: {
        findings: [
          { severity: 'critical', evidence: '源码在特定时序下会把会话数据写回真实 home 路径' },
        ],
      },
    })
    const result = await vetReport({ workspace, localHome: home, keep: true, vetDir })
    expect(result.conclusion).toBe('not-recommended')
    expect(result.llmFindings).toHaveLength(1)
    expect(result.llmFindings?.[0].rule).toBe('llm-review')
    const report = fs.readFileSync(result.reportPaths.report, 'utf8')
    expect(report).toContain('LLM 语义审查')
    expect(report).toContain('特定时序下会把会话数据写回真实 home')
  })

  it('keeps recommended when no LLM findings are provided', async () => {
    const { workspace, home, vetDir } = tempWorkspace()
    seed(vetDir)
    const result = await vetReport({ workspace, localHome: home, keep: true, vetDir })
    expect(result.conclusion).toBe('recommended')
    expect(result.llmFindings).toBeUndefined()
  })

  it('downgrades to caution on an LLM warning', async () => {
    const { workspace, home, vetDir } = tempWorkspace()
    seed(vetDir, {
      llm: { findings: [{ severity: 'warning', evidence: 'README 描述与实际行为略有出入' }] },
    })
    const result = await vetReport({ workspace, localHome: home, keep: true, vetDir })
    expect(result.conclusion).toBe('caution')
  })
})
