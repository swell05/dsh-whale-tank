import path from 'node:path'
import { packageTemplatesDir } from './paths.ts'
import type { Capability } from './capability.ts'
import type { OverlaySpec } from './template-engine.ts'

/** 覆盖层固定叠加顺序（设计 §13.3）。 */
export const OVERLAY_ORDER: Capability[] = [
  'skills',
  'tools',
  'commands',
  'mcp-client',
  'mcp-server',
  'cli',
  'toolview',
]

/** 按固定顺序装配覆盖层 spec（去重；未选的不生成）。 */
export function overlaySpecFor(caps: readonly Capability[]): OverlaySpec[] {
  const seen = new Set<Capability>()
  const selected = OVERLAY_ORDER.filter((key) => {
    if (seen.has(key)) return false
    seen.add(key)
    return caps.includes(key)
  })
  return selected.map((key) => ({
    key,
    templateDir: path.join(packageTemplatesDir(), 'skeleton', 'overlays', key),
  }))
}

/** 接线说明（设计 §13.3 计划回显）：每能力说明动了哪些文件/字段/seam。 */
export const CAPABILITY_WIRING: Record<Capability, string> = {
  skills: 'src/host/skills/ + inject 合并 \'skills\'（运行时 ctx.skills.register 形态）',
  tools: 'src/host/tools/ + inject 合并 \'tools\'（dsh-tools 工具 seam）',
  commands: 'src/host/commands/ + inject 合并 \'commands\'（dsh-commands 命令 seam）',
  'mcp-client': 'per-server @deepseek-ai/dsh-mcp-client 插件行（profile patch 层）',
  'mcp-server': 'src/host/mcp-server.ts（MCP server 挂载点）',
  cli: 'src/cli/ + package.json bin 字段 + tsdown cli entry',
  toolview: 'client/slots/ + dsh.client inject 接线',
}
