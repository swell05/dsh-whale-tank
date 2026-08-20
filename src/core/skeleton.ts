import path from 'node:path'
import { packageTemplatesDir } from './paths.ts'
import { normalizeType, skeletonTemplateFor } from './type-route.ts'
import { overlaySpecFor } from './overlays.ts'
import type { Capability } from './capability.ts'
import type { SkeletonSpec } from './template-engine.ts'
import type { ProjectType } from './types.ts'

/**
 * 基座骨架 spec：按 type 选三套官方基座之一，再叠加
 * capability 覆盖层（固定顺序）。
 */
export function skeletonSpecFor(
  type: ProjectType,
  capabilities: readonly Capability[] = [],
): SkeletonSpec {
  const normalized = normalizeType(type)
  return {
    type: normalized,
    templateDir: path.join(packageTemplatesDir(), 'skeleton', skeletonTemplateFor(normalized)),
    overlays: overlaySpecFor(capabilities),
  }
}

/** 合成 vars（含 cli entry 与 inject_list 由 composeSkeleton 计算）。 */
export function skeletonVarsFor(
  type: ProjectType,
  name: string,
  capabilities: readonly Capability[] = [],
): Record<string, string> {
  return {
    name,
    type: normalizeType(type),
    cli_entry: capabilities.includes('cli') ? "  cli: 'src/cli/index.ts'," : '',
  }
}
