import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { runDshWithHome } from './dsh.ts'
import { analyzePackage } from './harm.ts'
import { probeNpmPackage, type NpmProbeResult } from './npm-probe.ts'
import { vettingDir } from './paths.ts'
import { removeTree } from './fsutil.ts'
import {
  acquireCandidate,
  localHomeMetadata,
  metadataEqual,
  replicateProfile,
} from './replica.ts'
import { collectSnapshot, diffSnapshot } from './snapshot.ts'
import { BASELINE_BUNDLES } from './sandbox.ts'
import {
  assertDumpConfig,
  assertHostBootStderr,
  assertWebBootSettled,
  parseDumpConfigLayers,
} from './smoke.ts'
import type {
  BaselineProfile,
  DiffItem,
  ToolContextLike,
  VetFinding,
  VetResult,
} from './types.ts'

const requireResolve = createRequire(import.meta.url)

const DISCLAIMER = '启发式预检，非安全保证；决定权始终在用户。'
const BOUNDARY =
  '隔离边界：DSH_HOME 隔离 + 受限执行（partial enforcement）防状态污染，不防本机执行；网络行为只记录不阻断。'

/** 用户可读结论：全绿不宣称"建议安装"，用保守表述。 */
export function conclusionLabel(conclusion: VetResult['conclusion']): string {
  switch (conclusion) {
    case 'recommended':
      return '未发现漏洞'
    case 'caution':
      return '谨慎'
    case 'not-recommended':
      return '不建议'
  }
}

/**
 * vet 三阶段（2026-08-19 拆解）：static / dynamic / report。
 * 中间结果落盘到 vetDir，步骤可独立执行、可续跑：
 * - vet-progress.json  phase 时间戳 + pkg/version/source
 * - local-baseline.json 真实 ~/.dsh 白名单基线（static 采集，report 比对）
 * - findings.json       静态分析结果（static 写）
 * - conflicts.json      动态验证结果（dynamic 写）
 * 在线扫描（OSV）与 LLM 源码审查 v1 暂屏蔽，专注沙盒装载/卸载副作用清零。
 */

const PROGRESS_FILE = 'vet-progress.json'
const BASELINE_FILE = 'local-baseline.json'
const FINDINGS_FILE = 'findings.json'
const CONFLICTS_FILE = 'conflicts.json'

interface ProgressFile {
  package: string
  version: string | null
  source: 'npm' | 'git' | 'local'
  phases: Array<{ phase: string; at: string }>
}

export interface VetStaticOptions {
  workspace: string
  source: 'npm' | 'git' | 'local'
  pkg: string
  version: string | null
  localHome: string
  vetDir?: string
}

export interface VetStaticResult {
  vetDir: string
  candidatePath: string
  findings: VetFinding[]
  gated: boolean
  degraded: string[]
  /** 包名预检结果：null = 未预检/通过；拦截时含建议/近版本供 agent 问用户。 */
  probe: NpmProbeResult | null
}

export interface VetDynamicOptions {
  workspace: string
  globalRoot: string
  localHome: string
  profile?: BaselineProfile
  noExec?: boolean
  vetDir?: string
  yes?: boolean
  ctx?: ToolContextLike
  /** 逃生口：默认 both（自动判定 replica 跳过）；clean|replica|both 显式强制。 */
  env?: 'clean' | 'replica' | 'both'
  /** 步骤级实时进度（后台任务输出 / CLI 打印）。 */
  onProgress?: (line: string) => void
  /** 取消信号（job_kill）。 */
  signal?: AbortSignal
}

/** 本地已装检测：只读真实 ~/.dsh/profiles/<profile>/package.json dependencies。 */
export function localInstalledInfo(
  localHome: string,
  profile: string,
  pkg: string,
): { present: boolean; version: string | null; reference: string | null } {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(localHome, 'profiles', profile, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    const reference = manifest.dependencies?.[pkg]
    if (reference === undefined) return { present: false, version: null, reference: null }
    const version =
      typeof reference === 'string' && /^[\d^~>=<]/.test(reference) && !reference.includes(':')
        ? reference
        : null
    return { present: true, version, reference }
  } catch {
    return { present: false, version: null, reference: null }
  }
}

/** 候选版本：读 candidate package.json version。 */
export function candidateVersionOf(candidate: string): string {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(candidate, 'package.json'), 'utf8'),
    ) as { version?: string }
    return manifest.version ?? ''
  } catch {
    return ''
  }
}

export interface ReplicaDecision {
  skip: boolean
  skipReason: string | null
  upgradeMode: { from: string | null; to: string; note: string } | null
}

/**
 * replica 形态判定：本地已装同版 → 跳过（三处提示，--env 显式强制）；
 * 异版 → 升级模式；file:/link: 引用 → 覆写并注明来源变化。
 */
export function decideReplica(
  pkgName: string,
  local: { present: boolean; version: string | null; reference: string | null },
  candidateVersion: string,
  envExplicit: boolean,
): ReplicaDecision {
  if (!envExplicit && local.present && local.version !== null && local.version === candidateVersion) {
    return {
      skip: true,
      skipReason:
        `replica 已跳过：本地已安装并运行 ${pkgName}@${local.version}` +
        '（真实环境即冲突冒烟）；强制复检用 --env both',
      upgradeMode: null,
    }
  }
  if (local.present) {
    if (local.version !== null && local.version !== candidateVersion) {
      return {
        skip: false,
        skipReason: null,
        upgradeMode: {
          from: local.version,
          to: candidateVersion,
          note: `本地 ${local.version} → 候选 ${candidateVersion}，按升级场景验证（pnpm 同名 add 为替换语义）`,
        },
      }
    }
    if (local.version === null && local.reference !== null) {
      return {
        skip: false,
        skipReason: null,
        upgradeMode: {
          from: local.reference,
          to: candidateVersion,
          note: `本地为 file:/link: 引用（${local.reference}），候选将覆写该条目，来源变化`,
        },
      }
    }
  }
  return { skip: false, skipReason: null, upgradeMode: null }
}

