# Web 设置卡（web 插件，二级参考）

<!-- whale-tank-knowledge-pack: v0.1.6 -->

## 两半结构（同一包）

- Host 半：`src/` 注册 settings 命名空间（`installSettingsSection(ctx, ns, Config, config, { validate, setSource, onChange })`）；`role('secret')` 字段不进任何响应；`applies: 'restart'` 声明重启生效。
- 浏览器半：`src/client/` 注册卡片到 `settings.plugin.item` 槽（`ctx.settingsScope` 读写，revision fencing）。

```jsonc
{
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" }
  },
  "dsh": { "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-settings-plugins"] } }
}
```

## 要点

- **keyed 槽（rc.8 纪律）**：浏览器半注册到 `settings.plugin.item` 用 **`key`（= 命名空间）**；`id`/`order` 已废弃——跨插件顺序不稳定，不要依赖。
- **禁止直连 `settings.describe`**（rc.8 纪律）：SettingsDescribeMirror 有预算回归——新卡片读写一律走 `ctx.settingsScope`，别把 describe 拉进渲染路径。
- 命名空间是 join key，Host/浏览器两半必须拼写一致；Host 没组合时页面无卡片痕迹（按槽分发）。
- 卡片自渲染、自持有 staging 与 revision fencing；跨插件协作走 cordis 服务，**值导入会挂 client bundle-purity 门禁**。
