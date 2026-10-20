import { GUARD_BLOCKED_EXTENSIONS, GUARD_HEAD_BYTES, GUARD_MARKER, GUARD_MAX_BYTES } from './rules.ts'

export const GUARD_FIX_LINE = 'put it in the asset store (raa-assets put <path>) and reference its sha256; see docs/private-assets.md'

// The pre-commit hook: one standalone Node ESM script with the rules of rules.ts inlined,
// so it works without raa-assets installed and can never drift from the library.
export function hookScript(): string {
  return `#!/usr/bin/env node
// ${GUARD_MARKER} — installed by raa-assets install-guard; do not edit
import { execFileSync } from 'node:child_process'

const BLOCKED_EXTENSIONS = ${JSON.stringify(GUARD_BLOCKED_EXTENSIONS)}
const MAX_BYTES = ${GUARD_MAX_BYTES}
const HEAD_BYTES = ${GUARD_HEAD_BYTES}
const FIX_LINE = ${JSON.stringify(GUARD_FIX_LINE)}

function git(args, encoding, maxBuffer) {
  return execFileSync('git', args, { encoding, maxBuffer, stdio: ['ignore', 'pipe', 'inherit'] })
}

function lastExtension(path) {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot).toLowerCase()
}

const paths = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRT'], 'utf8', 256 * 1024 * 1024)
  .split('\\0')
  .filter((path) => path !== '')

const violations = []
for (const path of paths) {
  const size = Number(git(['cat-file', '-s', ':' + path], 'utf8', 1024 * 1024).trim())
  let reason = null
  if (BLOCKED_EXTENSIONS.includes(lastExtension(path))) reason = 'asset-extension'
  else if (size > MAX_BYTES) reason = 'too-large'
  else if (git(['cat-file', 'blob', ':' + path], 'buffer', MAX_BYTES + 1).subarray(0, HEAD_BYTES).includes(0)) reason = 'binary'
  if (reason !== null) violations.push({ path, reason, size })
}

if (violations.length > 0) {
  const lines = ['raa-assets-guard: commit refused, ' + violations.length + ' file(s) must not enter git:']
  for (const v of violations) lines.push('  ' + v.path + ': ' + v.reason + ' (' + v.size + ' bytes)')
  lines.push(FIX_LINE)
  process.stderr.write(lines.join('\\n') + '\\n')
  process.exit(1)
}
process.exit(0)
`
}
