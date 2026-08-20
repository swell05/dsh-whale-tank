# 🐋 @swell05/dsh-whale-tank — a tiny whale tank

<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/@swell05/dsh-whale-tank/cover/cover.jpg" alt="Whale Tank" width="40%">
</p>

<p align="center">
  <a href="README_EN.md">English</a> · <a href="README.md"><strong>中文</strong></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@swell05/dsh-whale-tank"><img src="https://img.shields.io/npm/v/@swell05/dsh-whale-tank" alt="npm version"></a>
</p>

> A whale tank that does two things for you:
>
> 🛠️ **① Set up a clean sandbox for plugin development**
>
> 🩺 **② Vet plugins you're unsure about in a separate tank**
>
> Never touches your real `~/.dsh`.

## 🛠️ Create a plugin development sandbox

Plugin development is like renovation — you fence off the worksite first so you don't dirty the little whale's living room. `init` will:

- **Build a pristine sandbox**: a dedicated `DSH_HOME` + official baseline profile + `state.json`; experiment freely, your real `~/.dsh` stays untouched;
- **Generate a buildable skeleton by type** (`host / client / both`, dual tsdown configs, `cordis.patch.yml`, test stubs), plus a development tool-kit;
- **Optionally load a development knowledge pack** (AGENTS.md / NOTES.md / docs/dev-guidance) — a reference book for other agents, merged incrementally per the merge-spec, **never overwriting your content**; conflicts only warn, never auto-edit.

## 🩺 Plugin vetting

Not sure about installing a plugin? Tank it before you install. `vet` runs three phases:

1. **Static hazard check**: `npm pack` pulls the published artifact → the rule engine scans install scripts, credential reads and their flow, external calls, eval/obfuscation — credentials are judged by source→sink: reading an API key is a *signal* (a legit LLM plugin reading a key to call a known provider passes), high-severity only when the key can flow to a non-provider destination (hardcoded or runtime) — a high-severity hit means "not recommended", no execution;
2. **Restricted dynamic verification**: replica profile → two-layer conflict detection → plug/unplug cancellation (diff=0 to be clean), **untrusted code is not executed by default**;
3. **LLM source review**: the model reads the candidate source for "dark tricks" the rule engine can't catch — obfuscated business logic, misleading descriptions, suspicious side effects/data exfiltration, version-poisoning signs — complementing the rule engine;

Results land in local files: `vet-report.md` (human-readable) + `vet-result.json` (machine-readable) under `.vetting/`, with a three-way conclusion — **no vulnerabilities found / caution / not recommended**.

> ⚠️ vet is a **heuristic pre-check, not a security guarantee**. Isolation comes from a dedicated DSH_HOME + restricted execution — it **prevents state pollution, not local execution**; network behavior is recorded but not blocked. It's only available via `/whale-tank-vet` in the web UI — not provided on the CLI.

---

## 🚀 Quick Start

Published on npm; install into a DSH profile and you're ready.

### Install / Uninstall

```powershell
# Install into the web profile
dsh plugin --profile web add @swell05/dsh-whale-tank

# Uninstall
dsh plugin --profile web remove @swell05/dsh-whale-tank
```

Restart web after installing (the bundle layer stack is composed at boot).

### Use in dsh

After installing and restarting, trigger the skills from the dsh web conversation:

1. **Initialize a plugin project** — type `/whale-tank-init`: tell it the plugin's main purpose; it confirms the details step by step, then sets up the sandbox + skeleton + (optional) knowledge pack in the target directory, with an `ask_user` confirmation before writing; never overwrites existing content;

<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/@swell05/dsh-whale-tank/cover/snap1.png" alt="Screenshot 1" width="75%">
</p>

2. **Vet a third-party plugin** — type `/whale-tank-vet`: hand it the npm package name; the three-phase vet runs automatically, results land in `.vetting/` (`vet-report.md` human-readable + `vet-result.json` machine-readable).

<p align="center">
  <img src="https://cdn.jsdelivr.net/npm/@swell05/dsh-whale-tank/cover/snap2.png" alt="Screenshot 2" width="75%">
</p>

## 🧾 Full command reference (`.wttools` workspace tools)

