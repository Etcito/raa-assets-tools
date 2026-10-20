import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseRaaPrims, RaaError } from '../../index.ts'
import { parseArgs } from '../args.ts'
import type { ArgSpec } from '../args.ts'
import type { CliCommand, CliIo } from '../types.ts'

interface ValidateIssueJson {
  code: string
  path: string
  message: string
}

interface ValidateFileJson {
  file: string
  ok: boolean
  triangles: number | null
  budget: number | null
  issues: ValidateIssueJson[]
}

const spec: ArgSpec = { flags: { json: 'boolean', help: 'boolean' } }

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new RaaError('FILE_READ_FAILED', `cannot read '${path}': ${detail}`, 'check the path and its permissions')
  }
}

async function run(argv: string[], io: CliIo): Promise<number> {
  const { positional, flags } = parseArgs(argv, spec)
  if (positional.length === 0) {
    throw new RaaError('USAGE', 'validate needs at least one file', 'run raa-assets validate <file>...')
  }
  const files: ValidateFileJson[] = []
  for (const file of positional) {
    const text = await readText(resolve(io.cwd, file))
    const validation = parseRaaPrims(text)
    files.push({
      file,
      ok: validation.ok,
      triangles: validation.triangles,
      budget: validation.asset === null ? null : validation.asset.budget.triangles,
      issues: validation.issues.map((issue) => ({ code: issue.code, path: issue.path, message: issue.message })),
    })
  }
  if (flags.json === true) {
    io.stdout(`${JSON.stringify({ files }, null, 2)}\n`)
  } else {
    for (const entry of files) {
      if (entry.ok) {
        io.stdout(`ok ${entry.file}  triangles ${entry.triangles}/${entry.budget}\n`)
      } else {
        io.stdout(`refused ${entry.file}\n`)
        for (const issue of entry.issues) {
          io.stdout(`  ${issue.code} ${issue.path}: ${issue.message}\n`)
        }
      }
    }
  }
  return files.some((file) => !file.ok) ? 1 : 0
}

export const command: CliCommand = {
  name: 'validate',
  summary: 'parse raa.prims files and report issues',
  usage: 'raa-assets validate <file>... [--json]',
  run,
}
