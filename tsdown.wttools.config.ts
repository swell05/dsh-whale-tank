import { defineConfig } from 'tsdown'

/**
 * `.wttools` 单文件 CLI bundle：init 复制进项目 `.wttools/whale-tank.cjs`，
 * 每命令 shim（status/plug/run-test…）调它。必须**零外部运行时依赖**——
 * 只留 node 内建 external，其余全内联，插件卸载后 `.wttools` 仍可用
 * （grill 决策：自包含单文件 + 每命令 shim）。
 */
export default defineConfig({
  entry: { 'whale-tank': 'src/cli.ts' },
  format: 'cjs',
  target: 'node20',
  deps: {
    neverBundle: [/^node:/],
  },
  outDir: 'wttools',
  outExtensions: () => ({ js: '.cjs', dts: '.d.ts' }),
  dts: false,
  sourcemap: false,
  clean: true,
})
