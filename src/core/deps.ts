import fs from 'node:fs'
import path from 'node:path'
import { runDshPlugin } from './dsh.ts'
import { runNodeScript } from './proc.ts'
import { appendNoteLog } from './knowledge-pack.ts'
import { readState, recordProfilePlugin, removeProfilePlugin, writeState } from './state.ts'
import { assertDumpConfig } from './smoke.ts'
import type { ToolContextLike } from './types.ts'
import { readRuntimeVersionFromTree } from './versions.ts'

export type DepChannel = 'plugin' | 'npm'
export type DepSection = 'dependencies' | 'devDependencies' | 'peerDependencies'

export interface ClassifiedDependency {
  channel: DepChannel
  name: string
  version: string | null
}

/**
 * plugin 通道的版本解析：**版本一致性（铁律 6）只约束官方 `@deepseek-ai/*`
 * 插件**（随 dsh 版本锁定）——未显式指定时默认取沙盒运行时版本，且显式指定
 * 必须与运行时一致。第三方 dsh 插件（如 `@swell05/*`）版本独立，未指定时
 * 装 latest（返回 null），不强制对齐运行时（否则会去装一个不存在的
 * `@swell05/dsh-whale-tank@0.1.0-rc.8`）。显式指定则原样使用。
 */
export function resolvePluginDepVersion(
  name: string,
  explicit: string | null | undefined,
  runtimeVersion: string,
): string | null {
  if (explicit !== null && explicit !== undefined) return explicit
  return name.startsWith('@deepseek-ai/') ? runtimeVersion : null
}

/**
 * `--add` 智能抽取（确定性正则，无 LLM）：输入是**包名**（可带 `@版本`），
 * 如 `@deepseek-ai/dsh-client-runtime` 或 `lodash@^4.4.3`。保留 token 抽取
 * （scoped 名/裸名 + 版本），不做自然语言语义解析；通道按包名判定：
 * 插件依赖 = @deepseek-ai/* 或含 dsh- 前缀；其余 = 普通 npm 库。
 */
export function classifyDependency(spec: string): ClassifiedDependency {
  const token =
    /(@[a-zA-Z0-9][\w.-]*\/[a-zA-Z0-9][\w.-]*|[a-zA-Z0-9][\w.-]*)(?:@([^\s，。]+))?/g
  const matches = [...spec.trim().matchAll(token)]
  const chosen =
    matches.find((m) => m[1].includes('/') || m[1].includes('-') || m[1].includes('.')) ??
    matches[0]
  if (chosen === undefined) {
    throw new Error(
      '--add 需给出包名：如 --add @deepseek-ai/dsh-client-runtime 或 --add lodash@4。',
    )
  }
  const raw = chosen[1]
  const version = chosen[2] ?? null
  const isPlugin =
    raw.startsWith('@deepseek-ai/') ||
    raw.startsWith('dsh-') ||
    raw.includes('dsh')
  return { channel: isPlugin ? 'plugin' : 'npm', name: raw, version }
}

export interface AddDependencyOptions {
  project: string
  globalRoot: string
  channel: DepChannel
  name: string
  version?: string | null
  section?: DepSection
  remove?: boolean
  yes?: boolean
  ctx?: ToolContextLike
}

export interface DependencyResult {
  channel: DepChannel
  name: string
  action: 'added' | 'removed'
  smoke: { ok: boolean; reason: string | null } | null
  warnings: string[]
}

/** 双通道依赖安装（设计 §6.2）：插件依赖 → 沙盒 profile；普通库 → 项目 package.json。 */
export async function applyDependency(
  opts: AddDependencyOptions,
): Promise<DependencyResult> {
  const state = readState(opts.project)
  const warnings: string[] = []
  const profile = state.sandbox.profile

  if (opts.channel === 'plugin') {
    return applyPluginDependency(opts, state, profile, warnings)
  }
  return applyProjectDependency(opts, warnings)
}

