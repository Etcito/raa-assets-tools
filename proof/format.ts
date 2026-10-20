// Format proof: raa.prims v0 format, validator and conformance fixtures.
// node proof/format.ts [--only <regex>]
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REFUSAL_CODES, parseRaaPrims, serializeRaaPrims } from '../src/index.ts';
import type { RaaValidation, RefusalCode } from '../src/index.ts';
import { flag, measure, proofCpus, runProof } from './lib.ts';
import type { Measure, ProofCheck } from './lib.ts';

interface Expected {
  valid: Record<string, { triangles: number }>;
  refused: Record<string, { codes: RefusalCode[]; nodes: string[] }>;
}

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FIXTURES = `${ROOT}fixtures/`;

function loadFixtures() {
  const expected = JSON.parse(readFileSync(`${FIXTURES}expected.json`, 'utf8')) as Expected;
  const list = (dir: string, suffix: string) =>
    readdirSync(`${FIXTURES}${dir}`).filter((f) => f.endsWith(suffix)).sort();
  const read = (dir: string, file: string) => readFileSync(`${FIXTURES}${dir}/${file}`, 'utf8');
  const valid = list('valid', '.raa.prims.json').map((file) => {
    const text = read('valid', file);
    return { file, text, result: parseRaaPrims(text) };
  });
  const refused = list('refused', '.json').map((file) => ({
    file,
    result: parseRaaPrims(read('refused', file)),
  }));
  return { expected, valid, refused };
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

function runTests(): Promise<{ code: number | null; out: string }> {
  // Node does not collect .ts files from a bare directory argument, so the glob is used.
  const args = ['--test', '--test-reporter=tap', `--test-concurrency=${proofCpus()}`, 'test/format/**/*.test.ts'];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => { out += chunk; });
    child.stderr.on('data', (chunk: Buffer) => { out += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
  });
}

const tests: ProofCheck = {
  label: 'm1.tests',
  async run(): Promise<Measure[]> {
    const { out } = await runTests();
    const count = (name: string) => {
      const match = new RegExp(`^# ${name} (\\d+)$`, 'm').exec(out);
      if (!match) throw new Error(`node --test output has no '# ${name}' summary line`);
      return Number(match[1]);
    };
    const pass = count('pass');
    const fail = count('fail');
    if (fail > 0) {
      for (const line of out.split('\n')) if (/^\s*not ok /.test(line)) console.log(`  ${line.trim()}`);
    }
    return [measure('m1.tests.fail', fail, '==', 0), measure('m1.tests.pass', pass, '>=', 1)];
  },
};

const conformance: ProofCheck = {
  label: 'm1.conformance',
  async run(): Promise<Measure[]> {
    const { expected, valid, refused } = loadFixtures();
    const mismatches: string[] = [];
    const miss = (file: string, what: string) => mismatches.push(`${file}: ${what}`);

    for (const name of Object.keys(expected.valid)) {
      if (!valid.some((v) => v.file === name)) miss(name, 'expected valid entry has no file');
    }
    for (const name of Object.keys(expected.refused)) {
      if (!refused.some((r) => r.file === name)) miss(name, 'expected refused entry has no file');
    }

    for (const { file, text, result } of valid) {
      const want = expected.valid[file];
      if (!want) { miss(file, 'no expected entry'); continue; }
      if (!result.ok || result.issues.length > 0) {
        miss(file, `refused: ${result.issues.map((i) => `${i.code} ${i.path}`).join(', ')}`);
        continue;
      }
      if (result.triangles !== want.triangles) {
        miss(file, `triangles ${result.triangles}, expected ${want.triangles}`);
      }
      if (!result.asset || serializeRaaPrims(result.asset) !== text) miss(file, 'bytes differ from canonical serialization');
    }

    for (const { file, result } of refused) {
      const want = expected.refused[file];
      if (!want) { miss(file, 'no expected entry'); continue; }
      if (result.ok) { miss(file, 'accepted, expected a refusal'); continue; }
      const codes = result.issues.map((i) => i.code).sort();
      if (!sameList(codes, want.codes)) miss(file, `codes [${codes}], expected [${want.codes}]`);
      const nodes = [...new Set(result.issues.flatMap((i) => i.nodes))].sort();
      if (!sameList(nodes, want.nodes)) miss(file, `nodes [${nodes}], expected [${want.nodes}]`);
      for (const issue of result.issues) {
        if (issue.path !== '' && !issue.path.startsWith('/')) miss(file, `${issue.code} path ${JSON.stringify(issue.path)}`);
        if (issue.message.length === 0) miss(file, `${issue.code} has an empty message`);
        for (const id of issue.nodes) {
          if (!issue.message.includes(id)) miss(file, `${issue.code} message does not name '${id}'`);
        }
      }
    }

    for (const line of mismatches) console.log(`  mismatch ${line}`);
    return [
      measure('m1.conformance.valid', valid.length, '>=', 10),
      measure('m1.conformance.refused', refused.length, '>=', 35),
      measure('m1.conformance.mismatches', mismatches.length, '==', 0),
    ];
  },
};

const roundtrip: ProofCheck = {
  label: 'm1.roundtrip',
  async run(): Promise<Measure[]> {
    const { valid } = loadFixtures();
    let identical = 0;
    const unstable: string[] = [];
    for (const { file, text, result } of valid) {
      if (!result.asset) { unstable.push(file); continue; }
      const once = serializeRaaPrims(result.asset);
      if (once === text) identical++;
      else console.log(`  not byte-identical ${file}`);
      const again: RaaValidation = parseRaaPrims(once);
      if (!again.asset || serializeRaaPrims(again.asset) !== once) unstable.push(file);
    }
    for (const file of unstable) console.log(`  unstable ${file}`);
    return [
      measure('m1.roundtrip.identical', identical, '==', valid.length),
      flag(
        'm1.roundtrip.stable',
        unstable.length === 0,
        unstable.length === 0 ? `${valid.length}/${valid.length} stable` : `unstable: ${unstable.join(', ')}`,
      ),
    ];
  },
};

const refusalTable: ProofCheck = {
  label: 'm1.refusal-table',
  async run(): Promise<Measure[]> {
    const { refused } = loadFixtures();
    const missing: string[] = [];
    console.log('  CODE | fixture | message');
    for (const code of REFUSAL_CODES) {
      let row: string | undefined;
      for (const { file, result } of refused) {
        const issue = result.issues.find((i) => i.code === code);
        if (issue) { row = `${code} | ${file} | ${issue.message}`; break; }
      }
      if (row === undefined) { missing.push(code); row = `${code} | - | -`; }
      console.log(`  ${row}`);
    }
    return [measure('m1.refusal-table.codes-without-fixture', missing.length, '==', 0)];
  },
};

await runProof([tests, conformance, roundtrip, refusalTable]);
