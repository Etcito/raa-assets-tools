import { resolve } from 'node:path'
import { RaaError } from '../../index.ts'
import { gcPlan, storeFromEnv } from '../../node/index.ts'
import { parseArgs } from '../args.ts'
import type { ArgSpec } from '../args.ts'
import type { CliCommand, CliIo } from '../types.ts'

const spec: ArgSpec = {
  flags: { 'dry-run': 'boolean', keep: 'string[]', store: 'string', json: 'boolean', help: 'boolean' },
}

async function run(argv: string[], io: CliIo): Promise<number> {
  const { positional, flags } = parseArgs(argv, spec)
  if (positional.length > 0) {
    throw new RaaError('USAGE', `gc takes no positional argument ('${positional[0]}')`, 'run raa-assets gc --dry-run [--keep <sha256>]...')
  }
  if (flags['dry-run'] !== true) {
    throw new RaaError('GC_DELETE_UNAVAILABLE', 'deleting objects is not available', 'run raa-assets gc --dry-run')
  }
  const keep = Array.isArray(flags.keep) ? flags.keep : []
  const dir = typeof flags.store === 'string' ? resolve(io.cwd, flags.store) : undefined
  const store = storeFromEnv(io.env, { local: dir })
  const plan = await gcPlan(store, keep)
  if (flags.json === true) {
    const roots = await store.listRoots()
    const unreachable = plan.unreachable.map((o) => ({ sha256: o.sha256, size: o.size }))
    io.stdout(`${JSON.stringify({ roots, keep, reachable: plan.reachable.length, unreachable, unreachableBytes: plan.unreachableBytes }, null, 2)}\n`)
  } else {
    io.stdout(`reachable ${plan.reachable.length}\n`)
    for (const o of plan.unreachable) io.stdout(`${o.sha256} ${o.size}\n`)
    io.stdout(`unreachable ${plan.unreachable.length} objects, ${plan.unreachableBytes} bytes\n`)
  }
  return 0
}

export const command: CliCommand = {
  name: 'gc',
  summary: 'report the objects no root or kept manifest reaches',
  usage: 'raa-assets gc --dry-run [--keep <sha256>]... [--store <dir>] [--json]',
  run,
}
