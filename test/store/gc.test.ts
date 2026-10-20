import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { serializeManifest } from '../../src/manifest/manifest.ts'
import { gcPlan } from '../../src/node/store/gc.ts'
import { localStore } from '../../src/node/store/local.ts'
import type { AssetStore } from '../../src/node/store/types.ts'
import * as api from '../../src/node/index.ts'

const dirs: string[] = []
after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

async function tempStore(): Promise<AssetStore> {
  const dir = await mkdtemp(join(tmpdir(), 'raa-'))
  dirs.push(dir)
  return localStore(dir)
}

const enc = (s: string) => new TextEncoder().encode(s)

function code(c: string) {
  return (err: unknown) => (err as { code?: string }).code === c
}

async function populate(store: AssetStore) {
  const a = await store.put(enc('object a'))
  const b = await store.put(enc('object b'))
  const c = await store.put(enc('object c, not referenced'))
  const text = serializeManifest({
    format: 'raa.manifest',
    version: 0,
    name: 'gc.test',
    entries: {
      'thing.a': { sha256: a.sha256, size: a.size, contentType: 'application/octet-stream', version: 1 },
      'thing.b': { sha256: b.sha256, size: b.size, contentType: 'application/octet-stream', version: 1 },
    },
  })
  const m = await store.put(enc(text))
  return { a, b, c, m }
}

test('a root manifest keeps its entries; the third object is unreachable', async () => {
  const store = await tempStore()
  const { a, b, c, m } = await populate(store)
  await store.writeRoot('main', m.sha256)
  const plan = await gcPlan(store, [])
  assert.deepEqual(plan.reachable, [a.sha256, b.sha256, m.sha256].sort())
  assert.deepEqual(plan.unreachable, [{ sha256: c.sha256, size: c.size }])
  assert.equal(plan.unreachableBytes, c.size)
})

test('keep gives the same plan as a root', async () => {
  const withRoot = await tempStore()
  const r = await populate(withRoot)
  await withRoot.writeRoot('main', r.m.sha256)
  const withKeep = await tempStore()
  const k = await populate(withKeep)
  assert.deepEqual(await gcPlan(withKeep, [k.m.sha256]), await gcPlan(withRoot, []))
  // root and keep naming the same manifest are deduplicated
  assert.deepEqual(await gcPlan(withRoot, [r.m.sha256]), await gcPlan(withRoot, []))
})

test('a root on a non-manifest object or a missing sha is refused', async () => {
  const store = await tempStore()
  const { c } = await populate(store)
  await store.writeRoot('bad', c.sha256)
  await assert.rejects(gcPlan(store, []), code('GC_ROOT_NOT_MANIFEST'))

  const other = await tempStore()
  await assert.rejects(gcPlan(other, ['f'.repeat(64)]), code('GC_ROOT_MISSING'))
  await assert.rejects(gcPlan(other, ['not-a-sha']), code('BAD_HASH'))
})

test('an empty store gives empty lists', async () => {
  const store = await tempStore()
  assert.deepEqual(await gcPlan(store, []), { reachable: [], unreachable: [], unreachableBytes: 0 })
})

test("the './node' entry exposes the store API", () => {
  for (const name of ['localStore', 'storeFromEnv', 'gcPlan', 'redactSecrets', 'sha256Hex', 'objectKey'] as const) {
    assert.equal(typeof api[name], 'function', name)
  }
  assert.equal(api.OBJECT_MAX_BYTES, 52428800)
  assert.equal(api.STORE_DIR_DEFAULT, join(homedir(), '.raa-assets', 'store'))
  for (const name of ['sshStore', 'sshArgs', 'remotePutCommand', 'fetchPublic', 'publicUrl', 'PUBLIC_BASE_DEFAULT', 'REMOTE_ROOT_DEFAULT']) {
    assert.equal(name in api, false, `${name} is not exported (local-only store)`)
  }
})
