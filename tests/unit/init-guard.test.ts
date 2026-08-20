import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertInitSafe } from '../../src/tools/definitions.ts'

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-guard-'))
}

describe('assertInitSafe (init refuses non-empty uninitialized dirs)', () => {
  it('allows a missing or empty directory', () => {
    expect(() => assertInitSafe(path.join(tempDir(), 'missing'), false)).not.toThrow()
    const empty = tempDir()
    expect(() => assertInitSafe(empty, false)).not.toThrow()
  })

  it('allows an already-initialized project (has .sandbox/state.json)', () => {
    const project = tempDir()
    fs.mkdirSync(path.join(project, '.sandbox'), { recursive: true })
    fs.writeFileSync(path.join(project, '.sandbox', 'state.json'), '{}', 'utf8')
    expect(() => assertInitSafe(project, false)).not.toThrow()
  })

  it('refuses a non-empty directory without state.json', () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, 'package.json'), '{}', 'utf8')
    expect(() => assertInitSafe(project, false)).toThrow(/拒绝 init/)
  })

  it('skips the guard in plan-only mode', () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, 'package.json'), '{}', 'utf8')
    expect(() => assertInitSafe(project, true)).not.toThrow()
  })
})
