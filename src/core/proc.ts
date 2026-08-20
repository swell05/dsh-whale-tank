import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface RunProcessOptions {
  command: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  /** Abort the child when the signal fires (background-job cancellation). */
  signal?: AbortSignal
}

export interface RunResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

export class ProcError extends Error {
  constructor(
    message: string,
    public readonly result: RunResult,
  ) {
    super(message)
    this.name = 'ProcError'
  }
}

/**
 * Spawn one child process without a shell. On Windows this is the only safe
 * path for argument lists containing spaces (the dsh CLI's own shell:true
 * forwarding breaks spaced paths — documented in NOTES.md / gotchas).
 * `.cmd`/`.bat` shims cannot be spawned directly, so callers resolve the
 * underlying JS entry (dsh lib/bin.js, pnpm bin/pnpm.cjs).
 */
/** spawn 抛错时的可读文案：受限沙盒（spawn EPERM）给行动指引，其余原样。 */
function spawnErrorText(error: unknown): string {
  const code = (error as { code?: string } | null)?.code
  if (code === 'EPERM') {
    return (
      '受限沙盒禁止创建子进程（spawn EPERM）：请在你自己的终端里跑 .wttools\\ 命令，' +
      '或把该命令升级到 danger-full-access。'
    )
  }
  return String(error)
}

export function runProcess(options: RunProcessOptions): Promise<RunResult> {
  const { command, args = [], cwd, env, timeoutMs, signal } = options
  return new Promise((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(command, args, {
        cwd,
        env: { ...process.env, ...env },
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      // spawn 可能同步抛错（如受限沙盒 EPERM）而非 emit 'error'。
      resolve({ exitCode: -1, stdout: '', stderr: spawnErrorText(error), timedOut: false })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true
            terminateTree()
          }, timeoutMs)
    const onAbort = () => {
      timedOut = true
      terminateTree()
    }
    if (signal !== undefined) {
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    let forceTimer: NodeJS.Timeout | undefined
    /** 杀进程树 + 兜底强制收尾：Windows 下孙进程可能握着管道，close 永不触发。 */
    const terminateTree = () => {
      try {
        child.kill('SIGKILL')
      } catch {
        // best effort
      }
      if (process.platform === 'win32') {
        try {
          const taskkill = spawn(
            'taskkill',
            ['/pid', String(child.pid), '/T', '/F'],
            { windowsHide: true, stdio: 'ignore' },
          )
          taskkill.unref()
        } catch {
          // best effort
        }
      } else if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          // best effort
        }
      }
      if (forceTimer === undefined) {
        forceTimer = setTimeout(() => {
          if (!settled) {
            settled = true
            if (timer !== undefined) clearTimeout(timer)
            signal?.removeEventListener('abort', onAbort)
            resolve({ exitCode: -1, stdout, stderr: stderr || '进程树终止超时（强制收尾）', timedOut })
          }
        }, 8_000)
        forceTimer.unref()
      }
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      if (forceTimer !== undefined) clearTimeout(forceTimer)
      signal?.removeEventListener('abort', onAbort)
      resolve({
        exitCode: -1,
        stdout,
        stderr: stderr || String(error),
        timedOut,
      })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      if (forceTimer !== undefined) clearTimeout(forceTimer)
      signal?.removeEventListener('abort', onAbort)
      resolve({
        exitCode: code === null ? -1 : code,
        stdout,
        stderr,
        timedOut,
      })
    })
  })
}

export async function runProcessChecked(options: RunProcessOptions): Promise<RunResult> {
  const result = await runProcess(options)
  if (result.timedOut) {
    throw new ProcError(
      `命令超时（${options.timeoutMs}ms）：${options.command} ${options.args?.join(' ') ?? ''}`,
      result,
    )
  }
  return result
}

/**
 * Foreground child sharing the console (stdio inherit)——run-test 前台实跑用。
 * 截获 SIGINT/SIGTERM 不退出：Ctrl+C 会同时打到父进程与子进程（同一控制台），
 * 父进程吞掉信号等子进程自然退出，让 run-test 的清理（unplug+diff+复原）能跑完。
 */
