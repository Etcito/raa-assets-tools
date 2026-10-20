import { resolve } from 'node:path'
import { RaaError } from '../../index.ts'
import { redactSecrets } from '../../node/index.ts'
import { GUARD_FIX_LINE, stagedViolations, trackedViolations } from '../../node/guard/index.ts'
import type { GuardViolation } from '../../node/guard/index.ts'
import { parseArgs } from '../args.ts'
import type { ArgSpec } from '../args.ts'
import type { CliCommand, CliIo } from '../types.ts'

const spec: ArgSpec = { flags: { tracked: 'boolean', json: 'boolean', help: 'boolean' } }

const OWN_EXIT_CODES: Record<string, number> = { GUARD_FOREIGN_HOOK: 1, NOT_A_REPO: 2 }

async function run(argv: string[], io: CliIo): Promise<number> {
  const { positional, flags } = parseArgs(argv, spec)
  if (positional.length > 1) {
    throw new RaaError('USAGE', 'guard-check takes at most one repository path', 'run raa-assets guard-check [<repo>] [--tracked]')
  }
  const repo = positional.length === 1 ? resolve(io.cwd, positional[0]) : io.cwd
  const mode = flags.tracked === true ? 'tracked' : 'staged'
  let violations: GuardViolation[]
  try {
    violations = mode === 'tracked' ? await trackedViolations(repo) : await stagedViolations(repo)
  } catch (error) {
    if (error instanceof RaaError && OWN_EXIT_CODES[error.code] !== undefined) {
      io.stderr(redactSecrets(`error ${error.code}: ${error.message}\n`, io.env))
      io.stderr(redactSecrets(`  fix: ${error.fix}\n`, io.env))
      return OWN_EXIT_CODES[error.code]
    }
    throw error
  }
  const count = violations.length
  if (flags.json === true) {
    io.stdout(`${JSON.stringify({ mode, count, violations })}\n`)
  } else {
    for (const v of violations) io.stdout(`  ${v.path}: ${v.reason} (${v.size} bytes)\n`)
    io.stdout(`${count} violation(s) in ${mode} files\n`)
    if (count > 0) io.stdout(`${GUARD_FIX_LINE}\n`)
  }
  return count > 0 ? 1 : 0
}

export const command: CliCommand = {
  name: 'guard-check',
  summary: 'run the git guard rules on the staged (or tracked) files',
  usage: 'raa-assets guard-check [<repo>] [--tracked] [--json]',
  run,
}
