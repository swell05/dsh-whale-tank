import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { globalNodeModulesDir } from '../../src/core/proc.ts'
import { initSandbox } from '../../src/core/sandbox.ts'
import { readState, writeState, setKnowledgePackVersion } from '../../src/core/state.ts'
import { collectStatus } from '../../src/core/status.ts'
import { upgradeKnowledgePack } from '../../src/core/upgrade-knowledge.ts'
import { KNOWLEDGE_PACK_VERSION, AGENTS_BLOCK } from '../../src/core/knowledge-pack.ts'

describe('upgrade-knowledge (ticket 12)', () => {
  let globalRoot: string | null = null
  let project: string

  beforeAll(async () => {
    globalRoot = await globalNodeModulesDir('dsh')
    if (globalRoot === null) throw new Error('无法定位全局 dsh 安装')
    project = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-upgrade-spec-'))
    const init = await initSandbox({
      project,
      projectName: 'whale-tank-upgrade-spec',
      projectType: 'host',
      requestedVersion: null,
      globalRoot: globalRoot!,
      knowledgePackVersion: 'v0.1.0',
    })
    expect(init.selfCheck.ok).toBe(true)
  })

  afterAll(() => {
    if (project !== undefined) fs.rmSync(project, { recursive: true, force: true })
  })

  it('fills in the knowledge pack for a knowledge-free project and is idempotent', () => {
    const first = upgradeKnowledgePack(project)
    expect(first.added).toContain('AGENTS.md')
    expect(first.added).toContain('NOTES.md')
    expect(fs.existsSync(path.join(project, 'docs', 'dev-guidance', 'README.md'))).toBe(true)
    expect(readState(project).knowledgePack.version).toBe(KNOWLEDGE_PACK_VERSION)

    const second = upgradeKnowledgePack(project)
    expect(second.added).toEqual([])
    const agents = fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8')
    const blockLines = agents
      .split(/\r?\n/)
      .filter((line) => line === AGENTS_BLOCK)
    expect(blockLines).toHaveLength(1)
  })

  it('status flags a stale anchor before upgrade and clears it after', () => {
    const state = readState(project)
    writeState(project, setKnowledgePackVersion(state, 'v0.0.9'))
    const stale = collectStatus(project, { globalRoot: globalRoot! })
    expect(stale.knowledgePack.stale).toBe(true)
    expect(stale.warnings.some((w) => w.includes('upgrade-knowledge'))).toBe(true)

    upgradeKnowledgePack(project)
    const fresh = collectStatus(project, { globalRoot: globalRoot! })
    expect(fresh.knowledgePack.stale).toBe(false)
  })
})