After init, the project contains `.wttools/` — a self-contained tool-kit for plugin development. Run commands directly in the project folder (Windows: `.wttools\`, Unix: `./.wttools/`). `.wttools` is self-contained (single zero-dependency file), usable even after the plugin is uninstalled.

| Command | Purpose |
|---|---|
| `.wttools\status` | Sandbox health check (plug dirty, knowledge pack stale) |
| `.wttools\deps` | Dual-channel dependency install (plugins → sandbox profile; libraries → project package.json) |
| `.wttools\plug` | Mount the project plugin into the sandbox profile (snapshot → build → inject → smoke) |
| `.wttools\unplug` | Remove and reconcile (diff=0 → clean) |
| `.wttools\plug-test` | One-shot plug/unplug + restore composite test (daily dev loop) |
| `.wttools\run-test` | **Mount + run the in-development plugin in the foreground**, Ctrl+C restores automatically |
| `.wttools\restore` | Restore from the latest snapshot (`--full` = reset) |
| `.wttools\reset` | Delete `.sandbox/` and rebuild (asks before deleting) |
| `.wttools\upgrade-knowledge` | Upgrade the sandbox knowledge pack (idempotent) |

### `status`

Sandbox health check, no arguments.

```
.wttools\status
```

Output: project name/type, version mode (local/standalone), declared vs actual dsh version, drift and mixed-version warnings, profile, plugState (clean/plugged/dirty), knowledge-pack anchored version vs current template (stale hint). Shows the snapshot diff detail when dirty. Exit code: 0 when clean, 1 otherwise.

### `deps`

Dual-channel dependency install. **Plugin dependencies → sandbox profile** (reconciled into bundles); **ordinary npm libraries → project package.json** + `npm install`.

| Argument | Purpose |
|---|---|
| `--add <pkg>` | Give the package name directly (optionally `@version`, e.g. `@deepseek-ai/dsh-client-runtime`, `lodash@^4`); extracts name+version and picks the channel from the name (no LLM) |
| `--pkg <pkg>` | Explicit package name (with `--channel`) |
| `--channel plugin\|npm` | Explicit channel |
| `--version <ver>` | Pin a version; npm channel defaults to `*`, plugin channel defaults to the sandbox runtime dsh version |
| `--section <dependencies\|devDependencies\|peerDependencies>` | Which package.json section for the npm channel (default dependencies) |
| `--remove` | Remove instead of add |
| `--yes` | Skip confirmation |

```powershell
.wttools\deps --add @deepseek-ai/dsh-tools          # name contains dsh → plugin channel
.wttools\deps --add lodash@^4                       # ordinary library → npm channel
.wttools\deps --pkg @deepseek-ai/dsh-tools --channel plugin
.wttools\deps --pkg lodash --channel npm --section devDependencies
```

Channel rule (pure string matching, no semantic parsing): names containing `@deepseek-ai/`, a `dsh-` prefix, or `dsh` → plugin; otherwise → npm. The plugin channel enforces **version consistency** (Iron Rule 6: a version ≠ the sandbox runtime is rejected) and runs a dump-config smoke after install.

### `plug`

Mount the project plugin into the sandbox profile. Requires plugState = clean.

| Argument | Purpose |
|---|---|
| `--no-build` | Skip `npm run build` (builds by default) |

Flow: snapshot (pre-plug baseline) → build → `dsh plugin add file:<project>` + client insert → typed smoke (host/both: dump-config + boot; client: web boot + client-bundle assertion). On success plugState → plugged.

### `unplug`

Remove the plugin and reconcile, no arguments.

```
.wttools\unplug
```

Flow: `dsh plugin remove` → snapshot diff (vs the pre-plug baseline). diff=0 → clean (exit 0); diff≠0 → dirty + residual list (exit 1).

### `plug-test`

One-shot plug/unplug + restore composite test (the daily dev loop).

| Argument | Purpose |
|---|---|
| `--no-build` | Skip the build |
| `--no-restore` | Keep the scene on diff≠0 without auto-restore (still fails) |

Flow: plug → smoke → unplug → diff. diff=0 → report each stage + exit 0; diff≠0 → residual list goes fully into the report → auto-restore (scene backed up in the snapshot dir, evidence kept) → final clean + exit 1.

### `run-test`

**Mount + run the in-development plugin in the foreground** — inject the project plugin into a sandbox profile and boot it for real; Ctrl+C restores automatically.

| Argument | Purpose |
|---|---|
| `--profile <name>` | Target profile (any sandbox profile, e.g. web/headless; **default web**) |
| `--port <n>` | Web port override (default 13080; other profiles respect their own config) |
| `--no-build` | Skip `npm run build` |

```powershell
.wttools\run-test                       # default web:13080, opens the browser for a live run
.wttools\run-test --profile headless    # run the headless profile
.wttools\run-test --port 8080
```

Flow: build → inject (`dsh plugin add file:`, always with an explicit sandbox DSH_HOME + profile path assertion, **never escapes to the real ~/.dsh**) → foreground boot → Ctrl+C → remove + diff restore (diff≠0: evidence captured + auto-restore that profile).

> ⚠️ `run-test` runs `npm run build` first — **run `npm install` on a fresh skeleton before `run-test`**, otherwise it errors with `tsc not found`.

### `restore`

Two-level restore.

| Argument | Purpose |
|---|---|
| `--full` | Go through reset: delete `.sandbox/` and rebuild |
| `--yes` | Skip the deletion confirmation |

Without `--full`: copy back the latest snapshot's profile files → rebuild node_modules → clear sandbox sessions → rewrite state (clean) → smoke confirmation.

### `reset`

Standalone verb: delete `.sandbox/` and rebuild the whole sandbox, asks before deleting (`--yes` skips). For when the sandbox is thoroughly broken.

### `upgrade-knowledge`

Merge the plugin's newer built-in knowledge pack into the project incrementally per the merge-spec (idempotent, never overwrites user content), no arguments.

```
.wttools\upgrade-knowledge
```

New version blocks are appended, old blocks kept (two versions coexist pending manual cleanup), conflicts only warn.

## 🌐 Skills & Tools (tested on dsh web mode only)

| Skill | Purpose |
|---|---|
| `/whale-tank-init` | Initialize a project: has `.sandbox/state.json` → upgrade knowledge pack; empty directory → init; non-empty uninitialized → refuse |
| `/whale-tank-vet` | Third-party plugin vetting, three phases |

Tools are **lazily registered**: they enter scope only on the turn the skill is triggered, deregistered when the session ends; the rest of the time the model context has **zero** whale-tank tools — no intrusion, no residue.

### Troubleshooting

- **`.wttools` commands don't need to be on PATH**: `.wttools` is self-contained (single zero-dependency file); run `.wttools\status` etc. directly in the project folder — no global install needed.
- **Build reports `tsc not found` after skeleton generation**: the scaffold ships no dependencies; run `npm install` (or `.wttools\deps`) first, then `npm run build`.

## 📄 License

[MIT](LICENSE) © 2026 swell05
