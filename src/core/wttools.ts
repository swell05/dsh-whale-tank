import fs from 'node:fs'
import path from 'node:path'
import { packageRootDir } from './paths.ts'

/**
 * `.wttools/` 工作区工具（grill 决策：随沙盒打包命令行工具，取代「装一个
 * 全局 whale-tank 命令去敲」的调用形态）。init 把包里预打包的**零依赖单文件
 * CLI**（wttools/whale-tank.cjs，见 tsdown.wttools.config.ts）复制进项目
 * `.wttools/`，并为每个 workspace 命令生成 shim（Windows `.cmd` + Unix sh），
 * 用户在项目文件夹内直接敲 `.wttools\status`、`.wttools\run-test` 等。
 *
 * shim 把项目根烘焙进 `--project`（父目录解析），用户在项目任意子目录都可用；
 * 用户自己传的 `--project` 在 `%*`/`"$@"` 里更靠后，parseCliArgs 后者覆盖前者。
 */

export const WTTOOLS_COMMANDS = [
  'status',
  'deps',
  'plug',
  'plug-test',
  'unplug',
  'restore',
  'reset',
  'upgrade-knowledge',
  'run-test',
] as const

export function wttoolsDir(project: string): string {
  return path.join(project, '.wttools')
}

/** 发布包内置的单文件 CLI bundle（tsdown.wttools.config.ts 产物）。 */
export function bundledWtCliPath(): string {
  return path.join(packageRootDir(), 'wttools', 'whale-tank.cjs')
}

export function writeWtTools(project: string): { files: string[] } {
  const dir = wttoolsDir(project)
  fs.mkdirSync(dir, { recursive: true })
  const bundle = bundledWtCliPath()
  if (!fs.existsSync(bundle)) {
    throw new Error(
      `内置 .wttools CLI bundle 缺失：${bundle}。请先 npm run build（tsdown.wttools.config.ts 产物）。`,
    )
  }
  const files: string[] = []
  fs.copyFileSync(bundle, path.join(dir, 'whale-tank.cjs'))
  files.push('.wttools/whale-tank.cjs')
  for (const verb of WTTOOLS_COMMANDS) {
    const winName = `${verb}.cmd`
    fs.writeFileSync(path.join(dir, winName), shimCmd(verb), 'utf8')
    files.push(`.wttools/${winName}`)
    fs.writeFileSync(path.join(dir, verb), shimSh(verb), 'utf8')
    files.push(`.wttools/${verb}`)
  }
  appendGitignore(project, '.wttools/')
  return { files }
}

export function shimCmd(verb: string): string {
  return (
    `@echo off\r\n` +
    `rem whale-tank ${verb} shim（@swell05/dsh-whale-tank init 生成）\r\n` +
    `node "%~dp0whale-tank.cjs" ${verb} --project "%~dp0.." %*\r\n`
  )
}

export function shimSh(verb: string): string {
  return (
    `#!/usr/bin/env sh\n` +
    `# whale-tank ${verb} shim（@swell05/dsh-whale-tank init 生成）\n` +
    `SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\n` +
    `exec node "$SCRIPT_DIR/whale-tank.cjs" ${verb} --project "$SCRIPT_DIR/.." "$@"\n`
  )
}

function appendGitignore(project: string, entry: string): void {
  const file = path.join(project, '.gitignore')
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const lines = existing.split(/\r?\n/)
  if (lines.includes(entry)) return
  const next = existing.endsWith('\n') || existing === '' ? existing : `${existing}\n`
  fs.writeFileSync(file, `${next}${entry}\n`, 'utf8')
}
