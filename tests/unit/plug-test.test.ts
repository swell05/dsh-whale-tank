import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { plugTest } from '../../src/core/plug-test.ts'
import { resolveVersionMode, setPlugStatus, writeInitialState } from '../../src/core/state.ts'

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-plugtest-'))
}

function initProject(status: 'clean' | 'plugged' | 'dirty') {
  const project = tempProject()
  let state = writeInitialState({
    projectName: 'dsh-demo',
    projectType: 'host',
    root: project,
    resolution: resolveVersionMode({ requested: null, local: '0.1.0-rc.8' }),
    profile: 'headless',
    baselineBundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
    dshHome: path.join(project, '.sandbox', 'dsh-home'),
    dshInstall: null,
    knowledgePackVersion: 'v0.1.3',
  })
  if (status !== 'clean') {
    state = setPlugStatus(state, status, status === 'plugged' ? 'snap-x' : null)
    fs.writeFileSync(path.join(project, '.sandbox', 'state.json'), JSON.stringify(state, null, 2), 'utf8')
  }
  return project
}

describe('plug-test 前置（票11）', () => {
  it('rejects a dirty state before plugging', async () => {
    const project = initProject('dirty')
    await expect(plugTest(project, { globalRoot: '/nonexistent' })).rejects.toThrow(/clean/)
  })

  it('rejects a plugged state before plugging', async () => {
    const project = initProject('plugged')
    await expect(plugTest(project, { globalRoot: '/nonexistent' })).rejects.toThrow(/clean/)
  })
})
