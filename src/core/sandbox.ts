import fs from 'node:fs'
import path from 'node:path'
import { runDshProfile } from './dsh.ts'
import { removeTree } from './fsutil.ts'
import {
  dshHomeDir,
  dshInstallDir,
  profileDir,
  sandboxRoot,
} from './paths.ts'
import {
  hasState,
  initialState,
  readState,
  resolveVersionMode,
  writeState,
} from './state.ts'
import { assertDumpConfig, assertHostBootStderr, assertWebBootSettled } from './smoke.ts'
import type { BaselineProfile, ProjectType, StateFile } from './types.ts'
import { readPackageVersion, resolveDshEntry } from './versions.ts'
import { installStandalone } from './standalone.ts'
import { baselineProfileFor, normalizeType } from './type-route.ts'
import type { ToolContextLike } from './types.ts'

export const BASELINE_BUNDLES: Record<BaselineProfile, string[]> = {
  web: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
  headless: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
}

/** 沙盒基线双 profile（grill 决策）：run-test 可任选其一实跑。 */
export const ALL_BASELINE_PROFILES: BaselineProfile[] = ['web', 'headless']

export { baselineProfileFor }

export interface SandboxInitOptions {
  project: string
  projectName: string
  projectType: ProjectType
  requestedVersion: string | null
  globalRoot: string
  knowledgePackVersion: string
  knowledgePackDshBaseline?: string
  /** Skip the post-init self-check (used by reset which re-checks once). */
  skipSelfCheck?: boolean
}

export interface SandboxInitResult {
  state: StateFile
  selfCheck: { ok: boolean; reason: string | null }
}

export async function initSandbox(opts: SandboxInitOptions): Promise<SandboxInitResult> {
  const localVersion = readPackageVersion(
    path.join(opts.globalRoot, '@deepseek-ai', 'dsh', 'package.json'),
  )
  const resolution = resolveVersionMode({
    requested: opts.requestedVersion,
    local: localVersion,
  })
  const profile = baselineProfileFor(normalizeType(opts.projectType))
  const dshHome = dshHomeDir(opts.project)
  fs.mkdirSync(dshHome, { recursive: true })

  let dshInstall: string | null = null
  if (resolution.mode === 'standalone') {
    dshInstall = dshInstallDir(opts.project)
    await installStandalone({
      project: opts.project,
      version: resolution.version,
    })
  }

  // Baseline profiles auto-initialization（web + headless 双基线，grill 决策）：
  // dump-config 首次使用即从官方模板建 profile（决策 02/04 实测）。
  // state.sandbox.profile 仍是主 profile（status/plug/smoke 默认），但两个
  // 都物化，run-test 可任选其一实跑。
  for (const baseline of ALL_BASELINE_PROFILES) {
    const initResult = await runDshProfile({
      project: opts.project,
      globalRoot: opts.globalRoot,
      mode: resolution.mode,
      profile: baseline,
      argv: ['--dump-config'],
      timeoutMs: 120_000,
    })
    if (initResult.exitCode !== 0) {
      throw new Error(
        `基线 profile 初始化失败（dsh --profile ${baseline} --dump-config）：\n${initResult.stderr}`,
      )
    }
  }

  const state = initialState({
    projectName: opts.projectName,
    projectType: opts.projectType,
    root: opts.project,
    resolution,
    profile,
    baselineBundles: BASELINE_BUNDLES[profile],
    dshHome,
    dshInstall,
    knowledgePackVersion: opts.knowledgePackVersion,
    ...(opts.knowledgePackDshBaseline === undefined
      ? {}
      : { knowledgePackDshBaseline: opts.knowledgePackDshBaseline }),
  })
  writeState(opts.project, state)

  const selfCheck = opts.skipSelfCheck
    ? { ok: true, reason: null }
    : await twoStepSmoke(opts.project, {
        globalRoot: opts.globalRoot,
        profile,
        pluginId: '@deepseek-ai/dsh-base',
        bundles: state.sandbox.baselineBundles,
      })
  return { state, selfCheck }
}

