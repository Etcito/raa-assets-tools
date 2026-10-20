import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { objectKey, sha256Hex } from '../../src/node/hash.ts'
import { localStore } from '../../src/node/store/local.ts'
import { OBJECT_MAX_BYTES } from '../../src/node/store/types.ts'

const dirs: string[] = []
after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

async function tempRoot(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'raa-'))
  dirs.push(dir)
  return dir
}

const enc = (s: string) => new TextEncoder().encode(s)

function code(c: string) {
  return (err: unknown) => (err as { code?: string }).code === c
}

test('put then get round trip; second put is not created', async () => {
  const store = localStore(await tempRoot())
  const data = enc('hello store')
  const first = await store.put(data)
  assert.deepEqual(first, { sha256: sha256Hex(data), size: data.byteLength, created: true, key: objectKey(sha256Hex(data)) })
  assert.deepEqual(await store.get(first.sha256), data)
  assert.equal(await store.has(first.sha256), true)
  const second = await store.put(data)
  assert.deepEqual(second, { ...first, created: false })
})

test('list is sorted and hides temp files', async () => {
  const root = await tempRoot()
  const store = localStore(root)
  const blobs = ['a', 'b', 'c', 'd', 'e'].map(enc)
  for (const b of blobs) await store.put(b)
  const listed = await store.list()
  const expected = blobs.map((b) => ({ sha256: sha256Hex(b), size: 1 })).sort((x, y) => (x.sha256 < y.sha256 ? -1 : 1))
  assert.deepEqual(listed, expected)

  const hidden = enc('hidden temp bytes')
  const sha = sha256Hex(hidden)
  const shard = join(root, 'objects', sha.slice(0, 2))
  await mkdir(shard, { recursive: true })
  await writeFile(join(shard, `.${sha}.tmp.abc`), hidden)
  assert.deepEqual(await store.list(), expected)
  assert.equal(await store.has(sha), false)
  await assert.rejects(store.get(sha), code('OBJECT_NOT_FOUND'))

  const put = await store.put(hidden)
  assert.equal(put.created, true)
  assert.deepEqual(await store.get(sha), hidden)
  assert.equal((await store.list()).length, expected.length + 1)
})

test('stat counts objects and bytes', async () => {
  const store = localStore(await tempRoot())
  await store.put(enc('12345'))
  await store.put(enc('1234567890'))
  const s = await store.stat()
  assert.equal(s.kind, 'local')
  assert.equal(s.objects, 2)
  assert.equal(s.bytes, 15)
  assert.equal(typeof s.freeBytes, 'number')
  assert.ok((s.freeBytes as number) >= 0)
})

test('stat on a root that does not exist yet', async () => {
  const store = localStore(join(await tempRoot(), 'not', 'yet'))
  const s = await store.stat()
  assert.equal(s.objects, 0)
  assert.equal(s.bytes, 0)
  assert.ok((s.freeBytes as number) >= 0)
})

test('a corrupted object gives OBJECT_HASH_MISMATCH', async () => {
  const root = await tempRoot()
  const store = localStore(root)
  const { sha256 } = await store.put(enc('original'))
  await writeFile(join(root, 'objects', sha256.slice(0, 2), sha256), 'tampered')
  await assert.rejects(store.get(sha256), code('OBJECT_HASH_MISMATCH'))
})

test('an object over the cap is refused before any write', async () => {
  const root = await tempRoot()
  const store = localStore(root)
  await assert.rejects(store.put(new Uint8Array(OBJECT_MAX_BYTES + 1)), code('OBJECT_TOO_LARGE'))
  let entries: string[] = []
  try {
    entries = await readdir(join(root, 'objects'))
  } catch (err) {
    assert.equal((err as { code?: string }).code, 'ENOENT')
  }
  assert.deepEqual(entries, [])
})

test('roots: write, read, list; bad names refused', async () => {
  const store = localStore(await tempRoot())
  const a = sha256Hex('manifest a')
  const b = sha256Hex('manifest b')
  assert.equal(await store.readRoot('demo.obstacles'), null)
  assert.deepEqual(await store.listRoots(), {})
  await store.writeRoot('demo.obstacles', a)
  await store.writeRoot('demo.characters', b)
  assert.equal(await store.readRoot('demo.obstacles'), a)
  assert.deepEqual(await store.listRoots(), { 'demo.characters': b, 'demo.obstacles': a })
  await store.writeRoot('demo.obstacles', b)
  assert.equal(await store.readRoot('demo.obstacles'), b)
  await assert.rejects(store.writeRoot('Bad/Name', a), code('BAD_ROOT_NAME'))
  await assert.rejects(store.writeRoot('../escape', a), code('BAD_ROOT_NAME'))
  await assert.rejects(store.readRoot('BAD'), code('BAD_ROOT_NAME'))
  await assert.rejects(store.writeRoot('ok', 'nothex'), code('BAD_HASH'))
})
