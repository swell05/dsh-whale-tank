# package.json 契约（v0.1.4 新模板，rc.8 实测）

<!-- whale-tank-knowledge-pack: v0.1.6 -->

> whale-tank v0.1.4 三套基座（host/both/client）生成的 package.json 契约。tsdown 配置形态 = **双配置**（`tsdown.host.config.ts` + `tsdown.client.config.ts`）——`hostPhase: true` 单配置对第三方不可用（实测：非 tsdown 原生选项、静默忽略、client 产物无声缺失）。

## host 型权威写法

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./invariant": { "types": "./lib/types/invariant.d.ts", "default": "./lib/invariant.js" },
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "scripts": {
    "build": "node -e \"require('fs').rmSync('lib',{recursive:true,force:true})\" && tsc -p tsconfig.build.json && tsdown --config tsdown.host.config.ts"
  },
  "peerDependencies": { "@deepseek-ai/cordis": "^4.0.1" }
}
```

## both / client 型差异

- both 型：`dsh.bundle.patch` + `dsh.client`（`platform: web` + `inject`）；exports 含 `./client`（指向 `lib/client.js`）；build 追加 `tsdown --config tsdown.client.config.ts`；`src/types/` 共享类型（仅类型零运行时，两端各自 import）。
- client 型：**无 `dsh.bundle`、无 `cordis.patch.yml`**（files 仅 `lib`）；`src/index.ts` 是 host loader stub（纯转发）；exports 含 `./client` 与 `./invariant`。

## 要点

- **`./package.json` 导出是硬要求**：client-modules 扫描用 `require.resolve('<pkg>/package.json')` 读 `dsh.client` 声明——exports 缺该子路径 → 包永远不被识别为 client 包（实测，client.js 404）。
- **`./invariant` 子路径**：包级不变量（`src/invariant.ts` 导出 `{ name, PACKAGE_NAME, CONTRACT }`），供外部/测试校验契约承诺；纯声明式，不依赖运行时服务。
- `dsh.bundle.patch` → `cordis.patch.yml`，内 `- insert: - id: <包名> name: '<包名>'`。
- 官方包以 **peerDependencies** 声明（rc.8 线，如 `^0.1.0-rc.8`）：pnpm `autoInstallPeers: false` 下只警告不阻塞；运行时由 profile 闭包注入。官方服务依赖（如 `dsh-tools`/`dsh-commands`）也走 peerDeps——骨架不硬依赖官方 rc 包（公共 npm 解析风险），开发者接线时按需加 devDep 供类型编译。
- client bundle 走 lazy-CJS factory（`window.__ModuleLoader__.load`）——`tsdown.client.config.ts` 的 moduleLoaderWrapper（见 12）。

## 演进方向（0811 私有 registry 时代，勿当默认）

`index.mjs` 入口、**不声明官方依赖**（npm 公共源解析不到 0.0.1-rc 预发布包）。本机 rc.8 下声明 peerDeps 实测可行，故默认走上方权威写法。
