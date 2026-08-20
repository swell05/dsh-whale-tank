import fs from 'node:fs'
import path from 'node:path'
import {
  applyKnowledgePack,
  loadBuiltinKnowledgePack,
} from './knowledge-pack.ts'
import { initSandbox, type SandboxInitResult } from './sandbox.ts'
import { KNOWLEDGE_PACK_DSH_BASELINE } from './knowledge-pack.ts'
import { readState, setKnowledgePackVersion, writeState } from './state.ts'
import { baselineProfileFor, normalizeType } from './type-route.ts'
import { composeSkeleton, writeComposedSkeleton } from './template-engine.ts'
import { skeletonSpecFor, skeletonVarsFor } from './skeleton.ts'
import { CAPABILITY_WIRING } from './overlays.ts'
import { parseCapabilities, validateCapabilities, type Capability } from './capability.ts'
import { writeWtTools } from './wttools.ts'
import type { KnowledgePackMeta } from './knowledge-pack.ts'
import type { KnowledgePackReport, ProjectType, ToolContextLike } from './types.ts'

export interface InitPlan {
  name: string
  type: ProjectType
  description: string
  summary: string
  directoryPlan: string[]
  dependencySuggestions: string[]
  capabilities: Capability[]
  knowledgePack: boolean
  dshVersionRequested: string | null
}

export interface InitOptions {
  project: string
  name: string
  type: ProjectType
  description?: string
  capabilities?: Capability[]
  requestedVersion?: string | null
  globalRoot: string
  knowledgePack: boolean
  planOnly?: boolean
  yes?: boolean
  git?: boolean
  skipSandbox?: boolean
  ctx?: ToolContextLike
}

export interface InitReport {
  plan: InitPlan
  planOnly: boolean
  skeletonFiles: string[]
  /** `.wttools/` 工作区工具文件（随沙盒打包的 CLI shim）。 */
  wttoolsFiles: string[]
  knowledgePack: KnowledgePackReport | null
  sandbox: SandboxInitResult | null
  gitHint: boolean
  warnings: string[]
}

export function planInit(opts: {
  name: string
  type: ProjectType
  description?: string
  capabilities?: Capability[]
  knowledgePack: boolean
  dshVersionRequested?: string | null
}): InitPlan {
  const description = (opts.description ?? '').trim()
  const type = normalizeType(opts.type)
  const capabilities = [...new Set(opts.capabilities ?? [])]
  const typeLabel =
    type === 'host' ? 'host' : type === 'client' ? 'client（仅浏览器，无 host 业务逻辑）' : 'both（web 客户端 + host 半边）'
  const summary =
    `为「${opts.name}」生成 DSH ${typeLabel} 插件骨架。` +
    (description.length > 0
      ? `理解：${description}。生成入口与测试桩，具体业务逻辑由开发者/agent 后续填充。`
      : '暂未提供详细描述：先生成可构建的最小骨架，后续由 agent 按需填充。')
  const directoryPlan = [
    'package.json（契约 A：main → lib/index.js、exports 含 ./client、peerDeps）',
    'tsconfig.json / tsconfig.build.json',
    'tsdown.host.config.ts + tsdown.client.config.ts',
    ...(type === 'client'
      ? ['（client 型无 dsh.bundle / cordis.patch.yml——不进层栈，由 plug 写 insert 行接入）']
      : ['cordis.patch.yml（insert 挂载自身）']),
    type === 'client' ? 'src/index.ts（host loader stub，纯转发）' : 'src/index.ts（Cordis 入口骨架）',
    'src/client/index.ts（client 半边）',
    'tests/plugin.spec.ts（vitest 桩）',
    ...capabilities.map(
      (cap) => `capability ${cap} → ${CAPABILITY_WIRING[cap]}`,
    ),
    ...(opts.knowledgePack
      ? ['AGENTS.md + NOTES.md + docs/dev-guidance/（知识包三层，增量合并）']
      : []),
    '.sandbox/（沙盒 DSH_HOME + 基线 profile + state.json）',
  ]
  return {
    name: opts.name,
    type,
    description,
    summary,
    directoryPlan,
    dependencySuggestions: [
      '@deepseek-ai/cordis@^4.0.1（peerDeps，运行时由 profile 闭包注入）',
      'typescript / tsdown / vitest（devDeps，构建与测试）',
      ...(type !== 'host'
        ? ['@deepseek-ai/dsh-client-runtime（web client inject 槽位，peerDeps）']
        : []),
    ],
    capabilities,
    knowledgePack: opts.knowledgePack,
    dshVersionRequested: opts.dshVersionRequested ?? null,
  }
}

