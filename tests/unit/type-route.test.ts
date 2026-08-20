import { describe, expect, it } from 'vitest'
import {
  baselineProfileFor,
  normalizeType,
  skeletonTemplateFor,
} from '../../src/core/type-route.ts'

describe('normalizeType（票04）', () => {
  it('maps the legacy web alias to both', () => {
    expect(normalizeType('web')).toBe('both')
  })

  it('keeps host, client, both unchanged', () => {
    expect(normalizeType('host')).toBe('host')
    expect(normalizeType('client')).toBe('client')
    expect(normalizeType('both')).toBe('both')
  })

  it('throws a clear error on unknown types', () => {
    expect(() => normalizeType('tui' as never)).toThrow(/host/)
    expect(() => normalizeType('' as never)).toThrow(/host/)
  })
})

describe('baselineProfileFor（票04）', () => {
  it('routes host to headless', () => {
    expect(baselineProfileFor('host')).toBe('headless')
  })

  it('routes both and client to web', () => {
    expect(baselineProfileFor('both')).toBe('web')
    expect(baselineProfileFor('client')).toBe('web')
  })
})

describe('skeletonTemplateFor（票06 三套官方基座）', () => {
  it('routes each normalized type to its own base template', () => {
    expect(skeletonTemplateFor('host')).toBe('host')
    expect(skeletonTemplateFor('both')).toBe('both')
    expect(skeletonTemplateFor('client')).toBe('client')
  })
})
