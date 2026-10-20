import type { RaaIssue, RefusalCode } from './types.ts'
import { MAX_ABS_NUMBER, NUMBER_DECIMALS } from './constants.ts'

export interface IssueSink {
  readonly issues: RaaIssue[]
  add(code: RefusalCode, path: string, message: string, nodes?: readonly string[]): void
}

export function createSink(): IssueSink {
  const issues: RaaIssue[] = []
  return {
    issues,
    add(code, path, message, nodes = []) {
      issues.push({ code, path, message, nodes: [...nodes] })
    },
  }
}

export function ptr(base: string, ...keys: (string | number)[]): string {
  let out = base
  for (const key of keys) {
    out += '/' + String(key).replace(/~/g, '~0').replace(/\//g, '~1')
  }
  return out
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  try {
    const proto = Object.getPrototypeOf(v)
    return proto === Object.prototype || proto === null
  } catch {
    return false
  }
}

export function checkKeys(
  sink: IssueSink,
  obj: Record<string, unknown>,
  path: string,
  allowed: readonly string[],
  required: readonly string[],
  nodes: readonly string[],
): boolean {
  let clean = true
  for (const key of required) {
    if (!Object.hasOwn(obj, key)) {
      sink.add('MISSING_FIELD', ptr(path, key), `missing required field '${key}'`, nodes)
      clean = false
    }
  }
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(obj)) {
    if (!allowedSet.has(key)) {
      sink.add('UNKNOWN_FIELD', ptr(path, key), `unknown field '${key}'`, nodes)
      clean = false
    }
  }
  return clean
}

export function readNumber(
  sink: IssueSink,
  v: unknown,
  path: string,
  nodes: readonly string[],
  badCode: RefusalCode,
): number | null {
  if (typeof v !== 'number') {
    sink.add(badCode, path, `expected a number, got ${describeValue(v)}`, nodes)
    return null
  }
  if (!Number.isFinite(v)) {
    sink.add('NUMBER_NOT_FINITE', path, `number must be finite, got ${String(v)}`, nodes)
    return null
  }
  if (Math.abs(v) > MAX_ABS_NUMBER) {
    sink.add('NUMBER_RANGE', path, `number must have absolute value at most ${MAX_ABS_NUMBER}`, nodes)
    return null
  }
  return v
}

export function readVec(
  sink: IssueSink,
  v: unknown,
  n: 3 | 4,
  path: string,
  nodes: readonly string[],
  badCode: RefusalCode,
): number[] | null {
  if (!Array.isArray(v)) {
    sink.add(badCode, path, `expected an array of ${n} numbers, got ${describeValue(v)}`, nodes)
    return null
  }
  if (v.length !== n) {
    sink.add(badCode, path, `expected an array of exactly ${n} numbers, got ${v.length}`, nodes)
    return null
  }
  const out: number[] = []
  let clean = true
  for (let i = 0; i < n; i++) {
    const item = readNumber(sink, v[i], ptr(path, i), nodes, badCode)
    if (item === null) clean = false
    else out.push(item)
  }
  return clean ? out : null
}

export function roundCanonical(x: number): number {
  const rounded = Number(x.toFixed(NUMBER_DECIMALS))
  return rounded === 0 ? 0 : rounded
}

export function scanJsonValue(sink: IssueSink, v: unknown, path: string): boolean {
  return scanValue(sink, v, path, new WeakSet<object>())
}

function scanValue(sink: IssueSink, v: unknown, path: string, seen: WeakSet<object>): boolean {
  switch (typeof v) {
    case 'undefined':
    case 'function':
    case 'symbol':
    case 'bigint':
      sink.add('BAD_TYPE', path, `value is ${typeof v}, which is not valid JSON`)
      return false
    case 'number':
    case 'string':
    case 'boolean':
      return true
    case 'object': {
      if (v === null) return true
      if (seen.has(v)) {
        sink.add('BAD_TYPE', path, 'value contains a cycle, which is not valid JSON')
        return false
      }
      seen.add(v)
      try {
        if (Array.isArray(v)) {
          let clean = true
          for (let i = 0; i < v.length; i++) {
            if (!scanValue(sink, v[i], ptr(path, i), seen)) clean = false
          }
          return clean
        }
        if (!isRecord(v)) {
          sink.add(
            'BAD_TYPE',
            path,
            `value is a ${objectTag(v)}, which is not a plain JSON object`,
          )
          return false
        }
        let clean = true
        for (const key of Object.keys(v)) {
          if (!scanValue(sink, v[key], ptr(path, key), seen)) clean = false
        }
        return clean
      } catch {
        sink.add('BAD_TYPE', path, 'value could not be read as JSON')
        return false
      } finally {
        seen.delete(v)
      }
    }
  }
}

function describeValue(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'object') return objectTag(v)
  return typeof v
}

function objectTag(v: object): string {
  try {
    const tag = Object.prototype.toString.call(v).slice(8, -1)
    return tag.length > 0 ? tag : 'object'
  } catch {
    return 'object'
  }
}
