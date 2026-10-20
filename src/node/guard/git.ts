import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { RaaError } from '../../format/errors.ts'
import { classifyBlob, GUARD_HEAD_BYTES, GUARD_MAX_BYTES, isBlockedExtension } from './rules.ts'
import type { GuardViolation } from './rules.ts'

const run = promisify(execFile)

export async function repoTopLevel(repo: string): Promise<string> {
  try {
    const { stdout } = await run('git', ['rev-parse', '--show-toplevel'], { cwd: repo, encoding: 'utf8' })
    return stdout.replace(/\n$/, '')
  } catch {
    throw new RaaError('NOT_A_REPO', `${repo} is not a git repository`, 'pass the path of a git working tree (git init creates one)')
  }
}

async function git(top: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd: top, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  return stdout
}

function splitNul(text: string): string[] {
  return text.split('\0').filter((part) => part !== '')
}

async function classifyIndexPath(top: string, path: string): Promise<GuardViolation | null> {
  const size = Number((await git(top, ['cat-file', '-s', `:${path}`])).trim())
  let head: Uint8Array = new Uint8Array(0)
  if (!isBlockedExtension(path) && size <= GUARD_MAX_BYTES) {
    const { stdout } = await run('git', ['cat-file', 'blob', `:${path}`], { cwd: top, encoding: 'buffer', maxBuffer: GUARD_MAX_BYTES + 1 })
    head = new Uint8Array(stdout.buffer, stdout.byteOffset, Math.min(stdout.length, GUARD_HEAD_BYTES))
  }
  return classifyBlob(path, size, head)
}

async function classifyAll(top: string, paths: string[]): Promise<GuardViolation[]> {
  const violations: GuardViolation[] = []
  for (const path of paths) {
    const violation = await classifyIndexPath(top, path)
    if (violation !== null) violations.push(violation)
  }
  return violations
}

export async function stagedViolations(repo: string): Promise<GuardViolation[]> {
  const top = await repoTopLevel(repo)
  const paths = splitNul(await git(top, ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRT']))
  return classifyAll(top, paths)
}

export async function trackedViolations(repo: string): Promise<GuardViolation[]> {
  const top = await repoTopLevel(repo)
  const paths: string[] = []
  for (const entry of splitNul(await git(top, ['ls-files', '-z', '-s']))) {
    // '<mode> <object> <stage>\t<path>'; gitlinks (submodules) have no blob to read.
    const tab = entry.indexOf('\t')
    const mode = entry.slice(0, entry.indexOf(' '))
    if (mode === '160000') continue
    const path = entry.slice(tab + 1)
    // An unmerged path appears once per stage; it is checked once.
    if (paths[paths.length - 1] !== path) paths.push(path)
  }
  return classifyAll(top, paths)
}
