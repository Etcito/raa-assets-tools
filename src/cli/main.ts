#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { RaaError } from '../format/errors.ts'
import { redactSecrets } from '../node/redact.ts'
import type { CliCommand, CliIo } from './types.ts'

const EXIT_1_CODES = new Set([
  'OBJECT_TOO_LARGE',
  'OBJECT_HASH_MISMATCH',
  'MANIFEST_INVALID',
  'ASSET_INVALID',
  'GC_ROOT_NOT_MANIFEST',
])

const EXIT_2_CODES = new Set([
  'USAGE',
  'UNKNOWN_COMMAND',
  'NO_STORE',
  'BAD_HASH',
  'BAD_ROOT_NAME',
  'GC_DELETE_UNAVAILABLE',
])

function exitCodeFor(code: string): number {
  if (EXIT_1_CODES.has(code)) return 1
  if (EXIT_2_CODES.has(code)) return 2
  return 3
}

function defaultIo(): CliIo {
  return {
    stdout: (s) => {
      process.stdout.write(s)
    },
    stderr: (s) => {
      process.stderr.write(s)
    },
    env: process.env,
    cwd: process.cwd(),
  }
}

async function discoverCommands(): Promise<CliCommand[]> {
  const dir = new URL('./commands/', import.meta.url)
  const fromSources = import.meta.url.endsWith('.ts')
  const entries = await readdir(dir, { withFileTypes: true })
  const names = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => (fromSources ? name.endsWith('.ts') : name.endsWith('.js') && !name.endsWith('.d.ts')))
    .sort()
  const commands: CliCommand[] = []
  for (const name of names) {
    const mod: { command?: CliCommand } = await import(new URL(name, dir).href)
    if (mod.command) commands.push(mod.command)
  }
  return commands
}

function printCommandList(commands: CliCommand[], io: CliIo): void {
  io.stdout('raa-assets <command> [options]\n')
  for (const command of commands) {
    io.stdout(`  ${command.name}  ${command.summary}\n`)
  }
}

function reportError(error: unknown, io: CliIo): number {
  if (error instanceof RaaError) {
    io.stderr(redactSecrets(`error ${error.code}: ${error.message}\n`, io.env))
    io.stderr(redactSecrets(`  fix: ${error.fix}\n`, io.env))
    return exitCodeFor(error.code)
  }
  const message = error instanceof Error ? error.message : String(error)
  io.stderr(redactSecrets(`error INTERNAL: ${message}\n`, io.env))
  return 3
}

export async function main(argv: string[], io: CliIo = defaultIo()): Promise<number> {
  let commands: CliCommand[]
  try {
    commands = await discoverCommands()
  } catch (error) {
    return reportError(error, io)
  }
  const first = argv[0]
  if (first === undefined || first === '--help' || first === 'help') {
    printCommandList(commands, io)
    return first === undefined ? 2 : 0
  }
  const command = commands.find((candidate) => candidate.name === first)
  if (!command) {
    return reportError(
      new RaaError('UNKNOWN_COMMAND', `unknown command '${first}'`, 'run raa-assets --help to list the commands'),
      io,
    )
  }
  const rest = argv.slice(1)
  if (rest.includes('--help')) {
    io.stdout(`${command.usage}\n`)
    return 0
  }
  try {
    return await command.run(rest, io)
  } catch (error) {
    return reportError(error, io)
  }
}

function isEntryModule(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href
  } catch {
    return false
  }
}

if (isEntryModule()) {
  process.exitCode = await main(process.argv.slice(2))
}
