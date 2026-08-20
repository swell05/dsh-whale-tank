import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCliInvocation } from '../../src/core/cli-run.ts'

describe('CLI 分派（grill 决策：CLI 不提供 init、.wttools 取代用户面）', () => {
  it('does not provide the init verb, pointing users to /whale-tank-init', async () => {
    const outcome = await runCliInvocation({
      verb: 'init',
      flags: { name: 'dsh-demo', type: 'host' },
      cwd: process.cwd(),
    })
    expect(outcome.exitCode).toBe(2)
    expect(outcome.text).toContain('不提供 init')
    expect(outcome.text).toContain('/whale-tank-init')
  })

  it('lists the surviving workspace commands (run-test included) for an unknown verb', async () => {
    const outcome = await runCliInvocation({
      verb: 'nonsense',
      flags: {},
      cwd: process.cwd(),
    })
    expect(outcome.exitCode).toBe(2)
    expect(outcome.text).toContain('run-test')
    expect(outcome.text).not.toContain('可用：status / init')
  })

  it('run-test on an uninitialized project fails with a clear error', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-cli-run-'))
    const outcome = await runCliInvocation({
      verb: 'run-test',
      flags: {},
      cwd: empty,
    })
    expect(outcome.exitCode).toBe(1)
    expect(outcome.text).toContain('错误：')
  })
})
