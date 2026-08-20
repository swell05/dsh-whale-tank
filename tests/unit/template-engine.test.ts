import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  composeSkeleton,
  mergePackageJson,
  type OverlaySpec,
  type SkeletonSpec,
} from '../../src/core/template-engine.ts'

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-engine-'))
}

function fixtureTree(base: string, entries: Record<string, string>): void {
  for (const [rel, content] of Object.entries(entries)) {
    const target = path.join(base, rel)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content, 'utf8')
  }
}

describe('mergePackageJson（票05）', () => {
  it('deep-merges objects, appends arrays, overlay scalar wins', () => {
    const base = {
      name: 'x',
      files: ['lib'],
      dsh: { bundle: { patch: './a.yml' } },
      scripts: { build: 'tsc' },
    }
    const overlay = {
      files: ['lib', '.agents'],
      dsh: { client: { platform: 'web' } },
      scripts: { build: 'tsc && tsdown' },
    }
    const merged = mergePackageJson(base, overlay) as {
      files: string[]
      dsh: { bundle: { patch: string }; client: { platform: string } }
      scripts: { build: string }
      name: string
    }
    expect(merged.files).toEqual(['lib', '.agents'])
    expect(merged.dsh).toEqual({
      bundle: { patch: './a.yml' },
      client: { platform: 'web' },
    })
    expect(merged.scripts.build).toBe('tsc && tsdown')
    expect(merged.name).toBe('x')
  })
})

describe('composeSkeleton（票05）', () => {
  it('is deterministic: same input yields byte-identical output', () => {
    const baseDir = tempDir()
    fixtureTree(baseDir, {
      'src/index.ts': "export const name = '{{name}}'",
      'package.json': JSON.stringify({ name: '{{name}}', files: ['lib'] }),
    })
    const spec: SkeletonSpec = { type: 'host', templateDir: baseDir }
    const a = composeSkeleton(spec, { name: 'dsh-demo' })
    const b = composeSkeleton(spec, { name: 'dsh-demo' })
    expect(a).toEqual(b)
    expect(a.find((f) => f.path === 'package.json')?.content).toContain('dsh-demo')
  })

  it('keeps package.json fields that the overlay does not touch', () => {
    const baseDir = tempDir()
    const overlayDir = tempDir()
    fixtureTree(baseDir, {
      'src/index.ts': 'base',
      'package.json': JSON.stringify({
        name: '{{name}}',
        version: '0.1.0',
        files: ['lib', 'cordis.patch.yml'],
        dsh: { bundle: { patch: './cordis.patch.yml' } },
      }),
    })
    fixtureTree(overlayDir, {
      'package.json': JSON.stringify({ files: ['lib', 'cordis.patch.yml', '.agents'] }),
    })
    const spec: SkeletonSpec = {
      type: 'host',
      templateDir: baseDir,
      overlays: [{ key: 'skills', templateDir: overlayDir } as OverlaySpec],
    }
    const files = composeSkeleton(spec, { name: 'dsh-demo' })
    const pkg = JSON.parse(
      files.find((f) => f.path === 'package.json')!.content,
    ) as Record<string, unknown>
    expect(pkg.name).toBe('dsh-demo')
    expect(pkg.version).toBe('0.1.0')
    expect(pkg.dsh).toEqual({ bundle: { patch: './cordis.patch.yml' } })
    expect(pkg.files).toEqual(['lib', 'cordis.patch.yml', '.agents'])
  })

  it('lets an overlay add files and override same-name files', () => {
    const baseDir = tempDir()
    const overlayDir = tempDir()
    fixtureTree(baseDir, {
      'src/index.ts': 'base-entry',
      'src/kept.ts': 'base-kept',
      'package.json': '{}',
    })
    fixtureTree(overlayDir, {
      'src/index.ts': 'overlay-entry',
      'src/tool.ts': 'overlay-tool',
      'package.json': '{}',
    })
    const spec: SkeletonSpec = {
      type: 'host',
      templateDir: baseDir,
      overlays: [{ key: 'tools', templateDir: overlayDir } as OverlaySpec],
    }
    const files = composeSkeleton(spec, { name: 'x' })
    const index = files.find((f) => f.path === 'src/index.ts')!.content
    const kept = files.find((f) => f.path === 'src/kept.ts')!.content
    const tool = files.find((f) => f.path === 'src/tool.ts')!.content
    expect(index).toBe('overlay-entry')
    expect(kept).toBe('base-kept')
    expect(tool).toBe('overlay-tool')
  })

  it('renders custom variables beyond the name', () => {
    const baseDir = tempDir()
    fixtureTree(baseDir, {
      'AGENTS.md': 'type={{type}} name={{name}}',
      'package.json': '{}',
    })
    const spec: SkeletonSpec = { type: 'both', templateDir: baseDir }
    const files = composeSkeleton(spec, { name: 'dsh-demo', type: 'both' })
    expect(files.find((f) => f.path === 'AGENTS.md')!.content).toBe(
      'type=both name=dsh-demo',
    )
  })
})

describe('overlay dshSkeleton.inject 合并（票09）', () => {
  it('collects overlay inject entries into the render vars and strips the directive from package.json', () => {
    const baseDir = tempDir()
    const overlayDir = tempDir()
    fixtureTree(baseDir, {
      'src/index.ts': "export const inject: string[] = [{{inject_list}}];\n",
      'package.json': JSON.stringify({ name: '{{name}}' }),
    })
    fixtureTree(overlayDir, {
      'src/host/tools/hello.ts': 'export const hello = 1\n',
      'package.json': JSON.stringify({ dshSkeleton: { inject: ['tools'] } }),
    })
    const spec: SkeletonSpec = {
      type: 'host',
      templateDir: baseDir,
      overlays: [{ key: 'tools', templateDir: overlayDir } as OverlaySpec],
    }
    const files = composeSkeleton(spec, { name: 'dsh-demo' })
    const index = files.find((f) => f.path === 'src/index.ts')!.content
    expect(index.replace(/\n/g, ' ')).toContain("inject: string[] = ['tools'];")
    const pkg = JSON.parse(files.find((f) => f.path === 'package.json')!.content)
    expect(pkg.dshSkeleton).toBeUndefined()
    expect(files.find((f) => f.path === 'src/host/tools/hello.ts')).toBeDefined()
  })
})
