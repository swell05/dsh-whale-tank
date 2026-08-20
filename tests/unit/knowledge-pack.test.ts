import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AGENTS_BLOCK,
  appendNoteLog,
  applyKnowledgePack,
  renderTemplates,
  type KnowledgePackTemplates,
} from '../../src/core/knowledge-pack.ts'

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-kp-'))
}

const AGENTS_TPL = `# {{project_name}} — dsh 插件开发指引

<!-- whale-tank-knowledge-pack: {{version}} -->
> 本文件由 @swell05/dsh-whale-tank init 生成/维护。

## dsh-whale-tank 开发指引

项目类型：{{type}} ｜ 版本模式：{{mode}} ｜ 基线：{{dsh_version}} ｜ profile：{{profile}}

先跑 status。
`

const NOTES_TPL = `# {{project_name}} — 踩坑积累

<!-- whale-tank-knowledge-pack: {{version}} -->
> 本文件由 @swell05/dsh-whale-tank 维护。

## dsh-whale-tank 踩坑积累

### 环境

- DSH_HOME 隔离。
`

function templates(version: string, devGuidance = true): KnowledgePackTemplates {
  return {
    version,
    agents: AGENTS_TPL,
    notes: NOTES_TPL,
    devGuidance: devGuidance
      ? [
          {
            path: 'docs/dev-guidance/01-package-contract.md',
            content: `# package 契约\n\n<!-- whale-tank-knowledge-pack: ${version} -->\n\nmain → lib/index.js\n`,
          },
        ]
      : [],
  }
}

describe('renderTemplates', () => {
  it('fills all placeholders from project metadata', () => {
    const rendered = renderTemplates(templates('v0.1.0'), {
      projectName: 'dsh-demo',
      type: 'host',
      mode: 'local',
      dshVersion: '0.1.0-rc.7',
      profile: 'headless',
    dshBaseline: '0.1.0-rc.8',
    })
    expect(rendered.agents).toContain('dsh-demo')
    expect(rendered.agents).toContain('host')
    expect(rendered.agents).toContain('0.1.0-rc.7')
    expect(rendered.agents).toContain('headless')
    expect(rendered.agents).not.toContain('{{')
  })
})

describe('applyKnowledgePack', () => {
  it('writes all three layers on a fresh project', () => {
    const project = tempProject()
    const report = applyKnowledgePack(
      project,
      templates('v0.1.0'),
      {
        projectName: 'dsh-demo',
        type: 'host',
        mode: 'local',
        dshVersion: '0.1.0-rc.7',
        profile: 'headless',
      dshBaseline: '0.1.0-rc.8',
      },
      'init',
    )
    expect(report.added).toContain('AGENTS.md')
    expect(report.added).toContain('NOTES.md')
    expect(report.added).toContain('docs/dev-guidance/01-package-contract.md')
    expect(report.updated).toEqual([])
    expect(report.skipped).toEqual([])
    expect(fs.existsSync(path.join(project, 'AGENTS.md'))).toBe(true)
    expect(fs.existsSync(path.join(project, 'docs', 'dev-guidance', '01-package-contract.md'))).toBe(
      true,
    )
  })

  it('is idempotent on a second run with the same version', () => {
    const project = tempProject()
    const meta = {
      projectName: 'dsh-demo',
      type: 'host',
      mode: 'local',
      dshVersion: '0.1.0-rc.7',
      profile: 'headless',
    dshBaseline: '0.1.0-rc.8',
    }
    applyKnowledgePack(project, templates('v0.1.0'), meta, 'init')
    const first = fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8')
    const second = applyKnowledgePack(project, templates('v0.1.0'), meta, 'init')
    expect(second.added).toEqual([])
    expect(second.skipped).toContain('docs/dev-guidance/01-package-contract.md')
    const after = fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8')
    expect(after).toBe(first)
    expect(after.split(AGENTS_BLOCK)).toHaveLength(2) // exactly one block, no duplication
  })

  it('preserves user content and appends the block when missing', () => {
    const project = tempProject()
    fs.writeFileSync(path.join(project, 'AGENTS.md'), '# 我的项目\n\n用户已有内容。\n', 'utf8')
    const report = applyKnowledgePack(
      project,
      templates('v0.1.0'),
      {
        projectName: 'dsh-demo',
        type: 'host',
        mode: 'local',
        dshVersion: '0.1.0-rc.7',
        profile: 'headless',
      dshBaseline: '0.1.0-rc.8',
      },
      'init',
    )
    expect(report.updated).toContain('AGENTS.md')
    const content = fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8')
    expect(content).toContain('用户已有内容。')
    expect(content).toContain(AGENTS_BLOCK)
  })

  it('keeps an older version block and appends the new one on upgrade', () => {
    const project = tempProject()
    const meta = {
      projectName: 'dsh-demo',
      type: 'host',
      mode: 'local',
      dshVersion: '0.1.0-rc.7',
      profile: 'headless',
    dshBaseline: '0.1.0-rc.8',
    }
    applyKnowledgePack(project, templates('v0.1.0'), meta, 'init')
    const before = fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8')
    const report = applyKnowledgePack(project, templates('v0.2.0'), meta, 'upgrade')
    const after = fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8')
    expect(after).toContain('v0.1.0')
    expect(after).toContain('v0.2.0')
    expect(after).toContain('两版并存')
    expect(report.updated).toContain('AGENTS.md')
    // The old block must remain byte-identical (never overwrite user content).
    expect(after.startsWith(before)).toBe(true)
  })

  it('skips existing dev-guidance files and flags version conflicts', () => {
    const project = tempProject()
    fs.mkdirSync(path.join(project, 'docs', 'dev-guidance'), { recursive: true })
    fs.writeFileSync(
      path.join(project, 'docs', 'dev-guidance', '01-package-contract.md'),
      '<!-- whale-tank-knowledge-pack: v0.0.9 -->\n老版本内容\n',
      'utf8',
    )
    const report = applyKnowledgePack(
      project,
      templates('v0.1.0'),
      {
        projectName: 'dsh-demo',
        type: 'host',
        mode: 'local',
        dshVersion: '0.1.0-rc.7',
        profile: 'headless',
      dshBaseline: '0.1.0-rc.8',
      },
      'upgrade',
    )
    expect(report.skipped).toContain('docs/dev-guidance/01-package-contract.md')
    expect(report.conflicts.some((c) => c.includes('01-package-contract.md'))).toBe(true)
    expect(
      fs.readFileSync(path.join(project, 'docs', 'dev-guidance', '01-package-contract.md'), 'utf8'),
    ).toContain('老版本内容')
  })
})

describe('appendNoteLog', () => {
  it('appends a dated entry and avoids exact duplicates', () => {
    const project = tempProject()
    const meta = {
      projectName: 'dsh-demo',
      type: 'host',
      mode: 'local',
      dshVersion: '0.1.0-rc.7',
      profile: 'headless',
    dshBaseline: '0.1.0-rc.8',
    }
    applyKnowledgePack(project, templates('v0.1.0'), meta, 'init')
    appendNoteLog(project, '2026-08-19 | 现象A | 原因A | 解法A')
    const once = fs.readFileSync(path.join(project, 'NOTES.md'), 'utf8')
    expect(once.split('现象A')).toHaveLength(2)
    appendNoteLog(project, '2026-08-19 | 现象A | 原因A | 解法A')
    const twice = fs.readFileSync(path.join(project, 'NOTES.md'), 'utf8')
    expect(twice).toBe(once)
  })
})
