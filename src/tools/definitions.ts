import { defineTool } from '@deepseek-ai/dsh-tools'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runInit } from '../core/init.ts'
import { parseCapabilities } from '../core/capability.ts'
import {
  vetStatic,
  vetDynamic,
  vetReport,
  startVetDynamicJob,
  conclusionLabel,
} from '../core/vet.ts'
import { upgradeKnowledgePack } from '../core/upgrade-knowledge.ts'
import { globalNodeModulesDir } from '../core/proc.ts'
import { hasState } from '../core/state.ts'
import type { ToolContextLike } from '../core/types.ts'

/**
 * @swell05/dsh-whale-tank 惰性工具定义：init / upgrade-knowledge / vet（三阶段）。
 * 它们**不在 apply 时注册**：由 inbox-inserted 监听器在用户触发对应 skill 的
 * 那一轮按 agent 惰性注册（agent.ctx.tools.register），随会话结束注销。
 */

/** 惰性工具在 dsh 运行时执行：经 exec.agent 桥接 approval 服务做 ask_user。 */
function toolContextOf(project: string, exec: unknown): ToolContextLike {
  const agent = (exec as { agent?: unknown } | undefined)?.agent
  const signal = (exec as { signal?: AbortSignal } | undefined)?.signal
  return {
    cwd: () => project,
    askUser: async (question) => {
      try {
        const ctx = agent as { ctx?: { get?: (key: string) => unknown } } | undefined
        const approval = ctx?.ctx?.get?.('approval') as
          | {
              request: (input: {
                agent?: unknown
                toolName?: string
                callId?: string
                reason: string
                signal?: AbortSignal
              }) => Promise<string>
            }
          | undefined
        if (approval === undefined) return { kind: 'cancel' }
        const outcome = await approval.request({
          agent,
          toolName: 'whale-tank',
          reason: question,
          signal,
        })
        return outcome === 'allowed-once' ? { kind: 'ok' } : { kind: 'cancel' }
      } catch {
        return { kind: 'cancel' }
      }
    },
  }
}

export function assertInitSafe(project: string, planOnly: boolean): void {
  if (planOnly) return
  if (!fs.existsSync(project)) return
  const entries = fs.readdirSync(project)
  if (entries.length > 0 && !hasState(project)) {
    throw new Error(
      `拒绝 init：目录非空且未初始化（缺少 .sandbox/state.json）。` +
        `whale-tank 不会覆盖已有内容；请在空目录执行 init，` +
        `或对已初始化项目使用 upgrade-knowledge。`,
    )
  }
}

