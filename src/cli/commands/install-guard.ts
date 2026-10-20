import { resolve } from 'node:path'
import { RaaError } from '../../index.ts'
import { redactSecrets } from '../../node/index.ts'
import { installGuard } from '../../node/guard/index.ts'
import { parseArgs } from '../args.ts'
import type { ArgSpec } from '../args.ts'
import type { CliCommand, CliIo } from '../types.ts'

const spec: ArgSpec = { flags: { force: 'boolean', json: 'boolean', help: 'boolean' } }

const OWN_EXIT_CODES: Record<string, number> = { GUARD_FOREIGN_HOOK: 1, NOT_A_REPO: 2 }

async function run(argv: string[], io: CliIo): Promise<number> {
  const { positional, flags } = parseArgs(argv, spec)
  if (positional.length !== 1) {
    throw new RaaError('USAGE', 'install-guard takes exactly one repository path', 'run raa-assets install-guard <repo> [--force]')
  }
  const repo = resolve(io.cwd, positional[0])
  let result
  try {
    result = await installGuard(repo, { force: flags.force === true })
  } catch (error) {
    if (error instanceof RaaError && OWN_EXIT_CODES[error.code] !== undefined) {
      io.stderr(redactSecrets(`error ${error.code}: ${error.message}\n`, io.env))
      io.stderr(redactSecrets(`  fix: ${error.fix}\n`, io.env))
      return OWN_EXIT_CODES[error.code]
    }
    throw error
  }
  const { hookPath, action, backup } = result
  if (flags.json === true) {
    io.stdout(`${JSON.stringify({ hookPath, action, backup })}\n`)
  } else {
    io.stdout(`${action}  ${hookPath}\n`)
    if (backup !== null) io.stdout(`backup  ${backup}\n`)
  }
  return 0
}

export const command: CliCommand = {
  name: 'install-guard',
  summary: 'install the pre-commit guard that keeps assets and binaries out of git',
  usage: 'raa-assets install-guard <repo> [--force] [--json]',
  run,
}
