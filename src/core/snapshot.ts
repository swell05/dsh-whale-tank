import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  profileDir,
  profileDirFor,
  sessionsDir,
  sessionsDirFor,
  snapshotsDir,
  snapshotsDirFor,
  statePath,
} from './paths.ts'
import type { DiffSummary } from './types.ts'

/** Profile files captured byte-for-byte (design §9.1). */
export const PROFILE_FILES = ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml'] as const

export interface SnapshotCollection {
  id: string
  dir: string
}

export function topLevelNodeModules(profileDirPath: string): string[] {
  const nm = path.join(profileDirPath, 'node_modules')
  if (!fs.existsSync(nm)) return []
  return fs
    .readdirSync(nm, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

/**
 * pnpm 卸载 scoped 包后留下的**空** `@scope/` 目录（如 `@swell05/`）：
 * pnpm 从不清理空 scope 目录，属于包管理器工件而非插件副作用。
 * 非 `@` 开头或目录非空 → false（仍视为真实残留）。
 */
export function isEmptyScopeDir(profileDirPath: string, name: string): boolean {
  if (!name.startsWith('@')) return false
  const dir = path.join(profileDirPath, 'node_modules', name)
  try {
    return fs.readdirSync(dir).length === 0
  } catch {
    return false
  }
}

function sha256Of(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

export function collectSnapshot(opts: {
  project: string
  profile: string
  trigger: string
  declaredVersion: string
  actualVersion: string
  /** Vet sandbox: pass the vetting root whose dsh-home lives directly under it. */
  sandboxRoot?: string
}): SnapshotCollection {
  const id = `snap-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random()
    .toString(36)
    .slice(2, 6)}`
  const dir = path.join(
    opts.sandboxRoot === undefined
      ? snapshotsDir(opts.project)
      : snapshotsDirFor(opts.sandboxRoot),
    id,
  )
  const filesDir = path.join(dir, 'files')
  fs.mkdirSync(filesDir, { recursive: true })

  const source =
    opts.sandboxRoot === undefined
      ? profileDir(opts.project, opts.profile)
      : profileDirFor(opts.sandboxRoot, opts.profile)
  const shas: Record<string, string> = {}
  for (const name of PROFILE_FILES) {
    const src = path.join(source, name)
    const dest = path.join(filesDir, name)
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest)
      shas[`files/${name}`] = sha256Of(src)
    }
  }
  fs.writeFileSync(path.join(dir, 'sha256.json'), JSON.stringify(shas, null, 2) + '\n', 'utf8')
  fs.writeFileSync(
    path.join(dir, 'node-modules.txt'),
    topLevelNodeModules(source).join('\n') + '\n',
    'utf8',
  )
  const stateFile =
    opts.sandboxRoot === undefined
      ? statePath(opts.project)
      : path.join(opts.sandboxRoot, 'state.json')
  if (fs.existsSync(stateFile)) {
    fs.copyFileSync(stateFile, path.join(dir, 'state.json'))
  }
  fs.writeFileSync(
    path.join(dir, 'sessions.txt'),
    listSessionEntriesFor(opts.sandboxRoot ?? null, opts.project).join('\n') + '\n',
    'utf8',
  )
  const metadata = {
    id,
    capturedAt: new Date().toISOString(),
    trigger: opts.trigger,
    declaredDshVersion: opts.declaredVersion,
    actualDshVersion: opts.actualVersion,
  }
  fs.writeFileSync(path.join(dir, 'snapshot.json'), JSON.stringify(metadata, null, 2) + '\n', 'utf8')
  return { id, dir }
}

export function diffSnapshot(opts: {
  project: string
  profile: string
  snapshotDir: string
  sandboxRoot?: string
  /** Package names whose removal is expected (e.g. the unplugged target). */
  allowRemoved?: string[]
}): DiffSummary {
  const items: DiffSummary['items'] = []
  const snapshotShas = JSON.parse(
    fs.readFileSync(path.join(opts.snapshotDir, 'sha256.json'), 'utf8'),
  ) as Record<string, string>
  const currentProfile =
    opts.sandboxRoot === undefined
      ? profileDir(opts.project, opts.profile)
      : profileDirFor(opts.sandboxRoot, opts.profile)

  // 1) profile 文件逐字节/SHA 比对（§9.2.1）。
  for (const name of PROFILE_FILES) {
    const rel = `files/${name}`
    const current = path.join(currentProfile, name)
    const snapshotFile = path.join(opts.snapshotDir, rel)
    if (!fs.existsSync(snapshotFile)) continue
    if (!fs.existsSync(current)) {
      items.push({
        category: 'profile-file',
        kind: 'removed',
        path: name,
        detail: '拔后缺失（快照中有）',
      })
      continue
    }
    if (!profileFileEquals(name, current, path.join(opts.snapshotDir, rel))) {
      items.push({
        category: 'profile-file',
        kind: 'modified',
        path: name,
        detail: '内容/SHA 与快照不一致',
      })
    }
  }

  // 2) node_modules 顶层清单差集（§9.2.2）。
  const snapshotModules = fs
    .readFileSync(path.join(opts.snapshotDir, 'node-modules.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
  const currentModules = topLevelNodeModules(currentProfile)
  const allowRemoved = new Set(opts.allowRemoved ?? [])
  for (const name of currentModules) {
    // pnpm 基础设施：虚拟 store（.pnpm）、bin shim 目录（.bin，卸载后带旧
    // shim 残留是 pnpm 行为）、卸载 scoped 包后留下的空 @scope/ 目录——
    // 都不算插件副作用，忽略。
    if (name === '.pnpm' || name === '.bin') continue
    if (isEmptyScopeDir(currentProfile, name)) continue
    if (!snapshotModules.includes(name)) {
      items.push({
        category: 'node-modules',
        kind: 'added',
        path: name,
        detail: '残留：快照中没有、现在多出来的顶层包',
      })
    }
  }
  for (const name of snapshotModules) {
    if (name === '.pnpm' || name === '.bin') continue
    if (!currentModules.includes(name) && !allowRemoved.has(name)) {
      items.push({
        category: 'node-modules',
        kind: 'removed',
        path: name,
        detail: '缺失：快照中有、现在少了的顶层包',
      })
    }
  }

  // 3) state.json 一致性：profilePlugins 与 bundles 对齐（§9.2.3）。
  const currentState = readJsonOrNull(
    opts.sandboxRoot === undefined
      ? statePath(opts.project)
      : path.join(opts.sandboxRoot, 'state.json'),
  )
  const currentManifest = readJsonOrNull(path.join(currentProfile, 'package.json'))
  const bundles = (currentManifest as { dsh?: { profile?: { bundles?: string[] } } } | null)?.dsh
    ?.profile?.bundles
  const profilePlugins = (currentState as { dependencies?: { profilePlugins?: Array<{ name: string }> } } | null)
    ?.dependencies?.profilePlugins
  if (Array.isArray(profilePlugins) && Array.isArray(bundles)) {
    for (const plugin of profilePlugins) {
      if (!bundles.includes(plugin.name)) {
        items.push({
          category: 'state',
          kind: 'modified',
          path: `dependencies.profilePlugins/${plugin.name}`,
          detail: `state 记录的 profile 插件不在 bundles 列表中（对账不一致）`,
        })
      }
    }
  }

  // 4) sessions 新增条目（§9.2.4）。
  const snapshotSessions = fs
    .readFileSync(path.join(opts.snapshotDir, 'sessions.txt'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
  for (const entry of listSessionEntriesFor(opts.sandboxRoot ?? null, opts.project)) {
    if (!snapshotSessions.includes(entry)) {
      items.push({
        category: 'sessions',
        kind: 'added',
        path: entry,
        detail: 'boot 测试产生的会话残留',
      })
    }
  }

  return { clean: items.length === 0, items }
}

function listSessionEntriesFor(sandboxRootPath: string | null, project: string): string[] {
  const dir =
    sandboxRootPath === null ? sessionsDir(project) : sessionsDirFor(sandboxRootPath)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => name !== '.gitkeep')
    .sort()
}

/**
 * package.json is compared canonically (pnpm drops empty dependency sections
 * on remove; an absent section equals an empty one). The other profile files
 * are compared byte-for-byte via their snapshot SHA.
 */
function profileFileEquals(name: string, current: string, snapshotFile: string): boolean {
  if (name === 'package.json') {
    const normalize = (text: string): unknown => {
      const parsed = JSON.parse(text) as Record<string, unknown>
      for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
        if (parsed[key] === undefined) parsed[key] = {}
      }
      return parsed
    }
    try {
      return (
        canonicalize(normalize(fs.readFileSync(current, 'utf8'))) ===
        canonicalize(normalize(fs.readFileSync(snapshotFile, 'utf8')))
      )
    } catch {
      return sha256Of(current) === sha256Of(snapshotFile)
    }
  }
  return sha256Of(current) === sha256Of(snapshotFile)
}

/** Key-order-independent JSON canonicalization (used for manifest compare). */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function readJsonOrNull(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}
