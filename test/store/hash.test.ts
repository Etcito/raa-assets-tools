import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256Hex, sha256File, objectKey } from '../../src/node/hash.ts'
import { redactSecrets } from '../../src/node/redact.ts'
import { assertSize } from '../../src/node/store/types.ts'

const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
const dirs: string[] = []
after(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true })
})

test('sha256Hex known vector', () => {
  assert.equal(sha256Hex('abc'), ABC)
  assert.equal(sha256Hex(new TextEncoder().encode('abc')), ABC)
})

test('sha256File matches', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'raa-'))
  dirs.push(dir)
  const file = join(dir, 'f.txt')
  await writeFile(file, 'abc')
  assert.deepEqual(await sha256File(file), { sha256: ABC, size: 3 })
})

test('objectKey', () => {
  assert.equal(objectKey(ABC), `objects/ba/${ABC}`)
  for (const bad of [ABC.toUpperCase(), ABC.slice(1)]) {
    assert.throws(() => objectKey(bad), { code: 'BAD_HASH' })
  }
})

test('assertSize', () => {
  assertSize(52428800)
  assert.throws(() => assertSize(52428801), { code: 'OBJECT_TOO_LARGE' })
})

test('redactSecrets', () => {
  const env = { ASSET_STORE_SSH: 'deploy@store.example.invalid', ASSET_STORE_KEY: '/home/u/.ssh/id_probe' }
  const text = 'dest deploy@store.example.invalid host store.example.invalid key /home/u/.ssh/id_probe base id_probe'
  const out = redactSecrets(text, env)
  for (const s of ['deploy@store', 'store.example.invalid', '/home/u', 'id_probe']) assert.ok(!out.includes(s), s)
  assert.ok(out.includes('<ASSET_STORE_SSH>') && out.includes('<ASSET_STORE_KEY>'))
  assert.equal(redactSecrets(text, {}), text)
})
