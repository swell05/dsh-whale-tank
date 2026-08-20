/**
 * profile 用户 patch 层（`<profile>/cordis.patch.yml`）的 insert 行管理。
 *
 * client-only 插件不进层栈（无 dsh.bundle），要在 client 树被发现，必须在
 * 用户 patch 层有 include/insert 行。plug 写入、unplug 移除；幂等；绝不破坏
 * 既有条目（以顶层 `- insert:` 块为单位追加/删除，不做 YAML 语义级重写）。
 */

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function idPattern(pkgName: string): RegExp {
  return new RegExp(`id:\\s*['"]?${escapeRegExp(pkgName)}['"]?`)
}

/** 追加一个 client insert 顶层块；幂等（已存在该 id 则原样返回）。 */
export function addProfileInsert(patch: string, pkgName: string): string {
  if (idPattern(pkgName).test(patch)) return patch
  const block = `- insert:\n    - id: ${pkgName}\n      name: '${pkgName}'\n`
  const effective = patch
    .split(/\r?\n/)
    .filter((line) => !/^[ \t]*#/.test(line))
    .join('\n')
    .trim()
  if (effective === '[]') {
    const comments = patch
      .split(/\r?\n/)
      .filter((line) => /^[ \t]*#/.test(line))
      .join('\n')
    return comments.length > 0 ? `${comments}\n${block}` : block
  }
  return patch.replace(/\s+$/, '') + '\n' + block
}

/** 移除含该 id 的 insert 顶层块；不存在则该 id 时原样返回。 */
export function removeProfileInsert(patch: string, pkgName: string): string {
  const pattern = idPattern(pkgName)
  const blocks = patch.split(/^(?=- insert:)/m)
  const kept = blocks.filter((block) => !pattern.test(block))
  const next = kept.join('')
  // 若删完只剩注释/空白（无任何 YAML 条目），补回空数组 `[]`（与插前基线一致）。
  const effective = next
    .split(/\r?\n/)
    .filter((line) => !/^[ \t]*#/.test(line))
    .join('')
    .trim()
  if (effective === '') {
    return next.replace(/\s+$/, '') + '\n[]\n'
  }
  return next
}
