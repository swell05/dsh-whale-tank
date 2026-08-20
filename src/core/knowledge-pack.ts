import fs from 'node:fs'
import path from 'node:path'
import { packageTemplatesDir } from './paths.ts'
import type { KnowledgePackReport } from './types.ts'

/**
 * merge-spec 的落点（ADR-0001）：三层知识包增量合并。
 *
 * - 版本头：`<!-- whale-tank-knowledge-pack: v<版本> -->`
 * - AGENTS.md / NOTES.md：区块级合并，绝不覆盖用户内容；
 * - docs/dev-guidance/：文件粒度，同名存在即跳过；
 * - 冲突只告警不自动解决；无 --force。
 */

export const KNOWLEDGE_PACK_VERSION = 'v0.1.6'
/** 知识包蒸馏所锚定的 dsh 版本（dshBaseline 版本锚）。 */
export const KNOWLEDGE_PACK_DSH_BASELINE = '0.1.0-rc.8'
export const AGENTS_BLOCK = '## dsh-whale-tank 开发指引'
export const NOTES_BLOCK = '## dsh-whale-tank 踩坑积累'

const VERSION_HEADER_RE = /<!--\s*whale-tank-knowledge-pack:\s*(v[\w.\-]+)\s*-->/

export interface KnowledgePackTemplates {
  version: string
  agents: string
  notes: string
  devGuidance: Array<{ path: string; content: string }>
}

export interface KnowledgePackMeta {
  projectName: string
  type: string
  mode: string
  dshVersion: string
  profile: string
  dshBaseline: string
}

export function renderTemplates(
  templates: KnowledgePackTemplates,
  meta: KnowledgePackMeta,
): KnowledgePackTemplates {
  const fill = (text: string): string =>
    text
      .replaceAll('{{project_name}}', meta.projectName)
      .replaceAll('{{type}}', meta.type)
      .replaceAll('{{mode}}', meta.mode)
      .replaceAll('{{dsh_version}}', meta.dshVersion)
      .replaceAll('{{profile}}', meta.profile)
      .replaceAll('{{dsh_baseline}}', meta.dshBaseline)
      .replaceAll('{{version}}', templates.version)
  return {
    version: templates.version,
    agents: fill(templates.agents),
    notes: fill(templates.notes),
    devGuidance: templates.devGuidance.map((entry) => ({
      path: entry.path,
      content: fill(entry.content),
    })),
  }
}

interface BlockRegion {
  start: number
  end: number
  version: string | null
}

/** Find the LAST occurrence of a heading block (last = current version block). */
function findLastBlock(content: string, heading: string): BlockRegion | null {
  const pattern = new RegExp(`(^|\\n)(${escapeRegExp(heading)})`, 'g')
  let match: RegExpExecArray | null
  let last: { start: number; end: number } | null = null
  while ((match = pattern.exec(content)) !== null) {
    const start = match.index + (match[1] === '\n' ? 1 : 0)
    const after = content.indexOf('\n## ', start + heading.length)
    const end = after === -1 ? content.length : after
    last = { start, end }
  }
  if (last === null) return null
  return { ...last, version: versionOf(content.slice(last.start, last.end)) }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function versionOf(text: string): string | null {
  const match = VERSION_HEADER_RE.exec(text)
  return match === null ? null : match[1]
}

function templateBlockOf(rendered: string, heading: string): string {
  const idx = rendered.indexOf(heading)
  if (idx === -1) throw new Error(`知识包模板缺少区块 ${heading}`)
  return rendered.slice(idx).replace(/\s+$/, '') + '\n'
}

function readOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export function applyKnowledgePack(
  projectRoot: string,
  templates: KnowledgePackTemplates,
  meta: KnowledgePackMeta,
  mode: 'init' | 'upgrade',
): KnowledgePackReport {
  const report: KnowledgePackReport = {
    version: templates.version,
    added: [],
    updated: [],
    skipped: [],
    conflicts: [],
  }
  const rendered = renderTemplates(templates, meta)

  mergeBlockFile(
    projectRoot,
    'AGENTS.md',
    rendered.agents,
    AGENTS_BLOCK,
    templates.version,
    mode,
    report,
  )
  mergeBlockFile(
    projectRoot,
    'NOTES.md',
    rendered.notes,
    NOTES_BLOCK,
    templates.version,
    mode,
    report,
  )

  for (const entry of rendered.devGuidance) {
    const target = path.join(projectRoot, entry.path)
    const existing = readOrNull(target)
    if (existing === null) {
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, entry.content, 'utf8')
      report.added.push(entry.path)
      continue
    }
    report.skipped.push(entry.path)
    const existingVersion = versionOf(existing)
    if (existingVersion !== null && existingVersion !== templates.version) {
      report.conflicts.push(
        `${entry.path}：已存在且版本为 ${existingVersion}（当前模板 ${templates.version}），已跳过；建议人工合并。`,
      )
    }
  }
  return report
}

