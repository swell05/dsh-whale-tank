# whale-tank-init

用户手动触发后，本轮已注册 `whale_tank_init` 与 `whale_tank_upgrade_knowledge` 两个工具。**先检查目标目录状态**分流，再走对应流程。

## 0. 目录与包名默认值 + 分流

**默认**：`project`（目标目录）= 当前工作区；`name`（包名）= 当前工作区名称。当**包名 ≠ 工作区名**或**工作区非空**时，`project` = `<工作区>/<包名>`——在工作区内先建一个以包名为名的文件夹作为项目目录（避免包名与工作区名不一致导致混乱）。用户可显式改包名或指定目录。

再按目标目录 `project` 的状态分流：

1. **目录不存在或为空** → 走下面的 init 确认清单；
2. **已有 `.sandbox/state.json`（已初始化）** → 调用 `whale_tank_upgrade_knowledge`（`--project <绝对路径>`）补齐/升级知识包；幂等，绝不覆盖用户内容；
3. **目录非空但无 `.sandbox/state.json`** → **拒绝**并提示："该目录已有内容但未初始化，whale-tank 不会覆盖用户内容；请在空目录执行 init。" 不要调用任何工具。

## 1. init 确认清单（逐项复述，不许猜）

按序逐项与用户确认，每项都有明确答复后再进下一项。**每一项都要给出你的推断依据**，拿不准就直接问，绝不替用户拍板：

| # | 参数 | 确认内容 |
|---|---|---|
| ① | 包名 `name` | npm 包名（小写、可含连字符）；**默认取当前工作区名称** |
| ② | 选端 `type` | 按第 2 节判定表，**先给判定依据再给结论**（例："桌面宠物要在浏览器里渲染 → client"） |
| ③ | 功能扩展 `capabilities` | 按所选端过滤合法项，把候选列给用户多选（skills/tools/commands/mcp-client/mcp-server/cli/toolview） |
| ④ | 知识包 | 要不要三层开发知识包（AGENTS.md/NOTES.md/dev-guidance）；**默认要**，仅当用户明确不要时才 `no_knowledge_pack: true` |
| ⑤ | 功能描述 `description` | 一段粗略功能描述 |
| ⑥ | dsh 版本 | **默认不钉**（local 模式）；只有用户明确要求才传 `dsh_version` |
| ⑦ | 目标目录 `project` | 默认 = 当前工作区；包名≠工作区名或工作区非空时 = `<工作区>/<包名>`（新子目录） |

全部确认后，把（项目名 / 类型 / capabilities / 知识包 / 目录）**复述一遍 ask_user 总确认**，再调用 `whale_tank_init`。

## 2. 选端判定表（硬编码，先依据后结论）

| 插件形态 | type |
|---|---|
| 纯 Node 后端（工具/命令/服务，**无浏览器 UI**） | `host` |
| 纯浏览器 UI（前端渲染、toolview 消费） | `client` |
| host 半边 + 浏览器半边 + 共享类型（桌面宠物） | `both` |
| 拿不准 | **问用户，不许猜** |

`web` 是 `both` 的废弃别名，不主动推荐。

## 3. 工具调用

`whale_tank_init` 参数：`--project <绝对路径> --name <包名> --type host|client|both [--description ...] [--capabilities ...] [--dsh_version ...] [--no_knowledge_pack true] [--plan_only true]`。知识包默认写入；`--no_knowledge_pack true` 仅当用户明确不要（知识自由模式）。

init 完成后**不要替用户运行 `.wttools` 命令**——dsh 受限沙盒禁止创建子进程（spawn EPERM）。向用户说明：`.wttools\status`、`.wttools\run-test` 等由用户在**自己终端的项目文件夹里**执行（Windows 用 `.wttools\`，Unix 用 `./.wttools/`）。

**依赖提醒（必须转达用户）**：骨架**不含依赖**，用户需先在项目文件夹里手动 `npm install`（或 `.wttools\deps`）再 `npm run build`——**不能直接 `.wttools\run-test`**（run-test 内部会先 `npm run build`，没装依赖会报 `tsc` 不存在）。

**收尾措辞**：init 全部完成后，**不要以"接下来需要我帮你…"继续代工**。改为告诉用户：项目已就绪，可以用**专业的开发工作流另开一个 session 接手**（把项目文件夹交给新的会话继续开发），或在自己终端里用 `.wttools\` 命令（status / run-test / plug-test 等）。

铁律：写盘前必须获得用户确认；用户取消则不执行；任何情况下不覆盖用户已有内容。
