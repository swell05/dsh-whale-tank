import { describe, expect, it } from 'vitest'
import { addProfileInsert, removeProfileInsert } from '../../src/core/patch.ts'

describe('profile 用户 patch 层 insert 行管理（票08）', () => {
  it('replaces the empty default patch with a client insert block', () => {
    const patch = `# 用户 patch 层注释\n[]\n`
    const next = addProfileInsert(patch, 'dsh-client-demo')
    expect(next).toContain('- insert:')
    expect(next).toContain('id: dsh-client-demo')
    expect(next).toContain("name: 'dsh-client-demo'")
  })

  it('appends to an existing insert list without clobbering other entries', () => {
    const patch = `- insert:\n    - id: other-plugin\n      name: 'other-plugin'\n`
    const next = addProfileInsert(patch, 'dsh-client-demo')
    expect(next).toContain('id: other-plugin')
    expect(next).toContain('id: dsh-client-demo')
    // 两条 insert 在同一条目列表里。
    expect(next.match(/id: dsh-client-demo/g)).toHaveLength(1)
  })

  it('is idempotent when the insert already exists', () => {
    const patch = `- insert:\n    - id: dsh-client-demo\n      name: 'dsh-client-demo'\n`
    expect(addProfileInsert(patch, 'dsh-client-demo')).toBe(patch)
  })

  it('removes a client insert block and leaves the rest intact', () => {
    const patch = `- insert:\n    - id: dsh-client-demo\n      name: 'dsh-client-demo'\n- insert:\n    - id: other-plugin\n      name: 'other-plugin'\n`
    const next = removeProfileInsert(patch, 'dsh-client-demo')
    expect(next).not.toContain('dsh-client-demo')
    expect(next).toContain('other-plugin')
  })

  it('returns the patch unchanged when the id is absent', () => {
    const patch = `[]\n`
    expect(removeProfileInsert(patch, 'dsh-client-demo')).toBe(patch)
  })
})
