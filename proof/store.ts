// Store and CLI proof: content-addressed store client and raa-assets CLI.
// node proof/store.ts [--only <regex>]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RaaError } from '../src/index.ts';
import { localStore, objectKey, sha256Hex, STORE_DIR_DEFAULT } from '../src/node/index.ts';
import { main } from '../src/cli/main.ts';
import { flag, measure, proofCpus, parallelMap, runProof } from './lib.ts';
import type { Measure, ProofCheck } from './lib.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI = 'src/cli/main.ts';
const STORE_ENV = ['ASSET_STORE_SSH', 'ASSET_STORE_KEY', 'ASSET_STORE_ROOT', 'ASSET_STORE_URL', 'RAA_ASSETS_STORE_DIR'];

interface CliRun { code: number | null; stdout: string; stderr: string }

function cliEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of STORE_ENV) delete env[name];
  return env;
}

function cli(args: string[], env: NodeJS.ProcessEnv = cliEnv()): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk; });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function cliJson<T>(args: string[]): Promise<T> {
  const run = await cli([...args, '--json']);
  if (run.code !== 0) throw new Error(`raa-assets ${args[0]} exited ${run.code}: ${run.stderr.trim()}`);
  return JSON.parse(run.stdout) as T;
}

const tempDir = (name: string) => mkdtemp(join(tmpdir(), `raa-m2-${name}-`));

interface PutJson { objects: Array<{ file: string; sha256: string; size: number; created: boolean }> }
interface ManifestJson { sha256: string; size: number; entries: Record<string, { sha256: string; size: number }> }
interface ShowJson { sha256: string; manifest: { entries: Record<string, { sha256: string }> } }
interface LsJson { objects: Array<{ sha256: string; size: number }>; count: number; bytes: number }
interface StatJson { kind: string; objects: number; bytes: number; freeBytes: number | null }
interface GcJson { reachable: number; unreachable: Array<{ sha256: string; size: number }> }
interface GetJson { sha256: string; size: number; file: string }

