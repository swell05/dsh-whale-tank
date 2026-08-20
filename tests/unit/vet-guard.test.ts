import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertVetDirFree } from '../../src/core/vet.ts'

describe('assertVetDirFree（vet 现场占用守卫）', () => {
  it('passes when the target vet dir is absent', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-vet-guard-'))
    expect(() => assertVetDirFree(path.join(empty, '.vetting', 'pkg'))).not.toThrow()
  })

  it('refuses when a kept scene already occupies the target vet dir', () => {
    const dir = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'wt-vet-guard-')),
      '.vetting',
      'pkg',
    )
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'progress.json'), '{}\n', 'utf8')
    expect(() => assertVetDirFree(dir)).toThrow(/已有体检现场/)
    expect(() => assertVetDirFree(dir)).toThrow(/手动删除|换一个工作区/)
  })
})
