import {
  applyKnowledgePack,
  KNOWLEDGE_PACK_DSH_BASELINE,
  loadBuiltinKnowledgePack,
} from './knowledge-pack.ts'
import { readState, setKnowledgePackVersion, writeState } from './state.ts'
import type { KnowledgePackReport } from './types.ts'

/**
 * 知识包升级（ticket 12 / ADR-0001 修订）：把当前内置模板按 merge-spec
 * 版本块机制增量合并进目标工作区；新版本块追加、旧版本保留、头部标注
 * 两版并存；重复执行幂等。
 */
export function upgradeKnowledgePack(project: string): KnowledgePackReport {
  const templates = loadBuiltinKnowledgePack()
  const state = readState(project)
  const meta = {
    projectName: state.project.name,
    type: state.project.type,
    mode: state.dsh.mode,
    dshVersion: state.dsh.version,
    profile: state.sandbox.profile,
    dshBaseline: KNOWLEDGE_PACK_DSH_BASELINE,
  }
  const report = applyKnowledgePack(project, templates, meta, 'upgrade')
  writeState(
    project,
    setKnowledgePackVersion(state, templates.version, KNOWLEDGE_PACK_DSH_BASELINE),
  )
  return report
}
