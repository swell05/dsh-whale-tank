// DSH both plugin client half: registered through window.__ModuleLoader__.
// 自渲染 UI 逻辑放 apply(ctx) 内；host 半与浏览器半的命名空间必须拼写一致。
export const name = '{{name}}-client'

export const inject: string[] = []

export function apply(ctx: unknown) {
  void ctx
}

// 共享类型仅类型零运行时：client 侧 re-export 供浏览器半消费。
export type { EchoRequest, EchoResponse } from '../types/shared.ts'