/** 分层合成骨架：基座模板 + capability 覆盖层 + package.json 字段合并。 */
export function writeSkeleton(
  project: string,
  type: ProjectType,
  name: string,
  capabilities: Capability[] = [],
): string[] {
  const spec = skeletonSpecFor(type, capabilities)
  const files = composeSkeleton(spec, skeletonVarsFor(type, name, capabilities))
  return writeComposedSkeleton(project, files)
}

export async function runInit(opts: InitOptions): Promise<InitReport> {
  const normalized = normalizeType(opts.type)
  const capabilities = opts.capabilities ?? []
  const validation = validateCapabilities(normalized, capabilities)
  if (!validation.ok) {
    throw new Error(`capabilities 非法组合：\n${validation.reasons.join('\n')}`)
  }
  const plan = planInit({
    name: opts.name,
    type: normalized,
    description: opts.description ?? '',
    capabilities,
    knowledgePack: opts.knowledgePack,
    dshVersionRequested: opts.requestedVersion ?? null,
  })
  const warnings: string[] = []
  if (opts.type === 'web') {
    warnings.push('--type web 已弃用，本次按 both 处理。')
  }
  if (opts.planOnly) {
    return {
      plan,
      planOnly: true,
      skeletonFiles: [],
      wttoolsFiles: [],
      knowledgePack: null,
      sandbox: null,
      gitHint: false,
      warnings,
    }
  }

  if (!opts.yes) {
    const question =
      `init 计划确认：\n${plan.summary}\n目录计划：\n- ${plan.directoryPlan.join('\n- ')}\n` +
      `依赖建议：\n- ${plan.dependencySuggestions.join('\n- ')}\n确认执行？`
    const answer = await opts.ctx?.askUser?.(question)
    if (answer?.kind !== 'ok') {
      throw new Error('init 已取消（用户未确认）。')
    }
  }

  fs.mkdirSync(opts.project, { recursive: true })
  const skeletonFiles = writeSkeleton(opts.project, normalized, opts.name, capabilities)

  let sandbox: SandboxInitResult | null = null
  if (!opts.skipSandbox) {
    sandbox = await initSandbox({
      project: opts.project,
      projectName: opts.name,
      projectType: normalized,
      requestedVersion: opts.requestedVersion ?? null,
      globalRoot: opts.globalRoot,
      knowledgePackVersion: loadBuiltinKnowledgePack().version,
      knowledgePackDshBaseline: KNOWLEDGE_PACK_DSH_BASELINE,
    })
    if (!sandbox.selfCheck.ok) {
      warnings.push(`init 自检未通过：${sandbox.selfCheck.reason}`)
    }
  }

  // .wttools 工作区工具（随沙盒打包）：bundle 缺失时降级为告警，不阻断 init。
  let wttoolsFiles: string[] = []
  try {
    wttoolsFiles = writeWtTools(opts.project).files
  } catch (error) {
    warnings.push(`.wttools 工作区工具写入失败：${String(error)}`)
  }

  let knowledgePack: KnowledgePackReport | null = null
  if (opts.knowledgePack) {
    const state = sandbox !== null ? readState(opts.project) : null
    const meta: KnowledgePackMeta = {
      projectName: opts.name,
      type: normalized,
      mode: state?.dsh.mode ?? 'local',
      dshVersion: state?.dsh.version ?? '',
      profile: state?.sandbox.profile ?? baselineProfileFor(normalized),
      dshBaseline: KNOWLEDGE_PACK_DSH_BASELINE,
    }
    knowledgePack = applyKnowledgePack(
      opts.project,
      loadBuiltinKnowledgePack(),
      meta,
      'init',
    )
    if (state !== null) {
      writeState(
        opts.project,
        setKnowledgePackVersion(state, knowledgePack.version, KNOWLEDGE_PACK_DSH_BASELINE),
      )
    }
  }

  // git: 不再自动 init，改为提示。用户可选择自行 git init / 跳过。
  const gitHint = opts.git !== false
  if (gitHint) {
    warnings.push(
      'git 仓库未自动创建。如需版本管理，请手动执行：\n' +
      '  git init\n  git add -A\n  git commit -m "init: 骨架 + 沙盒 + 知识包"',
    )
  }

  return {
    plan,
    planOnly: false,
    skeletonFiles,
    wttoolsFiles,
    knowledgePack,
    sandbox,
    gitHint,
    warnings,
  }
}
