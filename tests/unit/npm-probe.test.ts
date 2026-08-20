import { describe, expect, it } from 'vitest'
import {
  parseVersionOutput,
  probeNpmPackage,
  type NpmProbeDeps,
} from '../../src/core/npm-probe.ts'
import type { RunResult } from '../../src/core/proc.ts'

function runReturning(
  respond: (args: string[]) => Partial<RunResult>,
): NpmProbeDeps['runNpm'] {
  return async (args) => ({
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
    ...respond(args),
  })
}

describe('parseVersionOutput（票14）', () => {
  it('parses a plain version string and JSON-quoted output', () => {
    expect(parseVersionOutput('0.1.0-rc.8')).toBe('0.1.0-rc.8')
    expect(parseVersionOutput('"0.1.0"')).toBe('0.1.0')
    expect(parseVersionOutput('')).toBeNull()
  })
})

describe('probeNpmPackage（票14）', () => {
  it('returns OK for an existing package', async () => {
    const result = await probeNpmPackage('@deepseek-ai/dsh', null, {
      runNpm: runReturning((args) => {
        if (args.includes('version')) return { exitCode: 0, stdout: '"0.1.0-rc.8"' }
        return { exitCode: 0, stdout: '{}' }
      }),
      fetchJson: async () => ({ objects: [] }),
    })
    expect(result.ok).toBe(true)
    expect(result.kind).toBe('OK')
    expect(result.latestVersion).toBe('0.1.0-rc.8')
  })

  it('returns PACKAGE_NOT_FOUND with suggestions and never rewrites input', async () => {
    const seen: string[] = []
    const result = await probeNpmPackage('dsh-plugib', null, {
      runNpm: runReturning((args) => {
        seen.push(args[1])
        return { exitCode: 1, stderr: 'npm error code E404: not found' }
      }),
      fetchJson: async () => ({
        objects: [
          { package: { name: 'dsh-plugin' } },
          { package: { name: 'dsh-plugins' } },
        ],
      }),
    })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('PACKAGE_NOT_FOUND')
    expect(result.suggestions).toEqual(['dsh-plugin', 'dsh-plugins'])
    expect(seen).toEqual(['dsh-plugib'])
  })

  it('returns VERSION_NOT_FOUND with the five most recent versions', async () => {
    const versions = ['1.0.0', '1.1.0', '1.2.0', '1.3.0', '1.4.0', '2.0.0', '2.1.0']
    const result = await probeNpmPackage('dsh-plugin', '9.9.9', {
      runNpm: runReturning((args) => {
        const i = args.indexOf('view')
        const spec = args[i + 1] ?? ''
        if (spec.includes('@')) return { exitCode: 1, stderr: 'E404 no matching version' }
        if (args.includes('versions')) return { exitCode: 0, stdout: JSON.stringify(versions) }
        return { exitCode: 0, stdout: '"2.1.0"' }
      }),
      fetchJson: async () => ({ objects: [] }),
    })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('VERSION_NOT_FOUND')
    expect(result.recentVersions).toEqual(versions.slice(-5))
  })

  it('degrades to OK (pass-through) on network failures', async () => {
    const result = await probeNpmPackage('dsh-plugin', null, {
      runNpm: runReturning((args) => ({
        exitCode: 1,
        stderr: 'ERR_SOCKET_TIMEOUT: request timed out',
      })),
      fetchJson: async () => ({ objects: [] }),
    })
    expect(result.ok).toBe(true)
    expect(result.kind).toBe('NETWORK_UNAVAILABLE')
    expect(result.warning).toContain('降级放行')
  })
})