export const initTool = defineTool({
  name: 'whale_tank_init',
  description:
    '初始化一个 DSH 插件项目：生成骨架（host/client/both；web 是 both 旧别名）→ 建沙盒基线 profile → 写 state.json，' +
    '并按 merge-spec 增量合并写入知识包（AGENTS.md/NOTES.md/docs/dev-guidance；no_knowledge_pack=true 跳过，知识自由模式只生成骨架）。' +
    '类型判定：纯 Node 后端（工具/命令/服务，无浏览器 UI）→ host；纯浏览器 UI（如桌面宠物等前端渲染）→ client；host 半边 + 浏览器半边 + 共享类型 → both。' +
    '空目录 → init；已初始化（有 .sandbox/state.json）→ 改用 whale_tank_upgrade_knowledge；' +
    '非空未初始化目录会拒绝。写盘前 ask_user 一次确认（yes=true 跳过）。',
  parameters: {
    project: { type: 'string', required: true, description: '目标项目绝对路径' },
    name: { type: 'string', required: true, description: 'npm 包名（如 dsh-my-plugin）' },
    type: { type: 'string', required: true, enum: ['host', 'client', 'both', 'web'], description: '插件类型：host（纯 Node 后端）/ client（纯浏览器 UI）/ both（host+UI+共享类型）；web 是 both 废弃别名' },
    description: { type: 'string', description: '粗略功能描述' },
    capabilities: { type: 'string', description: '能力 csv（skills|tools|commands|mcp-client|mcp-server|cli|toolview，按 type 过滤合法项）' },
    dsh_version: { type: 'string', description: '钉版版本；≠ 本机时自动 standalone' },
    no_knowledge_pack: { type: 'boolean', description: '跳过三层知识包写入（知识自由模式；默认写）' },
    plan_only: { type: 'boolean', description: '只输出计划不落盘' },
    yes: { type: 'boolean', description: '跳过 ask_user 确认' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        planOnly: { type: 'boolean', required: true },
        skeletonFiles: { type: 'array', items: { type: 'string' } },
        wttoolsFiles: { type: 'array', items: { type: 'string' } },
        knowledgePackWritten: { type: 'boolean' },
        knowledgePackAdded: { type: 'array', items: { type: 'string' } },
        knowledgePackUpdated: { type: 'array', items: { type: 'string' } },
        knowledgePackSkipped: { type: 'array', items: { type: 'string' } },
        selfCheckOk: { type: 'boolean', required: true },
        selfCheckReason: { type: 'string' },
        gitHint: { type: 'boolean' },
        warnings: { type: 'array', items: { type: 'string' } },
      },
    },
    render: (_args, value) => [
      {
        type: 'text',
        text: value.planOnly
          ? `init 计划已生成（未落盘）`
          : `${value.knowledgePackWritten === false ? '未写知识包（知识自由模式）' : `知识包 +${(value.knowledgePackAdded ?? []).length}/~${(value.knowledgePackUpdated ?? []).length}/skip ${(value.knowledgePackSkipped ?? []).length}`}；骨架 ${(value.skeletonFiles ?? []).length} 个文件；.wttools 工作区工具 ${(value.wttoolsFiles ?? []).length} 个；自检 ${value.selfCheckOk ? '通过' : `失败：${value.selfCheckReason}`}`,
      },
    ],
  },
  async execute(args, exec) {
    assertInitSafe(args.project, args.plan_only === true)
    const globalRoot = await globalNodeModulesDir('dsh')
    if (globalRoot === null) throw new Error('无法定位全局 dsh 安装。')
    const report = await runInit({
      project: args.project,
      name: args.name,
      type: args.type,
      description: args.description ?? '',
      capabilities:
        args.capabilities === undefined ? [] : parseCapabilities(args.capabilities),
      requestedVersion: args.dsh_version ?? null,
      globalRoot,
      knowledgePack: !(args.no_knowledge_pack === true),
      planOnly: args.plan_only === true,
      yes: args.yes === true,
      ctx: toolContextOf(args.project, exec),
    })
    return {
      planOnly: report.planOnly,
      skeletonFiles: report.skeletonFiles,
      wttoolsFiles: report.wttoolsFiles,
      knowledgePackAdded: report.knowledgePack?.added ?? [],
      knowledgePackUpdated: report.knowledgePack?.updated ?? [],
      knowledgePackSkipped: report.knowledgePack?.skipped ?? [],
      knowledgePackWritten: report.knowledgePack !== null,
      selfCheckOk: report.sandbox?.selfCheck.ok ?? true,
      selfCheckReason: report.sandbox?.selfCheck.reason ?? '',
      gitHint: report.gitHint,
      warnings: report.warnings,
    }
  },
})

export const upgradeTool = defineTool({
  name: 'whale_tank_upgrade_knowledge',
  description:
    '把插件当前内置的更新版知识包按 merge-spec 版本块机制增量合并进已初始化工作区：' +
    '新版本块追加、旧版本保留、不覆盖用户内容；幂等。仅适用于已有 .sandbox/state.json 的项目。',
  parameters: {
    project: { type: 'string', required: true, description: '已初始化项目绝对路径' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        version: { type: 'string', required: true },
        added: { type: 'array', items: { type: 'string' } },
        updated: { type: 'array', items: { type: 'string' } },
        skipped: { type: 'array', items: { type: 'string' } },
        conflicts: { type: 'array', items: { type: 'string' } },
      },
    },
    render: (_args, value) => [
      {
        type: 'text',
        text: `upgrade-knowledge → ${value.version}：新增 ${(value.added ?? []).length}、更新 ${(value.updated ?? []).length}、跳过 ${(value.skipped ?? []).length}${(value.conflicts ?? []).length > 0 ? `；冲突告警：${(value.conflicts ?? []).length} 条` : ''}`,
      },
    ],
  },
  async execute(args) {
    const report = upgradeKnowledgePack(args.project)
    return {
      version: report.version,
      added: report.added,
      updated: report.updated,
      skipped: report.skipped,
      conflicts: report.conflicts,
    }
  },
})

