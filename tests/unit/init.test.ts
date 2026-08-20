import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { planInit, runInit, writeSkeleton } from '../../src/core/init.ts'

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-init-'))
}

describe('planInit', () => {
  it('produces a deterministic three-part plan (复述 / 目录计划 / 依赖建议)', () => {
    const plan = planInit({
      name: 'dsh-demo',
      type: 'host',
      description: '给聊天加一个 /hello 命令',
      knowledgePack: true,
    })
    expect(plan.summary).toContain('dsh-demo')
    expect(plan.summary).toContain('host')
    expect(plan.summary).toContain('/hello')
    expect(plan.directoryPlan.some((entry) => entry.startsWith('package.json'))).toBe(true)
    expect(plan.directoryPlan.some((entry) => entry.startsWith('src/index.ts'))).toBe(true)
    expect(plan.dependencySuggestions.length).toBeGreaterThan(0)
  })

  it('keeps the plan independent of the sandbox path', () => {
    const a = planInit({ name: 'x', type: 'web', knowledgePack: false })
    const b = planInit({ name: 'x', type: 'web', knowledgePack: false })
    expect(a).toEqual(b)
  })
})

describe('writeSkeleton', () => {
  it('writes the host skeleton with the project name rendered', () => {
    const project = tempDir()
    const files = writeSkeleton(project, 'host', 'dsh-demo')
    expect(files).toContain('package.json')
    expect(files).toContain('src/index.ts')
    const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8')) as {
      name: string
      main: string
      dsh: { bundle: { patch: string } }
    }
    expect(manifest.name).toBe('dsh-demo')
    expect(manifest.main).toBe('lib/index.js')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    const entry = fs.readFileSync(path.join(project, 'src', 'index.ts'), 'utf8')
    expect(entry).toContain('dsh-demo')
    expect(entry).not.toContain('{{')
    const patch = fs.readFileSync(path.join(project, 'cordis.patch.yml'), 'utf8')
    expect(patch).toContain("name: 'dsh-demo'")
  })

  it('writes the both skeleton with host + client halves and shared types', () => {
    const project = tempDir()
    const files = writeSkeleton(project, 'both', 'dsh-both-demo')
    expect(files).toContain('tsdown.client.config.ts')
    expect(files).toContain('tsdown.host.config.ts')
    expect(files).toContain('src/client/index.ts')
    expect(files).toContain('src/types/shared.ts')
    expect(files).toContain('src/invariant.ts')
    const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8')) as {
      dsh: { client: { platform: string }; bundle: { patch: string } }
      exports: Record<string, unknown>
    }
    expect(manifest.dsh.client.platform).toBe('web')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(Object.keys(manifest.exports)).toContain('./invariant')
    expect(Object.keys(manifest.exports)).toContain('./client')
  })

  it('never leaves a placeholder behind', () => {
    const project = tempDir()
    writeSkeleton(project, 'host', 'dsh-demo')
    const walk = (dir: string): string[] => {
      const out: string[] = []
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walk(full))
        else out.push(full)
      }
      return out
    }
    for (const file of walk(project)) {
      const content = fs.readFileSync(file, 'utf8')
      expect(content, file).not.toContain('{{name}}')
    }
  })
})

describe('票04 类型系统（expand 阶段）', () => {
  it('treats --type both and legacy --type web equivalently in the plan (except type)', () => {
    const a = planInit({ name: 'x', type: 'both', knowledgePack: false })
    const b = planInit({ name: 'x', type: 'web', knowledgePack: false })
    expect(a.summary).toBe(b.summary)
    expect(a.directoryPlan).toEqual(b.directoryPlan)
    expect(a.dependencySuggestions).toEqual(b.dependencySuggestions)
    expect(a.type).toBe('both')
    expect(b.type).toBe('both')
  })

  it('emits deterministic both skeletons across runs', () => {
    const pa = tempDir()
    const pb = tempDir()
    const fa = writeSkeleton(pa, 'both', 'dsh-both-demo')
    const fb = writeSkeleton(pb, 'both', 'dsh-both-demo')
    expect(fa).toEqual(fb)
    expect(fa).toContain('tsdown.client.config.ts')
    expect(fa).toContain('src/client/index.ts')
  })

  it('plans --type client without a bundle patch layer', async () => {
    const project = tempDir()
    const report = await runInit({
      project,
      name: 'dsh-client-demo',
      type: 'client',
      globalRoot: '/nonexistent',
      knowledgePack: false,
      planOnly: true,
      skipSandbox: true,
      yes: true,
    })
    expect(report.plan.type).toBe('client')
    expect(report.plan.directoryPlan.some((d) => d.includes('cordis.patch.yml（insert 挂载自身）'))).toBe(false)
  })

  it('writes a client skeleton without dsh.bundle / cordis.patch.yml', () => {
    const project = tempDir()
    const files = writeSkeleton(project, 'client', 'dsh-client-demo')
    expect(files).toContain('src/client/index.ts')
    expect(files).not.toContain('cordis.patch.yml')
    expect(files).toContain('src/invariant.ts')
    const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8')) as {
      dsh: { client: { platform: string }; bundle?: unknown }
    }
    expect(manifest.dsh.client.platform).toBe('web')
    expect(manifest.dsh.bundle).toBeUndefined()
  })

  it('emits a deprecation warning for --type web and plans as both', async () => {
    const project = tempDir()
    const report = await runInit({
      project,
      name: 'dsh-web-demo',
      type: 'web',
      globalRoot: '/nonexistent',
      knowledgePack: false,
      planOnly: true,
      skipSandbox: true,
      yes: true,
    })
    expect(report.warnings.some((w) => w.includes('web 已弃用'))).toBe(true)
    expect(report.plan.type).toBe('both')
  })
})

