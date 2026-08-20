import { runNodeScript, resolveNpmEntry, type RunResult } from './proc.ts'

export type NpmProbeKind = 'OK' | 'PACKAGE_NOT_FOUND' | 'VERSION_NOT_FOUND' | 'NETWORK_UNAVAILABLE'

export interface NpmProbeResult {
  ok: boolean
  kind: NpmProbeKind
  /** 包存在时的最新版本（PACKAGE_NOT_FOUND / VERSION_NOT_FOUND 时相关）。 */
  latestVersion: string | null
  /** 拼错/复制不全时的相似候选（top 3-5，registry search 相似度+热度）。 */
  suggestions: string[]
  /** 版本不存在时最近 5 个可用版本。 */
  recentVersions: string[]
  /** 网络失败等降级时的告警（不进错误通道）。 */
  warning: string | null
}

export interface NpmProbeDeps {
  runNpm?: (args: string[], opts: { cwd: string }) => Promise<RunResult>
  fetchJson?: (url: string) => Promise<unknown>
}

/**
 * 包名预检：`npm view <pkg> version --json` 走调用方 .npmrc
 * （兼容 npmmirror/代理，不硬编码 registry 域名）。
 * - 包不存在 → { ok:false, kind:'PACKAGE_NOT_FOUND', suggestions:[...] }
 *   （registry search 按相似度+热度，由调用 agent 问用户，绝不自动改写）；
 * - 版本不存在 → { ok:false, kind:'VERSION_NOT_FOUND', recentVersions:[近5] }；
 * - 网络失败 → 降级放行 { ok:true, warning }（后续 pnpm 安装自然报错）。
 */
export async function probeNpmPackage(
  pkg: string,
  version: string | null,
  deps: NpmProbeDeps = {},
): Promise<NpmProbeResult> {
  const npmEntry = await resolveNpmEntry()
  const runNpm = deps.runNpm ?? (async (args, opts) =>
    runNodeScript(npmEntry, args, { cwd: opts.cwd, timeoutMs: 120_000 }))
  const fetchJson = deps.fetchJson ?? (async (url: string) => {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`registry HTTP ${response.status}`)
    return response.json()
  })

  // 1) 存在性：npm view <pkg> version --json
  const view = await runNpm(['view', pkg, 'version', '--json'], { cwd: process.cwd() })
  if (view.exitCode === 0) {
    const latest = parseVersionOutput(view.stdout)
    if (version !== null && version !== '') {
      const pinned = await runNpm(['view', `${pkg}@${version}`, 'version', '--json'], {
        cwd: process.cwd(),
      })
      if (pinned.exitCode !== 0) {
        const recent = await listRecentVersions(pkg, runNpm)
        return {
          ok: false,
          kind: 'VERSION_NOT_FOUND',
          latestVersion: latest,
          suggestions: [],
          recentVersions: recent,
          warning: null,
        }
      }
    }
    return {
      ok: true,
      kind: 'OK',
      latestVersion: latest,
      suggestions: [],
      recentVersions: [],
      warning: null,
    }
  }

  // 2) 失败分类：404 = 包不存在；其余（网络/源）→ 降级放行。
  const stderr = view.stderr ?? ''
  if (/E404|is not in this registry|no matching version|404/i.test(stderr)) {
    let suggestions: string[] = []
    try {
      suggestions = await searchSuggestions(pkg, fetchJson)
    } catch {
      // suggestions 拿不到不影响主流程（只影响建议质量）。
    }
    return {
      ok: false,
      kind: 'PACKAGE_NOT_FOUND',
      latestVersion: null,
      suggestions,
      recentVersions: [],
      warning: null,
    }
  }
  return {
    ok: true,
    kind: 'NETWORK_UNAVAILABLE',
    latestVersion: null,
    suggestions: [],
    recentVersions: [],
    warning: `registry 不可达/查询失败（${pkg}）：${stderr.slice(0, 200)}——降级放行，后续 pnpm 安装自然报错。`,
  }
}

/** 解析 npm view --json 的单版本输出（可能带引号/换行）。 */
export function parseVersionOutput(stdout: string): string | null {
  const text = stdout.trim()
  if (text === '') return null
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed === 'string') return parsed
    if (typeof parsed === 'object' && parsed !== null) {
      const value = (parsed as Record<string, unknown>)[Object.keys(parsed as object)[0]]
      if (typeof value === 'string') return value
    }
    return null
  } catch {
    return text.replace(/^['"]|['"]$/g, '') || null
  }
}

async function listRecentVersions(
  pkg: string,
  runNpm: (args: string[], opts: { cwd: string }) => Promise<RunResult>,
): Promise<string[]> {
  try {
    const result = await runNpm(['view', pkg, 'versions', '--json'], { cwd: process.cwd() })
    if (result.exitCode !== 0) return []
    const parsed = JSON.parse(result.stdout) as unknown
    const versions = Array.isArray(parsed)
      ? (parsed as string[]).filter((v) => typeof v === 'string')
      : typeof parsed === 'object' && parsed !== null
        ? Object.keys(parsed as Record<string, unknown>)
        : []
    return versions.slice(-5)
  } catch {
    return []
  }
}

async function searchSuggestions(
  pkg: string,
  fetchJson: (url: string) => Promise<unknown>,
): Promise<string[]> {
  const registry = await currentRegistry()
  const data = (await fetchJson(
    `${registry}/-/v1/search?text=${encodeURIComponent(pkg)}&size=5`,
  )) as { objects?: Array<{ package?: { name?: string } }> }
  return (data.objects ?? [])
    .map((entry) => entry.package?.name)
    .filter((name): name is string => typeof name === 'string' && name !== pkg)
    .slice(0, 5)
}

/** 从 `npm config get registry` 读 registry（走调用方 .npmrc，不硬编码域名）。 */
export async function currentRegistry(): Promise<string> {
  const npmEntry = await resolveNpmEntry()
  const result = await runNodeScript(npmEntry, ['config', 'get', 'registry'], {
    cwd: process.cwd(),
    timeoutMs: 60_000,
  })
  const value = result.stdout.trim().replace(/\/$/, '')
  return value !== '' ? value : 'https://registry.npmjs.org'
}
