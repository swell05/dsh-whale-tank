import fs from 'node:fs'
import path from 'node:path'

/**
 * Windows-safe recursive delete: pnpm node_modules entries are read-only
 * hard links; clear the read-only attribute before removing (决策 04).
 */
export function removeTree(target: string): void {
  if (!fs.existsSync(target)) return
  if (process.platform === 'win32') {
    const stack = [target]
    while (stack.length > 0) {
      const current = stack.pop()!
      let stat: fs.Stats
      try {
        stat = fs.lstatSync(current)
      } catch {
        continue
      }
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(current)) {
          stack.push(path.join(current, entry))
        }
      } else {
        try {
          fs.chmodSync(current, 0o600)
        } catch {
          // Best effort: the delete below will surface hard failures.
        }
      }
    }
  }
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
