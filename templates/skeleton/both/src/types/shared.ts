// 共享类型（host 与 client 半边共用）：RPC payload、工具接口、事件定义。
// 仅类型零运行时逻辑——两端各自 import，混进运行时会被 tsdown 打包成错误边界。
export interface EchoRequest {
  message: string
}

export interface EchoResponse {
  message: string
}
