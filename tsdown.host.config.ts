import { defineConfig } from 'tsdown'

/**
 * Host-half bundle: ESM output for the Cordis Loader and the standalone
 * `whale-tank` bin. Node builtins and every @deepseek-ai peer stay external
 * (provided by the host app's own tree). The .d.ts types come from
 * `tsc -p tsconfig.build.json` (lib/types), so tsdown's dts emission is off.
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
  },
  format: 'es',
  deps: {
    neverBundle: [/^node:/, /^@deepseek-ai\//],
  },
  outDir: 'lib',
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  dts: false,
  sourcemap: false,
  clean: false, // lib is wiped by the build script before tsc emits types
})
