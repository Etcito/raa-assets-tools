// Git guard proof: git guard keeps assets and binaries out of repositories.
// node proof/guard.ts [--only <regex>]
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flag, measure, proofCpus, parallelMap, runProof } from './lib.ts';
import type { Measure, ProofCheck } from './lib.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CLI = 'src/cli/main.ts';

interface Run { code: number | null; stdout: string; stderr: string }

// The hook starts with '#!/usr/bin/env node': the node running this proof must come first on PATH.
function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: dirname(process.execPath) + delimiter + (process.env.PATH ?? '') };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[name];
  return env;
}

function exec(file: string, args: string[], cwd: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk; });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

const cli = (args: string[]): Promise<Run> => exec(process.execPath, [CLI, ...args], ROOT);
const git = (dir: string, args: string[]): Promise<Run> => exec('git', args, dir);

async function gitOk(dir: string, args: string[]): Promise<string> {
  const run = await git(dir, args);
  if (run.code !== 0) throw new Error(`git ${args.join(' ')} exited ${run.code}: ${run.stderr.trim()}`);
  return run.stdout.trim();
}

async function initRepo(dir: string): Promise<void> {
  await gitOk(dir, ['init', '-q']);
  await gitOk(dir, ['config', 'user.name', 'raa m3 proof']);
  await gitOk(dir, ['config', 'user.email', 'm3-proof@example.invalid']);
  await gitOk(dir, ['config', 'commit.gpgsign', 'false']);
}

