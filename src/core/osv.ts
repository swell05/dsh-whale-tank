import fs from 'node:fs'
import path from 'node:path'

export interface OsvPackage {
  name: string
  version: string
}

export interface OsvHit {
  pkg: string
  version: string
  vulnId: string
  summary: string | null
  severity: string | null
  aliases: string[]
  references: string[]
}

export interface OsvScanResult {
  hits: OsvHit[]
  degraded: string[]
  cached: boolean
}

/**
 * OSV querybatch 主源（决策 08 规格）：无 key 批量查询 → 命中按 id 补拉详情
 * → 本地缓存；任一方失败 → 降级并在报告标注"在线扫描未完成"，不阻塞结论。
 */
export async function osvScan(
  packages: OsvPackage[],
  opts: {
    cacheDir: string
    timeoutMs?: number
    fetchImpl?: typeof fetch
  },
): Promise<OsvScanResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const degraded: string[] = []
  const hits: OsvHit[] = []
  let cached = false
  const cacheDir = path.join(opts.cacheDir, 'osv')
  fs.mkdirSync(cacheDir, { recursive: true })

  const uncached: OsvPackage[] = []
  for (const pkg of packages) {
    const cacheFile = path.join(cacheDir, `${pkg.name}@${pkg.version}.json`)
    if (fs.existsSync(cacheFile)) {
      cached = true
      try {
        const stored = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as {
          hits: OsvHit[]
        }
        hits.push(...stored.hits)
        continue
      } catch {
        // fall through to re-fetch
      }
    }
    uncached.push(pkg)
  }

  const signal = AbortSignal.timeout(opts.timeoutMs ?? 30_000)
  try {
    for (let i = 0; i < uncached.length; i += 1000) {
      const chunk = uncached.slice(i, i + 1000)
      const response = await fetchImpl('https://api.osv.dev/v1/querybatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          queries: chunk.map((pkg) => ({
            package: { ecosystem: 'npm', name: pkg.name },
            version: pkg.version,
          })),
        }),
        signal,
      })
      if (!response.ok) throw new Error(`OSV querybatch HTTP ${response.status}`)
      const body = (await response.json()) as { results: Array<{ vulns?: Array<{ id: string }> }> }
      for (let j = 0; j < body.results.length; j++) {
        const pkg = chunk[j]
        const vulnIds = body.results[j]?.vulns?.map((v) => v.id) ?? []
        for (const vulnId of vulnIds) {
          const hit = await fetchDetail(vulnId, fetchImpl, signal)
          hits.push({ pkg: pkg.name, version: pkg.version, ...hit })
        }
        writeCache(cacheDir, pkg, hits)
      }
    }
  } catch (error) {
    degraded.push(`osv：${String(error)}`)
  }
  return { hits, degraded, cached }
}

async function fetchDetail(
  vulnId: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<Omit<OsvHit, 'pkg' | 'version'>> {
  const response = await fetchImpl(`https://api.osv.dev/v1/vulns/${encodeURIComponent(vulnId)}`, {
    signal,
  })
  if (!response.ok) {
    return { vulnId, summary: null, severity: null, aliases: [], references: [] }
  }
  const detail = (await response.json()) as {
    summary?: string
    severity?: Array<{ type: string; score: string }>
    aliases?: string[]
    references?: Array<{ url: string }>
  }
  return {
    vulnId,
    summary: detail.summary ?? null,
    severity: detail.severity?.[0]?.score ?? null,
    aliases: detail.aliases ?? [],
    references: (detail.references ?? []).map((ref) => ref.url),
  }
}

function writeCache(
  cacheDir: string,
  pkg: OsvPackage,
  allHits: OsvHit[],
): void {
  const entries = allHits.filter((hit) => hit.pkg === pkg.name && hit.version === pkg.version)
  const file = path.join(cacheDir, `${pkg.name}@${pkg.version}.json`)
  fs.writeFileSync(file, JSON.stringify({ hits: entries }, null, 2) + '\n', 'utf8')
}