export const vetStaticTool = defineTool({
  name: 'whale_tank_vet_static',
  description:
    'vet 阶段一：获取 npm 候选（npm pack）→ 静态危害分析（规则引擎）→ 分级门。' +
    '返回 vetDir、candidatePath、findings 与 gated；命中高危则后续 dynamic/report 会直接给"不建议"。' +
    'v1 仅支持 npm 源（git/local 暂不提供，因非显式安装通道）。',
  parameters: {
    workspace: { type: 'string', required: true, description: '调用时工作区（.vetting 所在）' },
    source: { type: 'string', required: true, enum: ['npm'], description: '候选来源（v1 仅 npm）' },
    pkg: { type: 'string', required: true, description: 'npm 包名' },
    version: { type: 'string', description: '版本（npm 源）' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        vetDir: { type: 'string', required: true },
        candidatePath: { type: 'string', required: true },
        gated: { type: 'boolean', required: true },
        criticalFindings: { type: 'array', items: { type: 'string' } },
        degraded: { type: 'array', items: { type: 'string' } },
        packageProbe: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean' },
            kind: { type: 'string' },
            suggestions: { type: 'array', items: { type: 'string' } },
            recentVersions: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    render: (_args, value) => [
      {
        type: 'text',
        text:
          value.packageProbe?.ok === false
            ? `vet 静态：包名预检拦截（${value.packageProbe.kind}）——建议由用户确认候选，绝不自动改写。${
                (value.packageProbe.suggestions ?? []).length > 0
                  ? `\n相似候选: ${(value.packageProbe.suggestions ?? []).join(', ')}`
                  : ''
              }${
                (value.packageProbe.recentVersions ?? []).length > 0
                  ? `\n最近可用版本: ${(value.packageProbe.recentVersions ?? []).join(', ')}`
                  : ''
              }`
            : `vet 静态：${value.gated ? `命中高危（${(value.criticalFindings ?? []).length} 条），将判"不建议"` : '未命中高危，可进入动态验证'} ｜ vetDir=${value.vetDir}`,
      },
    ],
  },
  async execute(args, exec) {
    const result = await vetStatic({
      workspace: args.workspace,
      source: args.source,
      pkg: args.pkg,
      version: args.version ?? null,
      localHome: path.join(os.homedir(), '.dsh'),
    })
    return {
      vetDir: result.vetDir,
      candidatePath: result.candidatePath,
      gated: result.gated,
      criticalFindings: result.findings
        .filter((f) => f.severity === 'critical')
        .map((f) => `${f.rule}（${f.file ?? '-'}）：${f.evidence}`),
      degraded: result.degraded,
      packageProbe:
        result.probe === null
          ? undefined
          : {
              ok: result.probe.ok,
              kind: result.probe.kind,
              suggestions: result.probe.suggestions,
              recentVersions: result.probe.recentVersions,
            },
    }
  },
})

export const vetDynamicTool = defineTool({
  name: 'whale_tank_vet_dynamic',
  description:
    'vet 阶段二（后台任务）：复刻 profile → 装入候选 → 两层冲突检测 → 插拔抵消。' +
    '有 dsh jobs 服务时秒回 jobId：完成时 dsh 会自动注入完成通知，无需忙轮询；' +
    '需要等待时用 job_output(job_id, wait: true, timeout_ms) 阻塞到终态；' +
    '期间可并行做 LLM 源码审查；job_kill 可取消。无 jobs 服务时同步执行并直接返回结果。',
  parameters: {
    workspace: { type: 'string', required: true, description: '调用时工作区（.vetting 所在）' },
    vet_dir: { type: 'string', description: 'vet 目录（静态阶段返回的 vetDir）' },
    profile: { type: 'string', enum: ['web', 'headless'], description: '目标 profile（默认 headless）' },
    env: { type: 'string', enum: ['clean', 'replica', 'both'], description: '环境逃生口（默认 both 自动判定；显式指定无视本地已装跳过）' },
    no_exec: { type: 'boolean', description: '强制全程静态' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        jobId: { type: 'string', required: true },
        startedAsJob: { type: 'boolean', required: true },
        vetDir: { type: 'string', required: true },
        executed: { type: 'boolean', required: true },
        staticGated: { type: 'boolean', required: true },
        criticalConflicts: { type: 'array', items: { type: 'string' } },
        warningConflicts: { type: 'array', items: { type: 'string' } },
        cancelOutChecked: { type: 'boolean' },
        cancelOutClean: { type: 'boolean' },
        residual: { type: 'array', items: { type: 'string' } },
        degraded: { type: 'array', items: { type: 'string' } },
      },
    },
    render: (_args, value) => [
      {
        type: 'text',
        text: value.startedAsJob
          ? `vet 动态：后台任务已启动（jobId=${value.jobId}）。完成时会有自动通知；需要等待时用 job_output(job_id, wait: true) 阻塞到终态；期间可并行做 LLM 源码审查。`
          : value.executed
            ? `vet 动态：执行完成，critical ${(value.criticalConflicts ?? []).length} / warning ${(value.warningConflicts ?? []).length}，插拔抵消 ${value.cancelOutChecked ? (value.cancelOutClean ? 'diff=0 ✓' : 'diff≠0 ✗') : '未检查'}`
            : value.staticGated
              ? 'vet 动态：静态命中高危，跳过动态验证。'
              : 'vet 动态：未执行（--no-exec 或阶段失败）。',
      },
    ],
  },
  async execute(args, exec) {
    const globalRoot = await globalNodeModulesDir('dsh')
    if (globalRoot === null) throw new Error('无法定位全局 dsh 安装。')
    const base = {
      workspace: args.workspace,
      globalRoot,
      localHome: path.join(os.homedir(), '.dsh'),
      profile: args.profile,
      env: args.env as 'clean' | 'replica' | 'both' | undefined,
      noExec: args.no_exec === true,
      vetDir: args.vet_dir,
    }
    const agent = (exec as { agent?: unknown } | undefined)?.agent
    const jobs = (agent as { ctx?: { get?: (key: string) => unknown } } | undefined)
      ?.ctx?.get?.('jobs') as { start: (spec: unknown) => string } | undefined
    if (jobs !== undefined) {
      const handle = await startVetDynamicJob({ ...base, jobs, agent })
      return {
        jobId: handle.jobId,
        startedAsJob: true,
        vetDir: handle.vetDir,
        executed: false,
        staticGated: false,
        criticalConflicts: [],
        warningConflicts: [],
        cancelOutChecked: false,
        cancelOutClean: false,
        residual: [],
        degraded: ['后台任务已启动，请用 job_output / job_list 轮询。'],
      }
    }
    const result = await vetDynamic(base)
    return {
      jobId: '',
      startedAsJob: false,
      vetDir: args.vet_dir ?? '',
      executed: result.executed,
      staticGated: result.staticGated,
      criticalConflicts: result.conflicts
        .filter((f) => f.severity === 'critical')
        .map((f) => `${f.rule}：${f.evidence}`),
      warningConflicts: result.conflicts
        .filter((f) => f.severity === 'warning')
        .map((f) => `${f.rule}：${f.evidence}`),
      cancelOutChecked: result.cancelOut.checked,
      cancelOutClean: result.cancelOut.clean,
      residual: result.cancelOut.residual.map(
        (item) => `${item.category}/${item.kind} ${item.path}`,
      ),
      degraded: result.degraded,
    }
  },
})

