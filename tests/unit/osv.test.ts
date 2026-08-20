import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { osvScan } from '../../src/core/osv.ts'

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-osv-'))
}

describe('osvScan (best-effort online dependency scan)', () => {
  it('aggregates batch hits, fetches details, and caches them', async () => {
    const calls: string[] = []
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push(url)
      if (url.includes('/querybatch')) {
        return new Response(
          JSON.stringify({
            results: [{ vulns: [{ id: 'GHSA-abc' }] }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      if (url.includes('/vulns/GHSA-abc')) {
        return new Response(
          JSON.stringify({
            summary: 'ReDoS in lodash',
            severity: [{ type: 'CVSS_V3', score: '7.5' }],
            aliases: ['CVE-2021-23337'],
            references: [{ url: 'https://example.com/advisory' }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      throw new Error(`unexpected url ${url}`)
    }) as unknown as typeof fetch

    const cacheDir = path.join(tempDir(), '.cache')
    const first = await osvScan(
      [{ name: 'lodash', version: '4.17.20' }],
      { cacheDir, fetchImpl: fakeFetch },
    )
    expect(first.hits).toHaveLength(1)
    expect(first.hits[0]).toMatchObject({
      pkg: 'lodash',
      vulnId: 'GHSA-abc',
      summary: 'ReDoS in lodash',
      severity: '7.5',
    })
    expect(first.degraded).toEqual([])
    expect(fs.existsSync(path.join(cacheDir, 'osv', 'lodash@4.17.20.json'))).toBe(true)

    const second = await osvScan(
      [{ name: 'lodash', version: '4.17.20' }],
      { cacheDir, fetchImpl: fakeFetch },
    )
    expect(second.cached).toBe(true)
    expect(second.hits).toHaveLength(1)
    expect(calls.filter((url) => url.includes('/querybatch'))).toHaveLength(1)
  })

  it('degrades gracefully and never blocks the conclusion on network failure', async () => {
    const failingFetch = (async () => {
      throw new Error('network unreachable')
    }) as unknown as typeof fetch
    const result = await osvScan([{ name: 'x', version: '1.0.0' }], {
      cacheDir: path.join(tempDir(), '.cache'),
      fetchImpl: failingFetch,
    })
    expect(result.hits).toEqual([])
    expect(result.degraded.some((d) => d.includes('network unreachable'))).toBe(true)
  })
})