export interface VetDynamicResult {
  executed: boolean
  staticGated: boolean
  conflicts: VetFinding[]
  cancelOut: VetResult['cancelOut']
  degraded: string[]
  /** 纯净体检。 */
  cleanRun: VetCleanRunResult | null
  /** 复刻体检：null = 未执行（stage-gate 跳过）。 */
  replicaRun: NonNullable<VetResult['replicaRun']> | null
}

export interface VetReportOptions {
  workspace: string
  localHome: string
  profile?: BaselineProfile
  keep?: boolean
  vetDir?: string
  /** 模型 LLM 审查结果文件（.vetting/<包>/llm-findings.json），可选。 */
  llmFindingsFile?: string
}

export interface VetReportResult extends VetResult {}

function resolveVetDir(
  workspace: string,
  pkg: string,
  version: string | null,
  explicit?: string,
): string {
  return explicit ?? vettingDir(workspace, sanitizeTag(pkg), version)
}

function progressPath(vetDir: string): string {
  return path.join(vetDir, PROGRESS_FILE)
}

function baselinePath(vetDir: string): string {
  return path.join(vetDir, BASELINE_FILE)
}

function findingsPath(vetDir: string): string {
  return path.join(vetDir, FINDINGS_FILE)
}

function conflictsPath(vetDir: string): string {
  return path.join(vetDir, CONFLICTS_FILE)
}

function markPhase(
  vetDir: string,
  phase: string,
  meta?: {
    package?: string
    version?: string | null
    source?: 'npm' | 'git' | 'local'
  },
): void {
  fs.mkdirSync(vetDir, { recursive: true })
  const current = readJsonOrNull(progressPath(vetDir)) as Partial<ProgressFile> | null
  const next: ProgressFile = {
    package: meta?.package ?? current?.package ?? '',
    version: meta?.version !== undefined ? meta.version : (current?.version ?? null),
    source: meta?.source ?? current?.source ?? 'local',
    phases: [...(current?.phases ?? []), { phase, at: new Date().toISOString() }],
  }
  fs.writeFileSync(progressPath(vetDir), JSON.stringify(next, null, 2) + '\n', 'utf8')
}

