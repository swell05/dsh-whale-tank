import { describe, expect, it } from 'vitest'
import * as entry from '../src/index.ts'
import { createTestContext } from './harness.ts'

describe('plugin entry', () => {
  it('exports a Cordis plugin shape (name / inject / apply)', () => {
    expect(entry.name).toBe('{{name}}')
    expect(typeof entry.apply).toBe('function')
    expect(Array.isArray(entry.inject)).toBe(true)
  })

  it('applies cleanly on an isolated context (no throw)', () => {
    const ctx = createTestContext()
    expect(() => entry.apply(ctx, {})).not.toThrow()
  })

  it('exposes the ./invariant contract anchor', async () => {
    const invariant = await import('../src/invariant.ts')
    expect(invariant.PACKAGE_NAME).toBe('{{name}}')
    expect(invariant.CONTRACT.exports).toContain('./invariant')
  })
})
