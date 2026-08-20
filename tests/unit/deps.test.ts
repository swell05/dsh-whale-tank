import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifyDependency,
  editProjectPackageJson,
  resolvePluginDepVersion,
} from '../../src/core/deps.ts'

function tempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-deps-'))
}

describe('classifyDependency（--add 直接收包名，无 LLM）', () => {
  it('routes @deepseek-ai plugin packages to the sandbox profile channel', () => {
    expect(classifyDependency('@deepseek-ai/dsh-tool-fs')).toEqual({
      channel: 'plugin',
      name: '@deepseek-ai/dsh-tool-fs',
      version: null,
    })
  })

  it('routes a dsh- prefixed package to the profile channel', () => {
    expect(classifyDependency('dsh-better-sidebar')).toEqual({
      channel: 'plugin',
      name: 'dsh-better-sidebar',
      version: null,
    })
  })

  it('routes ordinary npm libraries to the project package.json', () => {
    expect(classifyDependency('zod')).toEqual({
      channel: 'npm',
      name: 'zod',
      version: null,
    })
  })

  it('extracts an explicit version', () => {
    expect(classifyDependency('zod@^4.4.3')).toEqual({
      channel: 'npm',
      name: 'zod',
      version: '^4.4.3',
    })
  })

  it('throws a clear error when no package name is given', () => {
    expect(() => classifyDependency('装一个插件')).toThrow(/--add 需给出包名/)
  })
})

describe('resolvePluginDepVersion（版本一致性只约束官方 @deepseek-ai/*）', () => {
  it('official plugin without explicit version → sandbox runtime version', () => {
    expect(resolvePluginDepVersion('@deepseek-ai/dsh-tool-fs', null, '0.1.0-rc.8')).toBe(
      '0.1.0-rc.8',
    )
  })

  it('official plugin with explicit version → uses it', () => {
    expect(resolvePluginDepVersion('@deepseek-ai/dsh-tool-fs', '0.1.0-rc.8', '0.1.0-rc.8')).toBe(
      '0.1.0-rc.8',
    )
  })

  it('third-party plugin without explicit version → null (install latest, no runtime pin)', () => {
    expect(resolvePluginDepVersion('@swell05/dsh-whale-tank', null, '0.1.0-rc.8')).toBeNull()
  })

  it('third-party plugin with explicit version → uses it', () => {
    expect(resolvePluginDepVersion('@swell05/dsh-whale-tank', '0.1.5-b', '0.1.0-rc.8')).toBe(
      '0.1.5-b',
    )
  })
})

describe('editProjectPackageJson', () => {
  it('adds and removes a dependency in the requested section', () => {
    const project = tempProject()
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({ name: 'demo', version: '0.1.0' }),
      'utf8',
    )
    editProjectPackageJson(project, {
      name: 'zod',
      version: '^4.4.3',
      section: 'dependencies',
      remove: false,
    })
    let manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'))
    expect(manifest.dependencies).toEqual({ zod: '^4.4.3' })

    editProjectPackageJson(project, {
      name: 'zod',
      version: '^4.4.3',
      section: 'dependencies',
      remove: true,
    })
    manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'))
    expect(manifest.dependencies).toEqual({})
    expect(manifest.name).toBe('demo')
  })

  it('keeps unrelated fields and existing entries intact', () => {
    const project = tempProject()
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({
        name: 'demo',
        version: '0.1.0',
        scripts: { build: 'tsc' },
        dependencies: { react: '^18.2.0' },
      }),
      'utf8',
    )
    editProjectPackageJson(project, {
      name: 'zod',
      version: '^4.4.3',
      section: 'dependencies',
      remove: false,
    })
    const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'))
    expect(manifest.dependencies).toEqual({ react: '^18.2.0', zod: '^4.4.3' })
    expect(manifest.scripts.build).toBe('tsc')
  })
})
