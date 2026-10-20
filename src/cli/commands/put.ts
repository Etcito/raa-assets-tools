import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { RaaError } from '../../index.ts'
import { assertSize, storeFromEnv } from '../../node/index.ts'
import type { StoreStat } from '../../node/index.ts'
import { parseArgs } from '../args.ts'
import type { ArgSpec } from '../args.ts'
import type { CliCommand, CliIo } from '../types.ts'

interface PutObjectJson {
  file: string
  sha256: string
  size: number
  created: boolean
  key: string
}

const spec: ArgSpec = { flags: { store: 'string', json: 'boolean', help: 'boolean' } }

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function run(argv: string[], io: CliIo): Promise<number> {
  const { positional, flags } = parseArgs(argv, spec)
  if (positional.length === 0) {
    throw new RaaError('USAGE', 'put needs at least one file', 'run raa-assets put <file>...')
  }
  const local = typeof flags.store === 'string' ? resolve(io.cwd, flags.store) : undefined
  const store = storeFromEnv(io.env, { local })
  const objects: PutObjectJson[] = []
  for (const file of positional) {
    const path = resolve(io.cwd, file)
    let size: number
    try {
      size = (await stat(path)).size
    } catch (error) {
      throw new RaaError('FILE_READ_FAILED', `cannot stat '${file}': ${errorDetail(error)}`, 'check the path and its permissions')
    }
    // The cap is checked on the file size before any byte is read or sent.
    assertSize(size)
    let data: Uint8Array
    try {
      data = await readFile(path)
    } catch (error) {
      throw new RaaError('FILE_READ_FAILED', `cannot read '${file}': ${errorDetail(error)}`, 'check the path and its permissions')
    }
    const result = await store.put(data)
    objects.push({
      file,
      sha256: result.sha256,
      size: result.size,
      created: result.created,
      key: result.key,
    })
  }
  const storeStat: StoreStat = await store.stat()
  if (flags.json === true) {
    io.stdout(`${JSON.stringify({ objects, store: storeStat })}\n`)
  } else {
    for (const object of objects) {
      io.stdout(`${object.sha256}  ${object.size}  ${object.created ? 'created' : 'exists'}  ${object.key}\n`)
    }
    io.stdout(`store ${storeStat.kind}: ${storeStat.objects} objects, ${storeStat.bytes} bytes\n`)
  }
  return 0
}

export const command: CliCommand = {
  name: 'put',
  summary: 'store files under their sha256 (size cap, dedupe, verify)',
  usage: 'raa-assets put <file>... [--store <dir>] [--json]',
  run,
}
