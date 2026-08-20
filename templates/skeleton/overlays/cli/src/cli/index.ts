#!/usr/bin/env node
// {{name}} CLI 入口（package.json bin 指向 lib/cli.js）。
// 开发者接线：添加子命令与参数解析。
const [verb] = process.argv.slice(2)
console.log(`{{name}} cli: ${verb ?? 'no command'}`)
