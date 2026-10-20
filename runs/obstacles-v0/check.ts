// Checks the obstacles-v0 example run (example data, see ../README.md) offline against its committed files.
// node runs/obstacles-v0/check.ts [--only <regex>]
// Never touches the network or the store; a missing file or field is a FAIL flag, never an exception.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifest } from '../../src/manifest/index.ts';
import { OBJECT_MAX_BYTES, objectKey, sha256Hex } from '../../src/node/index.ts';
import { flag, measure, runProof } from '../../proof/lib.ts';
import type { Measure, ProofCheck } from '../../proof/lib.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUN = 'runs/obstacles-v0';
const SPEC_COUNT = 11;
const BUDGET = 1500;
const MANIFEST_NAME = 'rf.assets.obstacles-v0';
const PRIMS_TYPE = 'application/vnd.raa.prims+json';
const SDFM_TYPE = 'application/vnd.sdfm+json';
const SECRET_PATTERNS = ['@', '.ssh', 'BEGIN', '/root/', '/home/'];
const SHA_RE = /^[0-9a-f]{64}$/;

interface SpecAsset { name?: string; logical?: string; id?: string; anchors?: unknown; budget?: unknown }
interface Spec { assets?: SpecAsset[] }
interface StoredRef { sha256?: string; size?: number; key?: string }
interface EvidenceAsset extends StoredRef {
  name?: string; id?: string; logical?: string; anchors?: unknown; triangles?: unknown; budget?: unknown; source?: StoredRef;
}
interface Evidence {
  store?: { kind?: string };
  assets?: EvidenceAsset[];
  manifest?: StoredRef & { name?: string; storedFile?: { sha256?: string }; get?: { sha256?: string; size?: number } };
  contactSheet?: { sha256?: string; key?: string; renderer?: string };
}

type Loaded<T> = { ok: true; value: T; text: string; bytes: Buffer } | { ok: false; why: string };

async function load(file: string): Promise<Loaded<string>> {
  try {
    const bytes = await readFile(join(ROOT, RUN, file));
    return { ok: true, value: bytes.toString('utf8'), text: bytes.toString('utf8'), bytes };
  } catch {
    return { ok: false, why: `${RUN}/${file} missing` };
  }
}

async function loadJson<T>(file: string): Promise<Loaded<T>> {
  const raw = await load(file);
  if (!raw.ok) return raw;
  try {
    const value = JSON.parse(raw.text) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, why: `${RUN}/${file} is not a JSON object` };
    return { ok: true, value: value as T, text: raw.text, bytes: raw.bytes };
  } catch {
    return { ok: false, why: `${RUN}/${file} is not valid JSON` };
  }
}

const list = <T>(value: T[] | undefined): T[] => (Array.isArray(value) ? value.filter((item) => item !== null && typeof item === 'object') : []);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
const keyOf = (sha: unknown): string | null => (typeof sha === 'string' && SHA_RE.test(sha) ? objectKey(sha) : null);

function report(mismatches: string[]): void {
  for (const line of mismatches.slice(0, 20)) console.log(`  mismatch ${line}`);
  if (mismatches.length > 20) console.log(`  ... ${mismatches.length - 20} more`);
}

const assets: ProofCheck = {
  label: 'm6.assets',
  async run(): Promise<Measure[]> {
    const [spec, evidence] = await Promise.all([loadJson<Spec>('spec.json'), loadJson<Evidence>('evidence.json')]);
    if (!evidence.ok || !spec.ok) {
      return [
        flag('m6.assets.evidence', evidence.ok, evidence.ok ? `${RUN}/evidence.json` : evidence.why),
        flag('m6.assets.spec', spec.ok, spec.ok ? `${RUN}/spec.json` : spec.why),
      ];
    }
    const specAssets = list(spec.value.assets);
    const evidenceAssets = list(evidence.value.assets);
    const mismatches: string[] = [];
    const byName = new Map<string, EvidenceAsset>();
    for (const asset of evidenceAssets) {
      if (typeof asset.name !== 'string') mismatches.push('evidence asset without a name');
      else if (byName.has(asset.name)) mismatches.push(`evidence ${asset.name}: duplicate`);
      else byName.set(asset.name, asset);
    }
    const specNames = new Set(specAssets.map((asset) => asset.name).filter((name): name is string => typeof name === 'string'));
    for (const name of byName.keys()) if (!specNames.has(name)) mismatches.push(`evidence ${name}: not a spec name`);
    let matched = 0;
    for (const want of specAssets) {
      const got = typeof want.name === 'string' ? byName.get(want.name) : undefined;
      if (!got) {
        mismatches.push(`spec ${want.name}: missing from evidence.assets`);
        continue;
      }
      const issues: string[] = [];
      if (got.id !== want.id) issues.push(`id ${got.id} != ${want.id}`);
      if (got.logical !== want.logical) issues.push(`logical ${got.logical} != ${want.logical}`);
      const anchors = new Set(strings(got.anchors));
      const missing = strings(want.anchors).filter((anchor) => !anchors.has(anchor));
      if (missing.length > 0) issues.push(`anchors missing ${missing.join(' ')}`);
      if (issues.length === 0) matched++;
      else mismatches.push(`${want.name}: ${issues.join(', ')}`);
    }
    console.log(`  spec ${specAssets.length} evidence ${evidenceAssets.length} matched ${matched}`);
    report(mismatches);
    return [
      measure('m6.assets.spec-count', specAssets.length, '==', SPEC_COUNT),
      measure('m6.assets.mismatches', mismatches.length, '==', 0),
      measure('m6.assets.matched', matched, '==', SPEC_COUNT),
    ];
  },
};

