import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { stagedViolations, trackedViolations } from '../../src/node/guard/index.ts'
import type { GuardViolation } from '../../src/node/guard/index.ts'

const REPO = fileURLToPath(new URL('../../', import.meta.url))

const inGit = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: REPO, encoding: 'utf8' }).status === 0
const skip = inGit ? false : 'not a git checkout (unpacked copy): nothing is tracked or staged'

function describe(violations: GuardViolation[]): string {
  return violations.map((v) => `${v.path}: ${v.reason} (${v.size} bytes)`).join('\n')
}

test('no tracked file of this repository violates the guard', { skip }, async () => {
  const violations = await trackedViolations(REPO)
  assert.equal(violations.length, 0, `tracked violations:\n${describe(violations)}`)
})

test('no staged file of this repository violates the guard', { skip }, async () => {
  const violations = await stagedViolations(REPO)
  assert.equal(violations.length, 0, `staged violations:\n${describe(violations)}`)
})

test('guard-check --tracked --json reports 0 violations here', { skip }, () => {
  const result = spawnSync(process.execPath, ['src/cli/main.ts', 'guard-check', '--tracked', '--json'], { cwd: REPO, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.mode, 'tracked')
  assert.equal(report.count, 0)
})
