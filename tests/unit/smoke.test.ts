import { describe, expect, it } from 'vitest'
import {
  assertDumpConfig,
  assertHostBootStderr,
  assertWebBootSettled,
  parseDumpConfigLayers,
} from '../../src/core/smoke.ts'

const DUMP_OK = [
  '# == @deepseek-ai/dsh-base',
  '# == @deepseek-ai/dsh-base',
  '# == @deepseek-ai/dsh-base, patched by @deepseek-ai/dsh-headless',
  '# == @deepseek-ai/dsh-headless',
  '# == my-plugin',
  '',
].join('\n')

describe('parseDumpConfigLayers', () => {
  it('extracts layer ids in composition order', () => {
    expect(parseDumpConfigLayers(DUMP_OK)).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-headless',
      'my-plugin',
    ])
  })
})

describe('assertDumpConfig', () => {
  it('passes when the plugin layer exists and bundle order matches', () => {
    const result = assertDumpConfig(DUMP_OK, {
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', 'my-plugin'],
      pluginId: 'my-plugin',
    })
    expect(result.ok).toBe(true)
  })

  it('fails when the plugin layer is missing', () => {
    const result = assertDumpConfig(DUMP_OK, {
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
      pluginId: 'missing-plugin',
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('missing-plugin')
  })

  it('fails when the layer order disagrees with bundles', () => {
    const result = assertDumpConfig(DUMP_OK, {
      bundles: ['my-plugin', '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
      pluginId: 'my-plugin',
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('顺序')
  })
})

describe('assertHostBootStderr', () => {
  it('passes when the tree settles without load errors (MISSING_CREDENTIAL)', () => {
    const result = assertHostBootStderr(
      'dsh: MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"',
    )
    expect(result.ok).toBe(true)
  })

  it('fails on plugin tree failed to load even when MISSING_CREDENTIAL appears', () => {
    const result = assertHostBootStderr(
      'dsh: plugin tree failed to load ... Cannot find module lib/missing.js\ndsh: MISSING_CREDENTIAL ...',
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('plugin tree failed to load')
  })

  it('fails on EADDRINUSE (port conflict)', () => {
    const result = assertHostBootStderr(
      'Error: EADDRINUSE 127.0.0.1:3080\ndsh: MISSING_CREDENTIAL ...',
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('EADDRINUSE')
  })

  it('fails on too many arguments (wrong profile invocation)', () => {
    const result = assertHostBootStderr(
      'too many arguments: got 2 but expected 0 ("say", "ok")\ndsh: ...',
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('参数过多')
  })

  it('passes on clean web boot with --port 0 (reaches MISSING_CREDENTIAL on free port)', () => {
    // 真实 web boot（--port 0 --no-open）的 stderr：凭据缺失是 dsh 全局行为。
    const result = assertHostBootStderr(
      'dsh: MISSING_CREDENTIAL: llm-deepseek: no API key configured for provider "deepseek-official"',
    )
    expect(result.ok).toBe(true)
  })

  it('fails on completely unknown output (no evidence of boot reaching settle)', () => {
    const result = assertHostBootStderr('something else entirely')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('MISSING_CREDENTIAL')
  })
})

describe('assertWebBootSettled（票06）', () => {
  it('accepts the web server start address as the settle signal', () => {
    const result = assertWebBootSettled('dsh web: http://127.0.0.1:39688\n', '')
    expect(result.ok).toBe(true)
  })

  it('fails on a plugin tree load failure even when an address is printed', () => {
    const result = assertWebBootSettled(
      'dsh web: http://127.0.0.1:39688\n',
      'Error: plugin tree failed to load',
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('plugin tree')
  })

  it('fails when no server address appears', () => {
    const result = assertWebBootSettled('', 'something else')
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('dsh web:')
  })
})
