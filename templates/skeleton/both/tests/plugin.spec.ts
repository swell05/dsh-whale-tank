import { describe, expect, it } from 'vitest'
import * as entry from '../src/index.ts'
import { createTestContext } from './harness.ts'
import type { EchoRequest } from '../src/types/shared.ts'

describe('plugin entry (host half)', () => {
  it('exports a Cordis plugin shape (name / inject / apply)', () => {
    expect(entry.name).toBe('{{name}}')
    expect(typeof entry.apply).toBe('function')
    expect(Array.isArray(entry.inject)).toBe(true)
  })

  it('applies cleanly on an isolated context (no throw)', () => {
    const ctx = createTestContext()
    expect(() => entry.apply(ctx, {})).not.toThrow()
  })

  it('re-exports the shared types for host consumers', () => {
    const req: EchoRequest = { message: 'ping' }
    expect(req.message).toBe('ping')
  })
})

describe('client half', () => {
  it('exports a client plugin shape', async () => {
    const client = await import('../src/client/index.ts')
    expect(client.name).toBe('{{name}}-client')
    expect(typeof client.apply).toBe('function')
  })
})
