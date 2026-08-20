import fs from 'node:fs'
import path from 'node:path'
import type { NormalizedProjectType } from './type-route.ts'

/**
 * 分层合成模板引擎（设计 §13.3）。
 *
 * 基座模板（按 type 三选一）→ capability 覆盖层按固定顺序叠加 →
 * package.json 字段级合并最后执行。绝不整文件覆盖：
 * - 覆盖层文件覆盖基座同名文件（覆盖层优先）、追加新文件；
 * - package.json 走字段级深合并（对象递归、数组追加去重、标量覆盖层优先）；
 * - 同输入同产出的确定性合成（文件路径排序输出）。
 *
 * 模板目录里 package.json 是字段合并的"真相"来源，合成时重新序列化。
 */

export interface TemplateFile {
  path: string
  content: string
}

export interface OverlaySpec {
  key: string
  templateDir: string
  /** 自定义 package.json 合并（默认 mergePackageJson）。 */
  mergePackageJson?: (base: Record<string, unknown>, overlay: Record<string, unknown>) => Record<string, unknown>
}

export interface SkeletonSpec {
  type: NormalizedProjectType
  templateDir: string
  /** capability 覆盖层（落地；固定顺序叠加）。 */
  overlays?: OverlaySpec[]
}

/** 字段级深合并：对象递归、数组追加去重（base 在前）、标量 overlay 优先。 */
export function mergePackageJson(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    const existing = out[key]
    if (isPlainObject(existing) && isPlainObject(value)) {
      out[key] = mergePackageJson(existing as Record<string, unknown>, value as Record<string, unknown>)
    } else if (Array.isArray(existing) && Array.isArray(value)) {
      out[key] = [...existing, ...value.filter((item) => !existing.includes(item))]
    } else {
      out[key] = value
    }
  }
  return out
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readTemplateDir(dir: string): Map<string, string> {
  const files = new Map<string, string>()
  const walk = (current: string, rel: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      const targetRel = rel.length === 0 ? entry.name : path.join(rel, entry.name)
      if (entry.isDirectory()) {
        walk(full, targetRel)
      } else {
        files.set(targetRel.split(path.sep).join('/'), fs.readFileSync(full, 'utf8'))
      }
    }
  }
  walk(dir, '')
  return files
}

/**
 * 合成骨架文件集（不落盘）：基座 + 覆盖层 + package.json 字段合并 + 变量渲染。
 * 返回的路径已排序（确定性）。
 */
export function composeSkeleton(
  spec: SkeletonSpec,
  vars: Record<string, string>,
): TemplateFile[] {
  const files = readTemplateDir(spec.templateDir)
  const pkgBase = JSON.parse(files.get('package.json') ?? '{}') as Record<string, unknown>
  files.delete('package.json')

  // overlay 的 dshSkeleton.inject 指令：收集进渲染 vars，不写入最终 package.json。
  const injectItems: string[] = []
  let pkg = pkgBase
  for (const overlay of spec.overlays ?? []) {
    const overlayFiles = readTemplateDir(overlay.templateDir)
    const pkgExtra = JSON.parse(overlayFiles.get('package.json') ?? '{}') as Record<string, unknown>
    overlayFiles.delete('package.json')
    for (const [rel, content] of overlayFiles) {
      files.set(rel, content)
    }
    pkg = overlay.mergePackageJson?.(pkg, pkgExtra) ?? mergePackageJson(pkg, pkgExtra)
    const directive = (pkgExtra as { dshSkeleton?: { inject?: string[] } }).dshSkeleton
    if (directive?.inject !== undefined) {
      injectItems.push(...directive.inject)
    }
  }
  // 剥离合成指令，不污染产物 package.json。
  if ('dshSkeleton' in pkg) {
    const { dshSkeleton: _drop, ...rest } = pkg
    pkg = rest
  }

  files.set('package.json', `${JSON.stringify(pkg, null, 2)}\n`)
  const renderVars: Record<string, string> = {
    ...vars,
    inject_list: injectItems.map((item) => `'${item}'`).join(', '),
  }
  return [...files.entries()]
    .map(([rel, content]) => ({
      path: rel,
      content: content.replaceAll(/\{\{([a-zA-Z_]+)\}\}/g, (_, key: string) => renderVars[key] ?? `{{${key}}}`),
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/** 把合成骨架落盘到项目根；返回写入路径（排序）。 */
export function writeComposedSkeleton(project: string, files: TemplateFile[]): string[] {
  for (const file of files) {
    const target = path.join(project, file.path)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, file.content, 'utf8')
  }
  return files.map((f) => f.path)
}
