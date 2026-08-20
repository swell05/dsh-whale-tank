import fs from 'node:fs'
import path from 'node:path'
import type {
  BaselineProfile,
  ProfilePluginRecord,
  ProjectType,
  StateFile,
  VersionMode,
  VersionRequest,
  VersionResolution,
} from './types.ts'
import { statePath } from './paths.ts'
import { normalizeType } from './type-route.ts'

export const STATE_SCHEMA_VERSION = 2
/** 可读取的最旧 schema（v1）：读到旧 state 时内存映射、不回写强制迁移。 */
export const LEGACY_SCHEMA_VERSION = 1

export class StateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StateError'
  }
}

/** Pure: resolve the version mode from a request and the local install. */
export function resolveVersionMode(req: VersionRequest): VersionResolution {
  if (req.requested === null || req.requested === '') {
    return { mode: 'local', version: req.local, override: null }
  }
  if (req.requested === req.local) {
    return { mode: 'local', version: req.local, override: req.requested }
  }
  return { mode: 'standalone', version: req.requested, override: req.requested }
}

export function initialState(input: {
  projectName: string
  projectType: ProjectType
  root: string
  resolution: VersionResolution
  profile: BaselineProfile
  baselineBundles: string[]
  dshHome: string
  dshInstall: string | null
  knowledgePackVersion: string
  knowledgePackDshBaseline?: string
}): StateFile {
  const now = new Date().toISOString()
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    project: {
      name: input.projectName,
      type: normalizeType(input.projectType),
      root: input.root,
    },
    dsh: {
      version: input.resolution.version,
      mode: input.resolution.mode,
      override: input.resolution.override,
    },
    sandbox: {
      dshHome: input.dshHome,
      profile: input.profile,
      baselineBundles: input.baselineBundles,
      dshInstall: input.dshInstall,
    },
    dependencies: {
      profilePlugins: [],
      projectDeps: {
        dependencies: {},
        devDependencies: {},
        peerDependencies: {},
      },
    },
    plugState: {
      status: 'clean',
      lastPluggedAt: null,
      lastSnapshotId: null,
    },
    knowledgePack: {
      version: input.knowledgePackVersion,
      lastWrittenAt: now,
      ...(input.knowledgePackDshBaseline === undefined
        ? {}
        : { dshBaseline: input.knowledgePackDshBaseline }),
    },
    notes: {
      lastGeneratedAt: now,
      noteCount: 0,
    },
  }
}

export function readState(project: string): StateFile {
  const file = statePath(project)
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new StateError(`state.json 不存在：${file}`)
    }
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new StateError(`state.json 解析失败（${file}）：${String(error)}`)
  }
  const state = parsed as Partial<StateFile>
  if (state.schemaVersion !== STATE_SCHEMA_VERSION) {
    if (state.schemaVersion === LEGACY_SCHEMA_VERSION) {
      // v1 旧 state：内存映射 type web→both，schemaVersion 标 2；不回写（下次写 state 自然升级）。
      const migrated = parsed as StateFile
      migrated.schemaVersion = STATE_SCHEMA_VERSION
      if (migrated.project?.type === 'web') migrated.project.type = 'both'
      return migrated
    }
    throw new StateError(
      `state.json schema 版本不匹配：期望 ${STATE_SCHEMA_VERSION}，实际 ${String(state.schemaVersion)}`,
    )
  }
  return parsed as StateFile
}

export function hasState(project: string): boolean {
  return fs.existsSync(statePath(project))
}

export function writeState(project: string, state: StateFile): void {
  const file = statePath(project)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

/** Pure: compare declared vs actual runtime version. */
export function versionDrift(declared: string, actual: string): boolean {
  return declared !== actual
}

export function recordProfilePlugin(
  state: StateFile,
  entry: ProfilePluginRecord,
): StateFile {
  return {
    ...state,
    dependencies: {
      ...state.dependencies,
      profilePlugins: [...state.dependencies.profilePlugins, entry],
    },
  }
}

export function removeProfilePlugin(state: StateFile, name: string): StateFile {
  return {
    ...state,
    dependencies: {
      ...state.dependencies,
      profilePlugins: state.dependencies.profilePlugins.filter(
        (entry) => entry.name !== name,
      ),
    },
  }
}

export function setPlugStatus(
  state: StateFile,
  status: StateFile['plugState']['status'],
  snapshotId: string | null,
): StateFile {
  return {
    ...state,
    plugState: {
      status,
      lastPluggedAt: status === 'plugged' ? new Date().toISOString() : state.plugState.lastPluggedAt,
      lastSnapshotId: snapshotId,
    },
  }
}

export function setKnowledgePackVersion(
  state: StateFile,
  version: string,
  dshBaseline?: string,
): StateFile {
  return {
    ...state,
    knowledgePack: {
      version,
      lastWrittenAt: new Date().toISOString(),
      ...(dshBaseline === undefined
        ? 'dshBaseline' in state.knowledgePack
          ? { dshBaseline: state.knowledgePack.dshBaseline }
          : {}
        : { dshBaseline }),
    },
  }
}

export function bumpNoteCount(state: StateFile, count: number): StateFile {
  return {
    ...state,
    notes: {
      lastGeneratedAt: new Date().toISOString(),
      noteCount: state.notes.noteCount + count,
    },
  }
}

/** Pure: mixed-version check — profile plugin versions vs state runtime. */
export function mixedVersionDetail(state: StateFile): string | null {
  const offenders = state.dependencies.profilePlugins.filter(
    (entry) => entry.version !== state.dsh.version,
  )
  if (offenders.length === 0) return null
  return `profile 插件版本与沙盒运行时版本不一致：${offenders
    .map((o) => `${o.name}@${o.version}（state=${state.dsh.version}）`)
    .join('；')}`
}

/** Utility used by tests and callers to seed a state for a temp project. */
export function writeInitialState(input: {
  projectName: string
  projectType: ProjectType
  root: string
  resolution: VersionResolution
  profile: BaselineProfile
  baselineBundles: string[]
  dshHome: string
  dshInstall: string | null
  knowledgePackVersion: string
  knowledgePackDshBaseline?: string
}): StateFile {
  const state = initialState(input)
  writeState(input.root, state)
  return state
}

export type { VersionMode }
