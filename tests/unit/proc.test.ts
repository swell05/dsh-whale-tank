import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertDshHome,
  dshHomeEnv,
  findCommandPath,
  runProcess,
  runNodeScript,
  type RunResult,
} from '../../src/core/proc.ts'

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-proc-'))
}

/** A tiny node script that echoes env/args and writes to stderr. */
function makeEchoScript(dir: string): string {
  const script = path.join(dir, 'echo.mjs')
  fs.writeFileSync(
    script,
    [
      `console.log(JSON.stringify({ argv: process.argv.slice(2), dshHome: process.env.DSH_HOME ?? null }))`,
      `console.error('echo-stderr')`,
      `process.exitCode = Number(process.argv[3] ?? 0)`,
    ].join('\n'),
    'utf8',
  )
  return script
}

describe('runProcess', () => {
  it('captures stdout/stderr and env from a node child', async () => {
    const dir = tempDir()
    const script = makeEchoScript(dir)
    const result: RunResult = await runProcess({
      command: process.execPath,
      args: [script, '--hello', '7'],
      cwd: dir,
      env: { DSH_HOME: 'E:/demo/.sandbox/dsh-home' },
    })
    expect(result.exitCode).toBe(7)
    expect(result.stdout).toContain('--hello')
    expect(result.stdout).toContain('E:/demo/.sandbox/dsh-home')
    expect(result.stderr).toContain('echo-stderr')
    expect(result.timedOut).toBe(false)
  })

  it('kills the child on timeout', async () => {
    const dir = tempDir()
    const script = path.join(dir, 'slow.mjs')
    fs.writeFileSync(script, `setInterval(() => {}, 1000);\n`, 'utf8')
    const result: RunResult = await runProcess({
      command: process.execPath,
      args: [script],
      cwd: dir,
      timeoutMs: 500,
    })
    expect(result.timedOut).toBe(true)
  })
})

describe('findCommandPath（PATH 目录扫描，不 spawn）', () => {
  it('resolves node via PATH scanning (no where/which spawn)', async () => {
    const resolved = await findCommandPath('node')
    expect(resolved).not.toBeNull()
    expect(fs.existsSync(resolved!)).toBe(true)
  })

  it('returns null for a nonexistent command without throwing', async () => {
    const resolved = await findCommandPath('whale-tank-definitely-not-installed-xyz')
    expect(resolved).toBeNull()
  })

  it('finds an executable placed in a PATH directory', async () => {
    const fakeBin = tempDir()
    const marker = path.join(fakeBin, 'wt-fake-tool.cmd')
    fs.writeFileSync(marker, '@echo off\r\n', 'utf8')
    const oldPath = process.env.PATH
    process.env.PATH = `${fakeBin}${path.delimiter}${oldPath}`
    try {
      const resolved = await findCommandPath('wt-fake-tool')
      expect(resolved).toBe(marker)
    } finally {
      process.env.PATH = oldPath
    }
  })
})

describe('DSH_HOME guard', () => {
  it('rejects blank DSH_HOME (blank falls back to the real home)', () => {
    expect(() => dshHomeEnv('')).toThrow(/非空/)
    expect(() => dshHomeEnv('   ')).toThrow(/非空/)
  })

  it('asserts non-empty via assertDshHome', () => {
    expect(() => assertDshHome('')).toThrow(/非空/)
    expect(assertDshHome('E:/demo/.sandbox/dsh-home')).toBe('E:/demo/.sandbox/dsh-home')
  })

  it('returns a DSH_HOME env map without clobbering unrelated vars', () => {
    const env = dshHomeEnv('E:/demo/.sandbox/dsh-home', { FOO: 'bar' })
    expect(env.DSH_HOME).toBe('E:/demo/.sandbox/dsh-home')
    expect(env.FOO).toBe('bar')
  })
})

describe('runNodeScript', () => {
  it('runs an .mjs script via the current node executable', async () => {
    const dir = tempDir()
    const script = makeEchoScript(dir)
    const result = await runNodeScript(script, ['ok'])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('ok')
  })
})
