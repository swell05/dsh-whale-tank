import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  localHomeMetadata,
  metadataEqual,
  isLocalWatchPath,
} from '../../src/core/replica.ts'

function fakeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-home-'))
  fs.mkdirSync(path.join(home, 'profiles', 'headless'), { recursive: true })
  fs.writeFileSync(path.join(home, 'profiles', 'headless', 'package.json'), '{}', 'utf8')
  fs.writeFileSync(path.join(home, '.credentials.yaml'), 'x', 'utf8')
  fs.mkdirSync(path.join(home, 'sessions', 'scope'), { recursive: true })
  fs.writeFileSync(path.join(home, 'sessions', 'scope', 'session-a.jsonl.zstd'), '1', 'utf8')
  return home
}

describe('local-untouched whitelist (2026-08-19 实机修正)', () => {
  it('watches only high-value paths', () => {
    expect(isLocalWatchPath('profiles/headless/package.json')).toBe(true)
    expect(isLocalWatchPath('.credentials.yaml')).toBe(true)
    expect(isLocalWatchPath('settings.yaml')).toBe(true)
    expect(isLocalWatchPath('storages/abc.json')).toBe(false)
    expect(isLocalWatchPath('cache/x.json')).toBe(false)
    expect(isLocalWatchPath('sessions/scope/session-a.jsonl.zstd')).toBe(false)
    expect(isLocalWatchPath('task-board/x.json')).toBe(false)
  })

  it('excludes live session logs from the baseline and the diff', () => {
    const home = fakeHome()
    const before = localHomeMetadata(home)
    expect(before.has(path.join(home, 'profiles', 'headless', 'package.json'))).toBe(true)
    expect(before.has(path.join(home, '.credentials.yaml'))).toBe(true)
    expect(before.has(path.join(home, 'sessions', 'scope', 'session-a.jsonl.zstd'))).toBe(false)

    // 宿主会话持续写日志：模拟新日志 + 已有日志变化，不应影响判定。
    fs.writeFileSync(path.join(home, 'sessions', 'scope', 'session-a.jsonl.zstd'), 'changed', 'utf8')
    fs.writeFileSync(path.join(home, 'sessions', 'scope', 'session-b.jsonl.zstd'), '2', 'utf8')
    const after = localHomeMetadata(home)
    expect(metadataEqual(before, after).clean).toBe(true)
  })

  it('still flags a real change under a watched path', () => {
    const home = fakeHome()
    const before = localHomeMetadata(home)
    fs.writeFileSync(path.join(home, '.credentials.yaml'), 'changed', 'utf8')
    const after = localHomeMetadata(home)
    const result = metadataEqual(before, after)
    expect(result.clean).toBe(false)
    expect(result.detail).toContain('.credentials.yaml')
  })
})
