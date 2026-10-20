import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { packVendor } from '../../scripts/pack-vendor.ts'

const tmpDirs: string[] = []
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true })
})

async function tmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'raa-pack-vendor-'))
  tmpDirs.push(d)
  return d
}

async function put(root: string, rel: string, content: string | Uint8Array): Promise<void> {
  const p = path.join(root, rel)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, content)
}

async function fakeSrc(): Promise<string> {
  const src = await tmp()
  await put(src, 'dist/index.js', 'export const x = 1\n')
  await put(src, 'dist/sub/a.d.ts', 'export declare const a: number\n')
  await put(src, 'schema/raa.prims.v0.schema.json', '{}\n')
  await put(src, 'LICENSE', 'MIT\n')
  await put(src, 'README.md', '# readme\n')
  const pkg = {
    name: '@etcito/raa-assets-tools', version: '0.1.0', type: 'module', license: 'MIT', private: true,
    exports: { '.': './dist/index.js' }, bin: { 'raa-assets': './dist/cli/main.js' },
    scripts: { build: 'tsc' }, devDependencies: { typescript: '^6.0.3' },
  }
  await put(src, 'package.json', JSON.stringify(pkg, null, 2))
  return src
}

const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')
const EXPECTED = ['.gitignore', 'LICENSE', 'README.md', 'dist/index.js', 'dist/sub/a.d.ts', 'package.json', 'schema/raa.prims.v0.schema.json']

test('packVendor writes the vendor tree and VENDOR.json, replacing the target', async () => {
  const src = await fakeSrc()
  const target = path.join(await tmp(), 'vendor')
  const first = await packVendor(src, target, { skipBuild: true })
  assert.equal(first.files, EXPECTED.length)
  assert.equal(first.commit, 'unknown')

  await put(target, 'stale.txt', 'old\n')
  const second = await packVendor(src, target, { skipBuild: true })
  assert.equal(second.files, EXPECTED.length)
  await assert.rejects(fs.stat(path.join(target, 'stale.txt')), { code: 'ENOENT' })

  const vendor = JSON.parse(await fs.readFile(path.join(target, 'VENDOR.json'), 'utf8'))
  assert.deepEqual(Object.keys(vendor), ['package', 'version', 'commit', 'dirty', 'builtAt', 'files'])
  assert.equal(vendor.package, '@etcito/raa-assets-tools')
  assert.equal(vendor.version, '0.1.0')
  assert.equal(vendor.dirty, false)
  assert.deepEqual(Object.keys(vendor.files), EXPECTED)
  for (const rel of EXPECTED) {
    assert.equal(vendor.files[rel], sha(await fs.readFile(path.join(target, rel))), rel)
  }

  const pkgText = await fs.readFile(path.join(target, 'package.json'), 'utf8')
  assert.ok(pkgText.endsWith('}\n'))
  const pkg = JSON.parse(pkgText)
  assert.deepEqual(Object.keys(pkg), ['name', 'version', 'type', 'license', 'exports', 'bin'])
  assert.equal(pkg.scripts, undefined)
  assert.equal(pkg.devDependencies, undefined)
  assert.equal(await fs.readFile(path.join(target, '.gitignore'), 'utf8'), '!dist/\n')
})

test('packVendor refuses a guarded file and leaves the target untouched', async () => {
  const src = await fakeSrc()
  await put(src, 'dist/logo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0]))
  const target = path.join(await tmp(), 'vendor')
  await put(target, 'keep.txt', 'keep\n')
  await assert.rejects(packVendor(src, target, { skipBuild: true }), { code: 'VENDOR_GUARD' })
  assert.deepEqual(await fs.readdir(target), ['keep.txt'])
})
