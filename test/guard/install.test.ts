import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFile, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { RaaError } from '../../src/format/errors.ts'
import { GUARD_BLOCKED_EXTENSIONS, GUARD_MARKER, GUARD_MAX_BYTES, hookScript, installGuard } from '../../src/node/guard/index.ts'

const run = promisify(execFile)
const dirs: string[] = []

after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'raa-guard-install-'))
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

function commit(repo: string): { status: number | null; stderr: string } {
  const env = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}` }
  const result = spawnSync('git', ['commit', '-m', 'x'], { cwd: repo, env, encoding: 'utf8' })
  return { status: result.status, stderr: result.stderr }
}

const isRaaError = (code: string) => (err: unknown) => err instanceof RaaError && err.code === code

test('hookScript is a standalone node script with the rules inlined', () => {
  const script = hookScript()
  assert.ok(script.startsWith('#!/usr/bin/env node\n'))
  assert.equal(script.split('\n')[1], `// ${GUARD_MARKER} — installed by raa-assets install-guard; do not edit`)
  assert.ok(script.endsWith('\n') && !script.endsWith('\n\n'))
  assert.ok(!script.includes('\r'))
  assert.ok(script.includes(String(GUARD_MAX_BYTES)))
  for (const ext of GUARD_BLOCKED_EXTENSIONS) assert.ok(script.includes(`"${ext}"`), ext)
  const imports = [...script.matchAll(/^\s*import\b.*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1])
  assert.deepEqual(imports, ['node:child_process'])
  assert.ok(!/\bimport\s*\(/.test(script))
})

test('install, reinstall, update', async () => {
  const repo = await tempRepo()
  const first = await installGuard(repo)
  assert.equal(first.action, 'installed')
  assert.equal(first.backup, null)
  assert.equal(first.hookPath, join(await git(repo, 'rev-parse', '--show-toplevel').then((s) => s.trim()), '.git', 'hooks', 'pre-commit'))
  assert.equal((await stat(first.hookPath)).mode & 0o777, 0o755)
  assert.equal(await readFile(first.hookPath, 'utf8'), hookScript())

  const again = await installGuard(repo)
  assert.equal(again.action, 'unchanged')
  assert.equal((await stat(again.hookPath)).mode & 0o777, 0o755)

  await writeFile(first.hookPath, `#!/usr/bin/env node\n// ${GUARD_MARKER} old version\n`, { mode: 0o644 })
  const updated = await installGuard(repo)
  assert.equal(updated.action, 'updated')
  assert.equal(await readFile(first.hookPath, 'utf8'), hookScript())
  assert.equal((await stat(first.hookPath)).mode & 0o777, 0o755)
})

test('a foreign hook is refused without force and backed up with force', async () => {
  const repo = await tempRepo()
  const hookPath = join(repo, '.git', 'hooks', 'pre-commit')
  const foreign = '#!/bin/sh\necho mine\n'
  await writeFile(hookPath, foreign)
  await assert.rejects(installGuard(repo), isRaaError('GUARD_FOREIGN_HOOK'))
  assert.equal(await readFile(hookPath, 'utf8'), foreign)

  const forced = await installGuard(repo, { force: true })
  assert.equal(forced.action, 'installed')
  assert.equal(forced.backup, `${forced.hookPath}.bak-1`)
  assert.equal(await readFile(forced.backup, 'utf8'), foreign)
  assert.equal(await readFile(forced.hookPath, 'utf8'), hookScript())

  const second = '#!/bin/sh\necho second\n'
  await writeFile(forced.hookPath, second)
  const forcedAgain = await installGuard(repo, { force: true })
  assert.equal(forcedAgain.backup, `${forced.hookPath}.bak-2`)
  assert.equal(await readFile(`${forced.hookPath}.bak-2`, 'utf8'), second)
  assert.equal(await readFile(forced.backup, 'utf8'), foreign)
})

test('NOT_A_REPO on a plain directory', async () => {
  const dir = await tempDir()
  await assert.rejects(installGuard(dir), isRaaError('NOT_A_REPO'))
})

test('the installed hook refuses an asset and lets an ordinary commit through', async () => {
  const repo = await tempRepo()
  await writeFile(join(repo, 'README.md'), 'start\n')
  await git(repo, 'add', 'README.md')
  await git(repo, 'commit', '-q', '-m', 'start')
  await installGuard(repo)
  const head = (await git(repo, 'rev-parse', 'HEAD')).trim()

  await writeFile(join(repo, 'fake.png'), 'not really a png\n')
  await git(repo, 'add', 'fake.png')
  const refused = commit(repo)
  assert.notEqual(refused.status, 0)
  assert.match(refused.stderr, /raa-assets-guard: commit refused, 1 file\(s\) must not enter git:/)
  assert.ok(refused.stderr.includes('  fake.png: asset-extension (17 bytes)'), refused.stderr)
  assert.ok(refused.stderr.includes('put it in the asset store (raa-assets put <path>) and reference its sha256; see docs/private-assets.md'))
  assert.equal((await git(repo, 'rev-parse', 'HEAD')).trim(), head)

  await git(repo, 'rm', '-q', '--cached', 'fake.png')
  await writeFile(join(repo, 'a.ts'), 'export const a = 1\n')
  await git(repo, 'add', 'a.ts')
  const ok = commit(repo)
  assert.equal(ok.status, 0, ok.stderr)
  assert.notEqual((await git(repo, 'rev-parse', 'HEAD')).trim(), head)
})