export function runForeground(options: {
  command: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}): Promise<{ exitCode: number; interrupted: boolean }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(options.command, options.args ?? [], {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        shell: false,
        stdio: 'inherit',
      })
    } catch (error) {
      resolve({ exitCode: -1, interrupted: false })
      void error
      return
    }
    let interrupted = false
    let settled = false
    const terminateChildTree = (): void => {
      try {
        child.kill('SIGKILL')
      } catch {
        // best effort
      }
      if (process.platform === 'win32') {
        try {
          const taskkill = spawn(
            'taskkill',
            ['/pid', String(child.pid), '/T', '/F'],
            { windowsHide: true, stdio: 'ignore' },
          )
          taskkill.unref()
        } catch {
          // best effort
        }
      } else if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          // best effort
        }
      }
    }
    // 收到 SIGINT/SIGTERM：真实 Ctrl+C 是控制台广播、子进程也会收到；但
    // `kill <父进程>` / 会话关闭时子进程不会自己死——父进程必须主动终结
    // 子进程树，让 run-test 的复原（remove+diff）能跑完。
    const onSig = (): void => {
      interrupted = true
      terminateChildTree()
    }
    process.on('SIGINT', onSig)
    process.on('SIGTERM', onSig)
    const cleanup = (): void => {
      process.off('SIGINT', onSig)
      process.off('SIGTERM', onSig)
    }
    child.on('error', () => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ exitCode: -1, interrupted })
    })
    child.on('exit', (code) => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ exitCode: code === null ? -1 : code, interrupted })
    })
  })
}

/** Run a node .mjs/.cjs script with the current node executable. */
export function runNodeScript(
  script: string,
  args: string[] = [],
  options: Omit<RunProcessOptions, 'command' | 'args'> = {},
): Promise<RunResult> {
  return runProcess({ ...options, command: process.execPath, args: [script, ...args] })
}

/** 铁律 2: every dsh child must carry a non-empty DSH_HOME. */
export function assertDshHome(dshHome: string): string {
  if (typeof dshHome !== 'string' || dshHome.trim() === '') {
    throw new Error(
      'DSH_HOME 必须是非空路径：空白值会被 dsh 视为未设置并回落到真实 ~/.dsh（铁律 2）。',
    )
  }
  return dshHome
}

export function dshHomeEnv(
  dshHome: string,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  assertDshHome(dshHome)
  return {
    ...extra,
    DSH_HOME: dshHome.trim(),
    DSH_TELEMETRY_DISABLED: '1',
  }
}

const commandPathCache = new Map<string, string | null>()

/**
 * Locate an executable by scanning PATH directories on the filesystem——
 * **不再 spawn `where`/`which`**（dsh 受限沙盒禁止创建子进程，首个 spawn 即
 * EPERM）。纯 readdir 检查，status 等只读命令因此可在受限沙盒里直接跑。
 * Windows 按 PATHEXT 常见扩展名探测；Unix 直接查可执行文件。
 */
export async function findCommandPath(command: string): Promise<string | null> {
  const cached = commandPathCache.get(command)
  if (cached !== undefined) return cached
  const result = scanPathForExecutable(command)
  commandPathCache.set(command, result)
  return result
}

function scanPathForExecutable(command: string): string | null {
  const pathEnv = process.env.PATH ?? ''
  const extensions =
    process.platform === 'win32' ? ['', '.cmd', '.bat', '.exe', '.ps1'] : ['']
  for (const dir of pathEnv.split(path.delimiter)) {
    if (dir === '') continue
    for (const ext of extensions) {
      const candidate = path.join(dir, `${command}${ext}`)
      try {
        if (fs.existsSync(candidate)) return candidate
      } catch {
        // PATH 里不可读的目录跳过
      }
    }
  }
  return null
}

/** Bin directory containing the command shim (e.g. C:\nvm4w\nodejs). */
export async function binDirOf(command: string): Promise<string | null> {
  const resolved = await findCommandPath(command)
  if (resolved === null) return null
  return path.dirname(resolved)
}

/** Global node_modules root derived from a command shim's bin directory. */
export async function globalNodeModulesDir(command = 'dsh'): Promise<string | null> {
  const binDir = await binDirOf(command)
  if (binDir === null) return null
  const candidate = path.join(binDir, 'node_modules')
  return fs.existsSync(candidate) ? candidate : null
}

/**
 * Resolve the JS entry of a package installed in the global node_modules.
 * pnpm installs shims into the same bin directory as node itself.
 */
export async function globalPackageEntry(
  command: string,
  relativeEntry: string,
): Promise<string | null> {
  const root = await globalNodeModulesDir(command)
  if (root === null) return null
  const entry = path.join(root, relativeEntry)
  return fs.existsSync(entry) ? entry : null
}

/** pnpm's real CLI entry (pnpm.cjs), avoiding the .cmd shim. */
export async function resolvePnpmEntry(): Promise<string> {
  const entry = await globalPackageEntry('pnpm', 'pnpm/bin/pnpm.cjs')
  if (entry === null) {
    throw new Error('无法解析 pnpm CLI（需要 pnpm 在 PATH 中且全局安装）。')
  }
  return entry
}

/** npm's real CLI entry (npm-cli.js), avoiding the .cmd shim. */
export async function resolveNpmEntry(): Promise<string> {
  const entry = await globalPackageEntry('npm', 'npm/bin/npm-cli.js')
  if (entry === null) {
    throw new Error('无法解析 npm CLI（需要 npm 在 PATH 中且全局安装）。')
  }
  return entry
}
