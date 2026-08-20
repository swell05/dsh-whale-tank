import { describe, expect, it } from 'vitest'
import * as entry from '../src/index.ts'
import { createTestContext } from './harness.ts'

describe('loader stub (client-only)', () => {
  it('exports a Cordis plugin shape', () => {
    expect(entry.name).toBe('{{name}}')
    expect(typeof entry.apply).toBe('function')
    expect(Array.isArray(entry.inject)).toBe(true)
  })

  it('applies cleanly on an isolated context (no throw)', () => {
    const ctx = createTestContext()
    expect(() => entry.apply(ctx)).not.toThrow()
  })
})

describe('client half', () => {
  it('exports a client plugin shape', async () => {
    const client = await import('../src/client/index.ts')
    expect(client.name).toBe('{{name}}-client')
    expect(typeof client.apply).toBe('function')
  })
})
