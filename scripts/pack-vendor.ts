// OPTIONAL. Packs a built copy of this package into a vendor directory for an application that
// copies the package into its own tree instead of installing it from npm. The npm package does not
// need this script. The vendor tree holds dist, schema, LICENSE, README, a reduced package.json, a
// .gitignore that re-includes dist/, and VENDOR.json (source commit and file hashes), written last.
// Usage: node scripts/pack-vendor.ts <targetDir>
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { RaaError } from '../src/format/errors.ts'
import { classifyBlob, GUARD_HEAD_BYTES, type GuardViolation } from '../src/node/guard/rules.ts'

const EXTRA_FILES = ['schema/raa.prims.v0.schema.json', 'LICENSE', 'README.md']
const PACKAGE_KEYS = ['name', 'version', 'type', 'license', 'exports', 'types', 'bin']
const GITIGNORE = '!dist/\n'

async function listFiles(root: string, rel: string): Promise<string[]> {
  const out: string[] = []
  const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true })
  for (const e of entries) {
    const child = `${rel}/${e.name}`
    if (e.isDirectory()) out.push(...(await listFiles(root, child)))
    else if (e.isFile()) out.push(child)
  }
  return out.sort()
}

function git(srcRoot: string, args: string[]): string | null {
  const r = spawnSync('git', args, { cwd: srcRoot, encoding: 'utf8' })
  return r.status === 0 ? r.stdout : null
}

function build(srcRoot: string): void {
  const tsc = path.join(srcRoot, 'node_modules', 'typescript', 'bin', 'tsc')
  const r = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { cwd: srcRoot, encoding: 'utf8' })
  if (r.status !== 0) {
    const detail = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`.trim()
    throw new RaaError('BUILD_FAILED', `tsc -p tsconfig.json failed (exit ${r.status}): ${detail}`, 'install typescript (npm install) and fix the compile errors, then pack again')
  }
}

function reducedPackageJson(raw: string): string {
  const pkg = JSON.parse(raw) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of PACKAGE_KEYS) if (pkg[key] !== undefined) out[key] = pkg[key]
  return `${JSON.stringify(out, null, 2)}\n`
}

export async function packVendor(srcRoot: string, targetDir: string, opts?: { skipBuild?: boolean }): Promise<{ files: number; commit: string }> {
  if (opts?.skipBuild !== true) {
    await fs.rm(path.join(srcRoot, 'dist'), { recursive: true, force: true })
    build(srcRoot)
  }

  // Every file to write, as relative posix path -> bytes, read before targetDir is touched.
  const contents = new Map<string, Uint8Array>()
  for (const rel of [...(await listFiles(srcRoot, 'dist')), ...EXTRA_FILES]) {
    contents.set(rel, await fs.readFile(path.join(srcRoot, ...rel.split('/'))))
  }
  const pkgRaw = await fs.readFile(path.join(srcRoot, 'package.json'), 'utf8')
  contents.set('package.json', new TextEncoder().encode(reducedPackageJson(pkgRaw)))
  contents.set('.gitignore', new TextEncoder().encode(GITIGNORE))

  const violations: GuardViolation[] = []
  for (const [rel, bytes] of contents) {
    const v = classifyBlob(rel, bytes.length, bytes.subarray(0, GUARD_HEAD_BYTES))
    if (v !== null) violations.push(v)
  }
  if (violations.length > 0) {
    const err = new RaaError('VENDOR_GUARD', `${violations.length} file(s) would be refused by the git guard`, 'remove the asset or binary files from dist/ and pack again')
    throw Object.assign(err, { violations })
  }

  const head = git(srcRoot, ['rev-parse', 'HEAD'])
  const commit = head === null ? 'unknown' : head.trim()
  const status = head === null ? null : git(srcRoot, ['status', '--porcelain'])
  const dirty = status !== null && status.trim() !== ''
  const pkg = JSON.parse(pkgRaw) as { name?: string; version?: string }

  await fs.rm(targetDir, { recursive: true, force: true })
  await fs.mkdir(targetDir, { recursive: true })
  const files: Record<string, string> = {}
  for (const rel of [...contents.keys()].sort()) {
    const bytes = contents.get(rel) as Uint8Array
    const dest = path.join(targetDir, ...rel.split('/'))
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(dest, bytes)
    files[rel] = createHash('sha256').update(bytes).digest('hex')
  }

  const vendor = { package: pkg.name, version: pkg.version, commit, dirty, builtAt: new Date().toISOString(), files }
  await fs.writeFile(path.join(targetDir, 'VENDOR.json'), `${JSON.stringify(vendor, null, 2)}\n`)
  return { files: Object.keys(files).length, commit }
}

async function main(argv: string[]): Promise<number> {
  if (argv.length !== 1 || argv[0].startsWith('-')) {
    process.stderr.write('error USAGE: expected exactly one argument\n  fix: run node scripts/pack-vendor.ts <targetDir>\n')
    return 2
  }
  const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  try {
    const r = await packVendor(srcRoot, path.resolve(argv[0]))
    process.stdout.write(`packed ${r.files} files from ${r.commit} into ${argv[0]}\n`)
    return 0
  } catch (e) {
    if (!(e instanceof RaaError)) throw e
    process.stderr.write(`error ${e.code}: ${e.message}\n`)
    const violations = (e as RaaError & { violations?: GuardViolation[] }).violations ?? []
    for (const v of violations) process.stderr.write(`  ${v.path}: ${v.reason} (${v.size} bytes)\n`)
    process.stderr.write(`  fix: ${e.fix}\n`)
    return e.code === 'VENDOR_GUARD' ? 1 : 3
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2))
}
