import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import test from 'node:test';
import {
  filterChecks,
  flag,
  formatMeasure,
  measure,
  proofCpus,
  parallelMap,
  proofMode,
} from '../../proof/lib.ts';
import type { ProofCheck } from '../../proof/lib.ts';

test('measure compares values and includes the comparator in its threshold', () => {
  const cases = [
    ['<=', 9, true], ['<=', 10, true], ['<=', 11, false],
    ['>=', 9, false], ['>=', 10, true], ['>=', 11, true],
    ['<', 9, true], ['<', 10, false], ['<', 11, false],
    ['>', 9, false], ['>', 10, false], ['>', 11, true],
    ['==', 9, false], ['==', 10, true], ['==', 11, false],
  ] as const;
  for (const [cmp, value, pass] of cases) {
    assert.deepEqual(measure('count', value, cmp, 10), {
      label: 'count', value, threshold: `${cmp} 10`, pass,
    });
  }
  assert.equal(measure('triangles', 12, '<=', 1500).threshold, '<= 1500');
});

test('flag keeps the detail as its value', () => {
  for (const ok of [true, false]) {
    assert.deepEqual(flag('fixtures', ok, 'mismatches 0'), {
      label: 'fixtures', value: 'mismatches 0', threshold: 'true', pass: ok,
    });
  }
});

test('proofMode defaults to quick and recognises --full', (t) => {
  assert.equal(proofMode([]), 'quick');
  assert.equal(proofMode(['--only', 'unit']), 'quick');
  assert.equal(proofMode(['--only', 'unit', '--full']), 'full');
  const original = process.argv;
  t.after(() => { process.argv = original; });
  process.argv = ['node', 'proof.ts', '--full'];
  assert.equal(proofMode(), 'full');
});

test('proofCpus reads a positive integer and otherwise defaults to 1', (t) => {
  const original = process.env.PROOF_CPUS;
  t.after(() => {
    if (original === undefined) delete process.env.PROOF_CPUS;
    else process.env.PROOF_CPUS = original;
  });
  delete process.env.PROOF_CPUS;
  assert.equal(proofCpus(), 1);
  for (const [value, expected] of [
    ['3', 3], ['x', 1], ['0', 1], ['-1', 1], ['1.5', 1], ['3x', 1],
  ] as const) {
    process.env.PROOF_CPUS = value;
    assert.equal(proofCpus(), expected, value);
  }
});

test('parallelMap preserves order and limits asynchronous calls to 2', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const results = await parallelMap([30, 5, 10, 1], async (delay, index) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await setTimeout(delay);
    inFlight--;
    return `${index}:${delay}`;
  }, 2);
  assert.deepEqual(results, ['0:30', '1:5', '2:10', '3:1']);
  assert.equal(maxInFlight, 2);
  assert.equal(inFlight, 0);
});

test('parallelMap handles empty input and rejects invalid limits or failed calls', async () => {
  assert.deepEqual(await parallelMap([], async () => assert.fail('unexpected call')), []);
  for (const limit of [0, -1, 1.5, NaN, Infinity]) {
    await assert.rejects(parallelMap([1], async (item) => item, limit), RangeError);
  }
  await assert.rejects(parallelMap([1], async () => {
    throw new Error('failed call');
  }), /failed call/);
});

test('parallelMap defaults to the PROOF_CPUS limit', async (t) => {
  const original = process.env.PROOF_CPUS;
  t.after(() => {
    if (original === undefined) delete process.env.PROOF_CPUS;
    else process.env.PROOF_CPUS = original;
  });
  process.env.PROOF_CPUS = '1';
  let inFlight = 0;
  await parallelMap([1, 2, 3], async () => {
    assert.equal(++inFlight, 1);
    await setTimeout(1);
    inFlight--;
  });
});

test('--only matches check labels case-insensitively with a regular expression', () => {
  const checks: ProofCheck[] = ['m1.tests', 'm1.conformance', 'm1.roundtrip']
    .map((label) => ({ label, async run() { assert.fail('filter must not run checks'); } }));
  assert.deepEqual(filterChecks(checks, []), checks);
  assert.deepEqual(filterChecks(checks, ['--full']), checks);
  assert.deepEqual(filterChecks(checks, ['--only', 'TESTS|roundtrip$']), [checks[0], checks[2]]);
  assert.deepEqual(filterChecks(checks, ['--only', '^missing$']), []);
  assert.throws(() => filterChecks(checks, ['--only']), /requires a regular expression/);
  assert.throws(() => filterChecks(checks, ['--only', '--full']), /requires a regular expression/);
  assert.throws(() => filterChecks(checks, ['--only', '[']), SyntaxError);
});

test('formatMeasure emits the exact proof line format', () => {
  assert.equal(formatMeasure(measure('triangles', 12, '<=', 1500)),
    'PASS  triangles  12  (threshold <= 1500)');
  assert.equal(formatMeasure(flag('fixtures', false, 'mismatches 1')),
    'FAIL  fixtures  mismatches 1  (threshold true)');
  assert.equal(formatMeasure({ label: 'boolean', value: true, threshold: 'true', pass: true }),
    'PASS  boolean  true  (threshold true)');
});

test('runProof child exits 1 immediately after printing the first FAIL', () => {
  const moduleUrl = new URL('../../proof/lib.ts', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { runProof, measure, flag } from ${JSON.stringify(moduleUrl)};
    await runProof([
      { label: 'skipped', async run() { throw new Error('must be filtered out'); } },
      { label: 'selected', async run() {
        return [measure('before', 1, '==', 1), measure('failure', 2, '<=', 1),
          flag('after', true, 'must not print')];
      } },
      { label: 'selected.later', async run() { throw new Error('must not run'); } },
    ], process.argv.slice(1));
  `, '--', '--only', '^SELECTED'], { encoding: 'utf8', timeout: 10_000 });
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  assert.equal(child.status, 1, child.stderr);
  assert.equal(child.stdout,
    'PASS  before  1  (threshold == 1)\nFAIL  failure  2  (threshold <= 1)\n');
  assert.equal(child.stderr, '');
});