describe('票09 capabilities 覆盖层', () => {
  it('generates tools + cli overlays with bin field and inject merge', () => {
    const project = tempDir()
    const files = writeSkeleton(project, 'host', 'dsh-cap-demo', ['tools', 'cli'])
    expect(files).toContain('src/host/tools/hello.ts')
    expect(files).toContain('src/cli/index.ts')
    const entry = fs.readFileSync(path.join(project, 'src/index.ts'), 'utf8')
    expect(entry).toContain("'tools'")
    const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8')) as {
      bin: Record<string, string>
      dshSkeleton?: unknown
    }
    expect(manifest.bin['dsh-cap-demo']).toBe('lib/cli.js')
    expect(manifest.dshSkeleton).toBeUndefined()
    const tsdown = fs.readFileSync(path.join(project, 'tsdown.host.config.ts'), 'utf8')
    expect(tsdown).toContain("cli: 'src/cli/index.ts'")
  })

  it('rejects host-family capabilities for a client project', async () => {
    const project = tempDir()
    await expect(
      runInit({
        project,
        name: 'dsh-bad-client',
        type: 'client',
        capabilities: ['tools'],
        globalRoot: '/nonexistent',
        knowledgePack: false,
        planOnly: true,
        skipSandbox: true,
        yes: true,
      }),
    ).rejects.toThrow(/tools/)
  })

  it('echoes capability wiring notes in the plan', () => {
    const plan = planInit({ name: 'dsh-cap', type: 'host', capabilities: ['tools'], knowledgePack: false })
    expect(plan.capabilities).toEqual(['tools'])
    expect(plan.directoryPlan.some((d) => d.includes('tools') && d.includes('inject'))).toBe(true)
  })

  it('keeps package.json fields untouched by overlays that do not reference them', () => {
    const project = tempDir()
    writeSkeleton(project, 'host', 'dsh-cap-demo', ['commands'])
    const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8')) as Record<string, unknown>
    expect(manifest.name).toBe('dsh-cap-demo')
    expect((manifest as { dsh: { bundle: { patch: string } } }).dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dshSkeleton).toBeUndefined()
  })
})

describe('票10 client 族覆盖层', () => {
  it('generates toolview + mcp-client overlays without dsh.mcpServers', () => {
    const project = tempDir()
    const files = writeSkeleton(project, 'both', 'dsh-both-cap', ['toolview', 'mcp-client'])
    expect(files).toContain('src/client/slots/tool-view.ts')
    expect(files).toContain('src/host/mcp-client.ts')
    const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8')) as Record<string, unknown>
    const mcpServers = (manifest.dsh as Record<string, unknown> | undefined)?.mcpServers
    expect(mcpServers).toBeUndefined()
    expect(manifest.dshSkeleton).toBeUndefined()
  })

  it('keeps both base host+client halves intact under overlays', () => {
    const project = tempDir()
    writeSkeleton(project, 'both', 'dsh-both-cap', ['toolview', 'mcp-client'])
    const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8')) as {
      dsh: { client: { platform: string }; bundle: { patch: string } }
      exports: Record<string, unknown>
    }
    expect(manifest.dsh.client.platform).toBe('web')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(Object.keys(manifest.exports)).toContain('./client')
  })

  it('rejects client-family capabilities for a host project', async () => {
    const project = tempDir()
    await expect(
      runInit({
        project,
        name: 'dsh-bad-host',
        type: 'host',
        capabilities: ['toolview'],
        globalRoot: '/nonexistent',
        knowledgePack: false,
        planOnly: true,
        skipSandbox: true,
        yes: true,
      }),
    ).rejects.toThrow(/toolview/)
  })
})
