import { RaaError } from '../format/errors.ts'

export type ArgFlagType = 'boolean' | 'string' | 'string[]'

export interface ArgSpec {
  flags: Record<string, ArgFlagType>
}

export interface ParsedArgs {
  positional: string[]
  flags: Record<string, boolean | string | string[]>
}

const USAGE_FIX = 'run raa-assets <command> --help'

export function parseArgs(argv: string[], spec: ArgSpec): ParsedArgs {
  const positional: string[] = []
  const flags: Record<string, boolean | string | string[]> = {}
  let flagsDone = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (flagsDone || arg === '-' || !arg.startsWith('-')) {
      positional.push(arg)
      continue
    }
    if (arg === '--') {
      flagsDone = true
      continue
    }
    let name: string
    let inline: string | undefined
    const eq = arg.indexOf('=')
    if (arg.startsWith('--')) {
      name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2)
      inline = eq >= 0 ? arg.slice(eq + 1) : undefined
    } else if (arg === '-o') {
      name = 'out'
    } else if (arg.startsWith('-o=')) {
      name = 'out'
      inline = arg.slice(3)
    } else {
      throw new RaaError('USAGE', `unknown flag '${arg}'`, USAGE_FIX)
    }
    const type = spec.flags[name]
    if (type === undefined) {
      throw new RaaError('USAGE', `unknown flag '${arg}'`, USAGE_FIX)
    }
    if (type === 'boolean') {
      if (inline !== undefined) {
        throw new RaaError('USAGE', `flag '--${name}' takes no value`, USAGE_FIX)
      }
      flags[name] = true
      continue
    }
    let value: string
    if (inline !== undefined) {
      value = inline
    } else {
      const next = argv[i + 1]
      if (next === undefined) {
        throw new RaaError('USAGE', `flag '--${name}' needs a value`, USAGE_FIX)
      }
      value = next
      i++
    }
    if (type === 'string') {
      flags[name] = value
    } else {
      const list = Array.isArray(flags[name]) ? (flags[name] as string[]) : []
      list.push(value)
      flags[name] = list
    }
  }
  return { positional, flags }
}
