import { describe, expect, it } from 'vitest'
import { SKILL_REGISTRATIONS } from '../../src/skills.ts'

describe('plugin-level skill registrations (vision-toolkit pattern)', () => {
  it('registers exactly the two user-only skills', () => {
    const names = SKILL_REGISTRATIONS.map((skill) => skill.name).sort()
    expect(names).toEqual(['whale-tank-init', 'whale-tank-vet'])
  })

  it('is user-invocable only (model cannot self-invoke)', () => {
    for (const skill of SKILL_REGISTRATIONS) {
      expect(skill.invocation).toEqual({
        modelInvocable: false,
        userInvocable: true,
      })
    }
  })

  it('ships non-empty instruction bodies and a resource base', () => {
    for (const skill of SKILL_REGISTRATIONS) {
      expect(skill.content.length).toBeGreaterThan(100)
      expect(skill.resourceBase?.kind).toBe('directory')
      expect(skill.source).toBe('runtime')
    }
  })
})