export const vetReportTool = defineTool({
  name: 'whale_tank_vet_report',
  description:
    'vet 阶段三：本地未受影响自检 → 汇总前两阶段结果 → 写 vet-report.md + vet-result.json → 三级结论（未发现漏洞/谨慎/不建议）→ 清理（keep=true 保留现场）。',
  parameters: {
    workspace: { type: 'string', required: true, description: '调用时工作区（报告与 .vetting 所在）' },
    vet_dir: { type: 'string', description: 'vet 目录（静态阶段返回的 vetDir）' },
    profile: { type: 'string', enum: ['web', 'headless'], description: '目标 profile' },
    keep: { type: 'boolean', description: '保留体检沙盒现场' },
    llm_findings_file: { type: 'string', description: 'LLM 语义审查结果文件（.vetting/<包>/llm-findings.json）' },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        package: { type: 'string', required: true },
        conclusion: {
          type: 'string',
          enum: ['recommended', 'caution', 'not-recommended'],
          required: true,
        },
        conclusionLabel: { type: 'string', required: true },
        executed: { type: 'boolean', required: true },
        cancelOutClean: { type: 'boolean' },
        localUntouched: { type: 'boolean' },
        llmFindings: { type: 'array', items: { type: 'string' } },
        report: { type: 'string' },
        result: { type: 'string' },
        degraded: { type: 'array', items: { type: 'string' } },
      },
    },
    render: (_args, value) => [
      {
        type: 'text',
        text:
          `vet 结论：${value.conclusionLabel}（${value.conclusion}）` +
          ` ｜ 报告：${value.report}` +
          ((value.degraded ?? []).length > 0 ? ` ｜ 说明：${(value.degraded ?? []).join('; ')}` : ''),
      },
    ],
  },
  async execute(args) {
    const result = await vetReport({
      workspace: args.workspace,
      localHome: path.join(os.homedir(), '.dsh'),
      profile: args.profile,
      keep: args.keep === true,
      vetDir: args.vet_dir,
      llmFindingsFile: args.llm_findings_file,
    })
    return {
      package: result.package,
      conclusion: result.conclusion,
      conclusionLabel: conclusionLabel(result.conclusion),
      executed: result.executed,
      cancelOutClean: result.cancelOut.checked && result.cancelOut.clean,
      localUntouched: result.localUntouched.clean,
      llmFindings: (result.llmFindings ?? []).map((f) => `[${f.severity}] ${f.evidence}`),
      report: result.reportPaths.report,
      result: result.reportPaths.result,
      degraded: result.degraded,
    }
  },
})
