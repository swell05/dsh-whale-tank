// 包级不变量（./invariant 子路径导出）：供外部与测试校验包的契约承诺。
// 纯声明式，不依赖任何运行时服务。
export const name = '{{name}}-invariant'
export const PACKAGE_NAME = '{{name}}'
export const CONTRACT = {
  entry: 'lib/index.js',
  exports: ['.', './client', './invariant'],
  inject: [],
} as const
