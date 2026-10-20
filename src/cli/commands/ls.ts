import { resolve } from 'node:path'
import { RaaError } from '../../index.ts'
import { storeFromEnv } from '../../node/index.ts'
import { parseArgs } from '../args.ts'
import type { ArgSpec } from '../args.ts'
import type { CliCommand, CliIo } from '../types.ts'

const spec: ArgSpec = { flags: { store: 'string', json: 'boolean', help: 'boolean' } }

async function run(argv: string[], io: CliIo): Promise<number> {
  const { positional, flags } = parseArgs(argv, spec)
  if (positional.length > 0) {
    throw new RaaError('USAGE', 'ls takes no argument', 'run raa-assets ls [--store <dir>] [--json]')
  }
  const local = typeof flags.store === 'string' ? resolve(io.cwd, flags.store) : undefined
  const store = storeFromEnv(io.env, { local })
  const objects = (await store.list()).map((object) => ({ sha256: object.sha256, size: object.size }))
  const bytes = objects.reduce((sum, object) => sum + object.size, 0)
  if (flags.json === true) {
    io.stdout(`${JSON.stringify({ objects, count: objects.length, bytes })}\n`)
  } else {
    for (const object of objects) io.stdout(`${object.sha256} ${object.size}\n`)
    io.stdout(`total ${objects.length} objects, ${bytes} bytes\n`)
  }
  return 0
}

export const command: CliCommand = {
  name: 'ls',
  summary: 'list the stored objects sorted by sha256',
  usage: 'raa-assets ls [--store <dir>] [--json]',
  run,
}
