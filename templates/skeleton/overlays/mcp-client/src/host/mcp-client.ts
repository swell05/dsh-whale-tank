// MCP client 覆盖层（capability: mcp-client）。
// 官方形态：per-server @deepseek-ai/dsh-mcp-client 插件行（profile 用户 patch 层 insert），
// 配置 transport/serverName/command|url——绝不生成 dsh.mcpServers（官方不读）。
// 骨架示例：在 profile 用户 patch 层追加
//   - insert:
//       - id: my-mcp
//         name: '@deepseek-ai/dsh-mcp-client'
//         config:
//           serverName: my-server
//           command: my-mcp-server
export const MCP_SERVER_NAME = 'my-mcp-server'
