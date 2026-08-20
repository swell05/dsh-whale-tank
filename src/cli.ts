#!/usr/bin/env node
import { runCliInvocation, parseCliArgs } from './core/cli-run.ts'

/**
 * 独立 bin（排障/脚本/dogfooding 兜底，零依赖 boot 上下文）。
 * 与 agent 工具、`dsh whale-tank` 命令共享 core；也被 tsdown 打进
 * `.wttools/whale-tank.cjs`（自包含单文件，init 复制进项目工作区）。
 * async 包装：cjs 产物不支持 top-level await。
 */
async function main(): Promise<void> {
  const outcome = await runCliInvocation(parseCliArgs(process.argv.slice(2)))
  if (outcome.text.length > 0) {
    process.stdout.write(`${outcome.text}\n`)
  }
  process.exitCode = outcome.exitCode
}

void main()
