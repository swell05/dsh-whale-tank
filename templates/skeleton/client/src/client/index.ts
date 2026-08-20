// DSH client-only plugin client half: registered through window.__ModuleLoader__.
// 自渲染 UI 逻辑放 apply(ctx) 内。
export const name = '{{name}}-client'

export const inject: string[] = []

export function apply(ctx: unknown) {
  void ctx
}