export async function twoStepSmoke(
  project: string,
  opts: {
    globalRoot: string
    profile: BaselineProfile
    pluginId: string
    bundles: string[]
  },
): Promise<{ ok: boolean; reason: string | null }> {
  const state = readState(project)
  const dump = await runDshProfile({
    project,
    globalRoot: opts.globalRoot,
    mode: state.dsh.mode,
    profile: opts.profile,
    argv: ['--dump-config'],
    timeoutMs: 60_000,
  })
  const structural = assertDumpConfig(dump.stdout, {
    bundles: opts.bundles,
    pluginId: opts.pluginId,
  })
  if (!structural.ok) {
    return { ok: false, reason: `结构断言失败：${structural.reason}` }
  }
  // web profile 不接受位置参数（rc.8+），用 --port 0 --no-open 触发实际 boot；// headless profile 接受 say ok。两者都走到确定性终点（凭据缺失）。
  const bootArgs =
    opts.profile === 'web'
      ? ['--port', '0', '--no-open']
      : ['say ok']
  const boot = await runDshProfile({
    project,
    globalRoot: opts.globalRoot,
    mode: state.dsh.mode,
    profile: opts.profile,
    argv: bootArgs,
    timeoutMs: 30_000,
  })
  // web 是常驻服务器：settle 信号 = 启动地址出现；headless 走 MISSING_CREDENTIAL。
  const activation =
    opts.profile === 'web'
      ? assertWebBootSettled(boot.stdout, boot.stderr)
      : assertHostBootStderr(boot.stderr)
  if (!activation.ok) {
    return { ok: false, reason: `激活断言失败：${activation.reason}` }
  }
  return { ok: true, reason: null }
}

/** 复原自检（设计 §8.3）：init 产物完整 + 基线干净。 */
export async function sandboxSelfCheck(
  project: string,
  opts: { globalRoot: string },
): Promise<{ ok: boolean; reason: string | null }> {
  if (!hasState(project)) {
    return { ok: false, reason: 'state.json 缺失' }
  }
  const state = readState(project)
  return twoStepSmoke(project, {
    globalRoot: opts.globalRoot,
    profile: state.sandbox.profile,
    pluginId: '@deepseek-ai/dsh-base',
    bundles: state.sandbox.baselineBundles,
  })
}

/** reset：删除 .sandbox/ 整体重建（删除前确认；--yes 跳过）。 */
export async function resetSandbox(
  project: string,
  opts: {
    globalRoot: string
    yes: boolean
    ctx?: ToolContextLike
  },
): Promise<SandboxInitResult> {
  if (!hasState(project)) {
    throw new Error('项目未初始化（缺少 state.json），无法 reset。')
  }
  const state = readState(project)
  if (!opts.yes) {
    const answer = await opts.ctx?.askUser?.(
      `删除 ${sandboxRoot(project)} 并整体重建？此操作不可恢复（--yes 跳过确认）。`,
    )
    if (answer?.kind !== 'ok') {
      throw new Error('reset 已取消。')
    }
  }
  removeTree(sandboxRoot(project))
  return initSandbox({
    project,
    projectName: state.project.name,
    projectType: state.project.type,
    requestedVersion: state.dsh.override,
    globalRoot: opts.globalRoot,
    knowledgePackVersion: state.knowledgePack.version,
    ...(state.knowledgePack.dshBaseline === undefined
      ? {}
      : { knowledgePackDshBaseline: state.knowledgePack.dshBaseline }),
  })
}

/** Whether the standalone dsh entry is present (used by status diagnostics). */
export function hasStandaloneInstall(project: string): boolean {
  return fs.existsSync(
    path.join(dshInstallDir(project), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
  )
}

/** dsh entry used by the sandbox's own mode (for logging/exact commands). */
export function sandboxDshEntry(project: string, globalRoot: string, mode: 'local' | 'standalone'): string {
  return resolveDshEntry({ mode, project, globalRoot })
}

export { profileDir }
