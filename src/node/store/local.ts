import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { RaaError } from '../../format/errors.ts'
import { LOGICAL_NAME_RE } from '../../manifest/manifest.ts'
import { objectKey, sha256Hex } from '../hash.ts'
import { assertSize } from './types.ts'
import type { AssetStore, PutResult, StoreObject, StoreStat } from './types.ts'

const SHA_RE = /^[0-9a-f]{64}$/

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT'
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (err) {
    if (isNotFound(err)) return false
    throw err
  }
}

function tempPath(finalPath: string): string {
  return join(dirname(finalPath), `.${basename(finalPath)}.tmp.${randomBytes(6).toString('hex')}`)
}

function mismatch(sha256: string, actual: string): RaaError {
  return new RaaError(
    'OBJECT_HASH_MISMATCH',
    `object ${sha256} hashes to ${actual}`,
    'the stored bytes are corrupt; put the original file again',
  )
}

function rootName(name: string): string {
  if (!LOGICAL_NAME_RE.test(name)) {
    throw new RaaError('BAD_ROOT_NAME', `'${name}' is not a valid root name`, 'use a name matching ^[a-z][a-z0-9_.-]{0,127}$')
  }
  return name
}

async function freeBytesOf(root: string): Promise<number> {
  let dir = resolve(root)
  for (;;) {
    try {
      const s = await statfs(dir)
      return s.bavail * s.bsize
    } catch (err) {
      const parent = dirname(dir)
      if (!isNotFound(err) || parent === dir) throw err
      dir = parent
    }
  }
}

export function localStore(root: string): AssetStore {
  const objectsDir = join(root, 'objects')
  const rootsDir = join(root, 'roots')
  const objectPath = (sha256: string) => join(root, objectKey(sha256))

  async function list(): Promise<StoreObject[]> {
    let shards: string[]
    try {
      shards = await readdir(objectsDir)
    } catch (err) {
      if (isNotFound(err)) return []
      throw err
    }
    const out: StoreObject[] = []
    for (const shard of shards) {
      if (shard.startsWith('.')) continue
      const shardDir = join(objectsDir, shard)
      if (!(await stat(shardDir)).isDirectory()) continue
      for (const name of await readdir(shardDir)) {
        if (name.startsWith('.') || !SHA_RE.test(name)) continue
        const s = await stat(join(shardDir, name))
        if (s.isFile()) out.push({ sha256: name, size: s.size })
      }
    }
    return out.sort((a, b) => (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0))
  }

  return {
    kind: 'local',

    async put(data: Uint8Array): Promise<PutResult> {
      assertSize(data.byteLength)
      const sha256 = sha256Hex(data)
      const size = data.byteLength
      const key = objectKey(sha256)
      const finalPath = join(root, key)
      if (await exists(finalPath)) return { sha256, size, created: false, key }
      await mkdir(dirname(finalPath), { recursive: true })
      const tmp = tempPath(finalPath)
      try {
        await writeFile(tmp, data)
        const actual = sha256Hex(await readFile(tmp))
        if (actual !== sha256) throw mismatch(sha256, actual)
        await rename(tmp, finalPath)
      } catch (err) {
        await rm(tmp, { force: true })
        throw err
      }
      return { sha256, size, created: true, key }
    },

    async get(sha256: string): Promise<Uint8Array> {
      let buf: Buffer
      try {
        buf = await readFile(objectPath(sha256))
      } catch (err) {
        if (isNotFound(err)) {
          throw new RaaError('OBJECT_NOT_FOUND', `object ${sha256} is not in the store`, 'put the file first, or check the sha256')
        }
        throw err
      }
      const actual = sha256Hex(buf)
      if (actual !== sha256) throw mismatch(sha256, actual)
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    },

    async has(sha256: string): Promise<boolean> {
      return exists(objectPath(sha256))
    },

    list,

    async stat(): Promise<StoreStat> {
      const objects = await list()
      const bytes = objects.reduce((sum, o) => sum + o.size, 0)
      return { kind: 'local', objects: objects.length, bytes, freeBytes: await freeBytesOf(root) }
    },

    async readRoot(name: string): Promise<string | null> {
      try {
        return (await readFile(join(rootsDir, rootName(name)), 'utf8')).trim()
      } catch (err) {
        if (isNotFound(err)) return null
        throw err
      }
    },

    async writeRoot(name: string, sha256: string): Promise<void> {
      const finalPath = join(rootsDir, rootName(name))
      objectKey(sha256)
      await mkdir(rootsDir, { recursive: true })
      const tmp = tempPath(finalPath)
      try {
        await writeFile(tmp, `${sha256}\n`)
        await rename(tmp, finalPath)
      } catch (err) {
        await rm(tmp, { force: true })
        throw err
      }
    },

    async listRoots(): Promise<Record<string, string>> {
      let names: string[]
      try {
        names = await readdir(rootsDir)
      } catch (err) {
        if (isNotFound(err)) return {}
        throw err
      }
      const out: Record<string, string> = {}
      for (const name of names.sort()) {
        if (name.startsWith('.') || !LOGICAL_NAME_RE.test(name)) continue
        out[name] = (await readFile(join(rootsDir, name), 'utf8')).trim()
      }
      return out
    },
  }
}
