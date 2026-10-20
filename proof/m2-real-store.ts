// Real local-store round trip: writes evidence/m2-real-store.json.
// RAA_ASSETS_STORE_DIR=<dir> node proof/m2-real-store.ts   or   node proof/m2-real-store.ts --store <dir>
// It never falls back to the default store directory.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RaaError } from '../src/index.ts';
import { objectKey, redactSecrets, sha256File, STORE_DIR_DEFAULT } from '../src/node/index.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI = 'src/cli/main.ts';
const EVIDENCE = join(ROOT, 'evidence', 'm2-real-store.json');
const STORE_ENV = ['ASSET_STORE_SSH', 'ASSET_STORE_KEY', 'ASSET_STORE_ROOT', 'ASSET_STORE_URL', 'RAA_ASSETS_STORE_DIR'];

interface PutJson { objects: Array<{ file: string; sha256: string; size: number; created: boolean; key: string }> }
interface GetJson { sha256: string; size: number }
interface ManifestJson { sha256: string; size: number; key: string }
interface ShowJson { sha256: string; manifest: { entries: Record<string, { sha256: string }> } }
interface StatJson { kind: string; objects: number; bytes: number }

function storeDir(argv: string[]): string {
  const at = argv.indexOf('--store');
  const value = at >= 0 ? argv[at + 1] : process.env.RAA_ASSETS_STORE_DIR;
  if (value === undefined || value === '' || value.startsWith('--')) {
    throw new RaaError('USAGE', 'no store directory given', 'pass --store <dir> or set RAA_ASSETS_STORE_DIR');
  }
  return resolve(process.cwd(), value);
}

function cliJson<T>(args: string[]): Promise<T> {
  const env = { ...process.env };
  for (const name of STORE_ENV) delete env[name];
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [CLI, ...args, '--json'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk; });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk; });
    child.on('error', fail);
    child.on('close', (code) => {
      if (code !== 0) fail(new Error(`raa-assets ${args[0]} exited ${code}: ${stderr.trim()}`));
      else done(JSON.parse(stdout) as T);
    });
  });
}

async function roundTrip(dir: string): Promise<object> {
  const tmp = await mkdtemp(join(tmpdir(), 'raa-m2-real-'));
  try {
    const store = ['--store', dir];
    const recordedAt = new Date().toISOString();
    const probe = join(tmp, 'probe.txt');
    await writeFile(probe, `raa-assets-tools m2 probe ${recordedAt}\n`);

    const put = (await cliJson<PutJson>(['put', probe, ...store])).objects[0]!;
    const storedFile = await sha256File(join(dir, objectKey(put.sha256)));

    const back = join(tmp, 'probe.back.txt');
    const got = await cliJson<GetJson>(['get', put.sha256, '-o', back, ...store]);
    const backHash = await sha256File(back);
    const bytesEqual = Buffer.compare(await readFile(probe), await readFile(back)) === 0;

    const manifest = await cliJson<ManifestJson>(['manifest', '--name', 'm2.real-store', `probe=${probe}`, ...store]);
    const manifestFile = await sha256File(join(dir, objectKey(manifest.sha256)));
    const show = await cliJson<ShowJson>(['manifest', '--show', manifest.sha256, ...store]);

    const stat = await cliJson<StatJson>(['stat', ...store]);
    return {
      store: { kind: stat.kind, layout: 'objects/<2hex>/<sha256>', isDefaultDir: dir === resolve(STORE_DIR_DEFAULT) },
      object: { sha256: put.sha256, size: put.size, created: put.created, key: put.key },
      storedFile: { sha256: storedFile.sha256 },
      get: { sha256: backHash.sha256, size: backHash.size, bytesEqual: bytesEqual && got.sha256 === backHash.sha256 },
      manifest: {
        sha256: manifest.sha256,
        size: manifest.size,
        key: manifest.key,
        storedFile: { sha256: manifestFile.sha256 },
        entrySha256: show.manifest.entries['probe']?.sha256 ?? null,
      },
      stat: { objects: stat.objects, bytes: stat.bytes },
      recordedAt,
    };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

try {
  const evidence = await roundTrip(storeDir(process.argv.slice(2)));
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  if (/\/root\/|\/home\/|@|BEGIN|\.ssh|id_/.test(text)) throw new Error('evidence would contain a path or secret pattern');
  await writeFile(EVIDENCE, text);
  process.stdout.write(text);
} catch (error) {
  const code = error instanceof RaaError ? error.code : 'REAL_STORE_FAILED';
  process.stderr.write(`error ${code}: ${redactSecrets(error instanceof Error ? error.message : String(error))}\n`);
  if (error instanceof RaaError) process.stderr.write(`  fix: ${error.fix}\n`);
  process.exit(error instanceof RaaError && error.code === 'USAGE' ? 2 : 3);
}
