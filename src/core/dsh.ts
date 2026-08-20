import { dshHomeDir } from './paths.ts'
import {
  dshHomeEnv,
  runForeground,
  runNodeScript,
  runProcessChecked,
  type RunResult,
} from './proc.ts'
import type { VersionMode } from './types.ts'
import { resolveDshEntry } from './versions.ts'

export interface DshRunOptions {
  project: string
  globalRoot: string
  mode: VersionMode
  /** Full argv after the dsh entry, e.g. ['plugin','--profile','web','add',...]. */
  argv: string[]
  timeoutMs?: number
  signal?: AbortSignal
  extraEnv?: NodeJS.ProcessEnv
  cwd?: string
}

/**
 * 铁律 2: every dsh child carries a non-empty DSH_HOME. The entry is the
 * underlying lib/bin.js (local global install or standalone copy), so no
 * .cmd shell shim is involved and spaced arguments survive intact.
 */
export async function runDsh(opts: DshRunOptions): Promise<RunResult> {
  const entry = resolveDshEntry({
    mode: opts.mode,
    project: opts.project,
    globalRoot: opts.globalRoot,
  })
  return runNodeScript(entry, opts.argv, {
    cwd: opts.cwd ?? opts.project,
    env: dshHomeEnv(dshHomeDir(opts.project), opts.extraEnv),
    timeoutMs: opts.timeoutMs ?? 60_000,
    signal: opts.signal,
  })
}

/**
 * Run dsh against an explicit DSH_HOME (vet replicas live under
 * `<vetDir>/dsh-home`, not the project `.sandbox` layout).
 */
export async function runDshWithHome(opts: {
  home: string
  globalRoot: string
  mode: VersionMode
  project: string
  argv: string[]
  timeoutMs?: number
  signal?: AbortSignal
  extraEnv?: NodeJS.ProcessEnv
  cwd?: string
}): Promise<RunResult> {
  const entry = resolveDshEntry({
    mode: opts.mode,
    project: opts.project,
    globalRoot: opts.globalRoot,
  })
  return runNodeScript(entry, opts.argv, {
    cwd: opts.cwd ?? opts.project,
    env: dshHomeEnv(opts.home, opts.extraEnv),
    timeoutMs: opts.timeoutMs ?? 60_000,
    signal: opts.signal,
  })
}

/** `dsh --profile <profile> <args...>`（run-test 前台实跑：共享控制台、可交互）。 */
export async function runDshForeground(
  opts: DshRunOptions,
): Promise<{ exitCode: number; interrupted: boolean }> {
  const entry = resolveDshEntry({
    mode: opts.mode,
    project: opts.project,
    globalRoot: opts.globalRoot,
  })
  return runForeground({
    command: process.execPath,
    args: [entry, ...opts.argv],
    cwd: opts.cwd ?? opts.project,
    env: dshHomeEnv(dshHomeDir(opts.project), opts.extraEnv),
  })
}

/** `dsh --profile <profile> <args...>` */
export function runDshProfile(opts: DshRunOptions & { profile: string }): Promise<RunResult> {
  return runDsh({
    ...opts,
    argv: ['--profile', opts.profile, ...opts.argv],
  })
}

/** `dsh plugin --profile <profile> <pnpm args...>` */
export function runDshPlugin(
  opts: DshRunOptions & { profile: string },
): Promise<RunResult> {
  // `dsh plugin --profile <profile> <pnpm args...>`: --profile belongs to the
  // plugin subcommand (research 02 exact CLI shape).
  return runDsh({
    ...opts,
    argv: ['plugin', '--profile', opts.profile, ...opts.argv],
  })
}

/** `dsh --version` style version probe (kept for diagnostics). */
export async function readDshCliVersion(opts: {
  project: string
  globalRoot: string
  mode: VersionMode
}): Promise<string | null> {
  const result = await runDsh({
    ...opts,
    argv: ['--version'],
    timeoutMs: 10_000,
  })
  const version = result.stdout.trim().split(/\r?\n/)[0]?.trim()
  return version && version.length > 0 ? version : null
}

export async function runPnpmIn(
  cwd: string,
  args: string[],
  opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {},
): Promise<RunResult> {
  const { resolvePnpmEntry } = await import('./proc.ts')
  const entry = await resolvePnpmEntry()
  return runProcessChecked({
    command: process.execPath,
    args: [entry, ...args],
    cwd,
    env: opts.env,
    timeoutMs: opts.timeoutMs ?? 300_000,
    signal: opts.signal,
  })
}