function mergeBlockFile(
  projectRoot: string,
  fileName: string,
  rendered: string,
  heading: string,
  version: string,
  mode: 'init' | 'upgrade',
  report: KnowledgePackReport,
): void {
  const target = path.join(projectRoot, fileName)
  const existing = readOrNull(target)
  if (existing === null) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, rendered, 'utf8')
    report.added.push(fileName)
    return
  }

  const block = findLastBlock(existing, heading)
  const templateBlock = templateBlockOf(rendered, heading)
  if (block === null) {
    const appended = existing.replace(/\s+$/, '') + '\n\n' + templateBlock
    fs.writeFileSync(target, appended, 'utf8')
    report.updated.push(fileName)
    return
  }

  // 版本头位于文件首部（区块外），以文件级版本头为准。
  const blockVersion = versionOf(existing) ?? block.version
  const sameVersion = blockVersion === version
  if (sameVersion) {
    // 幂等原位更新：把当前版本块替换为模板块（内容一致时无变化）。
    const next = existing.slice(0, block.start) + templateBlock + existing.slice(block.end)
    fs.writeFileSync(target, next, 'utf8')
    report.updated.push(fileName)
    return
  }

  // 升级：旧版本块保留，新版本块追加，头部标注两版并存。
  const note =
    `\n\n---\n\n> 两版并存：检测到知识包 ${blockVersion} 与 ${version} 两个版本块，` +
    `旧版本块保留在上方，请人工决定清理。\n\n`
  const next = existing.replace(/\s+$/, '') + note + templateBlock
  fs.writeFileSync(target, next, 'utf8')
  report.updated.push(fileName)
  if (mode === 'upgrade' && blockVersion !== null) {
    report.conflicts.push(
      `${fileName}：旧版本块 ${blockVersion} 与新版本块 ${version} 并存，需人工清理。`,
    )
  }
}

/**
 * Append one dated pitfall entry to NOTES.md; a duplicate (same date +
 * phenomenon) is never written twice.
 */
export function appendNoteLog(projectRoot: string, entry: string): void {
  const target = path.join(projectRoot, 'NOTES.md')
  const content = readOrNull(target)
  if (content === null) {
    fs.writeFileSync(target, entry + '\n', 'utf8')
    return
  }
  const [date, ...rest] = entry.split('|')
  const phenomenon = (rest[0] ?? '').trim()
  const exists = content
    .split(/\r?\n/)
    .some((line) => line.startsWith(date.trim()) && line.includes(phenomenon))
  if (exists) return
  fs.writeFileSync(target, content.replace(/\s+$/, '') + '\n' + entry + '\n', 'utf8')
}

/** Load the built-in knowledge-pack templates from this package's templates/. */
export function loadBuiltinKnowledgePack(): KnowledgePackTemplates {
  const root = packageTemplatesRoot()
  const agents = fs.readFileSync(path.join(root, 'knowledge-pack', 'AGENTS.md'), 'utf8')
  const notes = fs.readFileSync(path.join(root, 'knowledge-pack', 'NOTES.md'), 'utf8')
  const guidanceDir = path.join(root, 'knowledge-pack', 'dev-guidance')
  const devGuidance = fs
    .readdirSync(guidanceDir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => ({
      path: `docs/dev-guidance/${name}`,
      content: fs.readFileSync(path.join(guidanceDir, name), 'utf8'),
    }))
  return {
    version: KNOWLEDGE_PACK_VERSION,
    agents,
    notes,
    devGuidance,
  }
}

/** Templates live at <package>/templates. */
function packageTemplatesRoot(): string {
  return packageTemplatesDir()
}
