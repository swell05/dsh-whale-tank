// MCP server 覆盖层（capability: mcp-server）。
// 开发者接线：定义 MCP server 启动配置并注册。
// 注：官方 MCP 形态是 per-server @deepseek-ai/dsh-mcp-client 插件行（知识包 01），
// 此处是 host 侧 server 自实现的挂载点。
export const MCP_SERVER_NAME = '{{name}}-mcp'
