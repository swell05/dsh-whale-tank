import { describe, expect, it } from 'vitest'
import {
  capabilitiesForType,
  collectWizardAnswers,
  isValidPackageName,
} from '../../src/core/cli-wizard.ts'

describe('isValidPackageName（票13）', () => {
  it('accepts lowercase npm package names', () => {
    expect(isValidPackageName('dsh-demo')).toBe(true)
    expect(isValidPackageName('my_plugin')).toBe(true)
    expect(isValidPackageName('a')).toBe(true)
  })

  it('rejects uppercase, spaces, leading digits issues and empty', () => {
    expect(isValidPackageName('Dsh-Demo')).toBe(false)
    expect(isValidPackageName('dsh demo')).toBe(false)
    expect(isValidPackageName('')).toBe(false)
    expect(isValidPackageName('-dsh')).toBe(false)
  })
})

describe('capabilitiesForType（票13）', () => {
  it('host accepts only host-family capabilities', () => {
    const legal = capabilitiesForType('host')
    expect(legal).toContain('tools')
    expect(legal).toContain('cli')
    expect(legal).not.toContain('toolview')
    expect(legal).not.toContain('mcp-client')
  })

  it('client accepts only client-family capabilities', () => {
    const legal = capabilitiesForType('client')
    expect(legal).toContain('toolview')
    expect(legal).toContain('mcp-client')
    expect(legal).not.toContain('tools')
    expect(legal).not.toContain('cli')
  })

  it('both accepts the full capability set', () => {
    const legal = capabilitiesForType('both')
    expect(legal).toHaveLength(7)
  })
})

describe('collectWizardAnswers（票13 完整流程）', () => {
  it('collects a host+cli project through all seven steps', async () => {
    const inputs = ['dsh-wiz', 'host', 'my desc', 'cli', '', '', 'y']
    const answers = await collectWizardAnswers(async () => inputs.shift() ?? '')
    expect(answers).toEqual({
      name: 'dsh-wiz',
      type: 'host',
      description: 'my desc',
      capabilities: ['cli'],
      version: '',
      knowledgePack: true,
    })
  })

  it('filters illegal capabilities for the chosen type', async () => {
    const inputs = ['dsh-wiz', 'client', '', 'toolview,cli', '', '', 'y']
    const answers = await collectWizardAnswers(async () => inputs.shift() ?? '')
    expect(answers?.type).toBe('client')
    expect(answers?.capabilities).toEqual(['toolview'])
  })

  it('defaults to writing the knowledge pack', async () => {
    const inputs = ['dsh-wiz', 'host', '', '', '', '', 'y']
    const answers = await collectWizardAnswers(async () => inputs.shift() ?? '')
    expect(answers?.knowledgePack).toBe(true)
  })

  it('opts into knowledge-free mode when the user answers n', async () => {
    const inputs = ['dsh-wiz', 'host', '', '', '', 'n', 'y']
    const answers = await collectWizardAnswers(async () => inputs.shift() ?? '')
    expect(answers?.knowledgePack).toBe(false)
    expect(answers?.name).toBe('dsh-wiz')
  })

  it('aborts without falling through when the user declines', async () => {
    const inputs = ['dsh-wiz', 'both', '', '', '', '', 'n']
    const answers = await collectWizardAnswers(async () => inputs.shift() ?? '')
    expect(answers).toBeNull()
  })

  it('rejects an invalid type and aborts', async () => {
    const inputs = ['dsh-wiz', 'tui']
    const answers = await collectWizardAnswers(async () => inputs.shift() ?? '')
    expect(answers).toBeNull()
  })

  it('rejects an invalid package name and re-prompts', async () => {
    const inputs = ['Bad Name', 'dsh-ok', 'host', '', '', '', '', 'y']
    const answers = await collectWizardAnswers(async () => inputs.shift() ?? '')
    expect(answers?.name).toBe('dsh-ok')
    expect(answers?.type).toBe('host')
  })
})
