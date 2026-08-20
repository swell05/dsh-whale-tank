import { describe, expect, it } from 'vitest'
import {
  CAPABILITY_FAMILIES,
  capabilityFamily,
  validateCapabilities,
  type Capability,
} from '../../src/core/capability.ts'

describe('capability family (票07)', () => {
  it('assigns host-family capabilities to host and client-family to client', () => {
    expect(capabilityFamily('tools')).toBe('host')
    expect(capabilityFamily('commands')).toBe('host')
    expect(capabilityFamily('mcp-server')).toBe('host')
    expect(capabilityFamily('cli')).toBe('host')
    expect(capabilityFamily('skills')).toBe('host')
    expect(capabilityFamily('mcp-client')).toBe('client')
    expect(capabilityFamily('toolview')).toBe('client')
  })
})

describe('validateCapabilities (票07)', () => {
  it('accepts a client-only capability set for a client project', () => {
    const result = validateCapabilities('client', ['toolview', 'mcp-client'])
    expect(result.ok).toBe(true)
  })

  it('rejects host-family capabilities for a client project with a clear family note', () => {
    const result = validateCapabilities('client', ['tools'])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reasons.some((r) => r.includes('tools'))).toBe(true)
      expect(result.reasons.some((r) => r.includes('host'))).toBe(true)
    }
  })

  it('rejects client-family capabilities for a host project', () => {
    const result = validateCapabilities('host', ['toolview'])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reasons.some((r) => r.includes('toolview'))).toBe(true)
      expect(result.reasons.some((r) => r.includes('client'))).toBe(true)
    }
  })

  it('accepts both families for a both project', () => {
    const result = validateCapabilities('both', ['tools', 'toolview', 'mcp-client', 'cli'])
    expect(result.ok).toBe(true)
  })

  it('accepts an empty capability set for any type', () => {
    expect(validateCapabilities('host', []).ok).toBe(true)
    expect(validateCapabilities('client', []).ok).toBe(true)
    expect(validateCapabilities('both', []).ok).toBe(true)
  })
})
