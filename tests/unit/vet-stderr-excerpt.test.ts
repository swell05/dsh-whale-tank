import { describe, expect, it } from 'vitest'
import { stderrExcerpt } from '../../src/core/vet.ts'

describe('stderrExcerpt (boot 失败关键行提取)', () => {
  it('extracts the loader/activation error lines', () => {
    const stderr = [
      'some noise line',
      'dsh: plugin tree failed to load: failed to import loader entry demo-plugin: Cannot find module lib/missing.js',
      '    at finalizeResolution (node:internal/modules/esm/resolve:275:11)',
      'more noise',
    ].join('\n')
    const excerpt = stderrExcerpt(stderr)
    expect(excerpt).toContain('plugin tree failed to load')
    expect(excerpt).toContain('Cannot find module lib/missing.js')
    expect(excerpt).not.toContain('some noise line')
  })

  it('extracts duplicate registration lines', () => {
    const excerpt = stderrExcerpt('x\ndsh: already registered: provider "tools" duplicate\ny')
    expect(excerpt).toContain('already registered')
  })

  it('returns empty when nothing relevant is present', () => {
    expect(stderrExcerpt('ok\nfine')).toBe('')
  })
})