const budget: ProofCheck = {
  label: 'm6.budget',
  async run(): Promise<Measure[]> {
    const [spec, evidence] = await Promise.all([loadJson<Spec>('spec.json'), loadJson<Evidence>('evidence.json')]);
    if (!evidence.ok || !spec.ok) {
      return [
        flag('m6.budget.evidence', evidence.ok, evidence.ok ? `${RUN}/evidence.json` : evidence.why),
        flag('m6.budget.spec', spec.ok, spec.ok ? `${RUN}/spec.json` : spec.why),
      ];
    }
    const specBudget = new Map(list(spec.value.assets).map((asset) => [asset.name, asset.budget]));
    const evidenceAssets = list(evidence.value.assets);
    const mismatches: string[] = [];
    let worst = 0;
    let worstName = 'none';
    for (const asset of evidenceAssets) {
      const want = specBudget.get(asset.name);
      if (asset.budget !== BUDGET || want !== BUDGET) mismatches.push(`${asset.name}: budget ${asset.budget}, spec ${want}, expected ${BUDGET}`);
      const triangles = asset.triangles;
      if (typeof triangles !== 'number' || !Number.isInteger(triangles) || triangles < 1) {
        mismatches.push(`${asset.name}: triangles ${triangles}`);
        continue;
      }
      const limit = typeof asset.budget === 'number' && asset.budget > 0 ? asset.budget : BUDGET;
      const ratio = triangles / limit;
      if (ratio > worst) { worst = ratio; worstName = `${asset.name} ${triangles}/${limit}`; }
    }
    console.log(`  assets ${evidenceAssets.length} worst ${worstName}`);
    report(mismatches);
    return [
      measure('m6.budget.assets', evidenceAssets.length, '>=', 1),
      measure('m6.budget.mismatches', mismatches.length, '==', 0),
      measure('m6.budget.worst-ratio', worst, '<=', 1),
    ];
  },
};

const manifest: ProofCheck = {
  label: 'm6.manifest',
  async run(): Promise<Measure[]> {
    const [raw, evidence] = await Promise.all([load('manifest.json'), loadJson<Evidence>('evidence.json')]);
    if (!raw.ok) return [flag('m6.manifest.file', false, raw.why)];
    if (!evidence.ok) return [flag('m6.manifest.evidence', false, evidence.why)];
    const parsed = parseManifest(raw.text);
    const issues = parsed.issues.map((issue) => `${issue.code} ${issue.path}`).join(', ');
    const recorded = evidence.value.manifest ?? {};
    const sha = sha256Hex(raw.bytes);
    const entries = parsed.manifest?.entries ?? {};
    const mismatches: string[] = [];
    const expected = new Map<string, { sha256?: string; size?: number; contentType: string }>();
    for (const asset of list(evidence.value.assets)) {
      expected.set(`${asset.logical}`, { sha256: asset.sha256, size: asset.size, contentType: PRIMS_TYPE });
      expected.set(`${asset.logical}.source`, { sha256: asset.source?.sha256, size: asset.source?.size, contentType: SDFM_TYPE });
    }
    for (const [logical, want] of expected) {
      const got = entries[logical];
      if (!got) mismatches.push(`${logical}: no manifest entry`);
      else if (got.sha256 !== want.sha256 || got.size !== want.size || got.contentType !== want.contentType) {
        mismatches.push(`${logical}: entry ${got.sha256} ${got.size} ${got.contentType}, evidence ${want.sha256} ${want.size} ${want.contentType}`);
      }
    }
    for (const logical of Object.keys(entries)) if (!expected.has(logical)) mismatches.push(`${logical}: not in the evidence`);
    const oversize = Object.entries(entries).filter(([, entry]) => entry.size > OBJECT_MAX_BYTES).map(([logical]) => logical);
    if (raw.bytes.length > OBJECT_MAX_BYTES) oversize.push('manifest.json');
    const entryCount = Object.keys(entries).length;
    console.log(`  manifest ${sha} ${raw.bytes.length} bytes, ${entryCount} entries`);
    report(mismatches);
    return [
      flag('m6.manifest.parse', parsed.ok, parsed.ok ? 'parseManifest ok' : `issues ${issues}`),
      flag('m6.manifest.name', parsed.manifest?.name === MANIFEST_NAME, `name ${parsed.manifest?.name}`),
      flag('m6.manifest.sha256', recorded.sha256 === sha, `bytes ${sha}, evidence ${recorded.sha256}`),
      flag('m6.manifest.size', recorded.size === raw.bytes.length, `bytes ${raw.bytes.length}, evidence ${recorded.size}`),
      measure('m6.manifest.entries', entryCount, '==', SPEC_COUNT * 2),
      measure('m6.manifest.mismatches', mismatches.length, '==', 0),
      flag('m6.manifest.max-bytes', oversize.length === 0, oversize.length === 0 ? `all <= ${OBJECT_MAX_BYTES}` : `over ${OBJECT_MAX_BYTES}: ${oversize.join(' ')}`),
    ];
  },
};