const localRoundtrip: ProofCheck = {
  label: 'm2.local-roundtrip',
  async run(): Promise<Measure[]> {
    const dir = await tempDir('roundtrip');
    try {
      const store = join(dir, 'store');
      const files = [join(dir, 'f1.json'), join(dir, 'f2.txt')];
      const contents = ['{"probe": "m2.local-roundtrip"}\n', 'raa-assets-tools m2 proof text\n'];
      await Promise.all(files.map((file, i) => writeFile(file, contents[i])));

      const put = await cliJson<PutJson>(['put', ...files, '--store', store]);
      const manifest = await cliJson<ManifestJson>([
        'manifest', '--name', 'm2.proof', `a.one=${files[0]}`, `b.two=${files[1]}`, '--root', 'main', '--store', store,
      ]);

      const outs = put.objects.map((_, i) => join(dir, 'out', `get-${i}`));
      const reads: string[][] = [
        ...put.objects.map((object, i) => ['get', object.sha256, '-o', outs[i], '--store', store]),
        ['manifest', '--show', manifest.sha256, '--store', store],
        ['ls', '--store', store],
        ['stat', '--store', store],
        ['gc', '--dry-run', '--store', store],
      ];
      const results = await parallelMap(reads, (args) => cliJson<unknown>(args), proofCpus());
      const gets = results.slice(0, put.objects.length) as GetJson[];
      const [show, ls, stat, gc] = results.slice(put.objects.length) as [ShowJson, LsJson, StatJson, GcJson];

      const mismatches: string[] = [];
      for (const [i, object] of put.objects.entries()) {
        const original = await readFile(files[i]);
        const fetched = await readFile(outs[i]);
        if (!original.equals(fetched) || gets[i].sha256 !== object.sha256) mismatches.push(`get ${object.file}: bytes differ`);
      }
      const stored = await readFile(join(store, objectKey(manifest.sha256)));
      if (sha256Hex(stored) !== manifest.sha256) mismatches.push(`manifest ${manifest.sha256}: stored bytes hash to ${sha256Hex(stored)}`);
      const listed = new Set(ls.objects.map((object) => object.sha256));
      for (const [logical, entry] of Object.entries(show.manifest.entries)) {
        if (!listed.has(entry.sha256)) mismatches.push(`entry ${logical} ${entry.sha256}: not in ls`);
      }
      if (ls.count !== 3) mismatches.push(`ls count ${ls.count}, expected 3`);
      const sizes = put.objects.reduce((sum, object) => sum + object.size, 0) + manifest.size;
      if (stat.objects !== 3 || stat.bytes !== sizes) {
        mismatches.push(`stat objects ${stat.objects} bytes ${stat.bytes}, expected 3 and ${sizes}`);
      }
      if (gc.unreachable.length !== 0) mismatches.push(`gc unreachable ${gc.unreachable.length}, expected 0`);

      console.log(`  objects ${stat.objects} bytes ${stat.bytes}`);
      for (const line of mismatches) console.log(`  mismatch ${line}`);
      return [
        measure('m2.local-roundtrip.mismatches', mismatches.length, '==', 0),
        measure('m2.local-roundtrip.objects', stat.objects, '==', 3),
      ];
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};

const cap: ProofCheck = {
  label: 'm2.cap',
  async run(): Promise<Measure[]> {
    const dir = await tempDir('cap');
    try {
      const store = join(dir, 'store');
      const big = join(dir, 'big');
      await writeFile(big, '');
      await truncate(big, 52428801);
      const put = await cli(['put', big, '--store', store, '--json']);
      const refused = put.code === 1 && put.stderr.includes('OBJECT_TOO_LARGE');
      const ls = await cliJson<LsJson>(['ls', '--store', store]);
      return [
        flag('m2.cap.refused', refused, `exit ${put.code}, ${put.stderr.split('\n')[0].trim() || 'no stderr'}`),
        measure('m2.cap.objects-after', ls.count, '==', 0),
      ];
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};

const rejects = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error ?? new Error('rejected');
  }
};

const atomic: ProofCheck = {
  label: 'm2.atomic',
  async run(): Promise<Measure[]> {
    const dir = await tempDir('atomic');
    try {
      const store = localStore(dir);
      const bytes = new TextEncoder().encode('raa-assets-tools m2 atomic probe\n');
      const sha = sha256Hex(bytes);
      const shard = join(dir, 'objects', sha.slice(0, 2));
      await mkdir(shard, { recursive: true });
      await writeFile(join(shard, `.${sha}.tmp.x`), bytes);
      const listed = (await store.list()).length;
      const getError = await rejects(store.get(sha));
      const hidden = listed === 0 && getError !== null;

      const put = await store.put(bytes);
      const has = await store.has(sha);

      // Remove the planted file so only what put leaves behind is inspected.
      await rm(join(shard, `.${sha}.tmp.x`), { force: true });
      const second = await store.put(new TextEncoder().encode('raa-assets-tools m2 atomic probe 2\n'));
      const leftovers = (await readdir(join(dir, 'objects', second.sha256.slice(0, 2)))).filter((name) => name.startsWith('.'));
      return [
        flag('m2.atomic.temp-hidden', hidden, `listed ${listed}, get ${getError instanceof RaaError ? getError.code : getError === null ? 'resolved' : 'rejected'}`),
        flag('m2.atomic.put-after-temp', put.created && has, `created ${put.created}, has ${has}`),
        flag('m2.atomic.no-temp-left', second.created && leftovers.length === 0, leftovers.length === 0 ? 'shard holds no dot-file after put' : `left ${leftovers.join(' ')}`),
      ];
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};

const storeSelection: ProofCheck = {
  label: 'm2.store-selection',
  async run(): Promise<Measure[]> {
    const dir = await tempDir('selection');
    try {
      const explicit = join(dir, 'explicit');
      const fromEnv = join(dir, 'env');
      const file = join(dir, 'probe');
      const data = 'm2 store selection probe';
      const sha = sha256Hex(data);
      await writeFile(file, data);
      const env = { ...cliEnv(), RAA_ASSETS_STORE_DIR: fromEnv };
      const first = await cli(['put', file, '--store', explicit, '--json'], env);
      const explicitWins = first.code === 0 && await localStore(explicit).has(sha) && !(await localStore(fromEnv).has(sha));
      const second = await cli(['put', file, '--json'], env);
      const envUsed = second.code === 0 && await localStore(fromEnv).has(sha);

      const legacy = {
        ASSET_STORE_SSH: 'unused-destination-sentinel',
        ASSET_STORE_KEY: 'unused-key-sentinel',
        ASSET_STORE_ROOT: 'unused-root-sentinel',
        ASSET_STORE_URL: 'unused-url-sentinel',
      };
      const baseline = await cli(['ls', '--json'], env);
      const ignored = await cli(['ls', '--json'], { ...env, ...legacy });

      // Inject a missing default through statSync; never access the host store.
      const savedStat = fs.statSync;
      let defaultChecked = false;
      let missingOutput = '';
      let missingCode: number;
      Reflect.set(fs, 'statSync', (path: unknown) => {
        defaultChecked = path === STORE_DIR_DEFAULT;
        throw Object.assign(new Error('missing default'), { code: 'ENOENT' });
      });
      try {
        missingCode = await main(['ls'], {
          env: { ...cliEnv(), ...legacy }, cwd: dir,
          stdout: text => { missingOutput += text; },
          stderr: text => { missingOutput += text; },
        });
      } finally {
        Reflect.set(fs, 'statSync', savedStat);
      }
      const missingRefused = defaultChecked && missingCode === 2 && missingOutput.includes('error NO_STORE: no asset store is configured and the default store directory does not exist') && missingOutput.includes('fix: pass --store <dir> or set RAA_ASSETS_STORE_DIR');
      const output = first.stdout + first.stderr + second.stdout + second.stderr + ignored.stdout + ignored.stderr + missingOutput;
      const noLeak = Object.values(legacy).every(value => !output.includes(value));
      return [
        flag('m2.store-selection.explicit', explicitWins, '--store wins over RAA_ASSETS_STORE_DIR'),
        flag('m2.store-selection.env', envUsed, 'RAA_ASSETS_STORE_DIR used without --store'),
        flag('m2.store-selection.missing-default', missingRefused, `exit ${missingCode}, NO_STORE with fix`),
        flag('m2.store-selection.legacy-ignored', noLeak && baseline.code === 0 && ignored.code === baseline.code && ignored.stdout === baseline.stdout && ignored.stderr === baseline.stderr, 'legacy variables have no effect and do not appear in output'),
      ];
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};

interface RealStoreEvidence {
  store?: { kind?: string };
  object?: { sha256?: string; size?: number; created?: boolean; key?: string };
  storedFile?: { sha256?: string };
  get?: { sha256?: string; size?: number; bytesEqual?: boolean };
  manifest?: { sha256?: string; storedFile?: { sha256?: string }; entrySha256?: string };
  stat?: { objects?: number; bytes?: number };
}

const realStore: ProofCheck = {
  label: 'm2.real-store',
  async run(): Promise<Measure[]> {
    let text: string;
    try {
      text = await readFile(join(ROOT, 'evidence', 'store-real.json'), 'utf8');
    } catch {
      return [flag('m2.real-store.evidence', false, 'evidence/store-real.json missing')];
    }
    const evidence = JSON.parse(text) as RealStoreEvidence;
    const found = ['@', 'BEGIN', '.ssh', 'id_', '/root/', '/home/'].filter((pattern) => text.includes(pattern));
    const objectSha = evidence.object?.sha256;
    const validObject = typeof objectSha === 'string' && /^[0-9a-f]{64}$/.test(objectSha);
    const manifestSha = evidence.manifest?.sha256;
    return [
      flag('m2.real-store.kind', evidence.store?.kind === 'local', `kind ${evidence.store?.kind}`),
      flag('m2.real-store.key', validObject && evidence.object?.key === objectKey(objectSha!), `key ${evidence.object?.key}`),
      flag('m2.real-store.sha-equal', validObject && evidence.storedFile?.sha256 === objectSha && evidence.get?.sha256 === objectSha && evidence.get?.bytesEqual === true, `stored ${evidence.storedFile?.sha256} get ${evidence.get?.sha256} bytesEqual ${evidence.get?.bytesEqual} object ${objectSha}`),
      flag('m2.real-store.manifest', typeof manifestSha === 'string' && evidence.manifest?.storedFile?.sha256 === manifestSha && evidence.manifest?.entrySha256 === objectSha, `manifest ${manifestSha} stored ${evidence.manifest?.storedFile?.sha256} entry ${evidence.manifest?.entrySha256}`),
      measure('m2.real-store.stat-objects', evidence.stat?.objects ?? 0, '>=', 2),
      flag('m2.real-store.no-secret', found.length === 0, found.length === 0 ? 'no secret pattern or absolute path' : `found ${found.join(' ')}`),
    ];
  },
};

await runProof([localRoundtrip, cap, atomic, storeSelection, realStore]);
