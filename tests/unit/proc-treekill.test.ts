import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runProcess } from '../../src/core/proc.ts'

describe('runProcess process-tree termination (Windows 孙进程握管道)', () => {
  it('resolves with timedOut instead of hanging forever when grandchildren hold stdout', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-tank-treekill-'))
    // 父进程 spawn 一个继承 stdout 的孙进程（每秒写一行），然后自己长睡。
    const script = path.join(dir, 'grandparent.mjs')
    fs.writeFileSync(
      script,
      [
        `import { spawn } from 'node:child_process'`,
        `const child = spawn(process.execPath, ['-e', 'setInterval(() => console.log("tick"), 500)'], { stdio: 'inherit' })`,
        `child.unref()`,
        `setInterval(() => {}, 1000)`,
      ].join('\n'),
      'utf8',
    )
    const start = Date.now()
    const result = await runProcess({
      command: process.execPath,
      args: [script],
      cwd: dir,
      timeoutMs: 1_500,
    })
    const elapsed = Date.now() - start
    expect(result.timedOut).toBe(true)
    // 树杀生效时 close 很快触发；即使杀不干净，8s 强制收尾也保证 resolve。
    expect(elapsed).toBeLessThan(15_000)
  }, 30_000)
})
