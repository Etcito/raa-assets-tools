import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { RaaError } from '../../index.ts'
import { storeFromEnv } from '../../node/index.ts'
import { parseArgs } from '../args.ts'
import type { ArgSpec } from '../args.ts'
import type { CliCommand, CliIo } from '../types.ts'

const spec: ArgSpec = { flags: { out: 'string', store: 'string', json: 'boolean', help: 'boolean' } }

async function run(argv: string[], io: CliIo): Promise<number> {
  const { positional, flags } = parseArgs(argv, spec)
  if (positional.length !== 1) {
    throw new RaaError('USAGE', 'get needs exactly one sha256', 'run raa-assets get <sha256> [-o <file>]')
  }
  const sha256 = positional[0]
  const local = typeof flags.store === 'string' ? resolve(io.cwd, flags.store) : undefined
  const store = storeFromEnv(io.env, { local })
  const bytes = await store.get(sha256)
  if (typeof flags.out !== 'string') {
    // Raw object bytes go straight to process.stdout, bypassing io.stdout: CliIo only carries
    // text, and a string round trip would corrupt binary content.
    process.stdout.write(bytes)
    return 0
  }
  const file = flags.out
  const path = resolve(io.cwd, file)
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new RaaError('FILE_WRITE_FAILED', `cannot write '${file}': ${detail}`, 'check the output path and its permissions')
  }
  if (flags.json === true) {
    io.stdout(`${JSON.stringify({ sha256, size: bytes.byteLength, file })}\n`)
  } else {
    io.stdout(`${sha256}  ${bytes.byteLength}  ${file}\n`)
  }
  return 0
}

export const command: CliCommand = {
  name: 'get',
  summary: 'fetch an object by sha256 and verify its hash',
  usage: 'raa-assets get <sha256> [-o|--out <file>] [--store <dir>] [--json]',
  run,
}
