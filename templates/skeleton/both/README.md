# {{name}}

DSH both plugin scaffolded by @swell05/dsh-whale-tank.

```powershell
npm install
npm run build
npm test
```

结构（官方 both 最小实例）：
- `src/index.ts` + `config.ts` + `runtime.ts` + `invariant.ts` — host 半边
- `src/client/index.ts` — client 半边（`./client` 子路径导出）
- `src/types/shared.ts` — 共享类型（仅类型零运行时）
- `tests/harness.ts` + `tests/plugin.spec.ts` — 测试

构建产出 `lib/index.js`（host）与 `lib/client.js`（client bundle，双 tsdown 配置）。

See `docs/dev-guidance/README.md` (knowledge-pack mode) for the development
guidance; run `.wttools\status` before any sandbox operation.
