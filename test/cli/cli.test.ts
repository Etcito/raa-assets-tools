import { test, before, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { main } from '../../src/cli/main.ts'
import { STORE_DIR_DEFAULT } from '../../src/node/store/types.ts'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = fileURLToPath(new URL('../../', import.meta.url))
const MAIN = join(REPO, 'src', 'cli', 'main.ts')

// The child never sees a store from the environment, so no test can reach the real store.
const ENV: Record<string, string | undefined> = { ...process.env }
for (const name of ['ASSET_STORE_SSH', 'ASSET_STORE_KEY', 'ASSET_STORE_ROOT', 'ASSET_STORE_URL', 'RAA_ASSETS_STORE_DIR']) {
  delete ENV[name]
}

interface Run {
  status: number | null
  stdout: string
  stderr: string
}

function cli(...args: string[]): Run {
  const r = spawnSync(process.execPath, [MAIN, ...args], { cwd: REPO, env: ENV, encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

function json(r: Run): any {
  assert.ok(r.stdout.endsWith('\n'), `stdout ends with a newline: ${r.stdout}`)
  return JSON.parse(r.stdout)
}

let work = ''
let store = ''
let fileA = ''
let fileB = ''
let fileExtra = ''

before(async () => {
  work = await mkdtemp(join(tmpdir(), 'raa-cli-'))
  store = join(work, 'store')
  fileA = join(work, 'a.json')
  fileB = join(work, 'b.txt')
  fileExtra = join(work, 'extra.bin')
  await writeFile(fileA, '{"a": 1}\n')
  await writeFile(fileB, 'plain text b\n')
  await writeFile(fileExtra, 'extra object, not in any manifest\n')
})

after(async () => {
  await rm(work, { recursive: true, force: true })
})

const sha = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex')

test('--help lists the commands; unknown command and missing store exit 2', async () => {
  const help = cli('--help')
  assert.equal(help.status, 0)
  for (const name of ['put', 'get', 'ls', 'stat', 'manifest', 'gc', 'validate']) {
    assert.match(help.stdout, new RegExp(`^  ${name}  `, 'm'), name)
  }
  assert.equal(cli('frobnicate').status, 2)
  // Simulate unavailable defaults without accessing the host store directory.
  for (const code of ['ENOENT', 'ENOTDIR', 'EACCES']) {
    const checked: unknown[] = []
    const stat = mock.method(fs, 'statSync', (path: unknown) => {
      checked.push(path)
      throw Object.assign(new Error('unavailable default'), { code })
    })
    let stderr = ''
    try {
      const status = await main(['ls'], { env: ENV, cwd: REPO, stdout: () => {}, stderr: s => { stderr += s } })
      assert.deepEqual(checked, [STORE_DIR_DEFAULT])
      assert.equal(status, 2, code)
      assert.match(stderr, /error NO_STORE: no asset store is configured and the default store directory does not exist/)
      assert.match(stderr, /fix: pass --store <dir> or set RAA_ASSETS_STORE_DIR/)
    } finally {
      stat.mock.restore()
    }
  }
})

test('put, get, ls, stat, manifest, gc and the size cap on one store', async (t) => {
  await t.test('put twice: created then exists', () => {
    const first = cli('put', fileA, fileB, '--store', store, '--json')
    assert.equal(first.status, 0, first.stderr)
    const j1 = json(first)
    assert.equal(j1.objects.length, 2)
    for (const o of j1.objects) {
      assert.deepEqual(Object.keys(o).sort(), ['created', 'file', 'key', 'sha256', 'size'])
      assert.equal(o.created, true)
      assert.equal(o.key, `objects/${o.sha256.slice(0, 2)}/${o.sha256}`)
    }
    assert.equal(j1.store.kind, 'local')
    assert.equal(j1.store.objects, 2)
    const again = cli('put', fileA, fileB, '--store', store)
    assert.equal(again.status, 0, again.stderr)
    const lines = again.stdout.trimEnd().split('\n')
    assert.equal(lines.length, 3)
    assert.match(lines[0], /^[0-9a-f]{64} {2}\d+ {2}exists {2}objects\/[0-9a-f]{2}\/[0-9a-f]{64}$/)
    assert.match(lines[1], /^[0-9a-f]{64} {2}\d+ {2}exists {2}objects\/[0-9a-f]{2}\/[0-9a-f]{64}$/)
    assert.match(lines[2], /^store local: 2 objects, \d+ bytes$/)
    const j2 = json(cli('put', fileA, '--store', store, '--json'))
    assert.equal(j2.objects[0].created, false)
  })

  await t.test('get -o gives identical bytes; absent and bad hashes', async () => {
    const source = await readFile(fileA)
    const out = join(work, 'out', 'x')
    const r = cli('get', sha(source), '-o', out, '--store', store, '--json')
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(json(r), { sha256: sha(source), size: source.byteLength, file: out })
    assert.deepEqual(await readFile(out), source)
    const absent = cli('get', '0'.repeat(64), '--store', store)
    assert.equal(absent.status, 3)
    assert.match(absent.stderr, /error OBJECT_NOT_FOUND/)
    const bad = cli('get', 'xyz', '--store', store)
    assert.equal(bad.status, 2)
    assert.match(bad.stderr, /error BAD_HASH/)
  })

  await t.test('ls and stat --json', async () => {
    const a = await readFile(fileA)
    const b = await readFile(fileB)
    const ls = json(cli('ls', '--store', store, '--json'))
    assert.deepEqual(Object.keys(ls).sort(), ['bytes', 'count', 'objects'])
    assert.equal(ls.count, 2)
    assert.equal(ls.bytes, a.byteLength + b.byteLength)
    assert.deepEqual(ls.objects, [
      { sha256: sha(a), size: a.byteLength },
      { sha256: sha(b), size: b.byteLength },
    ].sort((x, y) => (x.sha256 < y.sha256 ? -1 : 1)))
    const st = json(cli('stat', '--store', store, '--json'))
    assert.deepEqual(Object.keys(st).sort(), ['bytes', 'freeBytes', 'kind', 'objects'])
    assert.equal(st.kind, 'local')
    assert.equal(st.objects, 2)
    assert.equal(st.bytes, ls.bytes)
    assert.equal(typeof st.freeBytes, 'number')
    const one = json(cli('stat', sha(a), '--store', store, '--json'))
    assert.deepEqual(one, { sha256: sha(a), size: a.byteLength, key: `objects/${sha(a).slice(0, 2)}/${sha(a)}`, present: true })
  })

  let manifestSha = ''
  let entries: Record<string, { sha256: string; size: number; contentType: string; version: number }> = {}

  await t.test('manifest --root and --show', async () => {
    const r = cli('manifest', '--name', 'm2.test', `a.one=${fileA}`, `b.two=${fileB}@3`, '--root', 'main', '--store', store, '--json')
    assert.equal(r.status, 0, r.stderr)
    const m = json(r)
    assert.deepEqual(Object.keys(m).sort(), ['entries', 'key', 'name', 'root', 'sha256', 'size'])
    assert.equal(m.name, 'm2.test')
    assert.equal(m.root, 'main')
    assert.equal(m.key, `objects/${m.sha256.slice(0, 2)}/${m.sha256}`)
    manifestSha = m.sha256
    entries = m.entries
    const stored = await readFile(join(store, 'objects', manifestSha.slice(0, 2), manifestSha))
    assert.equal(sha(stored), manifestSha)
    assert.equal(stored.byteLength, m.size)
    assert.equal(entries['a.one'].version, 1)
    assert.equal(entries['a.one'].contentType, 'application/json')
    assert.equal(entries['b.two'].version, 3)
    assert.equal(entries['b.two'].contentType, 'application/octet-stream')
    const listed = new Set(json(cli('ls', '--store', store, '--json')).objects.map((o: { sha256: string }) => o.sha256))
    assert.ok(listed.has(manifestSha))
    for (const e of Object.values(entries)) assert.ok(listed.has(e.sha256), e.sha256)
    const shown = cli('manifest', '--show', manifestSha, '--store', store, '--json')
    assert.equal(shown.status, 0, shown.stderr)
    const s = json(shown)
    assert.equal(s.sha256, manifestSha)
    assert.deepEqual(s.manifest.entries, entries)
    assert.equal(s.manifest.name, 'm2.test')
  })

  await t.test('gc --dry-run before and after an extra object; gc without --dry-run', async () => {
    const r1 = cli('gc', '--dry-run', '--store', store, '--json')
    assert.equal(r1.status, 0, r1.stderr)
    const g1 = json(r1)
    assert.deepEqual(g1.roots, { main: manifestSha })
    assert.deepEqual(g1.keep, [])
    assert.equal(g1.reachable, 3)
    assert.deepEqual(g1.unreachable, [])
    assert.equal(g1.unreachableBytes, 0)
    assert.equal(cli('put', fileExtra, '--store', store).status, 0)
    const extra = await readFile(fileExtra)
    const g2 = json(cli('gc', '--dry-run', '--store', store, '--json'))
    assert.deepEqual(g2.unreachable, [{ sha256: sha(extra), size: extra.byteLength }])
    assert.equal(g2.unreachableBytes, extra.byteLength)
    const del = cli('gc', '--store', store)
    assert.equal(del.status, 2)
    assert.match(del.stderr, /error GC_DELETE_UNAVAILABLE/)
  })

  await t.test('a 52428801-byte file is refused and nothing is stored', async () => {
    const before = json(cli('ls', '--store', store, '--json')).count
    const big = join(work, 'big')
    await writeFile(big, '')
    await truncate(big, 52428801)
    const r = cli('put', big, '--store', store)
    assert.equal(r.status, 1)
    assert.match(r.stderr, /error OBJECT_TOO_LARGE/)
    assert.equal(json(cli('ls', '--store', store, '--json')).count, before)
  })
})

test('validate: a valid fixture passes, a refused fixture lists its codes', async () => {
  const expected = JSON.parse(await readFile(join(REPO, 'fixtures', 'expected.json'), 'utf8'))
  const validName = 'sphere-spawn.raa.prims.json'
  const ok = cli('validate', join('fixtures', 'valid', validName), '--json')
  assert.equal(ok.status, 0, ok.stderr)
  const okFile = json(ok).files[0]
  assert.equal(okFile.ok, true)
  assert.equal(okFile.triangles, expected.valid[validName].triangles)
  assert.equal(typeof okFile.budget, 'number')
  assert.deepEqual(okFile.issues, [])
  const refusedName = 'bool_nested.json'
  const bad = cli('validate', join('fixtures', 'refused', refusedName), '--json')
  assert.equal(bad.status, 1)
  const badFile = json(bad).files[0]
  assert.equal(badFile.ok, false)
  assert.deepEqual([...new Set(badFile.issues.map((i: { code: string }) => i.code))].sort(), [...expected.refused[refusedName].codes].sort())
})

test('an unknown flag exits 2 with USAGE', () => {
  const r = cli('ls', '--bogus', '--store', store)
  assert.equal(r.status, 2)
  assert.match(r.stderr, /error USAGE/)
})
