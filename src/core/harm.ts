import fs from 'node:fs'
import path from 'node:path'
import type { VetFinding, VetSeverity } from './types.ts'

/**
 * 静态危害规则引擎（决策 14，2026-08-19 实机修正）：
 * critical 只留给"真实行为"证据（install 脚本、凭据引用、混淆载荷、真实外发调用），
 * 元数据/文档里的 URL 字符串不算行为——避免 package.json repository 链接这类误报进门。
 * 任一 critical 命中 → 高危门，直接"不建议"且不执行（设计 §6.7 第 3 步）。
 */

interface HarmHit {
  severity: VetSeverity
  evidence: string
}

interface HarmRule {
  id: string
  description: string
  evaluate: (relativePath: string, content: string) => HarmHit[] | null
}

const RULES: HarmRule[] = [
  {
    id: 'install-script',
    description: 'package.json 声明 install/preinstall/postinstall 脚本（安装即执行）',
    evaluate: (rel, content) => {
      if (rel !== 'package.json') return null
      try {
        const manifest = JSON.parse(content) as { scripts?: Record<string, string> }
        const scripts = manifest.scripts ?? {}
        const hit = ['preinstall', 'install', 'postinstall'].find(
          (key) => typeof scripts[key] === 'string' && scripts[key].length > 0,
        )
        return hit === undefined
          ? null
          : [{ severity: 'critical', evidence: `scripts.${hit} = ${scripts[hit]}` }]
      } catch {
        return null
      }
    },
  },
  {
    id: 'credential-reference',
    description:
      '凭据访问：env 凭据键 / 读取凭据文件 → critical；敏感路径/文件名孤立引用（无读取调用）→ warning（LLM 语义审查兜底）',
    evaluate: (_rel, content) => {
      // 正则字面量/转义文本里的模式不算行为：前置反斜杠即命中规则自身的正则源码。
      const noEscape = '(?<!\\\\)'
      const envAccess = new RegExp(
        `${noEscape}process\\.env\\.[A-Z_]*(API|TOKEN|KEY|SECRET|PASSWORD|CREDENTIAL)[A-Z_]*`,
        'i',
      ).exec(content)
      if (envAccess !== null) {
        return [{ severity: 'critical', evidence: `凭据 env 访问：${envAccess[0].slice(0, 120)}` }]
      }
      const credentialRead = new RegExp(
        `${noEscape}\\b(?:fs\\.)?(?:readFile|readFileSync|readFileAsync|openSync|createReadStream)\\s*\\([\\s\\S]{0,200}?(?:\\.credentials|credentials\\.ya?ml|~\\/\\.dsh|\\.dsh[\\\\/])`,
      ).exec(content)
      if (credentialRead !== null) {
        return [
          { severity: 'critical', evidence: `读取凭据路径：${credentialRead[0].slice(0, 120)}` },
        ]
      }
      const ref = new RegExp(
        `${noEscape}(?:\\.credentials|credentials\\.ya?ml|DEEPSEEK_API_KEY|~\\.dsh|\\.dsh[\\\\/])`,
      ).exec(content)
      if (ref !== null) {
        return [
          {
            severity: 'warning',
            evidence: `引用敏感路径/文件名：${ref[1]}（未见凭据读取调用，交由 LLM 语义审查）`,
          },
        ]
      }
      return null
    },
  },
  {
    id: 'obfuscation',
    description: 'eval / new Function / base64 混淆载荷（只认真实调用，不命中规则自身正则源码）',
    evaluate: (_rel, content) => {
      const base64 = /(?:atob|Buffer\.from|from\(['"])([A-Za-z0-9+/=]{16,})/.exec(content)
      // 真实 eval/new Function 调用：实参是字符串字面量或标识符；规则自身的
      // 正则字面量（/\beval\s*\(/）后跟的是 `/` 而非引号/标识符，不会自命中。
      if (/\beval\s*\((?:\s*['"`]|[A-Za-z_$])/.test(content)) {
        return [{ severity: 'critical', evidence: 'eval( 调用' }]
      }
      if (/\bnew\s+Function\s*\((?:\s*['"`]|[A-Za-z_$])/.test(content)) {
        return [{ severity: 'critical', evidence: 'new Function( 调用' }]
      }
      if (base64 !== null && /cHduZWQ=|aHR0c|d2hvYW1p/.test(base64[1])) {
        return [{ severity: 'critical', evidence: 'base64 混淆载荷' }]
      }
      return null
    },
  },
  {
    id: 'external-call',
    description:
      '外联：真实调用模式（fetch/http(s).request/net/child_process 带外链、脚本网络命令）→ critical；代码/脚本裸 URL → warning；package.json 元数据字段 URL → 不判；其他配置/文档 URL → info',
    evaluate: (rel, content) => {
      if (rel === 'package.json') return evaluateManifestUrls(content)
      if (/\.(js|mjs|cjs|ts|tsx)$/.test(rel)) return evaluateCodeUrls(content)
      if (/\.(sh|ps1|cmd|bat)$/.test(rel)) return evaluateScriptUrls(content)
      if (/\.(yml|yaml|json)$/.test(rel)) {
        return urlHits(content, 'info', 'URL 出现在配置/元数据文件，不计入行为判据')
      }
      return null
    },
  },
  {
    id: 'suspicious-dependency',
    description: '依赖中的已知可疑命名模式（占位规则，在线扫描补充）',
    evaluate: (rel, content) => {
      if (rel !== 'package.json') return null
      try {
        const manifest = JSON.parse(content) as { dependencies?: Record<string, string> }
        const names = Object.keys(manifest.dependencies ?? {})
        const hit = names.find((name) => /payload|inject|hack|keylog|steal/i.test(name))
        return hit === undefined
          ? null
          : [{ severity: 'warning', evidence: `可疑依赖名：${hit}` }]
      } catch {
        return null
      }
    },
  },
]

/** JS/TS 真实外发调用模式：命中即 critical（只扫 .js/.ts 等代码文件）。 */
const JS_CALL_PATTERNS: Array<[RegExp, string]> = [
  [/\b(fetch|axios|got|node-fetch)\s*\(\s*['"`]https?:\/\//, 'fetch/axios/got 直接请求外部 URL'],
  [/\b(http|https)\.request\s*\(/, 'http(s).request 网络请求'],
  [/\bnet\.connect\s*\(/, 'net.connect 原始 socket'],
  [/\b(WebSocket|EventSource)\s*\(/, 'WebSocket/EventSource 连接'],
  [/\b(child_process\.)?(exec|execFile|spawn|fork)\s*\([^)\n]*https?:\/\//, '子进程执行带外部 URL'],
]

/** Shell/PowerShell 命令真实外发：只扫 .sh/.ps1/.cmd/.bat 与 npm scripts（shell 上下文）。 */
const SHELL_CALL_PATTERNS: Array<[RegExp, string]> = [
  [/\b(curl|wget)\s+['"]?https?:\/\//, 'curl/wget 下载外部 URL'],
  [/\b(Invoke-WebRequest|iwr|Invoke-RestMethod|Start-BitsTransfer)\b/, 'PowerShell 网络请求'],
]

function urlHits(content: string, severity: VetSeverity, note: string): HarmHit[] | null {
  const urls = /https?:\/\/[^\s'")\]]+/g
  const hits: HarmHit[] = []
  let match: RegExpExecArray | null
  while ((match = urls.exec(content)) !== null) {
    hits.push({ severity, evidence: `${note}：${match[0]}` })
  }
  return hits.length === 0 ? null : hits
}

function applyCallPatterns(content: string, patterns: Array<[RegExp, string]>): HarmHit[] {
  const hits: HarmHit[] = []
  for (const [pattern, label] of patterns) {
    if (pattern.test(content)) {
      hits.push({ severity: 'critical', evidence: label })
    }
  }
  return hits
}

function evaluateCodeUrls(content: string): HarmHit[] | null {
  const hits = applyCallPatterns(content, JS_CALL_PATTERNS)
  const bare = urlHits(content, 'warning', '代码中出现外部 URL（非调用上下文）')
  if (bare !== null) hits.push(...bare)
  return hits.length === 0 ? null : hits
}

function evaluateScriptUrls(content: string): HarmHit[] | null {
  const hits = applyCallPatterns(content, SHELL_CALL_PATTERNS)
  if (hits.length === 0) {
    const bare = urlHits(content, 'warning', '脚本中出现外部 URL（非调用上下文）')
    if (bare !== null) hits.push(...bare)
  }
  return hits.length === 0 ? null : hits
}

function evaluateManifestUrls(content: string): HarmHit[] | null {
  let manifest: {
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }
  try {
    manifest = JSON.parse(content)
  } catch {
    return null
  }
  const hits: HarmHit[] = []
  // repository/homepage/bugs/funding 等纯元数据字段：不判（URL 只是描述，不是行为）。
  // 依赖 URL 源是真实供应链面 → warning；install 脚本里带外联 → critical。
  const depSections = [
    manifest.dependencies ?? {},
    manifest.devDependencies ?? {},
    manifest.peerDependencies ?? {},
  ]
  for (const section of depSections) {
    for (const [name, spec] of Object.entries(section)) {
      if (/^(git\+https?:|https?:|github:)/i.test(spec)) {
        hits.push({
          severity: 'warning',
          evidence: `依赖 ${name} 使用 URL 源：${spec}`,
        })
      }
    }
  }
  // npm scripts 在 shell 上下文执行 → 用 shell 外联模式（curl/wget/Invoke-WebRequest）。
  for (const [key, script] of Object.entries(manifest.scripts ?? {})) {
    for (const [pattern, label] of SHELL_CALL_PATTERNS) {
      if (pattern.test(script)) {
        hits.push({ severity: 'critical', evidence: `scripts.${key} 含 ${label}` })
        break
      }
    }
  }
  return hits.length === 0 ? null : hits
}

export interface HarmResult {
  findings: VetFinding[]
  gated: boolean
}

export function analyzePackage(pkgDir: string): HarmResult {
  const findings: VetFinding[] = []
  for (const file of walkFiles(pkgDir)) {
    const rel = path.relative(pkgDir, file).split(path.sep).join('/')
    if (rel.startsWith('node_modules/') || rel.startsWith('.git/')) continue
    if (!/\.(js|mjs|cjs|ts|tsx|json|yml|yaml|sh|ps1|cmd|bat)$/.test(rel)) continue
    let content: string
    try {
      content = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (content.length > 512 * 1024) continue // 跳过二进制/超大文件
    for (const rule of RULES) {
      const hits = rule.evaluate(rel, content)
      if (hits === null) continue
      for (const hit of hits) {
        findings.push({
          severity: hit.severity,
          rule: rule.id,
          file: rel,
          evidence: hit.evidence.slice(0, 160),
        })
      }
    }
  }
  const gated = findings.some((f) => f.severity === 'critical')
  return { findings, gated }
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()!
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else {
        out.push(full)
      }
    }
  }
  return out
}
