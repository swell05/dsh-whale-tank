import type { BaselineProfile, ProjectType } from './types.ts'

/** 规范化后的插件类型：client 暂未实现但保留类型（落地）。 */
export type NormalizedProjectType = 'host' | 'client' | 'both'

/** 规范化插件类型：web = both 废弃别名（v1 遗留），其余原样；非法值抛错。 */
export function normalizeType(type: ProjectType): NormalizedProjectType {
  if (type === 'web') return 'both'
  if (type === 'host' || type === 'client' || type === 'both') return type
  throw new Error(
    `非法插件类型：${String(type)}（应为 host / client / both；web 是 both 的废弃别名）。`,
  )
}

/** 沙盒基线 profile 路由：host→headless；client/both→web。 */
export function baselineProfileFor(type: NormalizedProjectType): BaselineProfile {
  return type === 'host' ? 'headless' : 'web'
}

/** 骨架基座模板目录路由（起三套官方基座）：host/both/client 各一。 */
export function skeletonTemplateFor(type: NormalizedProjectType): 'host' | 'both' | 'client' {
  switch (type) {
    case 'host':
      return 'host'
    case 'both':
      return 'both'
    case 'client':
      return 'client'
  }
}
