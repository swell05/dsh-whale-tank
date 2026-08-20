import { defineConfig } from 'tsdown'

const CLIENT_ID = '{{name}}'

function moduleLoaderWrapper() {
  return {
    name: 'dsh-module-loader-wrapper',
    renderChunk(code: string) {
      const wrapped = [
        `window.__ModuleLoader__.load({`,
        `\tid: ${JSON.stringify(CLIENT_ID)},`,
        `\tfactory: (require) => {`,
        `\t\tvar module = { exports: {} };`,
        `\t\tvar exports = module.exports;`,
        code,
        `\t\treturn module.exports;`,
        `\t}`,
        `});`,
        ``,
      ].join('\n')
      return { code: wrapped, map: null }
    },
  }
}

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  format: 'cjs',
  deps: {
    neverBundle: [/^@deepseek-ai\//],
  },
  outDir: 'lib',
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  dts: false,
  sourcemap: false,
  clean: false,
  plugins: [moduleLoaderWrapper()],
})