/** A throwaway repo with the guard installed; removed after fn. */
async function withRepo<R>(name: string, fn: (dir: string) => Promise<R>, guard = true): Promise<R> {
  const dir = await mkdtemp(join(tmpdir(), `raa-m3-${name}-`));
  try {
    await initRepo(dir);
    if (guard) {
      const install = await cli(['install-guard', dir]);
      if (install.code !== 0) throw new Error(`install-guard exited ${install.code}: ${install.stderr.trim()}`);
    }
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const firstLine = (text: string, needle: string): string =>
  text.split('\n').find((line) => line.includes(needle))?.trim() ?? 'no matching line';

/** Stage the files and commit; returns the commit run and HEAD before and after. */
async function stageAndCommit(dir: string, files: Record<string, string>): Promise<{ commit: Run; before: string | null; after: string | null }> {
  const head = async () => {
    const run = await git(dir, ['rev-parse', '-q', '--verify', 'HEAD']);
    return run.code === 0 ? run.stdout.trim() : null;
  };
  for (const [path, content] of Object.entries(files)) await writeFile(join(dir, path), content);
  await gitOk(dir, ['add', '--', ...Object.keys(files)]);
  const before = await head();
  const commit = await git(dir, ['commit', '-m', 'x']);
  return { commit, before, after: await head() };
}

const refuseAsset: ProofCheck = {
  label: 'm3.refuse-asset',
  async run(): Promise<Measure[]> {
    return withRepo('asset', async (dir) => {
      const base = await stageAndCommit(dir, { 'a.ts': 'export const a = 1\n' });
      if (base.commit.code !== 0) throw new Error(`base commit exited ${base.commit.code}: ${base.commit.stderr.trim()}`);
      const { commit, before, after } = await stageAndCommit(dir, { 'fake.png': 'not really a png, just text\n' });
      const output = commit.stdout + commit.stderr;
      const needle = 'fake.png: asset-extension';
      return [
        flag('m3.refuse-asset.exit', commit.code !== 0, `exit ${commit.code}`),
        flag('m3.refuse-asset.named', output.includes(needle), firstLine(output, needle)),
        flag('m3.refuse-asset.head-unchanged', before !== null && before === after, `HEAD ${before?.slice(0, 12)} -> ${after?.slice(0, 12)}`),
      ];
    });
  },
};

const refuseBinarySize: ProofCheck = {
  label: 'm3.refuse-binary-size',
  async run(): Promise<Measure[]> {
    const cases = [
      { name: 'binary', file: 'data.dat', content: 'ab\0cd', needle: 'data.dat: binary' },
      { name: 'size', file: 'big.txt', content: 'a'.repeat(1048577), needle: 'big.txt: too-large (1048577 bytes)' },
    ];
    const results = await parallelMap(cases, (c) => withRepo(c.name, async (dir) => {
      const { commit } = await stageAndCommit(dir, { [c.file]: c.content });
      return { c, commit, output: commit.stdout + commit.stderr };
    }), proofCpus());
    return results.flatMap(({ c, commit, output }) => [
      flag(`m3.refuse-binary-size.${c.name}.exit`, commit.code !== 0, `exit ${commit.code}`),
      flag(`m3.refuse-binary-size.${c.name}.named`, output.includes(c.needle), firstLine(output, c.needle)),
    ]);
  },
};

const allowNormal: ProofCheck = {
  label: 'm3.allow-normal',
  async run(): Promise<Measure[]> {
    return withRepo('normal', async (dir) => {
      const { commit, before, after } = await stageAndCommit(dir, {
        'a.ts': 'export const a = 1\n',
        'b.json': '{"b": 2}\n',
      });
      return [
        flag('m3.allow-normal.exit', commit.code === 0, `exit ${commit.code}${commit.code === 0 ? '' : `, ${commit.stderr.trim().split('\n')[0]}`}`),
        flag('m3.allow-normal.head-moved', after !== null && after !== before, `HEAD ${before?.slice(0, 12) ?? 'none'} -> ${after?.slice(0, 12) ?? 'none'}`),
      ];
    });
  },
};

interface InstallJson { hookPath: string; action: string; backup: string | null }

const install: ProofCheck = {
  label: 'm3.install',
  async run(): Promise<Measure[]> {
    const cases = ['reinstall', 'foreign'] as const;
    const results = await parallelMap(cases, (name): Promise<Measure[]> => {
      if (name === 'reinstall') {
        return withRepo('reinstall', async (dir) => {
          const again = await cli(['install-guard', dir, '--json']);
          const action = again.code === 0 ? (JSON.parse(again.stdout) as InstallJson).action : `exit ${again.code}`;
          return [flag('m3.install.unchanged', action === 'unchanged', `action ${action}`)];
        });
      }
      return withRepo('foreign', async (dir) => {
        const hook = resolve(dir, await gitOk(dir, ['rev-parse', '--git-path', 'hooks/pre-commit']));
        const foreign = '#!/bin/sh\nexit 0\n';
        await writeFile(hook, foreign);
        await chmod(hook, 0o755);
        const refused = await cli(['install-guard', dir]);
        const kept = await readFile(hook, 'utf8');
        const forced = await cli(['install-guard', dir, '--force', '--json']);
        const result = forced.code === 0 ? JSON.parse(forced.stdout) as InstallJson : null;
        const backupBytes = result?.backup ? await readFile(result.backup, 'utf8').catch(() => null) : null;
        const fresh = await readFile(hook, 'utf8');
        return [
          flag('m3.install.foreign-refused', refused.code === 1 && refused.stderr.includes('GUARD_FOREIGN_HOOK'), `exit ${refused.code}, ${firstLine(refused.stderr, 'GUARD_FOREIGN_HOOK')}`),
          flag('m3.install.foreign-kept', kept === foreign, kept === foreign ? 'hook unchanged' : 'hook changed'),
          flag('m3.install.force', result?.action === 'installed' && (result.backup ?? '').endsWith('pre-commit.bak-1'), `exit ${forced.code}, action ${result?.action}, backup ${result?.backup?.slice(-16)}`),
          flag('m3.install.backup-bytes', backupBytes === foreign, backupBytes === foreign ? 'backup holds the foreign hook' : 'backup differs'),
          flag('m3.install.new-hook', fresh.includes('raa-assets-guard v1'), fresh.includes('raa-assets-guard v1') ? 'hook has raa-assets-guard v1' : 'marker missing'),
        ];
      }, false);
    }, proofCpus());
    return results.flat();
  },
};

interface GuardCheckJson { mode: string; count: number; violations: Array<{ path: string; reason: string; size: number }> }

const repoClean: ProofCheck = {
  label: 'm3.repo-clean',
  async run(): Promise<Measure[]> {
    const run = await cli(['guard-check', '--tracked', '--json']);
    const report = JSON.parse(run.stdout) as GuardCheckJson;
    for (const v of report.violations) console.log(`  ${v.path}: ${v.reason} (${v.size} bytes)`);
    return [
      flag('m3.repo-clean.exit', run.code === 0, `exit ${run.code}, mode ${report.mode}`),
      measure('m3.repo-clean.violations', report.count, '==', 0),
    ];
  },
};

await runProof([refuseAsset, refuseBinarySize, allowNormal, install, repoClean]);
