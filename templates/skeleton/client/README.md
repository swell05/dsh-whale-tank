# {{name}}

DSH client plugin scaffolded by @swell05/dsh-whale-tank.

```powershell
npm install
npm run build
npm test
```

结构（官方 client 最小实例）：
- `src/index.ts` — host loader stub（纯转发，无 host 业务逻辑）
- `src/client/index.ts` — client 半边（`./client` 子路径导出）
- `src/invariant.ts` — 包级不变量（`./invariant` 子路径导出）
- `tests/harness.ts` + `tests/plugin.spec.ts` — 测试

client-only 插件**无 `dsh.bundle`、无 `cordis.patch.yml`**——不进层栈，
由 profile 用户 patch 层的 insert 行接入（`.wttools\plug` 自动处理）。

See `docs/dev-guidance/README.md` (knowledge-pack mode) for the development
guidance; run `.wttools\status` before any sandbox operation.
