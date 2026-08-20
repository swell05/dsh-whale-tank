import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  dshBaselineDrift,
  readPackageVersion,
  readRuntimeVersionFromTree,
} from '../../src/core/versions.ts'

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-versions-'))
}

describe('readPackageVersion', () => {
  it('reads the version field from a package.json', () => {
    const dir = tempDir()
    const file = path.join(dir, 'package.json')
    fs.writeFileSync(file, JSON.stringify({ name: 'x', version: '0.1.0-rc.7' }), 'utf8')
    expect(readPackageVersion(file)).toBe('0.1.0-rc.7')
  })

  it('throws a clear error when the package.json is missing', () => {
    expect(() => readPackageVersion(path.join(tempDir(), 'nope', 'package.json'))).toThrow(
      /package.json/,
    )
  })
})

describe('readRuntimeVersionFromTree', () => {
  it('reads the local global install', () => {
    const dir = tempDir()
    const globalRoot = path.join(dir, 'node_modules')
    const pkgDir = path.join(globalRoot, '@deepseek-ai', 'dsh')
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.7' }),
      'utf8',
    )
    expect(readRuntimeVersionFromTree({ mode: 'local', globalRoot })).toBe('0.1.0-rc.7')
  })

  it('reads the standalone install under .sandbox/dsh-install', () => {
    const dir = tempDir()
    const pkgDir = path.join(
      dir,
      '.sandbox',
      'dsh-install',
      'node_modules',
      '@deepseek-ai',
      'dsh',
    )
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.1.0-rc.6' }),
      'utf8',
    )
    expect(
      readRuntimeVersionFromTree({ mode: 'standalone', project: dir }),
    ).toBe('0.1.0-rc.6')
  })
})

describe('dshBaselineDrift', () => {
  it('hints when the local dsh is newer than the knowledge baseline', () => {
    const hint = dshBaselineDrift('0.1.0-rc.8', '0.1.0-rc.9')
    expect(hint).toContain('rc.9')
    expect(hint).toContain('知识包')
  })

  it('stays silent when versions are equal', () => {
    expect(dshBaselineDrift('0.1.0-rc.8', '0.1.0-rc.8')).toBeNull()
  })

  it('stays silent when the local dsh is older than the baseline', () => {
    expect(dshBaselineDrift('0.1.0-rc.8', '0.1.0-rc.7')).toBeNull()
  })

  it('treats a plain release as newer than its rc line (semver prerelease rule)', () => {
    expect(dshBaselineDrift('0.1.0-rc.8', '0.1.0')).toContain('知识包')
  })

  it('hints across core version bumps', () => {
    expect(dshBaselineDrift('0.1.0-rc.8', '0.2.0-rc.1')).toContain('知识包')
  })

  it('never hints when either side is unknown', () => {
    expect(dshBaselineDrift(null, '0.1.0-rc.9')).toBeNull()
    expect(dshBaselineDrift('0.1.0-rc.8', null)).toBeNull()
  })

  it('never hints on unparseable versions', () => {
    expect(dshBaselineDrift('banana', '0.1.0-rc.9')).toBeNull()
    expect(dshBaselineDrift('0.1.0-rc.8', 'banana')).toBeNull()
  })
})
