# {{name}}

DSH host plugin scaffolded by @swell05/dsh-whale-tank.

```powershell
npm install
npm run build
npm test
```

结构（官方 host 最小实例）：
- `src/index.ts` — Cordis 入口（main → lib/index.js）
- `src/config.ts` — 配置接口与默认值
- `src/runtime.ts` — 运行时 effect
- `src/invariant.ts` — 包级不变量（`./invariant` 子路径导出）
- `tests/harness.ts` + `tests/plugin.spec.ts` — 测试

See `docs/dev-guidance/README.md` (knowledge-pack mode) for the development
guidance; run `.wttools\status` before any sandbox operation.
