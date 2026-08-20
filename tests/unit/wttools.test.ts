import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  WTTOOLS_COMMANDS,
  bundledWtCliPath,
  shimCmd,
  shimSh,
  writeWtTools,
  wttoolsDir,
} from '../../src/core/wttools.ts'

describe('wttools 命令清单（grill 决策：8 workspace + run-test）', () => {
  it('covers exactly the 9 workspace commands', () => {
    expect([...WTTOOLS_COMMANDS]).toEqual([
      'status',
      'deps',
      'plug',
      'plug-test',
      'unplug',
      'restore',
      'reset',
      'upgrade-knowledge',
      'run-test',
    ])
  })

  it('ships a self-contained single-file CLI bundle', () => {
    expect(fs.existsSync(bundledWtCliPath())).toBe(true)
    const content = fs.readFileSync(bundledWtCliPath(), 'utf8')
    // 只允许 node 内建 external：自包含，插件卸载后 .wttools 仍可用。
    const requires = content.match(/require\(['"]([^'"]+)['"]\)/g) ?? []
    for (const req of requires) {
      expect(req, req).toMatch(/node:/)
    }
  })
})

describe('shim 生成（Windows .cmd + Unix sh，项目根烘焙进 --project）', () => {
  it('cmd shim invokes the single-file CLI with the verb and baked project root', () => {
    const shim = shimCmd('run-test')
    expect(shim).toContain('whale-tank.cjs')
    expect(shim).toContain('run-test')
    expect(shim).toContain('--project "%~dp0.."')
    expect(shim).toContain('%*')
  })

  it('sh shim is executable-style and forwards user args', () => {
    const shim = shimSh('status')
    expect(shim.startsWith('#!/usr/bin/env sh')).toBe(true)
    expect(shim).toContain('whale-tank.cjs')
    expect(shim).toContain('status')
    expect(shim).toContain('"$SCRIPT_DIR/.."')
    expect(shim).toContain('"$@"')
  })
})

describe('writeWtTools（init 随沙盒打包）', () => {
  it('writes the bundle + per-command shims and appends .wttools/ to gitignore', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-wttools-'))
    fs.writeFileSync(path.join(project, 'package.json'), '{}\n', 'utf8')
    fs.writeFileSync(path.join(project, '.gitignore'), 'node_modules/\n', 'utf8')

    const { files } = writeWtTools(project)

    expect(files).toContain('.wttools/whale-tank.cjs')
    expect(fs.existsSync(path.join(wttoolsDir(project), 'whale-tank.cjs'))).toBe(true)
    for (const verb of WTTOOLS_COMMANDS) {
      expect(fs.existsSync(path.join(wttoolsDir(project), `${verb}.cmd`))).toBe(true)
      expect(fs.existsSync(path.join(wttoolsDir(project), verb))).toBe(true)
    }
    const gitignore = fs.readFileSync(path.join(project, '.gitignore'), 'utf8')
    expect(gitignore).toContain('.wttools/')
  })

  it('is idempotent across re-runs', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-wttools-'))
    writeWtTools(project)
    const first = fs.readFileSync(path.join(project, '.gitignore'), 'utf8')
    writeWtTools(project)
    const second = fs.readFileSync(path.join(project, '.gitignore'), 'utf8')
    expect(second).toBe(first)
  })
})
