/**
 * Shared domain types for @swell05/dsh-whale-tank.
 *
 * Vocabulary follows CONTEXT.md: 沙盒 (.sandbox), 快照 (snapshots), 双通道依赖,
 * 版本模式 (local / standalone), 状态机 (clean → plugged → clean / dirty).
 */

/** 插件类型：web 是 both 的废弃别名（v1 遗留，init 规范化后不再出现）。 */
export type ProjectType = 'host' | 'client' | 'both' | 'web'

export type VersionMode = 'local' | 'standalone'

export type PlugStatus = 'clean' | 'plugged' | 'dirty' | 'not-initialized'

export type BaselineProfile = 'web' | 'headless'

export interface ProfilePluginRecord {
  name: string
  version: string
  addedBy: 'deps' | 'plug'
  addedAt: string
}

export interface StateFile {
  schemaVersion: 2
  project: {
    name: string
    type: ProjectType
    root: string
  }
  dsh: {
    version: string
    mode: VersionMode
    override: string | null
  }
  sandbox: {
    dshHome: string
    profile: BaselineProfile
    baselineBundles: string[]
    dshInstall: string | null
  }
  dependencies: {
    profilePlugins: ProfilePluginRecord[]
    projectDeps: {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
      peerDependencies: Record<string, string>
    }
  }
  plugState: {
    status: PlugStatus
    lastPluggedAt: string | null
    lastSnapshotId: string | null
  }
  knowledgePack: {
    version: string
    lastWrittenAt: string | null
    /** 知识包蒸馏所锚定的 dsh 版本（v1 老项目可能缺失）。 */
    dshBaseline?: string
  }
  notes: {
    lastGeneratedAt: string | null
    noteCount: number
  }
}

export interface VersionRequest {
  /** User-supplied --dsh-version; null means follow the local install. */
  requested: string | null
  /** Version of the locally installed dsh runtime. */
  local: string
}

export interface VersionResolution {
  mode: VersionMode
  version: string
  override: string | null
}

export interface StatusReport {
  project: string | null
  projectType: ProjectType | null
  versionMode: VersionMode | null
  declaredDshVersion: string | null
  actualDshVersion: string | null
  versionDrift: boolean
  mixedVersion: boolean
  mixedVersionDetail: string | null
  profile: BaselineProfile | null
  profilePlugins: ProfilePluginRecord[]
  plugState: PlugStatus
  lastSnapshotId: string | null
  knowledgePack: {
    anchoredVersion: string | null
    currentTemplateVersion: string
    stale: boolean
    /** 状态里的知识包版本锚（v1 老项目为 null）。 */
    dshBaseline: string | null
    /** 软提示行：本机 dsh 比锚新时不为 null；不进 warnings、不影响退出码。 */
    dshBaselineDrift: string | null
  }
  dirtyDetail: DiffSummary | null
  warnings: string[]
}

export interface DiffItem {
  category: 'profile-file' | 'node-modules' | 'state' | 'sessions'
  kind: 'added' | 'removed' | 'modified'
  path: string
  detail: string
}

export interface DiffSummary {
  clean: boolean
  items: DiffItem[]
}

export interface SnapshotMetadata {
  id: string
  capturedAt: string
  trigger: string
  declaredDshVersion: string
  actualDshVersion: string
}

export interface KnowledgePackReport {
  version: string
  added: string[]
  updated: string[]
  skipped: string[]
  conflicts: string[]
}

export type VetConclusion = 'recommended' | 'caution' | 'not-recommended'

export type VetSeverity = 'info' | 'warning' | 'critical'

export interface VetFinding {
  severity: VetSeverity
  rule: string
  file: string | null
  evidence: string
}

export interface VetResult {
  package: string
  version: string | null
  source: 'npm' | 'git' | 'local'
  profile: BaselineProfile
  executed: boolean
  staticGated: boolean
  degraded: string[]
  findings: VetFinding[]
  conflicts: VetFinding[]
  cancelOut: {
    checked: boolean
    clean: boolean
    residual: DiffItem[]
  }
  localUntouched: {
    checked: boolean
    clean: boolean
    detail: string | null
  }
  dependencyScan: {
    sources: string[]
    hits: Array<Record<string, string>>
    degraded: string[]
    cached: boolean
  } | null
  /** 模型 LLM 语义审查结果（skill 流程写入 llm-findings.json 后汇入）。 */
  llmFindings?: VetFinding[]
  /** 纯净体检：官方模板基线环境验证候选自身质量。 */
  cleanRun: {
    ok: boolean
    skipped: boolean
    vanillaBoot: { ok: boolean; reason: string | null } | null
    cancelOut: { checked: boolean; clean: boolean; residual: DiffItem[] }
    missingPeers: string[]
    issues: VetFinding[]
    degraded: string[]
  }
  /** 复刻体检：本地 profile 复刻环境。 */
  replicaRun: {
    ok: boolean
    skipped: boolean
    degraded: string[]
    /** 跳过原因（本地已装同版 / stage-gate）。 */
    skipReason?: string | null
    /** 升级模式：本地旧版 → 候选新版，按升级场景验证。 */
    upgradeMode?: {
      from: string | null
      to: string
      note: string
    } | null
  }
  conclusion: VetConclusion
  reportPaths: {
    report: string
    result: string
    vetDir: string | null
  }
}

export interface ToolContextLike {
  cwd: () => string
  askUser?: (question: string) => Promise<{ kind: 'ok' | 'cancel'; reply?: string }>
  signal?: AbortSignal
  log?: (message: string) => void
}