const store: ProofCheck = {
  label: 'm6.store',
  async run(): Promise<Measure[]> {
    const evidence = await loadJson<Evidence>('evidence.json');
    if (!evidence.ok) return [flag('m6.store.evidence', false, evidence.why)];
    const recorded = evidence.value.manifest ?? {};
    const sha = recorded.sha256;
    const manifestKey = keyOf(sha);
    const mismatches: string[] = [];
    const assetList = list(evidence.value.assets);
    for (const asset of assetList) {
      if (keyOf(asset.sha256) === null || asset.key !== keyOf(asset.sha256)) mismatches.push(`${asset.name}: key ${asset.key} for sha ${asset.sha256}`);
      const source = asset.source;
      if (keyOf(source?.sha256) === null || source?.key !== keyOf(source?.sha256)) mismatches.push(`${asset.name}.source: key ${source?.key} for sha ${source?.sha256}`);
    }
    report(mismatches);
    return [
      flag('m6.store.kind', evidence.value.store?.kind === 'local', `kind ${evidence.value.store?.kind}`),
      flag('m6.store.manifest-key', manifestKey !== null && recorded.key === manifestKey, `key ${recorded.key} for sha ${sha}`),
      flag('m6.store.stored-file', manifestKey !== null && recorded.storedFile?.sha256 === sha, `storedFile ${recorded.storedFile?.sha256}, manifest ${sha}`),
      flag('m6.store.get', manifestKey !== null && recorded.get?.sha256 === sha, `get ${recorded.get?.sha256}, manifest ${sha}`),
      measure('m6.store.assets', assetList.length, '>=', 1),
      measure('m6.store.key-mismatches', mismatches.length, '==', 0),
    ];
  },
};

const review: ProofCheck = {
  label: 'm6.review',
  async run(): Promise<Measure[]> {
    const [evidence, reportMd, dogfoodMd] = await Promise.all([loadJson<Evidence>('evidence.json'), load('report.md'), load('dogfood.md')]);
    const sheet = evidence.ok ? evidence.value.contactSheet : undefined;
    const sheetKey = keyOf(sheet?.sha256);
    const renderer = sheet?.renderer;
    const found = evidence.ok ? SECRET_PATTERNS.filter((pattern) => evidence.text.includes(pattern)) : [];
    const nonEmpty = (doc: Loaded<string>, file: string) => flag(`m6.review.${file}`, doc.ok && doc.value.trim().length > 0, doc.ok ? (doc.value.trim().length > 0 ? `${doc.bytes.length} bytes` : `${RUN}/${file} is empty`) : doc.why);
    return [
      flag('m6.review.evidence', evidence.ok, evidence.ok ? `${RUN}/evidence.json` : evidence.why),
      flag('m6.review.contact-sheet', sheetKey !== null && sheet?.key === sheetKey, `sha ${sheet?.sha256} key ${sheet?.key}`),
      flag('m6.review.renderer', renderer === 'host-webgpu' || renderer === 'browser-webgpu', `renderer ${renderer}`),
      nonEmpty(reportMd, 'report.md'),
      nonEmpty(dogfoodMd, 'dogfood.md'),
      flag('m6.review.no-secret', evidence.ok && found.length === 0, found.length === 0 ? 'no secret pattern or absolute path' : `found ${found.join(' ')}`),
    ];
  },
};

await runProof([assets, budget, manifest, store, review]);