function readProgress(vetDir: string): ProgressFile {
  const file = progressPath(vetDir)
  if (!fs.existsSync(file)) {
    throw new Error(`缺少 vet 进度文件（${file}）：请先运行 whale_tank_vet_static。`)
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as ProgressFile
}

function readJsonOrNull(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 现场占用守卫：目标 vetDir 已存在说明上一次体检保留了现场（keep），
 * whale-tank 不会覆盖已有现场——取消本次体检，由用户手动删除或换工作区。
 */
export function assertVetDirFree(vetDir: string): void {
  if (fs.existsSync(vetDir)) {
    throw new Error(
      `检测到已有体检现场：${vetDir}\n` +
        `上一次体检结束后保留了现场。请手动删除该目录（或换一个工作区）后再体检；` +
        `本次体检已取消，whale-tank 不会覆盖已有现场。`,
    )
  }
}

/** 阶段一：取候选 + 静态危害分析 + 分级门 + 本地基线采集。 */
export async function vetStatic(opts: VetStaticOptions): Promise<VetStaticResult> {
  const vetDir = resolveVetDir(opts.workspace, opts.pkg, opts.version, opts.vetDir)
  assertVetDirFree(vetDir)
  markPhase(vetDir, 'static', {
    package: opts.pkg,
    version: opts.version,
    source: opts.source,
  })
  fs.writeFileSync(
    baselinePath(vetDir),
    JSON.stringify(Object.fromEntries(localHomeMetadata(opts.localHome)), null, 2) + '\n',
    'utf8',
  )
  // 包名预检：npm 源先查存在性；拼错/复制不全 → 结构化返回供 agent 问用户。
  let probe: NpmProbeResult | null = null
  let degraded: string[] = []
  if (opts.source === 'npm') {
    probe = await probeNpmPackage(opts.pkg, opts.version)
    if (probe.kind === 'PACKAGE_NOT_FOUND' || probe.kind === 'VERSION_NOT_FOUND') {
      return { vetDir, candidatePath: '', findings: [], gated: false, degraded, probe }
    }
    if (probe.kind === 'NETWORK_UNAVAILABLE') {
      degraded = [probe.warning ?? `registry 不可达（${opts.pkg}），降级放行。`]
    }
  }
  const acquired = await acquireCandidate({
    source: opts.source,
    pkg: opts.pkg,
    version: opts.version,
    targetDir: vetDir,
  })
  const staticResult = analyzePackage(acquired.dir)
  fs.writeFileSync(
    findingsPath(vetDir),
    JSON.stringify({ findings: staticResult.findings, gated: staticResult.gated }, null, 2) + '\n',
    'utf8',
  )
  return {
    vetDir,
    candidatePath: acquired.dir,
    findings: staticResult.findings,
    gated: staticResult.gated,
    degraded: [...degraded, ...acquired.warnings],
    probe,
  }
}

export interface VetCleanRunResult {
  ok: boolean
  skipped: boolean
  vanillaBoot: { ok: boolean; reason: string | null } | null
  cancelOut: { checked: boolean; clean: boolean; residual: DiffItem[] }
  missingPeers: string[]
  issues: VetFinding[]
  degraded: string[]
}

/**
 * 纯净体检：官方模板原样基线（web→[dsh-base,dsh-web-app]、
 * headless→[dsh-base,dsh-headless]；零本地插件、零用户 patch）验证候选自身质量：
 * vanilla 可用（boot 冒烟）+ 插拔无残留 + 缺 peer 单列（autoInstallPeers:false
 * 下 peer 未显式装 = 打包缺陷）。复用 init 沙盒基线逻辑。
 */
async function vetCleanRun(opts: {
  vetDir: string
  globalRoot: string
  profile: BaselineProfile
  candidate: string
  signal?: AbortSignal
}): Promise<VetCleanRunResult> {
  const cleanHome = path.join(opts.vetDir, 'clean', 'dsh-home')
  const degraded: string[] = []
  const issues: VetFinding[] = []
  const critical = (rule: string, evidence: string): VetFinding => ({
    severity: 'critical',
    rule,
    file: null,
    evidence,
  })

  // 1) 官方模板基线初始化（dump-config 首用即建基线，同 init 沙盒）。
  const init = await runDshWithHome({
    home: cleanHome,
    globalRoot: opts.globalRoot,
    mode: 'local',
    project: opts.vetDir,
    argv: ['--profile', opts.profile, '--dump-config'],
    timeoutMs: 120_000,
    signal: opts.signal,
  })
  if (init.exitCode !== 0) {
    return {
      ok: false,
      skipped: false,
      vanillaBoot: null,
      cancelOut: { checked: false, clean: false, residual: [] },
      missingPeers: [],
      issues: [critical('clean-baseline-init', `clean 基线初始化失败：\n${init.stderr || init.stdout}`)],
      degraded,
    }
  }

  const pkgName = packageNameOf(opts.candidate)
  // 插前快照：add 之前采集（插后 diff 对比基线）。
  const preSnapshot = collectSnapshot({
    project: opts.vetDir,
    profile: opts.profile,
    trigger: 'vet-clean-plug',
    declaredVersion: '',
    actualVersion: '',
    sandboxRoot: path.join(opts.vetDir, 'clean'),
  })

  // 2) 装入候选（dsh plugin add file:…）。
  const add = await runDshWithHome({
    home: cleanHome,
    globalRoot: opts.globalRoot,
    mode: 'local',
    project: opts.vetDir,
    argv: ['plugin', '--profile', opts.profile, 'add', `file:${opts.candidate}`],
    timeoutMs: 180_000,
    signal: opts.signal,
  })
  if (add.exitCode !== 0) {
    return {
      ok: false,
      skipped: false,
      vanillaBoot: null,
      cancelOut: { checked: false, clean: false, residual: [] },
      missingPeers: [],
      issues: [critical('clean-install-failure', `候选装入 clean 基线失败：\n${add.stderr || add.stdout}`)],
      degraded,
    }
  }

  // 3) vanilla boot 冒烟（dump-config 结构 + boot 激活断言）。
  const dump = await runDshWithHome({
    home: cleanHome,
    globalRoot: opts.globalRoot,
    mode: 'local',
    project: opts.vetDir,
    argv: ['--profile', opts.profile, '--dump-config'],
    timeoutMs: 60_000,
    signal: opts.signal,
  })
  const layers = parseDumpConfigLayers(dump.stdout)
  const structural = assertDumpConfig(dump.stdout, {
    bundles: [...BASELINE_BUNDLES[opts.profile], pkgName],
    pluginId: pkgName,
  })
  const boot = await runDshWithHome({
    home: cleanHome,
    globalRoot: opts.globalRoot,
    mode: 'local',
    project: opts.vetDir,
    argv:
      opts.profile === 'web'
        ? ['--profile', opts.profile, '--port', '0', '--no-open']
        : ['--profile', opts.profile, 'say ok'],
    timeoutMs: 30_000,
    signal: opts.signal,
  })
  fs.writeFileSync(path.join(opts.vetDir, 'clean-boot-stderr.log'), boot.stderr, 'utf8')
  const activation =
    opts.profile === 'web'
      ? assertWebBootSettled(boot.stdout, boot.stderr)
      : assertHostBootStderr(boot.stderr)
  let vanillaBoot: { ok: boolean; reason: string | null } | null = null
  if (!structural.ok) {
    vanillaBoot = { ok: false, reason: structural.reason }
    issues.push(critical('clean-dump-config', structural.reason ?? 'clean 结构断言失败'))
  } else if (!activation.ok) {
    vanillaBoot = { ok: false, reason: activation.reason }
    issues.push(
      critical(
        'clean-activation',
        `${activation.reason ?? 'clean boot 激活失败'}${stderrExcerpt(boot.stderr) === '' ? '' : `\n${stderrExcerpt(boot.stderr)}`}`,
      ),
    )
  } else {
    vanillaBoot = { ok: true, reason: null }
  }

  // 4) 插拔抵消（remove + diff）。
  let cancelOut: { checked: boolean; clean: boolean; residual: DiffItem[] } = {
    checked: false,
    clean: false,
    residual: [],
  }
  const unplug = await runDshWithHome({
    home: cleanHome,
    globalRoot: opts.globalRoot,
    mode: 'local',
    project: opts.vetDir,
    argv: ['plugin', '--profile', opts.profile, 'remove', pkgName],
    timeoutMs: 180_000,
    signal: opts.signal,
  })
  if (unplug.exitCode !== 0) {
    issues.push(critical('clean-unplug-failure', `clean 插拔抵消 unplug 失败：\n${unplug.stderr || unplug.stdout}`))
  } else {
    const preSessions = fs
      .readFileSync(path.join(preSnapshot.dir, 'sessions.txt'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
    const sessionsPath = path.join(cleanHome, 'sessions')
    if (fs.existsSync(sessionsPath)) {
      for (const entry of fs.readdirSync(sessionsPath)) {
        if (!preSessions.includes(entry)) removeTree(path.join(sessionsPath, entry))
      }
    }
    // pnpm remove 清空 dependencies 后删键，与快照字节不一致 → 对齐（无真实残留才回拷）。
    reconcileCleanProfile(
      path.join(cleanHome, 'profiles', opts.profile, 'package.json'),
      path.join(preSnapshot.dir, 'files', 'package.json'),
    )
    const diff = diffSnapshot({
      project: opts.vetDir,
      profile: opts.profile,
      snapshotDir: preSnapshot.dir,
      sandboxRoot: path.join(opts.vetDir, 'clean'),
      allowRemoved: [pkgName],
    })
    cancelOut = { checked: true, clean: diff.clean, residual: diff.items }
    if (!diff.clean) {
      issues.push(
        critical(
          'clean-cancel-out-residual',
          `clean 插拔未抵消（diff≠0）：${diff.items
            .map((item) => `${item.category}/${item.kind} ${item.path}`)
            .join('；')}`,
        ),
      )
    }
  }

  // 5) 缺 peer 单列（autoInstallPeers:false 下 peer 未显式装 = 打包缺陷）。
  const missingPeers = missingPeersOf(opts.candidate, cleanHome, opts.profile)
  if (missingPeers.length > 0) {
    issues.push(
      critical('missing-peers', `候选缺 peer 依赖（autoInstallPeers:false 下未显式声明）：${missingPeers.join(', ')}`),
    )
  }

  const ok = issues.every((finding) => finding.severity !== 'critical')
  return { ok, skipped: false, vanillaBoot, cancelOut, missingPeers, issues, degraded }
}

/**
 * clean 插拔抵消对齐：pnpm remove 在清空 dependencies 后删除该键，
 * 与插前快照（含空 dependencies）字节不一致而误报残留。若当前与快照仅此键
 * 差异且无真实依赖残留 → 回拷快照（承认 clean）；有真实残留则不动（diff 如实报）。
 */
export function reconcileCleanProfile(currentPath: string, snapshotPath: string): boolean {
  let cur: Record<string, unknown>
  let snap: Record<string, unknown>
  try {
    cur = JSON.parse(fs.readFileSync(currentPath, 'utf8'))
    snap = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'))
  } catch {
    return false
  }
  const strip = (o: Record<string, unknown>): Record<string, unknown> => {
    const { dependencies: _d, ...rest } = o
    return rest
  }
  if (JSON.stringify(strip(cur)) !== JSON.stringify(strip(snap))) return false
  const curDeps = (cur.dependencies ?? {}) as Record<string, unknown>
  if (Object.keys(curDeps).length > 0) return false
  fs.copyFileSync(snapshotPath, currentPath)
  return true
}

/** 缺 peer 检测：候选 peerDependencies 在 clean profile node_modules 无法解析的。 */
export function missingPeersOf(candidate: string, home: string, profile: BaselineProfile): string[] {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(candidate, 'package.json'), 'utf8'),
  ) as { peerDependencies?: Record<string, string> }
  const peers = manifest.peerDependencies ?? {}
  const moduleDir = path.join(home, 'profiles', profile, 'node_modules')
  // 官方 peer（@deepseek-ai/* 与 cordis）由 profile 闭包注入，非打包缺陷——豁免。
  const isOfficialPeer = (name: string): boolean =>
    name === '@deepseek-ai/cordis' || name.startsWith('@deepseek-ai/')
  if (!fs.existsSync(moduleDir)) return Object.keys(peers).filter((name) => !isOfficialPeer(name))
  return Object.keys(peers).filter((name) => {
    if (isOfficialPeer(name)) return false
    try {
      requireResolve.resolve(name, { paths: [moduleDir] })
      return false
    } catch {
      return true
    }
  })
}

/** 阶段二：复刻 + 装入 + 冲突检测 + 插拔抵消（仅静态未命中高危且非 --no-exec）。 */
export async function vetDynamic(opts: VetDynamicOptions): Promise<VetDynamicResult> {
  const vetDir = opts.vetDir ?? resolveRequiredVetDir(opts.workspace)
  const findings = JSON.parse(fs.readFileSync(findingsPath(vetDir), 'utf8')) as {
    findings: VetFinding[]
    gated: boolean
  }
  markPhase(vetDir, 'dynamic')
  const degraded: string[] = []
  const progress = (line: string): void => {
    opts.onProgress?.(line)
    fs.appendFileSync(path.join(vetDir, 'progress.log'), `${line}\n`, 'utf8')
  }

  if (findings.gated) {
    progress('静态命中高危，跳过动态验证。')
    return persistDynamic(vetDir, {
      executed: false,
      staticGated: true,
      conflicts: [],
      cancelOut: { checked: false, clean: false, residual: [] },
      degraded,
      cleanRun: null,
      replicaRun: null,
    })
  }
  if (opts.noExec) {
    progress('--no-exec：全程静态。')
    return persistDynamic(vetDir, {
      executed: false,
      staticGated: false,
      conflicts: [],
      cancelOut: { checked: false, clean: false, residual: [] },
      degraded: ['--no-exec：全程静态，未执行动态验证。'],
      cleanRun: null,
      replicaRun: null,
    })
  }

  const profile: BaselineProfile = opts.profile ?? 'headless'
  try {
    // 纯净体检：官方模板基线验证候选自身质量，全程一次静态结论两环境共享。
    progress('纯净体检（clean 基线，零本地插件零用户 patch）…')
    const cleanRun = await vetCleanRun({
      vetDir,
      globalRoot: opts.globalRoot,
      profile,
      candidate: path.join(vetDir, 'candidate'),
      signal: opts.signal,
    })
    degraded.push(...cleanRun.degraded)
    progress(
      `clean ${cleanRun.ok ? '通过' : `失败（${cleanRun.issues.length} 项）`}` +
        (cleanRun.missingPeers.length > 0 ? `，缺 peer: ${cleanRun.missingPeers.join(', ')}` : '') +
        (cleanRun.cancelOut.checked
          ? `，插拔抵消 ${cleanRun.cancelOut.clean ? 'diff=0' : `diff≠0（${cleanRun.cancelOut.residual.length} 项）`}`
          : ''),
    )
    // stage-gate：clean 失败 → 结论直接"不建议"并跳过 replica（省时省磁盘）。
    if (!cleanRun.ok) {
      progress('stage-gate：clean 失败，跳过 replica。')
      return persistDynamic(vetDir, {
        executed: true,
        staticGated: false,
        conflicts: [...cleanRun.issues],
        cancelOut: { checked: false, clean: false, residual: [] },
        degraded,
        cleanRun,
        replicaRun: { ok: false, skipped: true, degraded: [] },
      })
    }

    // 本地已装规则（按 profile 判定）：同版 → 跳过 replica；异版 → 升级模式。
    const candidate = path.join(vetDir, 'candidate')
    const pkgNameForLocal = packageNameOf(candidate)
    const local = localInstalledInfo(opts.localHome, profile, pkgNameForLocal)
    const candidateVersion = candidateVersionOf(candidate)
    const decision = decideReplica(pkgNameForLocal, local, candidateVersion, opts.env !== undefined)
    if (decision.skip) {
      progress(decision.skipReason ?? 'replica 跳过')
      return persistDynamic(vetDir, {
        executed: true,
        staticGated: false,
        conflicts: [],
        cancelOut: { checked: false, clean: false, residual: [] },
        degraded,
        cleanRun,
        replicaRun: {
          ok: false,
          skipped: true,
          degraded: [],
          skipReason: decision.skipReason,
        },
      })
    }
    const upgradeMode = decision.upgradeMode
    if (upgradeMode !== null) {
      progress(`升级模式：${upgradeMode.note}`)
    }

    progress('复刻 profile 开始（pnpm install，allowBuilds 空白名单）…')
    const replica = await replicateProfile({
      sourceHome: opts.localHome,
      targetSandboxRoot: path.join(vetDir, 'replica'),
      profile,
      signal: opts.signal,
    })
    degraded.push(...replica.warnings)
    progress('复刻完成。')

    const home = path.join(vetDir, 'replica', 'dsh-home')
    const preSnapshot = collectSnapshot({
      project: vetDir,
      profile,
      trigger: 'vet-plug',
      declaredVersion: '',
      actualVersion: '',
      sandboxRoot: path.join(vetDir, 'replica'),
    })
    progress('装入候选（dsh plugin add file:…）…')
    const add = await runDshWithHome({
      home,
      globalRoot: opts.globalRoot,
      mode: 'local',
      project: vetDir,
      argv: ['plugin', '--profile', profile, 'add', `file:${candidate}`],
      timeoutMs: 180_000,
      signal: opts.signal,
    })
    const conflicts: VetFinding[] = []
    if (add.exitCode !== 0) {
      conflicts.push({
        severity: 'critical',
        rule: 'install-failure',
        file: null,
        evidence: `候选装入复刻 profile 失败：\n${add.stderr || add.stdout}`,
      })
      return persistDynamic(vetDir, {
        executed: false,
        staticGated: false,
        conflicts,
        cancelOut: { checked: false, clean: false, residual: [] },
        degraded,
        cleanRun,
        replicaRun: { ok: false, skipped: false, degraded },
      })
    }

    progress('装入完成，冲突检测（dump-config + 有界 boot）…')
    const pkgName = pkgNameForLocal
    conflicts.push(
      ...(await detectConflicts(opts.globalRoot, vetDir, profile, pkgName, degraded, opts.signal)),
    )
    progress('冲突检测完成，插拔抵消（unplug + diff）…')

    const unplug = await runDshWithHome({
      home,
      globalRoot: opts.globalRoot,
      mode: 'local',
      project: vetDir,
      argv: ['plugin', '--profile', profile, 'remove', pkgName],
      timeoutMs: 180_000,
      signal: opts.signal,
    })
    let cancelOut: VetResult['cancelOut'] = {
      checked: false,
      clean: false,
      residual: [],
    }
    if (unplug.exitCode !== 0) {
      conflicts.push({
        severity: 'warning',
        rule: 'unplug-failure',
        file: null,
        evidence: `插拔抵消的 unplug 步骤失败：\n${unplug.stderr || unplug.stdout}`,
      })
    } else {
      // 冒烟 boot 产生的会话是验证工具产物：先清掉快照之后新增的 sessions。
      const preSessions = fs
        .readFileSync(path.join(preSnapshot.dir, 'sessions.txt'), 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.length > 0)
      const sessionsPath = path.join(home, 'sessions')
      if (fs.existsSync(sessionsPath)) {
        for (const entry of fs.readdirSync(sessionsPath)) {
          if (!preSessions.includes(entry)) {
            removeTree(path.join(sessionsPath, entry))
          }
        }
      }
      const diff = diffSnapshot({
        project: vetDir,
        profile,
        snapshotDir: preSnapshot.dir,
        sandboxRoot: path.join(vetDir, 'replica'),
        allowRemoved: [pkgName],
      })
      cancelOut = { checked: true, clean: diff.clean, residual: diff.items }
      if (!diff.clean) {
        conflicts.push({
          severity: 'critical',
          rule: 'cancel-out-residual',
          file: null,
          evidence: `插拔未抵消（diff≠0）：${diff.items
            .map((item) => `${item.category}/${item.kind} ${item.path}`)
            .join('；')}`,
        })
      }
    }
    progress(cancelOut.checked
      ? `插拔抵消 ${cancelOut.clean ? 'diff=0 ✓' : `diff≠0（${cancelOut.residual.length} 项残留）`}`
      : '插拔抵消未完成（unplug 失败）。')
    return persistDynamic(vetDir, {
      executed: true,
      staticGated: false,
      conflicts,
      cancelOut,
      degraded,
      cleanRun,
      replicaRun: {
        ok: true,
        skipped: false,
        degraded,
        ...(upgradeMode !== null ? { upgradeMode } : {}),
      },
    })
  } catch (error) {
    progress(`动态验证失败：${String(error)}`)
    return persistDynamic(vetDir, {
      executed: false,
      staticGated: false,
      conflicts: [],
      cancelOut: { checked: false, clean: false, residual: [] },
      degraded: [`动态验证阶段失败（降级为静态结论）：${String(error)}`],
      cleanRun: null,
      replicaRun: null,
    })
  }
}

function persistDynamic(vetDir: string, result: VetDynamicResult): VetDynamicResult {
  fs.writeFileSync(conflictsPath(vetDir), JSON.stringify(result, null, 2) + '\n', 'utf8')
  return result
}

/** 阶段三：本地自检 + 汇总报告 + 结论 + 清理。 */
export async function vetReport(opts: VetReportOptions): Promise<VetReportResult> {
  const vetDir = opts.vetDir ?? resolveRequiredVetDir(opts.workspace)
  const progress = readProgress(vetDir)
  markPhase(vetDir, 'report')
  const findings = JSON.parse(fs.readFileSync(findingsPath(vetDir), 'utf8')) as {
    findings: VetFinding[]
    gated: boolean
  }
  const dynamic = JSON.parse(fs.readFileSync(conflictsPath(vetDir), 'utf8')) as VetDynamicResult
  const llmFindings = readLlmFindings(opts.llmFindingsFile ?? path.join(vetDir, 'llm-findings.json'))
  const baseline = readJsonOrNull(baselinePath(vetDir))
  const before =
    baseline === null
      ? new Map<string, string>()
      : new Map(Object.entries(baseline as Record<string, string>))
  const localUntouched = {
    checked: true,
    ...metadataEqual(before, localHomeMetadata(opts.localHome)),
  }
  if (!localUntouched.clean) {
    dynamic.conflicts.push({
      severity: 'critical',
      rule: 'local-untouched',
      file: null,
      evidence: localUntouched.detail ?? '真实 ~/.dsh 发生变化',
    })
  }

  const degraded = [...dynamic.degraded, '在线扫描（OSV）v1 暂屏蔽']
  const mergedFindings = [...findings.findings, ...dynamic.conflicts, ...llmFindings]
  const conclusion = conclude({
    findings: mergedFindings,
    conflicts: dynamic.conflicts,
    cancelOut: dynamic.cancelOut,
    executed: dynamic.executed,
    cleanRun: dynamic.cleanRun ?? null,
    replicaRun: dynamic.replicaRun ?? null,
  })
  const tag = sanitizeTag(progress.package)
  const result: VetReportResult = {
    package: progress.package,
    version: progress.version,
    source: progress.source,
    profile: opts.profile ?? 'headless',
    executed: dynamic.executed,
    staticGated: dynamic.staticGated,
    degraded,
    findings: findings.findings,
    conflicts: dynamic.conflicts,
    cancelOut: dynamic.cancelOut,
    localUntouched,
    cleanRun: dynamic.cleanRun ?? {
      ok: false,
      skipped: true,
      vanillaBoot: null,
      cancelOut: { checked: false, clean: false, residual: [] },
      missingPeers: [],
      issues: [],
      degraded: [],
    },
    replicaRun: dynamic.replicaRun ?? { ok: false, skipped: true, degraded: [] },
    dependencyScan: null,
    llmFindings: llmFindings.length === 0 ? undefined : llmFindings,
    conclusion,
    reportPaths: {
      report: reportPath(opts.workspace, tag, progress.version, 'vet-report.md'),
      result: reportPath(opts.workspace, tag, progress.version, 'vet-result.json'),
      vetDir: opts.keep ? vetDir : null,
    },
  }
  writeReports(opts.workspace, result)
  if (!opts.keep) {
    removeTree(vetDir)
  }
  return result
}

function readLlmFindings(file: string): VetFinding[] {
  const parsed = readJsonOrNull(file) as
    | { findings?: Array<{ severity?: string; evidence?: string }> }
    | null
  if (parsed?.findings === undefined) return []
  return parsed.findings
    .filter((f) => f.severity === 'critical' || f.severity === 'warning')
    .map((f) => ({
      severity: f.severity as 'critical' | 'warning',
      rule: 'llm-review',
      file: null,
      evidence: f.evidence ?? '',
    }))
}

async function detectConflicts(
  globalRoot: string,
  vetDir: string,
  profile: BaselineProfile,
  pkgName: string,
  degraded: string[],
  signal?: AbortSignal,
): Promise<VetFinding[]> {
  const conflicts: VetFinding[] = []
  const home = path.join(vetDir, 'replica', 'dsh-home')
  const dump = await runDshWithHome({
    home,
    globalRoot,
    mode: 'local',
    project: vetDir,
    argv: ['--profile', profile, '--dump-config'],
    timeoutMs: 60_000,
    signal,
  })
  const layers = parseDumpConfigLayers(dump.stdout)
  const structural = assertDumpConfig(dump.stdout, {
    bundles: layers,
    pluginId: pkgName,
  })
  if (!structural.ok) {
    conflicts.push({
      severity: 'warning',
      rule: 'dump-config',
      file: null,
      evidence: structural.reason ?? '结构断言失败',
    })
  }
  const seen = new Set<string>()
  const duplicates = layers.filter((layer) => (seen.has(layer) ? true : !seen.add(layer)))
  for (const duplicate of duplicates) {
    conflicts.push({
      severity: 'warning',
      rule: 'patch-id-conflict',
      file: null,
      evidence: `组合树出现重复层 id：${duplicate}`,
    })
  }

  const boot = await runDshWithHome({
    home,
    globalRoot,
    mode: 'local',
    project: vetDir,
    // web profile 不接受位置参数（rc.8+），用 --port 0 触发实际 boot；headless 用 say ok。
    argv: profile === 'web'
      ? ['--profile', profile, '--port', '0', '--no-open']
      : ['--profile', profile, 'say ok'],
    timeoutMs: 30_000,
    signal,
  })
  // 完整 stderr 落盘（--keep 复查用；默认随 vetDir 清理）；证据保留关键片段。
  fs.writeFileSync(path.join(vetDir, 'boot-stderr.log'), boot.stderr, 'utf8')
  const excerpt = stderrExcerpt(boot.stderr)
  const activation = assertHostBootStderr(boot.stderr)
  if (!activation.ok) {
    conflicts.push({
      severity: 'critical',
      rule: 'activation',
      file: null,
      evidence:
        `${activation.reason ?? '激活断言失败'}${excerpt === '' ? '' : `\n${excerpt}`}` +
        '\n（完整 stderr：<vetDir>/boot-stderr.log，--keep 时保留）',
    })
  }
  const alreadyLine = boot.stderr
    .split(/\r?\n/)
    .find((line) => line.includes('already registered'))
  if (alreadyLine !== undefined) {
    conflicts.push({
      severity: 'critical',
      rule: 'duplicate-registration',
      file: null,
      evidence: `boot 报工具/命令 id 重复注册：${alreadyLine}`,
    })
  }
  if (profile === 'web') {
    degraded.push('web 复刻不做 HTTP 端口冒烟（本机 3080 占用规避），web 加载/端口需人工复核。')
  }
  return conflicts
}

/** 从 boot stderr 提取与加载/激活/重复注册相关的关键行（供证据与报告）。 */
export function stderrExcerpt(stderr: string, maxLines = 8, maxChars = 600): string {
  const marks = ['plugin tree failed to load', 'already registered', 'Cannot find module', 'Error:']
  const hits = stderr
    .split(/\r?\n/)
    .filter((line) => marks.some((mark) => line.includes(mark)))
  if (hits.length === 0) return ''
  return hits.slice(0, maxLines).join('\n').slice(0, maxChars)
}

export function conclude(opts: {
  findings: VetFinding[]
  conflicts: VetFinding[]
  cancelOut: VetResult['cancelOut']
  executed: boolean
  cleanRun: VetResult['cleanRun'] | null
  replicaRun: VetResult['replicaRun'] | null
}): VetResult['conclusion'] {
  const { findings, conflicts, cancelOut, executed, cleanRun, replicaRun } = opts
  // 结论合成三分支：clean 败→不建议；clean 过+replica 冲突→谨慎/不建议；双过→建议。
  if (cleanRun !== null && !cleanRun.ok) return 'not-recommended'
  if (findings.some((f) => f.severity === 'critical')) return 'not-recommended'
  if (conflicts.some((f) => f.severity === 'critical')) return 'not-recommended'
  if (!executed) return 'caution'
  if (cancelOut.checked && !cancelOut.clean) return 'not-recommended'
  if (replicaRun?.skipped === true) return 'caution'
  if ([...findings, ...conflicts].some((f) => f.severity === 'warning')) return 'caution'
  return 'recommended'
}

function packageNameOf(dir: string): string {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
    name: string
  }
  return manifest.name
}

function reportPath(workspace: string, pkg: string, version: string | null, suffix: string): string {
  const tag = version === null ? pkg : `${pkg}-${version}`
  return path.join(workspace, '.vetting', `${tag}.${suffix}`)
}

function sanitizeTag(tag: string): string {
  return tag.replace(/[^\w@.-]/g, '-')
}

function resolveRequiredVetDir(workspace: string): string {
  const root = path.join(workspace, '.vetting')
  if (!fs.existsSync(root)) {
    throw new Error('缺少 vet 进度：请先运行 whale_tank_vet_static。')
  }
  const candidates = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter((dir) => fs.existsSync(progressPath(dir)))
  if (candidates.length === 0) {
    throw new Error('缺少 vet 进度：请先运行 whale_tank_vet_static。')
  }
  if (candidates.length > 1) {
    throw new Error('存在多个进行中的 vet 目录，请显式传 --vet-dir。')
  }
  return candidates[0]
}

function writeReports(workspace: string, result: VetResult): void {
  const reportDir = path.join(workspace, '.vetting')
  fs.mkdirSync(reportDir, { recursive: true })
  const lines = [
    `# vet 报告：${result.package}${result.version ? `@${result.version}` : ''}`,
    '',
    `> ${DISCLAIMER}`,
    `> ${BOUNDARY}`,
    '',
    `- 来源：${result.source} ｜ profile：${result.profile}`,
    `- 结论：${conclusionLabel(result.conclusion)}（${result.conclusion}）`,
    `- 动态执行：${result.executed ? '是' : '否'}`,
    `- 降级/说明：${result.degraded.length > 0 ? result.degraded.join('；') : '无'}`,
    '- 结论语义：未发现漏洞 = 确定性检查未发现高危/冲突，不构成安全保证。',
    '',
    '## 静态危害发现',
    ...(result.findings.length === 0
      ? ['（无）']
      : result.findings.map(
          (f) => `- [${f.severity}] ${f.rule}（${f.file ?? '-'}）：${f.evidence}`,
        )),
    '',
    '## 纯净体检（插件自身问题，clean 基线）',
    result.cleanRun.skipped
      ? '- 未执行（静态命中高危 / --no-exec 跳过）'
      : [
          `- vanilla 可用：${result.cleanRun.vanillaBoot?.ok ? '通过' : `失败（${result.cleanRun.vanillaBoot?.reason ?? '未验证'}）`}`,
          result.cleanRun.cancelOut.checked
            ? `- 插拔抵消：${result.cleanRun.cancelOut.clean ? 'diff=0 ✓' : `diff≠0（${result.cleanRun.cancelOut.residual.length} 项残留）`}`
            : '- 插拔抵消：未检查',
          `- 缺 peer 依赖：${result.cleanRun.missingPeers.length > 0 ? result.cleanRun.missingPeers.join(', ') : '无'}`,
          ...(result.cleanRun.issues.length === 0
            ? ['- 无问题项']
            : result.cleanRun.issues.map((f) => `- [${f.severity}] ${f.rule}：${f.evidence}`)),
        ],
    '',
    '## 复刻体检（与本地环境冲突，replica）',
    result.replicaRun.skipped
      ? `- 跳过（${result.replicaRun.skipReason ?? 'stage-gate：clean 失败即"不建议"，或未执行动态验证'}）`
      : result.conflicts.length === 0
        ? '- 无冲突'
        : result.conflicts.map((f) => `- [${f.severity}] ${f.rule}：${f.evidence}`),
    ...(result.replicaRun.upgradeMode !== null && result.replicaRun.upgradeMode !== undefined
      ? [`- 升级模式：${result.replicaRun.upgradeMode.note}（嵌套钉版冲突如实报告，见上）`]
      : []),
    '',
    '## LLM 语义审查',
    ...(result.llmFindings === undefined || result.llmFindings.length === 0
      ? ['- 未提供（确定性检查结论不受影响）。']
      : result.llmFindings.map(
          (f) => `- [${f.severity}] llm-review：${f.evidence}`,
        )),
    '',
    '## 插拔抵消',
    result.cancelOut.checked
      ? result.cancelOut.clean
        ? '- diff=0，插拔完全抵消'
        : `- diff≠0，残留：${result.cancelOut.residual
            .map((item) => `${item.category}/${item.kind} ${item.path}`)
            .join('；')}`
      : '- 未检查（未执行动态阶段）',
    '',
    '## 本地未受影响自检',
    result.localUntouched.checked
      ? result.localUntouched.clean
        ? '- 真实 ~/.dsh 白名单范围零变化 ✓（盯防：profiles / credentials / settings / .agent-presets / .anonymous-user-id；sessions / storages / cache 等宿主活目录不计入）'
        : `- 变化：${result.localUntouched.detail}`
      : '- 未检查',
    '',
    '## 依赖扫描',
    '- 在线扫描（OSV）v1 暂屏蔽；本地规则为唯一确定性依赖面。',
    '',
    '## 复现',
    `- web：/whale-tank-vet（skill 三阶段：static → dynamic 后台任务 → report）`,
    `- 候选：${result.source} 包 ${result.package}${result.version ? `@${result.version}` : ''}（profile ${result.profile}）`,
    '',
  ]
  fs.writeFileSync(result.reportPaths.report, lines.filter(Boolean).join('\n'), 'utf8')
  fs.writeFileSync(
    result.reportPaths.result,
    JSON.stringify(result, null, 2) + '\n',
    'utf8',
  )
}

/**
 * 后台任务入口（工具用）：有 ctx.jobs 则秒回 jobId，模型用原生 job 工具轮询；
 * 无 jobs 服务（CLI/测试）则同步执行。
 */
export interface VetDynamicJobHandle {
  jobId: string
  vetDir: string
  startedAsJob: boolean
}

export async function startVetDynamicJob(
  opts: VetDynamicOptions & {
    jobs?: { start: (spec: unknown) => string }
    agent?: unknown
  },
): Promise<VetDynamicJobHandle> {
  const vetDir = opts.vetDir ?? resolveRequiredVetDir(opts.workspace)
  if (opts.jobs === undefined) {
    await vetDynamic(opts)
    return { jobId: '', vetDir, startedAsJob: false }
  }
  const buffer: string[] = []
  const controller = new AbortController()
  const jobId = opts.jobs.start({
    kind: 'whale-tank-vet',
    label: `vet 动态验证：${path.basename(vetDir)}`,
    owner: opts.agent,
    run: () => {
      // JobOutcome 契约：status 必填（completed/killed/failed），stream job 的 output 不设。
      const runPromise = (async (): Promise<{
        status: 'completed' | 'killed' | 'failed'
        detail?: string
        output?: string
      }> => {
        try {
          await vetDynamic({
            ...opts,
            onProgress: (line) => {
              buffer.push(line)
              opts.onProgress?.(line)
            },
            signal: controller.signal,
          })
          if (controller.signal.aborted) {
            return { status: 'killed', detail: String(controller.signal.reason ?? 'job_kill 请求') }
          }
          return { status: 'completed' }
        } catch (error) {
          if (controller.signal.aborted) {
            return { status: 'killed', detail: String(controller.signal.reason ?? 'job_kill 请求') }
          }
          return { status: 'failed', detail: String(error) }
        }
      })()
      return {
        cancel: (reason?: string) => controller.abort(reason),
        done: runPromise,
        readOutput: () => buffer.splice(0).join('\n'),
      }
    },
  })
  return { jobId, vetDir, startedAsJob: true }
}
