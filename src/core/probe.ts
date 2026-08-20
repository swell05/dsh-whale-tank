import { spawn, type ChildProcess } from 'node:child_process'
import readline from 'node:readline'
import { dshHomeDir } from './paths.ts'
import { dshHomeEnv } from './proc.ts'
import { resolveDshEntry } from './versions.ts'
import type { VersionMode } from './types.ts'

/** 从 web boot 输出中提取服务器地址（`dsh web: http://...`）。 */
export function extractWebUrl(text: string): string | null {
  const match = /dsh web:\s+(https?:\/\/[^\s]+)/.exec(text)
  return match === null ? null : match[1]
}

/** 杀进程树 + 强制收尾（Windows taskkill /T /F；v1 proc 同款）。 */
export function terminateProcessTree(child: ChildProcess): void {
  try {
    child.kill('SIGKILL')
  } catch {
    // best effort
  }
  if (process.platform === 'win32' && child.pid !== undefined) {
    try {
      const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      taskkill.unref()
    } catch {
      // best effort
    }
  }
}

/**
 * client 冒烟：后台 boot web profile（--port 0 --no-open），
 * 等启动地址出现，HTTP 探测 `/plugins/<id>/client.js` 200 即 client bundle
 * 可加载；最后杀进程树。boot 未出地址 / 探测失败 → ok:false。
 */
export async function probeWebClientBundle(opts: {
  project: string
  globalRoot: string
  mode: VersionMode
  profile: string
  pluginId: string
}): Promise<{ ok: boolean; reason: string | null }> {
  const entry = resolveDshEntry({
    mode: opts.mode,
    project: opts.project,
    globalRoot: opts.globalRoot,
  })
  const child = spawn(
    process.execPath,
    [entry, '--profile', opts.profile, '--port', '0', '--no-open'],
    {
      cwd: opts.project,
      env: dshHomeEnv(dshHomeDir(opts.project)),
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  try {
    const url = await waitForWebUrl(child, 30_000)
    if (url === null) {
      return { ok: false, reason: 'web boot 未输出启动地址（`dsh web: http://...`）' }
    }
    const port = new URL(url).port
    const clientUrl = `http://127.0.0.1:${port}/plugins/${opts.pluginId}/client.js`
    let status: number | null = null
    try {
      const response = await fetch(clientUrl)
      status = response.status
    } catch (error) {
      return { ok: false, reason: `client bundle HTTP 请求失败：${String(error)}` }
    }
    if (status !== 200) {
      return {
        ok: false,
        reason: `client bundle 加载断言失败：HTTP ${status}（${clientUrl}）`,
      }
    }
    return { ok: true, reason: null }
  } finally {
    terminateProcessTree(child)
  }
}

function waitForWebUrl(child: ChildProcess, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    const url = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity })
    url.on('line', (line) => {
      const found = extractWebUrl(line)
      if (found !== null) finish(found)
    })
    child.on('close', () => finish(null))
    child.on('error', () => finish(null))
  })
}
