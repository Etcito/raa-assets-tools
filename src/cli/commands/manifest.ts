import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { RaaError } from '../../index.ts'
import { contentTypeFor, parseManifest, serializeManifest } from '../../manifest/index.ts'
import type { ManifestEntry, RaaManifest } from '../../manifest/index.ts'
import { assertSize, storeFromEnv } from '../../node/index.ts'
import type { AssetStore } from '../../node/index.ts'
import { parseArgs } from '../args.ts'
import type { ArgSpec } from '../args.ts'
import type { CliCommand, CliIo } from '../types.ts'

const spec: ArgSpec = {
  flags: { name: 'string', show: 'string', root: 'string', store: 'string', json: 'boolean', help: 'boolean' },
}

const USAGE_FIX = 'run raa-assets manifest --name <name> <logical>=<file>[@<version>]... or raa-assets manifest --show <sha256>'

interface EntrySpec {
  logical: string
  file: string
  version: number
}

function parseSpec(text: string): EntrySpec {
  const eq = text.indexOf('=')
  if (eq <= 0) throw new RaaError('USAGE', `'${text}' is not <logical>=<file>[@<version>]`, USAGE_FIX)
  const logical = text.slice(0, eq)
  let file = text.slice(eq + 1)
  let version = 1
  const at = /^(.*)@(\d+)$/.exec(file)
  if (at !== null) {
    file = at[1]
    version = Number(at[2])
  }
  if (file === '') throw new RaaError('USAGE', `'${text}' has no file`, USAGE_FIX)
  return { logical, file, version }
}

function openStore(flags: Record<string, boolean | string | string[]>, io: CliIo): AssetStore {
  const dir = typeof flags.store === 'string' ? resolve(io.cwd, flags.store) : undefined
  return storeFromEnv(io.env, { local: dir })
}

async function readInput(path: string): Promise<Uint8Array> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new RaaError('FILE_READ_FAILED', `cannot read '${path}': ${detail}`, 'check the path and its permissions')
  }
  assertSize(size)
  try {
    return new Uint8Array(await readFile(path))
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new RaaError('FILE_READ_FAILED', `cannot read '${path}': ${detail}`, 'check the path and its permissions')
  }
}

async function build(name: string, specs: EntrySpec[], root: string | null, io: CliIo, store: AssetStore, json: boolean): Promise<number> {
  const entries: Record<string, ManifestEntry> = {}
  for (const entry of specs) {
    const data = await readInput(resolve(io.cwd, entry.file))
    const put = await store.put(data)
    entries[entry.logical] = { sha256: put.sha256, size: put.size, contentType: contentTypeFor(entry.file), version: entry.version }
  }
  const manifest: RaaManifest = { format: 'raa.manifest', version: 0, name, entries }
  const text = serializeManifest(manifest)
  const put = await store.put(new TextEncoder().encode(text))
  if (root !== null) await store.writeRoot(root, put.sha256)
  if (json) {
    io.stdout(`${JSON.stringify({ name, sha256: put.sha256, size: put.size, key: put.key, root, entries }, null, 2)}\n`)
  } else {
    io.stdout(`manifest ${put.sha256}  ${put.size}  ${put.key}\n`)
    for (const logical of Object.keys(entries).sort()) {
      const e = entries[logical]
      io.stdout(`  ${logical} ${e.sha256} ${e.size} ${e.contentType} v${e.version}\n`)
    }
  }
  return 0
}

async function show(sha256: string, io: CliIo, store: AssetStore, json: boolean): Promise<number> {
  const parsed = parseManifest(new TextDecoder().decode(await store.get(sha256)))
  if (!parsed.ok || parsed.manifest === null) {
    const first = parsed.issues[0]
    throw new RaaError(
      'MANIFEST_INVALID',
      `object ${sha256} is not a valid raa.manifest: ${first.code} ${first.path}: ${first.message}`,
      'pass the sha256 of a manifest object',
    )
  }
  if (json) {
    io.stdout(`${JSON.stringify({ sha256, manifest: parsed.manifest }, null, 2)}\n`)
  } else {
    io.stdout(serializeManifest(parsed.manifest))
  }
  return 0
}

async function run(argv: string[], io: CliIo): Promise<number> {
  const { positional, flags } = parseArgs(argv, spec)
  const json = flags.json === true
  if (typeof flags.show === 'string') {
    if (flags.name !== undefined || flags.root !== undefined || positional.length > 0) {
      throw new RaaError('USAGE', 'manifest --show takes only a sha256', USAGE_FIX)
    }
    return show(flags.show, io, openStore(flags, io), json)
  }
  if (typeof flags.name !== 'string') throw new RaaError('USAGE', 'manifest needs --name <name> or --show <sha256>', USAGE_FIX)
  if (positional.length === 0) throw new RaaError('USAGE', 'manifest needs at least one <logical>=<file>', USAGE_FIX)
  const specs = positional.map(parseSpec)
  const seen = new Set<string>()
  for (const entry of specs) {
    if (seen.has(entry.logical)) throw new RaaError('USAGE', `logical name '${entry.logical}' is given twice`, USAGE_FIX)
    seen.add(entry.logical)
  }
  const root = typeof flags.root === 'string' ? flags.root : null
  return build(flags.name, specs, root, io, openStore(flags, io), json)
}

export const command: CliCommand = {
  name: 'manifest',
  summary: 'build and put a manifest, or show one',
  usage: 'raa-assets manifest --name <name> <logical>=<file>[@<version>]... [--root <rootName>] [--store <dir>] [--json]\n       raa-assets manifest --show <sha256> [--store <dir>] [--json]',
  run,
}
