import type { NormalizedProjectType } from './type-route.ts'

/** capabilities 枚举（设计 §13.3）：单个枚举数组参数。 */
export const CAPABILITIES = [
  'skills',
  'tools',
  'commands',
  'mcp-client',
  'mcp-server',
  'cli',
  'toolview',
] as const
export type Capability = (typeof CAPABILITIES)[number]

/** 能力归属形态：host 族（需要 host 半边）vs client 族（需要 client 半边）。 */
export const CAPABILITY_FAMILIES: Record<Capability, 'host' | 'client'> = {
  skills: 'host',
  tools: 'host',
  commands: 'host',
  'mcp-server': 'host',
  cli: 'host',
  'mcp-client': 'client',
  toolview: 'client',
}

export function capabilityFamily(capability: Capability): 'host' | 'client' {
  return CAPABILITY_FAMILIES[capability]
}

/**
 * 非法组合硬校验（校验框架；接线到参数面）：
 * - host 型只允许 host 族；client 型只允许 client 族；both 型两族都可；
 * - 拒绝时错误信息指明该能力属于哪个形态。
 */
export function validateCapabilities(
  type: NormalizedProjectType,
  caps: readonly Capability[],
): { ok: true } | { ok: false; reasons: string[] } {
  const reasons: string[] = []
  for (const capability of caps) {
    const family = capabilityFamily(capability)
    if (family === 'host' && type === 'client') {
      reasons.push(`能力 ${capability} 属于 host 族，client 型不支持（需要 host 半边）。`)
    }
    if (family === 'client' && type === 'host') {
      reasons.push(`能力 ${capability} 属于 client 族，host 型不支持（需要 client 半边）。`)
    }
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons }
}

/** 解析 `--capabilities` csv 字符串；未知值抛错。 */
export function parseCapabilities(csv: string): Capability[] {
  if (csv.trim() === '') return []
  const seen = new Set<Capability>()
  for (const raw of csv.split(',')) {
    const name = raw.trim() as Capability
    if (!CAPABILITIES.includes(name)) {
      throw new Error(
        `非法能力：${raw}（可用：${CAPABILITIES.join('|')}）。`,
      )
    }
    seen.add(name)
  }
  return [...seen]
}