async function applyPluginDependency(
  opts: AddDependencyOptions,
  state: ReturnType<typeof readState>,
  profile: string,
  warnings: string[],
): Promise<DependencyResult> {
  const runtimeVersion = readRuntimeVersionFromTree({
    mode: state.dsh.mode,
    project: opts.project,
    globalRoot: opts.globalRoot,
  })
  const version = resolvePluginDepVersion(opts.name, opts.version, runtimeVersion)
  if (
    opts.name.startsWith('@deepseek-ai/') &&
    version !== runtimeVersion &&
    !opts.remove
  ) {
    throw new Error(
      `版本一致性（铁律 6）：官方插件依赖版本 ${version} ≠ 沙盒运行时 ${runtimeVersion}。` +
        `如需其他官方版本，请用 init --dsh-version 钉版后重试。`,
    )
  }
  const spec = version === null ? opts.name : `${opts.name}@${version}`
  const args = opts.remove ? ['remove', opts.name] : ['add', spec]
  const result = await runDshPlugin({
    project: opts.project,
    globalRoot: opts.globalRoot,
    mode: state.dsh.mode,
    profile,
    argv: args,
    timeoutMs: 300_000,
  })
  if (result.exitCode !== 0) {
    throw new Error(`dsh plugin ${opts.remove ? 'remove' : 'add'} 失败：\n${result.stderr || result.stdout}`)
  }

  let smoke: { ok: boolean; reason: string | null } | null = null
  if (!opts.remove) {
    // 冒烟：dump-config 断言目标插件层在组合树。
    const { runDshProfile } = await import('./dsh.ts')
    const configDump = await runDshProfile({
      project: opts.project,
      globalRoot: opts.globalRoot,
      mode: state.dsh.mode,
      profile,
      argv: ['--dump-config'],
      timeoutMs: 60_000,
    })
    smoke = assertDumpConfig(configDump.stdout, {
      bundles: [...state.sandbox.baselineBundles, opts.name],
      pluginId: opts.name,
    })
    if (!smoke.ok) warnings.push(`deps 冒烟：${smoke.reason}`)
  }

  const next = opts.remove
    ? removeProfilePlugin(state, opts.name)
    : recordProfilePlugin(state, {
        name: opts.name,
        version: version ?? 'latest',
        addedBy: 'deps',
        addedAt: new Date().toISOString(),
      })
  writeState(opts.project, next)
  appendNoteLog(
    opts.project,
    `${new Date().toISOString().slice(0, 10)} | ${opts.remove ? '移除' : '安装'}插件依赖 ${spec} | 双通道：dsh plugin --profile ${profile} ${opts.remove ? 'remove' : 'add'} | 对账进 bundles，版本=${runtimeVersion}`,
  )
  return {
    channel: 'plugin',
    name: opts.name,
    action: opts.remove ? 'removed' : 'added',
    smoke,
    warnings,
  }
}

async function applyProjectDependency(
  opts: AddDependencyOptions,
  warnings: string[],
): Promise<DependencyResult> {
  const section = opts.section ?? 'dependencies'
  editProjectPackageJson(opts.project, {
    name: opts.name,
    version: opts.version ?? '*',
    section,
    remove: opts.remove === true,
  })
  const { resolveNpmEntry } = await import('./proc.ts')
  const npmEntry = await resolveNpmEntry()
  const install = await runNodeScript(npmEntry, ['install'], {
    cwd: opts.project,
    timeoutMs: 300_000,
  })
  if (install.exitCode !== 0) {
    warnings.push(`npm install 未完全成功：\n${install.stderr || install.stdout}`)
  }
  const state = readState(opts.project)
  writeState(opts.project, {
    ...state,
    dependencies: {
      ...state.dependencies,
      projectDeps: {
        ...state.dependencies.projectDeps,
        [section]: {
          ...state.dependencies.projectDeps[section],
          [opts.name]: opts.remove ? undefined : (opts.version ?? '*'),
        },
      },
    },
  })
  appendNoteLog(
    opts.project,
    `${new Date().toISOString().slice(0, 10)} | ${opts.remove ? '移除' : '添加'} npm 库 ${opts.name}@${opts.version ?? '*'}` +
      ` | 写入项目 package.json ${section} 并 npm install | ${warnings.length > 0 ? '有警告' : '成功'}`,
  )
  return {
    channel: 'npm',
    name: opts.name,
    action: opts.remove ? 'removed' : 'added',
    smoke: null,
    warnings,
  }
}

/** 编辑项目 package.json 的依赖区段（保留其他字段与既有条目）。 */
export function editProjectPackageJson(
  project: string,
  input: {
    name: string
    version: string
    section: DepSection
    remove: boolean
  },
): void {
  const file = path.join(project, 'package.json')
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<
    string,
    Record<string, string>
  >
  if (manifest[input.section] === undefined) {
    manifest[input.section] = {}
  }
  if (input.remove) {
    delete manifest[input.section][input.name]
  } else {
    manifest[input.section][input.name] = input.version
  }
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
}
