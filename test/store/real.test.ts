import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256Hex } from '../../src/node/hash.ts'
import { localStore } from '../../src/node/store/local.ts'

const directory = process.env.RAA_ASSETS_STORE_DIR
const enabled = process.env.RAA_ASSETS_REAL_STORE === '1' && !!directory

test(
  'real local store: put, raw file verify, get, has, stat',
  { skip: enabled ? false : 'set RAA_ASSETS_REAL_STORE=1 and RAA_ASSETS_STORE_DIR to run' },
  async () => {
    const store = localStore(directory!)
    const data = new TextEncoder().encode(`raa-assets-tools real test ${new Date().toISOString()}`)
    const sha = sha256Hex(data)
    const put = await store.put(data)
    assert.equal(put.sha256, sha)
    const raw = await readFile(join(directory!, put.key))
    assert.equal(sha256Hex(raw), sha, 'raw stored file hash')
    const got = await store.get(sha)
    assert.equal(sha256Hex(got), sha, 'get bytes hash')
    assert.deepEqual(got, data)
    assert.equal(await store.has(sha), true)
    assert.equal((await store.stat()).kind, 'local')
  },
)
