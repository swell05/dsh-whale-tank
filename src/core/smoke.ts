/**
 * 两步冒烟（决策 03 定稿，设计 §8.2）：
 * 1. dump-config 结构断言（层存在 + bundles 顺序，~0.3s）；
 * 2. host 有界真实 boot（stderr 双断言：无 `plugin tree failed to load`
 *    且含 `MISSING_CREDENTIAL`，30s 超时）。
 */

export function parseDumpConfigLayers(output: string): string[] {
  const markers: string[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = /^# ==\s+(.+?)\s*$/.exec(line)
    if (match !== null) {
      markers.push(match[1].split(', patched by')[0].trim())
    }
  }
  // 每层在 dump 中多次出现；按首次出现顺序去重得到层序。
  const seen = new Set<string>()
  const layers: string[] = []
  for (const name of markers) {
    if (!seen.has(name)) {
      seen.add(name)
      layers.push(name)
    }
  }
  return layers
}

export function assertDumpConfig(
  output: string,
  expected: { bundles: string[]; pluginId: string },
): { ok: boolean; reason: string | null } {
  const layers = parseDumpConfigLayers(output)
  if (!layers.includes(expected.pluginId)) {
    return { ok: false, reason: `dump-config 组合树缺少目标插件层 ${expected.pluginId}` }
  }
  const suffix = layers.slice(-expected.bundles.length)
  if (JSON.stringify(suffix) !== JSON.stringify(expected.bundles)) {
    return {
      ok: false,
      reason: `组合树层顺序与 bundles 不一致：期望尾部 ${expected.bundles.join(' → ')}，实际 ${suffix.join(' → ')}`,
    }
  }
  return { ok: true, reason: null }
}

/** 快速失败信号：任何 profile 的 boot 出现即失败（先于 settle 断言）。 */
const BOOT_FAIL_MARKERS: Array<{ marker: string; reason: string }> = [
  { marker: 'plugin tree failed to load', reason: 'boot stderr 含 plugin tree failed to load（入口/激活失败）' },
  { marker: 'EADDRINUSE', reason: 'boot 端口被占用（EADDRINUSE）' },
  { marker: 'too many arguments', reason: 'boot 参数过多（该 profile 不接受位置参数）' },
]

function bootFailMarker(text: string): string | null {
  for (const entry of BOOT_FAIL_MARKERS) {
    if (text.includes(entry.marker)) return entry.reason
  }
  return null
}

export function assertHostBootStderr(stderr: string): { ok: boolean; reason: string | null } {
  const fail = bootFailMarker(stderr)
  if (fail !== null) return { ok: false, reason: fail }
  // 确定性终点：凭据缺失 = boot 已 settle、所有插件已激活。
  if (!stderr.includes('MISSING_CREDENTIAL')) {
    return {
      ok: false,
      reason:
        'boot 未到达确定性终点 MISSING_CREDENTIAL（树未 settle 或激活断言不可用）',
    }
  }
  return { ok: true, reason: null }
}

/**
 * web profile 的确定性终点（实测）：web 是常驻服务器，不出 MISSING_CREDENTIAL；
 * settle 信号 = 服务器启动地址 `dsh web: http://...` 出现（插件树已加载、web 应用已起）。
 */
export function assertWebBootSettled(
  stdout: string,
  stderr: string,
): { ok: boolean; reason: string | null } {
  const combined = `${stdout}
${stderr}`
  const fail = bootFailMarker(combined)
  if (fail !== null) return { ok: false, reason: fail }
  if (!/dsh web:\s+http:\/\//.test(combined)) {
    return {
      ok: false,
      reason: 'web boot 未到达确定性终点（未见 `dsh web: http://` 启动地址）',
    }
  }
  return { ok: true, reason: null }
}
