import { test, after, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RaaError } from '../../src/format/errors.ts'
import { objectKey, sha256Hex } from '../../src/node/hash.ts'
import { storeFromEnv } from '../../src/node/store/open.ts'
import { STORE_DIR_DEFAULT } from '../../src/node/store/types.ts'

const dirs: string[] = []
after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})
afterEach(() => mock.restoreAll())

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'raa-'))
  dirs.push(dir)
  return dir
}

const enc = (s: string) => new TextEncoder().encode(s)

const SENTINELS = {
  ASSET_STORE_SSH: 'sentinel-user@sentinel-host.invalid',
  ASSET_STORE_KEY: '/sentinel/keys/id_sentinel_key',
  ASSET_STORE_ROOT: '/sentinel/remote-root',
  ASSET_STORE_URL: 'https://sentinel-url.invalid',
}

// The default directory is never touched: statSync is redirected so that
// STORE_DIR_DEFAULT resolves to `target` (a temp dir, or a path that does not exist).
function redirectDefault(target: string): string[] {
  const seen: string[] = []
  const real = fs.statSync
  mock.method(fs, 'statSync', ((p: fs.PathLike, ...rest: unknown[]) => {
    seen.push(String(p))
    return (real as (...a: unknown[]) => unknown)(String(p) === STORE_DIR_DEFAULT ? target : p, ...rest)
  }) as typeof fs.statSync)
  return seen
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false)
}

test('--store beats RAA_ASSETS_STORE_DIR', async () => {
  const flagDir = await tempRoot()
  const envDir = await tempRoot()
  const seen = redirectDefault(join(await tempRoot(), 'missing'))
  const store = storeFromEnv({ RAA_ASSETS_STORE_DIR: envDir }, { local: flagDir })
  const res = await store.put(enc('flag wins'))
  assert.equal(await exists(join(flagDir, res.key)), true)
  assert.deepEqual(await readdir(envDir), [])
  assert.deepEqual(seen, [], 'the default is not consulted when --store is given')
})

test('RAA_ASSETS_STORE_DIR is used when there is no --store', async () => {
  const envDir = await tempRoot()
  const seen = redirectDefault(join(await tempRoot(), 'missing'))
  const store = storeFromEnv({ RAA_ASSETS_STORE_DIR: envDir })
  const res = await store.put(enc('env used'))
  assert.equal(await exists(join(envDir, objectKey(sha256Hex(enc('env used'))))), true)
  assert.equal(res.created, true)
  assert.deepEqual(seen, [], 'the default is not consulted when the env directory is set')
})

test('the default is used only when it exists as a directory', async () => {
  const seen = redirectDefault(await tempRoot())
  const store = storeFromEnv({})
  assert.equal(store.kind, 'local')
  assert.deepEqual(seen, [STORE_DIR_DEFAULT])
  // No write: a write would go to the real default path.
})

test('a default that is a file, not a directory, gives NO_STORE', async () => {
  const root = await tempRoot()
  const file = join(root, 'not-a-dir')
  fs.writeFileSync(file, 'x\n')
  redirectDefault(file)
  assert.throws(() => storeFromEnv({}), (err: unknown) => err instanceof RaaError && err.code === 'NO_STORE')
})

test('a missing default gives NO_STORE with the fix text', async () => {
  redirectDefault(join(await tempRoot(), 'missing'))
  assert.throws(
    () => storeFromEnv({}),
    (err: unknown) =>
      err instanceof RaaError &&
      err.code === 'NO_STORE' &&
      err.message === 'no asset store is configured and the default store directory does not exist' &&
      err.fix === 'pass --store <dir> or set RAA_ASSETS_STORE_DIR',
  )
})

test('an explicit directory is created on first write', async () => {
  const base = await tempRoot()
  const flagDir = join(base, 'flag', 'nested')
  const envDir = join(base, 'env', 'nested')
  redirectDefault(join(base, 'missing'))

  const fromFlag = storeFromEnv({}, { local: flagDir })
  assert.equal(await exists(flagDir), false, 'selecting does not create the directory')
  const a = await fromFlag.put(enc('first write flag'))
  assert.equal(await exists(join(flagDir, a.key)), true)

  const fromEnv = storeFromEnv({ RAA_ASSETS_STORE_DIR: envDir })
  assert.equal(await exists(envDir), false)
  const b = await fromEnv.put(enc('first write env'))
  assert.equal(await exists(join(envDir, b.key)), true)
})

test('ASSET_STORE_* sentinels change nothing and never appear in errors', async () => {
  const flagDir = await tempRoot()
  const envDir = await tempRoot()
  redirectDefault(join(await tempRoot(), 'missing'))

  const withFlag = storeFromEnv({ ...SENTINELS, RAA_ASSETS_STORE_DIR: envDir }, { local: flagDir })
  assert.equal(withFlag.kind, 'local')
  const r1 = await withFlag.put(enc('sentinel flag'))
  assert.equal(await exists(join(flagDir, r1.key)), true)
  assert.deepEqual(await readdir(envDir), [])

  const withEnv = storeFromEnv({ ...SENTINELS, RAA_ASSETS_STORE_DIR: envDir })
  const r2 = await withEnv.put(enc('sentinel env'))
  assert.equal(await exists(join(envDir, r2.key)), true)
  assert.equal((await withEnv.stat()).kind, 'local')

  let caught: unknown
  try {
    storeFromEnv({ ...SENTINELS })
  } catch (err) {
    caught = err
  }
  assert.ok(caught instanceof RaaError && caught.code === 'NO_STORE', 'sentinels alone do not select a store')
  const text = `${caught.message}\n${caught.fix}\n${caught.stack ?? ''}`
  for (const value of Object.values(SENTINELS)) assert.equal(text.includes(value), false, value)
  for (const part of ['sentinel-host', 'id_sentinel_key', 'sentinel-url']) assert.equal(text.includes(part), false, part)
})
