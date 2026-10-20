import { resolve } from 'node:path'
import { RaaError } from '../../index.ts'
import { objectKey, storeFromEnv } from '../../node/index.ts'
import { parseArgs } from '../args.ts'
import type { ArgSpec } from '../args.ts'
import type { CliCommand, CliIo } from '../types.ts'

const spec: ArgSpec = { flags: { store: 'string', json: 'boolean', help: 'boolean' } }

async function run(argv: string[], io: CliIo): Promise<number> {
  const { positional, flags } = parseArgs(argv, spec)
  if (positional.length > 1) {
    throw new RaaError('USAGE', 'stat takes at most one sha256', 'run raa-assets stat [<sha256>]')
  }
  const local = typeof flags.store === 'string' ? resolve(io.cwd, flags.store) : undefined
  const store = storeFromEnv(io.env, { local })
  if (positional.length === 0) {
    const report = await store.stat()
    if (flags.json === true) {
      io.stdout(`${JSON.stringify(report)}\n`)
    } else {
      io.stdout(`kind ${report.kind}\n`)
      io.stdout(`objects ${report.objects}\n`)
      io.stdout(`bytes ${report.bytes}\n`)
      io.stdout(`freeBytes ${report.freeBytes ?? 'unknown'}\n`)
    }
    return 0
  }
  const sha256 = positional[0]
  const key = objectKey(sha256)
  if (!(await store.has(sha256))) {
    throw new RaaError('OBJECT_NOT_FOUND', `object ${sha256} is not in the ${store.kind} store`, 'check the sha256 or put the file first')
  }
  const found = (await store.list()).find((object) => object.sha256 === sha256)
  if (found === undefined) {
    throw new RaaError('OBJECT_NOT_FOUND', `object ${sha256} is not in the local store`, 'check the sha256 or put the file first')
  }
  const size = found.size
  const present = true
  if (flags.json === true) {
    io.stdout(`${JSON.stringify({ sha256, size, key, present })}\n`)
  } else {
    io.stdout(`sha256 ${sha256}\n`)
    io.stdout(`size ${size}\n`)
    io.stdout(`key ${key}\n`)
    io.stdout(`present ${present}\n`)
  }
  return 0
}

export const command: CliCommand = {
  name: 'stat',
  summary: 'report the store (kind, objects, bytes, freeBytes) or one object',
  usage: 'raa-assets stat [<sha256>] [--store <dir>] [--json]',
  run,
}
