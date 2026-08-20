# 客户端构建纪律（dsh.client 包）

<!-- whale-tank-knowledge-pack: v0.1.6 -->

## `DSH_CLIENT_*` 构建期环境（rc.8）

- 浏览器业务代码只能静态读 `process.env.DSH_CLIENT_*`——**构建期内联为字符串**，未设置 = undefined；其余 `process.env` 在 client 构建中收敛为空对象；`import.meta.env` 不可用。
- **内容公开**：内联值会进产物，**严禁放凭据、本机路径、Host 侧值**——只放构建 profile 之类公开开关（如 `DSH_CLIENT_BUILD_PROFILE=official`）。
- 仓库内官方构建（`build:official`）等价 CI 构建并写环境+摘要记录；第三方插件自建构建时同样只消费 `DSH_CLIENT_*`。

## 依赖声明纪律（`verify-client-packages` 强制）

- Cordis 本体与被 `dsh.client.inject` 引用的**内部动态包**：matching **peerDependencies + devDependencies**。
- React / ui-primitives / ui-slots 等对外壳是种子身份，**对动态包只是 devDependencies**（不进 peerDeps）。
- 实例：`dsh-client-ui-tool` 的 peerDeps 把 `react`/`ui-primitives`/`ui-slots` 移出，新增 `dsh-client-connection` 注入。
- 动态 `dsh.client` 包产出自注册 `lib/client.js`（lazy-CJS factory）；共享模块只有两种提供方：动态包 row（`/client` 别名）或外壳静态模块表精确 key——没有通用 `dsh.client.provide` 别名机制。

## cookbook 漂移警示

- 官方 `docs/cookbook/*` 追赶代码有滞后（rc.8 窗口 `web_search`、subagent bundle 化均未同步）——契约争议以 `docs/config-catalog` / `docs/tool-catalog` 为准。
