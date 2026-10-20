import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { RaaError } from '../../src/format/errors.ts'
import { stagedViolations, trackedViolations } from '../../src/node/guard/git.ts'
import { classifyBlob, GUARD_BLOCKED_EXTENSIONS, GUARD_MARKER, GUARD_MAX_BYTES } from '../../src/node/guard/rules.ts'

const run = promisify(execFile)
const dirs: string[] = []

after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'raa-guard-'))
  dirs.push(dir)
  return dir
}

async function git(repo: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd: repo, encoding: 'utf8' })
  return stdout
}

async function tempRepo(): Promise<string> {
  const repo = await tempDir()
  await git(repo, 'init', '-q')
  await git(repo, 'config', 'user.name', 'raa guard test')
  await git(repo, 'config', 'user.email', 'guard@example.invalid')
  await git(repo, 'config', 'commit.gpgsign', 'false')
  return repo
}

const text = (n: number) => new Uint8Array(n).fill(0x61)
const withNul = (n: number, at: number) => {
  const bytes = text(n)
  bytes[at] = 0
  return bytes
}

test('constants match the contract', () => {
  assert.deepEqual([...GUARD_BLOCKED_EXTENSIONS], ['.glb', '.gltf', '.png', '.jpg', '.jpeg', '.avif', '.ktx2', '.bin'])
  assert.equal(GUARD_MAX_BYTES, 1048576)
  assert.equal(GUARD_MARKER, 'raa-assets-guard v1')
})

test('every blocked extension is refused, in any case', () => {
  for (const ext of GUARD_BLOCKED_EXTENSIONS) {
    for (const path of [`x${ext}`, `dir/x${ext.toUpperCase()}`]) {
      assert.deepEqual(classifyBlob(path, 3, text(3)), { path, reason: 'asset-extension', size: 3 })
    }
  }
  assert.equal(classifyBlob('a/B.PNG', 1, text(1))?.reason, 'asset-extension')
})

test('only the last extension of the basename counts', () => {
  assert.equal(classifyBlob('x.png.txt', 3, text(3)), null)
  assert.equal(classifyBlob('x.txt.png', 3, text(3))?.reason, 'asset-extension')
  assert.equal(classifyBlob('.bin', 3, text(3)), null)
  assert.equal(classifyBlob('dir/.png', 3, text(3)), null)
  assert.equal(classifyBlob('png.dir/readme', 3, text(3)), null)
  assert.equal(classifyBlob('a.ts', 3, text(3)), null)
})

test('size boundary: 1048576 allowed, 1048577 too-large', () => {
  assert.equal(classifyBlob('f.txt', 1048576, text(8000)), null)
  assert.deepEqual(classifyBlob('f.txt', 1048577, text(8000)), { path: 'f.txt', reason: 'too-large', size: 1048577 })
})

test('binary boundary: NUL at byte 7999 refused, at byte 8000 allowed', () => {
  assert.deepEqual(classifyBlob('d.dat', 9000, withNul(9000, 7999)), { path: 'd.dat', reason: 'binary', size: 9000 })
  assert.equal(classifyBlob('d.dat', 9000, withNul(9000, 8000)), null)
})

test('precedence: extension, then too-large, then binary', () => {
  const big = 2 * 1024 * 1024
  assert.equal(classifyBlob('big.png', big, withNul(8000, 0))?.reason, 'asset-extension')
  assert.equal(classifyBlob('big.dat', big, withNul(8000, 0))?.reason, 'too-large')
})

test('stagedViolations names the 3 violating staged files', async () => {
  const repo = await tempRepo()
  await writeFile(join(repo, 'fake.png'), 'not really a png\n')
  await writeFile(join(repo, 'data.dat'), new Uint8Array([0x61, 0x00, 0x62]))
  await writeFile(join(repo, 'big.txt'), text(1048577))
  await writeFile(join(repo, 'a.ts'), 'export const a = 1\n')
  await git(repo, 'add', '.')
  const violations = await stagedViolations(repo)
  assert.deepEqual(violations, [
    { path: 'big.txt', reason: 'too-large', size: 1048577 },
    { path: 'data.dat', reason: 'binary', size: 3 },
    { path: 'fake.png', reason: 'asset-extension', size: 17 },
  ])
})

test('paths are relative to the top level, also from a subdirectory', async () => {
  const repo = await tempRepo()
  await mkdir(join(repo, 'sub', 'deep'), { recursive: true })
  await writeFile(join(repo, 'sub', 'deep', 'x.GLB'), 'x')
  await git(repo, 'add', '.')
  assert.deepEqual(await stagedViolations(join(repo, 'sub')), [{ path: 'sub/deep/x.GLB', reason: 'asset-extension', size: 1 }])
})

test('a staged deletion is ignored; trackedViolations sees committed files', async () => {
  const repo = await tempRepo()
  await writeFile(join(repo, 'old.png'), 'old\n')
  await writeFile(join(repo, 'ok.txt'), 'ok\n')
  await git(repo, 'add', '.')
  await git(repo, 'commit', '-q', '--no-verify', '-m', 'seed')
  assert.deepEqual(await stagedViolations(repo), [])
  assert.deepEqual(await trackedViolations(repo), [{ path: 'old.png', reason: 'asset-extension', size: 4 }])
  await git(repo, 'rm', '-q', 'old.png')
  assert.deepEqual(await stagedViolations(repo), [])
  assert.deepEqual(await trackedViolations(repo), [])
})

test('NOT_A_REPO on a plain directory', async () => {
  const plain = await tempDir()
  for (const read of [stagedViolations, trackedViolations]) {
    await assert.rejects(read(plain), (error: unknown) => {
      assert.ok(error instanceof RaaError)
      assert.equal(error.code, 'NOT_A_REPO')
      assert.equal(error.message, `${plain} is not a git repository`)
      assert.equal(error.fix, 'pass the path of a git working tree (git init creates one)')
      return true
    })
  }
})
