import { describe, expect, it } from 'vitest'
import { detectSkillTrigger } from '../../src/lazy-tools.ts'

describe('detectSkillTrigger (inbox-inserted lazy tool registration)', () => {
  it('detects /whale-tank-init at the start of a user message', () => {
    expect(
      detectSkillTrigger([{ content: '/whale-tank-init 我想建一个 host 插件' }]),
    ).toBe('whale-tank-init')
  })

  it('detects /whale-tank-vet anywhere with whitespace boundaries', () => {
    expect(
      detectSkillTrigger([{ content: '帮我 /whale-tank-vet 检查一下这个插件' }]),
    ).toBe('whale-tank-vet')
  })

  it('returns null when no skill token is present', () => {
    expect(detectSkillTrigger([{ content: '随便聊聊' }])).toBeNull()
    expect(detectSkillTrigger([])).toBeNull()
  })

  it('does not match partial tokens or trailing punctuation without boundary', () => {
    expect(detectSkillTrigger([{ content: '/whale-tank-init-test' }])).toBeNull()
    expect(detectSkillTrigger([{ content: 'whale-tank-vet' }])).toBeNull()
  })

  it('handles the real UserMessage shape (content block array)', () => {
    const message = {
      source: { kind: 'user' },
      content: [
        { type: 'reasoning', text: 'noise' },
        { type: 'text', text: '帮我 /whale-tank-vet 检查一下这个插件' },
      ],
    }
    expect(detectSkillTrigger([message])).toBe('whale-tank-vet')
  })

  it('ignores non-user sources like injected skill content', () => {
    const injected = {
      source: { kind: 'skill-invocation', name: 'whale-tank-vet' },
      content: [{ type: 'text', text: '/whale-tank-vet 使用说明...' }],
    }
    expect(detectSkillTrigger([injected])).toBeNull()
  })
})
