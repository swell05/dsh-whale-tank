# 安装与验证

<!-- whale-tank-knowledge-pack: v0.1.6 -->

## 双通道安装

```powershell
# bundle（声明 dsh.bundle.patch）→ 层栈，重启生效
dsh plugin --profile <基线> add file:<包绝对路径>

# 纯 cordis（无 dsh.bundle）→ 装依赖 + profile cordis.patch.yml 写 insert 行，配置 HMR 实时生效
dsh plugin --profile <基线> add <包>
# profile cordis.patch.yml:
# - insert:
#     - id: my-plugin
#       name: 'my-plugin'
```

- 本地目录：指向**含 `package.json#dsh.bundle` 的包目录**（构建产物在库），不要在仓库根 add。
- git 源：monorepo 子目录用 `github:owner/repo#<ref>&path:/<子目录>`（`path:` 前缀 + 前导 `/`）；产物入库推荐（一行装），不入库则 prepare + allowBuilds 放行（见 07）。
- 装完 bundle 需**重启 web**（层栈在 boot 合成；Node half 改动同因 ESM 缓存必须重启）。

## 验证按改动面

| 改动触达 | 验证 |
|---|---|
| client/ 源码或构建 | 重建 + 浏览器冒烟（headless dump-dom 断言 DOM marker、无 "Failed to load plugins"）；`/plugins/<id>/client.js` 200 |
| assets/ | 重装 + 刷新页面（路由按请求读磁盘） |
| index.mjs / src（Node half） | 门禁 + **重启 web** + boot 日志干净（无 `plugin tree failed to load`） |

## 挂载失败排查（按序）

1. `exports["."]`/`main` 指向不存在/无法解析的入口；
2. `inject` 未声明 `ctx.get` 用到的服务（严格注入抛错）；
3. 依赖解析失败（缺 profile 闭包 / 声明了不该声明的官方依赖）；
4. insert 行 `name:` 未加引号（YAML `@` 开头保留指示符）。

## 冒烟断言（2026-08-20 实测定稿，whale-tank 实际实现）

- 结构：`dsh --dump-config`（DSH_HOME=沙盒）断言插件层按 bundles 顺序在组合树（只证结构）。
- 激活：真实 boot + **settle 断言**——headless 的确定性终点是 `MISSING_CREDENTIAL`（boot 已 settle、所有插件已激活才走到凭据检查）；**web 是常驻服务器不出凭据错，settle 信号 = `dsh web: http://...` 启动地址出现**。`plugin tree failed to load` / `EADDRINUSE` / `too many arguments` 为快速失败信号（先于终点判定）。web profile 用 `--port 0 --no-open`（rc.8+ 不接受位置参数、默认自动开浏览器），headless 用 `say ok`。
