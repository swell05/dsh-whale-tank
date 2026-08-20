import fs from 'node:fs'
import path from 'node:path'
import { runPnpmIn } from './dsh.ts'
import { removeTree } from './fsutil.ts'
import { profileDirFor } from './paths.ts'

export interface ReplicaResult {
  profile: string
  warnings: string[]
}

/**
 * 复刻（决策 12/17，设计 §5.3）：从真实 ~/.dsh 拷贝 profile 清单
 * （package.json / cordis.patch.yml / pnpm-workspace.yaml），pnpm 安装到
 * 复刻 profile（allowBuilds 保持空 → install 脚本默认禁）。不拷贝凭据 /
 * sessions / settings / cache。
 */
export async function replicateProfile(opts: {
  sourceHome: string
  targetSandboxRoot: string
  profile: string
  signal?: AbortSignal
}): Promise<ReplicaResult> {
  const source = path.join(opts.sourceHome, 'profiles', opts.profile)
  const target = profileDirFor(opts.targetSandboxRoot, opts.profile)
  const warnings: string[] = []
  fs.mkdirSync(target, { recursive: true })

  for (const name of ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml']) {
    const src = path.join(source, name)
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(target, name))
    } else if (name === 'package.json') {
      throw new Error(`真实 profile ${opts.profile} 缺少 package.json：${source}`)
    }
  }

  // file:/link: 本地源缺失 → 告警跳过并记入报告（决策 12）。
  const manifest = JSON.parse(
    fs.readFileSync(path.join(target, 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> }
  for (const [name, spec] of Object.entries(manifest.dependencies ?? {})) {
    if (/^file:|^link:/.test(spec)) {
      const localPath = spec.replace(/^file:|^link:/, '')
      if (!fs.existsSync(localPath)) {
        warnings.push(
          `file: 依赖 ${name}（${spec}）本地源缺失，跳过安装并记入报告。`,
        )
      }
    }
  }

  const install = await runPnpmIn(target, ['install'], {
    timeoutMs: 300_000,
    signal: opts.signal,
  })
  if (install.exitCode !== 0 && !install.stderr.includes('ERR_PNPM_IGNORED_BUILDS')) {
    throw new Error(`复刻 profile 安装失败：\n${install.stderr || install.stdout}`)
  }
  if (install.stderr.includes('ERR_PNPM_IGNORED_BUILDS')) {
    warnings.push('复刻环境安装脚本保持禁用（allowBuilds 空白名单，安全默认）。')
  }
  return { profile: opts.profile, warnings }
}

/**
 * 本地未受影响自检的盯防范围（2026-08-19 实机修正）：只盯高价值路径。
 * `sessions/`、`storages/`、`cache/`、`task-board/` 等运行时活目录由宿主持续写入，
 * 属于恒定噪音（session_projcache.json 等缓存文件写了不算）；
 * 候选包跑在沙盒 DSH_HOME，真要逃逸写真实 home，目标只可能是下面这些。
 */
const LOCAL_WATCH_PREFIXES = [
  'profiles',
  '.agent-presets',
  '.credentials.yaml',
  'settings.yaml',
  '.anonymous-user-id',
]

export function isLocalWatchPath(relative: string): boolean {
  return LOCAL_WATCH_PREFIXES.some(
    (prefix) => relative === prefix || relative.startsWith(prefix + '/') || relative.startsWith(prefix + '\\'),
  )
}

/** 真实 ~/.dsh 元数据基线：白名单路径 → size:mtime（本地未受影响自检用）。 */
export function localHomeMetadata(homeDir: string): Map<string, string> {
  const out = new Map<string, string>()
  if (!fs.existsSync(homeDir)) return out
  const stack = [homeDir]
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else {
        const relative = path.relative(homeDir, full)
        if (!isLocalWatchPath(relative)) continue
        const stat = fs.statSync(full)
        out.set(full, `${stat.size}:${stat.mtimeMs}`)
      }
    }
  }
  return out
}

export function metadataEqual(a: Map<string, string>, b: Map<string, string>): {
  clean: boolean
  detail: string | null
} {
  const aKeys = [...a.keys()].sort()
  const bKeys = [...b.keys()].sort()
  if (JSON.stringify(aKeys) !== JSON.stringify(bKeys)) {
    const added = bKeys.filter((key) => !a.has(key))
    const removed = aKeys.filter((key) => !b.has(key))
    return {
      clean: false,
      detail: `真实 ~/.dsh 元数据变化：新增 ${added.length} 项、移除 ${removed.length} 项。`,
    }
  }
  for (const key of aKeys) {
    if (a.get(key) !== b.get(key)) {
      return { clean: false, detail: `真实 ~/.dsh 文件变化：${key}` }
    }
  }
  return { clean: true, detail: null }
}

/** 候选获取：local 目录拷贝 / git clone / npm tarball（设计 §6.7 第 2 步）。 */
export async function acquireCandidate(opts: {
  source: 'npm' | 'git' | 'local'
  pkg: string
  version: string | null
  targetDir: string
}): Promise<{ dir: string; warnings: string[] }> {
  const warnings: string[] = []
  const candidateDir = path.join(opts.targetDir, 'candidate')
  fs.mkdirSync(candidateDir, { recursive: true })

  if (opts.source === 'local') {
    if (!fs.existsSync(opts.pkg)) {
      throw new Error(`本地候选源不存在：${opts.pkg}`)
    }
    copyTree(opts.pkg, candidateDir)
    return { dir: candidateDir, warnings }
  }

  if (opts.source === 'git') {
    const { runProcessChecked } = await import('./proc.ts')
    const clone = await runProcessChecked({
      command: 'git',
      args: ['clone', '--depth', '1', opts.pkg, candidateDir],
      timeoutMs: 300_000,
    })
    if (clone.exitCode !== 0) {
      throw new Error(`git clone 失败：\n${clone.stderr || clone.stdout}`)
    }
    return { dir: candidateDir, warnings }
  }

  // npm：npm pack + tar 解包（registry 可达性失败 → 明确告警）。
  const { runNodeScript } = await import('./proc.ts')
  const { resolveNpmEntry } = await import('./proc.ts')
  const npmEntry = await resolveNpmEntry()
  const spec = opts.version === null ? opts.pkg : `${opts.pkg}@${opts.version}`
  const pack = await runNodeScript(npmEntry, ['pack', spec, '--pack-destination', opts.targetDir], {
    cwd: opts.targetDir,
    timeoutMs: 300_000,
  })
  if (pack.exitCode !== 0) {
    throw new Error(`npm pack 失败（${spec}）：\n${pack.stderr || pack.stdout}`)
  }
  const tarball = fs
    .readdirSync(opts.targetDir)
    .find((name) => name.endsWith('.tgz'))
  if (tarball === undefined) throw new Error('npm pack 未产出 tarball。')
  const { runProcess } = await import('./proc.ts')
  const extract = await runProcess({
    command: 'tar',
    args: ['-xzf', tarball, '-C', candidateDir, '--strip-components=1'],
    cwd: opts.targetDir,
    timeoutMs: 60_000,
  })
  if (extract.exitCode !== 0) {
    throw new Error(`tarball 解包失败：\n${extract.stderr}`)
  }
  return { dir: candidateDir, warnings }
}

function copyTree(source: string, target: string): void {
  const stack = [source]
  while (stack.length > 0) {
    const current = stack.pop()!
    const rel = path.relative(source, current)
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        stack.push(full)
      } else {
        const dest = path.join(target, rel, entry.name)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(full, dest)
      }
    }
  }
}

export { removeTree }
