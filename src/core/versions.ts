import fs from 'node:fs'
import path from 'node:path'
import { dshInstallDir, standaloneDshEntry } from './paths.ts'
import type { VersionMode } from './types.ts'

export function readPackageVersion(packageJsonPath: string): string {
  let raw: string
  try {
    raw = fs.readFileSync(packageJsonPath, 'utf8')
  } catch (error) {
    throw new Error(`读取 package.json 失败（${packageJsonPath}）：${String(error)}`)
  }
  const parsed = JSON.parse(raw) as { version?: string }
  if (typeof parsed.version !== 'string' || parsed.version === '') {
    throw new Error(`package.json 缺少 version 字段（${packageJsonPath}）。`)
  }
  return parsed.version
}

const DSH_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/

interface ParsedDshVersion {
  core: [number, number, number]
  rc: number | null
}

function parseDshVersion(version: string): ParsedDshVersion | null {
  const match = DSH_VERSION_RE.exec(version.trim())
  if (match === null) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    rc: match[4] === undefined ? null : Number(match[4]),
  }
}

/** Pure: semver-ish ordering for dsh versions (`0.1.0-rc.N` line). */
export function compareDshVersions(a: string, b: string): number | null {
  const pa = parseDshVersion(a)
  const pb = parseDshVersion(b)
  if (pa === null || pb === null) return null
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i]
  }
  // 同 core：正式版 > rc；rc 之间按编号。
  if (pa.rc === null && pb.rc === null) return 0
  if (pa.rc === null) return 1
  if (pb.rc === null) return -1
  return pa.rc - pb.rc
}

/**
 * 知识包版本锚（dshBaseline）的软提示（设计 §13.1）：
 * 本机 dsh 版本比锚新 → 返回提示行；等于/低于/未知 → null。
 * 只做可发现性，不进告警通道、不影响退出码与 plugState。
 */
export function dshBaselineDrift(
  baseline: string | null,
  local: string | null,
): string | null {
  if (baseline === null || local === null) return null
  const order = compareDshVersions(local, baseline)
  if (order === null || order <= 0) return null
  return `知识包可能滞后于 ${local}（知识包锚定 ${baseline}），建议重蒸馏/upgrade-knowledge。`
}

export function localDshPackageDir(globalRoot: string): string {
  return path.join(globalRoot, '@deepseek-ai', 'dsh')
}

export function standaloneDshPackageDir(project: string): string {
  return path.join(dshInstallDir(project), 'node_modules', '@deepseek-ai', 'dsh')
}

export function standaloneDshVersion(project: string): string {
  return readPackageVersion(path.join(standaloneDshPackageDir(project), 'package.json'))
}

/**
 * Resolve the actual runtime dsh version:
 * - local: read the global install's package.json;
 * - standalone: read the .sandbox/dsh-install copy.
 */
export function readRuntimeVersionFromTree(opts: {
  mode: VersionMode
  project?: string
  globalRoot?: string
}): string {
  if (opts.mode === 'standalone') {
    if (opts.project === undefined) {
      throw new Error('standalone 模式需要 project 参数以定位副本。')
    }
    return standaloneDshVersion(opts.project)
  }
  if (opts.globalRoot === undefined) {
    throw new Error('local 模式需要 globalRoot 参数。')
  }
  return readPackageVersion(
    path.join(localDshPackageDir(opts.globalRoot), 'package.json'),
  )
}

/**
 * Resolve the dsh entry script to spawn:
 * - local: <global>/@deepseek-ai/dsh/lib/bin.js
 * - standalone: <sandbox>/dsh-install/node_modules/@deepseek-ai/dsh/lib/bin.js
 */
export function resolveDshEntry(opts: {
  mode: VersionMode
  project: string
  globalRoot: string
}): string {
  if (opts.mode === 'standalone') {
    const entry = standaloneDshEntry(opts.project)
    if (!fs.existsSync(entry)) {
      throw new Error(
        `standalone dsh 副本入口不存在：${entry}（可能需要重跑 init 或 installStandalone）。`,
      )
    }
    return entry
  }
  const entry = path.join(localDshPackageDir(opts.globalRoot), 'lib', 'bin.js')
  if (!fs.existsSync(entry)) {
    throw new Error(`本地全局 dsh 入口不存在：${entry}`)
  }
  return entry
}
