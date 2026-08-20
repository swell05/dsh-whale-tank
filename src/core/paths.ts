import fs from 'node:fs'
import path from 'node:path'

/** All sandbox layout paths derive from the project root (design §5). */

export const SANDBOX_DIR_NAME = '.sandbox'
export const DSH_HOME_DIR_NAME = 'dsh-home'
export const STATE_FILE_NAME = 'state.json'
export const SNAPSHOTS_DIR_NAME = 'snapshots'
export const DSH_INSTALL_DIR_NAME = 'dsh-install'
export const VETTING_DIR_NAME = '.vetting'

export function sandboxRoot(project: string): string {
  return path.join(project, SANDBOX_DIR_NAME)
}

export function dshHomeDir(project: string): string {
  return path.join(sandboxRoot(project), DSH_HOME_DIR_NAME)
}

/** Vet sandbox uses `<vetDir>/dsh-home` directly (design §5.3). */
export function dshHomeDirFor(sandboxRootPath: string): string {
  return path.join(sandboxRootPath, DSH_HOME_DIR_NAME)
}

export function profileDirFor(sandboxRootPath: string, profile: string): string {
  return path.join(dshHomeDirFor(sandboxRootPath), 'profiles', profile)
}

export function sessionsDirFor(sandboxRootPath: string): string {
  return path.join(dshHomeDirFor(sandboxRootPath), 'sessions')
}

export function statePath(project: string): string {
  return path.join(sandboxRoot(project), STATE_FILE_NAME)
}

export function snapshotsDir(project: string): string {
  return path.join(sandboxRoot(project), SNAPSHOTS_DIR_NAME)
}

export function snapshotsDirFor(sandboxRootPath: string): string {
  return path.join(sandboxRootPath, SNAPSHOTS_DIR_NAME)
}

export function dshInstallDir(project: string): string {
  return path.join(sandboxRoot(project), DSH_INSTALL_DIR_NAME)
}

export function profileDir(project: string, profile: string): string {
  return path.join(dshHomeDir(project), 'profiles', profile)
}

export function sessionsDir(project: string): string {
  return path.join(dshHomeDir(project), 'sessions')
}

/** Vetting sandbox lives under the invoking workspace (design §5.3). */
export function vettingDir(workspace: string, pkg: string, version: string | null): string {
  const tag = version ? `${pkg}-${version}` : pkg
  return path.join(workspace, VETTING_DIR_NAME, tag)
}

export function standaloneDshEntry(project: string): string {
  return path.join(
    dshInstallDir(project),
    'node_modules',
    '@deepseek-ai',
    'dsh',
    'lib',
    'bin.js',
  )
}

export function profileManifestPath(project: string, profile: string): string {
  return path.join(profileDir(project, profile), 'package.json')
}

/**
 * Locate the package's templates/ directory across layouts:
 * - bundled chunks live in lib/ → templates is one level up;
 * - source files live in src/core/ → templates is two levels up;
 * - fall back to cwd for direct-script invocation.
 */
export function packageTemplatesDir(): string {
  const candidates = [
    path.join(import.meta.dirname, '..', 'templates'),
    path.join(import.meta.dirname, '..', '..', 'templates'),
    path.join(process.cwd(), 'templates'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error('找不到 templates/ 目录（构建产物或源码布局异常）。')
}

/** Package root: the parent of templates/ (source and built layouts both work). */
export function packageRootDir(): string {
  return path.dirname(packageTemplatesDir())
}
