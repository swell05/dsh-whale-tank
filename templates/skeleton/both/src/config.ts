// 插件配置（host 半边；cordis 会做 schema 校验，此处仅声明接口与默认值）。
export interface Config {
  /** 启动问候语。 */
  greeting?: string
}

export const DEFAULT_CONFIG: Config = {
  greeting: 'hello',
}
