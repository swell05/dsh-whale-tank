import fs from 'node:fs'
import path from 'node:path'
import type { SkillRegistration, SkillInvocationPolicy } from '@deepseek-ai/dsh-skill'
import { packageRootDir } from './core/paths.ts'

/**
 * 插件级 skill（vision-toolkit 同款机制）：`ctx.skills.register` 在运行时
 * 注册，正文打包在插件的 skills/ 目录，随插件安装/卸载，无文件系统残留。
 * 两个 skill 都是 user-invocable only（模型不能自己调，用户敲 `/` 触发）。
 */

const USER_ONLY: SkillInvocationPolicy = {
  modelInvocable: false,
  userInvocable: true,
}

function loadSkill(opts: {
  name: string
  dir: string
  description: string
  whenToUse: string
}): SkillRegistration {
  const base = path.join(packageRootDir(), 'skills', opts.dir)
  return {
    name: opts.name,
    description: opts.description,
    whenToUse: opts.whenToUse,
    source: 'runtime',
    resourceBase: { kind: 'directory', path: base },
    content: fs.readFileSync(path.join(base, 'SKILL.md'), 'utf8'),
    invocation: USER_ONLY,
  }
}

export const WHALE_TANK_INIT_SKILL: SkillRegistration = loadSkill({
  name: 'whale-tank-init',
  dir: 'whale-tank-init',
  description:
    '初始化 DSH 插件项目：自动判断 init / upgrade-knowledge。当用户想从零搭建一个 DSH 插件项目，或刷新已有 whale-tank 项目的知识包时使用。',
  whenToUse: '用户要求新建 DSH 插件项目（描述需求、给目录、指定类型 host/client/both），或对已初始化项目补/升知识包时使用。',
})

export const WHALE_TANK_VET_SKILL: SkillRegistration = loadSkill({
  name: 'whale-tank-vet',
  dir: 'whale-tank-vet',
  description:
    '第三方 DSH 插件体检（vet）。当用户想在安装一个第三方插件之前先做预检时使用。',
  whenToUse: '用户提到安装/体检/审查第三方 DSH 插件，或想评估某个 npm/git/本地插件是否安全时使用。',
})

export const SKILL_REGISTRATIONS: SkillRegistration[] = [
  WHALE_TANK_INIT_SKILL,
  WHALE_TANK_VET_SKILL,
]
