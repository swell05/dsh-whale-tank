import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    {{cli_entry}}
  },
  format: 'es',
  deps: {
    neverBundle: [/^node:/, /^@deepseek-ai\//],
  },
  outDir: 'lib',
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  dts: false,
  sourcemap: true,
  clean: false,
})
