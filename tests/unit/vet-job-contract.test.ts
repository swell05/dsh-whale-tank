import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { startVetDynamicJob } from '../../src/core/vet.ts'

describe('startVetDynamicJob JobOutcome contract', () => {
  it('resolves done with a terminal status (not code/output)', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-job-'))
    const vetDir = path.join(workspace, '.vetting', 'demo-plugin')
    fs.mkdirSync(vetDir, { recursive: true })
    fs.writeFileSync(
      path.join(vetDir, 'vet-progress.json'),
      JSON.stringify({
        package: 'demo-plugin',
        version: '1.0.0',
        source: 'npm',
        phases: [{ phase: 'static', at: new Date().toISOString() }],
      }),
      'utf8',
    )
    // 静态命中高危：vetDynamic 直接返回，不碰 dsh。
    fs.writeFileSync(
      path.join(vetDir, 'findings.json'),
      JSON.stringify({
        findings: [{ severity: 'critical', rule: 'install-script', file: 'package.json', evidence: 'x' }],
        gated: true,
      }),
      'utf8',
    )
    let captured: { run: () => unknown } | undefined
    const jobs = {
      start: (spec: { run: () => unknown }) => {
        captured = spec
        return 'whale-tank-vet-1'
      },
    }
    const handle = await startVetDynamicJob({
      workspace,
      globalRoot: '',
      localHome: os.tmpdir(),
      vetDir,
      jobs: jobs as never,
    })
    expect(handle.jobId).toBe('whale-tank-vet-1')
    expect(captured).toBeDefined()
    const hooks = captured!.run() as {
      done: Promise<{ status?: string; code?: number }>
      readOutput?: () => string
      cancel: (reason?: string) => void
    }
    const outcome = await hooks.done
    expect(outcome.status).toBe('completed')
    expect(outcome.code).toBeUndefined()
  })
})
