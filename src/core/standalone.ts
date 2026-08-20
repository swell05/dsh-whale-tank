import fs from 'node:fs'
import path from 'node:path'
import { dshInstallDir } from './paths.ts'
import { runPnpmIn } from './dsh.ts'
import { readPackageVersion, standaloneDshPackageDir } from './versions.ts'

export const DSH_REGISTRY = 'https://registry.npmjs.org/'

/**
 * standalone 模式（设计 §5.2 / 决策 04 实测）：
 * 把 @deepseek-ai/dsh@<版本> 装进 .sandbox/dsh-install/，共享全局 store，
 * 并把 pnpm-workspace.yaml 的 allowBuilds 占位键置 true。
 */
export async function installStandalone(opts: {
  project: string
  version: string
  timeoutMs?: number
}): Promise<{ entry: string; version: string }> {
  const dir = dshInstallDir(opts.project)
  fs.mkdirSync(dir, { recursive: true })
  const manifest = path.join(dir, 'package.json')
  if (!fs.existsSync(manifest)) {
    fs.writeFileSync(
      manifest,
      JSON.stringify({ name: 'dsh-install', version: '1.0.0', private: true }, null, 2) + '\n',
      'utf8',
    )
  }
  const result = await runPnpmIn(
    dir,
    [
      'add',
      `@deepseek-ai/dsh@${opts.version}`,
      '--registry',
      DSH_REGISTRY,
    ],
    { timeoutMs: opts.timeoutMs ?? 300_000 },
  )
  // pnpm ≥10/11 在原生 build 脚本被忽略时以 exit 1 + ERR_PNPM_IGNORED_BUILDS
  // 结束，但依赖已经装好（决策 04 实测）；allowBuilds 在下方统一处理。
  const ignoredBuilds =
    result.exitCode !== 0 &&
    (result.stderr + result.stdout).includes('ERR_PNPM_IGNORED_BUILDS')
  if (result.exitCode !== 0 && !ignoredBuilds) {
    throw new Error(
      `standalone 安装失败（pnpm add @deepseek-ai/dsh@${opts.version}）：\n` +
        `${result.stderr || result.stdout}`,
    )
  }
  enableAllowBuilds(path.join(dir, 'pnpm-workspace.yaml'))
  const version = readPackageVersion(path.join(standaloneDshPackageDir(opts.project), 'package.json'))
  if (version !== opts.version) {
    throw new Error(
      `standalone 副本版本不符：期望 ${opts.version}，实际安装 ${version}`,
    )
  }
  return {
    entry: path.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    version,
  }
}

/**
 * pnpm ≥10 blocks native build scripts; the generated allowBuilds section
 * holds placeholder entries (`'koffi': set this to true or false`). Flip
 * every key inside allowBuilds to `true`, preserving the quoted key
 * (keys contain colons — quotes are mandatory in YAML).
 */
export function enableAllowBuilds(file: string): void {
  let content: string
  try {
    content = fs.readFileSync(file, 'utf8')
  } catch {
    return
  }
  const lines = content.split(/\r?\n/)
  let inAllowBuilds = false
  const next: string[] = []
  for (const line of lines) {
    if (/^allowBuilds:\s*$/.test(line)) {
      inAllowBuilds = true
      next.push(line)
      continue
    }
    if (inAllowBuilds) {
      if (/^\S/.test(line) && !/^\s/.test(line)) {
        inAllowBuilds = false
      } else if (/^(\s+)(['"]?[\w@/.:-]+['"]?):\s*.*$/.test(line)) {
        const indentation = /^(\s+)/.exec(line)?.[1] ?? '  '
        const key = /^(\s+)(['"]?[\w@/.:-]+['"]?)/.exec(line)?.[2] ?? ''
        next.push(`${indentation}${key}: true`)
        continue
      }
    }
    next.push(line)
  }
  const updated = next.join('\n')
  if (updated !== content) {
    fs.writeFileSync(file, updated, 'utf8')
  }
}
