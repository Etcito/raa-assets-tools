export interface Measure {
  label: string;
  value: number | string | boolean;
  threshold: string;
  pass: boolean;
}

export interface ProofCheck {
  label: string;
  run(): Promise<Measure[]>;
}

export function measure(
  label: string,
  value: number,
  cmp: '<=' | '>=' | '<' | '>' | '==',
  threshold: number,
): Measure {
  let pass: boolean;
  switch (cmp) {
    case '<=': pass = value <= threshold; break;
    case '>=': pass = value >= threshold; break;
    case '<': pass = value < threshold; break;
    case '>': pass = value > threshold; break;
    case '==': pass = value === threshold; break;
  }
  return { label, value, threshold: `${cmp} ${threshold}`, pass };
}

export function flag(label: string, ok: boolean, detail: string): Measure {
  return { label, value: detail, threshold: 'true', pass: ok };
}

export function proofMode(argv: string[] = process.argv.slice(2)): 'quick' | 'full' {
  return argv.includes('--full') ? 'full' : 'quick';
}

export function proofCpus(): number {
  const value = Number(process.env.PROOF_CPUS);
  return Number.isSafeInteger(value) && value >= 1 ? value : 1;
}

export async function parallelMap<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  limit: number = proofCpus(),
): Promise<R[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError('parallelMap limit must be an integer >= 1');
  }
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Select checks without running them or accessing process state. */
export function filterChecks(checks: readonly ProofCheck[], argv: string[]): ProofCheck[] {
  const index = argv.indexOf('--only');
  if (index === -1) return [...checks];
  const pattern = argv[index + 1];
  if (pattern === undefined || pattern.startsWith('--')) {
    throw new Error('--only requires a regular expression');
  }
  const regex = new RegExp(pattern, 'i');
  return checks.filter((check) => regex.test(check.label));
}

export function formatMeasure(result: Measure): string {
  return `${result.pass ? 'PASS' : 'FAIL'}  ${result.label}  ${result.value}  (threshold ${result.threshold})`;
}

function redactSecrets(message: string): string {
  const secrets = [process.env.ASSET_STORE_SSH, process.env.ASSET_STORE_KEY]
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.length - a.length);
  for (const secret of secrets) message = message.split(secret).join('[REDACTED]');
  return message;
}

export async function runProof(
  checks: ProofCheck[],
  argv: string[] = process.argv.slice(2),
): Promise<never> {
  const start = performance.now();
  try {
    const selected = filterChecks(checks, argv);
    if (selected.length === 0) {
      console.error('no check matches');
      process.exit(2);
    }
    for (const check of selected) {
      for (const result of await check.run()) {
        console.log(redactSecrets(formatMeasure(result)));
        if (!result.pass) process.exit(1);
      }
    }
    console.log(`wall ${Math.round(performance.now() - start)} ms`);
    process.exit(0);
  } catch (error) {
    console.error(redactSecrets(error instanceof Error ? error.message : String(error)));
    process.exit(2);
  }
}
