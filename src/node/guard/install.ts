import { execFile } from 'node:child_process'
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { RaaError } from '../../format/errors.ts'
import { hookScript } from './hook.ts'
import { repoTopLevel } from './git.ts'
import { GUARD_MARKER } from './rules.ts'

const run = promisify(execFile)

export interface InstallGuardResult {
  hookPath: string
  action: 'installed' | 'updated' | 'unchanged'
  backup: string | null
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readIfExists(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function installGuard(repo: string, opts: { force?: boolean } = {}): Promise<InstallGuardResult> {
  const top = await repoTopLevel(repo)
  const { stdout } = await run('git', ['rev-parse', '--git-path', 'hooks'], { cwd: top, encoding: 'utf8' })
  const hooks = resolve(top, stdout.replace(/\n$/, ''))
  await mkdir(hooks, { recursive: true })
  const hookPath = join(hooks, 'pre-commit')
  const script = hookScript()
  const current = await readIfExists(hookPath)
  let action: InstallGuardResult['action'] = 'installed'
  let backup: string | null = null

  if (current !== null && current.includes(GUARD_MARKER)) {
    action = current.equals(Buffer.from(script, 'utf8')) ? 'unchanged' : 'updated'
  } else if (current !== null) {
    if (opts.force !== true) {
      throw new RaaError('GUARD_FOREIGN_HOOK', `${hookPath} is not a raa-assets guard hook`, 'move it away or rerun with --force, which keeps it as pre-commit.bak-<n>')
    }
    let n = 1
    while (await exists(`${hookPath}.bak-${n}`)) n++
    backup = `${hookPath}.bak-${n}`
    await rename(hookPath, backup)
  }

  if (action !== 'unchanged') await writeFile(hookPath, script, 'utf8')
  await chmod(hookPath, 0o755)
  return { hookPath, action, backup }
}
