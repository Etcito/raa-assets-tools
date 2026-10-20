import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ANCHOR_NAME_RE, ASSET_ID_RE, MATERIAL_ID_RE, NODE_ID_RE, PRIM_KINDS,
} from '../../src/format/constants.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SCHEMA_PATH = join(ROOT, 'schema', 'raa.prims.v0.schema.json')
const VALID_DIR = join(ROOT, 'fixtures', 'valid')

type Schema = Record<string, unknown>

function loadSchema(): Schema {
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as Schema
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function escapePointer(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1')
}

function typeMatches(type: string, v: unknown): boolean {
  switch (type) {
    case 'object': return isObject(v)
    case 'array': return Array.isArray(v)
    case 'string': return typeof v === 'string'
    case 'number': return typeof v === 'number'
    case 'integer': return Number.isInteger(v)
    case 'boolean': return typeof v === 'boolean'
    case 'null': return v === null
    default: throw new Error(`walker: unsupported type ${type}`)
  }
}

/**
 * A tiny JSON Schema walker covering the keywords the raa.prims schema uses.
 * Returns the list of `pointer: reason` errors (empty when the value conforms).
 */
function walk(root: Schema, schema: Schema, value: unknown, pointer: string, errors: string[]): void {
  if (typeof schema.$ref === 'string') {
    const ref = schema.$ref
    const m = /^#\/\$defs\/([^/]+)$/.exec(ref)
    if (!m) throw new Error(`walker: unsupported $ref ${ref}`)
    const defs = root.$defs as Record<string, Schema>
    const target = defs[m[1]!]
    if (!target) throw new Error(`walker: unknown $ref ${ref}`)
    walk(root, target, value, pointer, errors)
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type as string[] : [schema.type as string]
    if (!types.some(t => typeMatches(t, value))) {
      errors.push(`${pointer}: expected type ${types.join('|')}`)
      return
    }
  }
  if ('const' in schema && value !== schema.const) {
    errors.push(`${pointer}: expected const ${JSON.stringify(schema.const)}`)
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${pointer}: not in enum ${JSON.stringify(schema.enum)}`)
  }
  if (typeof value === 'string') {
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${pointer}: does not match ${schema.pattern}`)
    }
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`${pointer}: shorter than ${schema.minLength}`)
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push(`${pointer}: longer than ${schema.maxLength}`)
    }
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      errors.push(`${pointer}: fewer than ${schema.minItems} items`)
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      errors.push(`${pointer}: more than ${schema.maxItems} items`)
    }
    if (isObject(schema.items)) {
      value.forEach((item, i) => walk(root, schema.items as Schema, item, `${pointer}/${i}`, errors))
    }
  }
  if (isObject(value)) {
    const props = isObject(schema.properties) ? schema.properties as Record<string, Schema> : {}
    if (Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        if (!(key in value)) errors.push(`${pointer}/${escapePointer(key)}: required field missing`)
      }
    }
    for (const [key, v] of Object.entries(value)) {
      const at = `${pointer}/${escapePointer(key)}`
      if (isObject(schema.propertyNames)) walk(root, schema.propertyNames as Schema, key, at, errors)
      if (props[key]) walk(root, props[key], v, at, errors)
      else if (schema.additionalProperties === false) errors.push(`${at}: additional property not allowed`)
      else if (isObject(schema.additionalProperties)) walk(root, schema.additionalProperties as Schema, v, at, errors)
    }
  }
  if (Array.isArray(schema.oneOf)) walkOneOf(root, schema.oneOf as Schema[], value, pointer, errors)
}

/** oneOf: pick the branch whose `const` on kind or shape matches the value, then walk it. */
function walkOneOf(root: Schema, branches: Schema[], value: unknown, pointer: string, errors: string[]): void {
  if (!isObject(value)) return
  const discriminator = (branch: Schema): [string, unknown] | null => {
    const props = branch.properties as Record<string, Schema> | undefined
    for (const key of ['kind', 'shape']) {
      const p = props?.[key]
      if (p && 'const' in p) return [key, p.const]
    }
    return null
  }
  const matching = branches.filter(b => {
    const d = discriminator(b)
    if (!d) throw new Error(`walker: oneOf branch without a kind/shape const at ${pointer}`)
    return value[d[0]] === d[1]
  })
  if (matching.length !== 1) {
    errors.push(`${pointer}: oneOf matched ${matching.length} branches`)
    return
  }
  walk(root, matching[0]!, value, pointer, errors)
}

function validateAgainst(schema: Schema, value: unknown): string[] {
  const errors: string[] = []
  walk(schema, schema, value, '', errors)
  return errors
}

test('schema parses with draft 2020-12 and the v0 $id', () => {
  const schema = loadSchema()
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.equal(schema.$id, 'urn:raa:prims:v0')
})

test('schema kind enum and patterns equal constants.ts', () => {
  const schema = loadSchema()
  const defs = schema.$defs as Record<string, Schema>
  const top = schema.properties as Record<string, Schema>
  const node = defs.node!.properties as Record<string, Schema>
  const collider = defs.collider!.properties as Record<string, Schema>
  assert.deepEqual((node.kind as Schema).enum, [...PRIM_KINDS])
  assert.equal((node.id as Schema).pattern, NODE_ID_RE.source)
  assert.equal((node.material as Schema).pattern, MATERIAL_ID_RE.source)
  assert.equal((collider.node as Schema).pattern, NODE_ID_RE.source)
  assert.equal((top.id as Schema).pattern, ASSET_ID_RE.source)
  assert.equal(((top.materials as Schema).propertyNames as Schema).pattern, MATERIAL_ID_RE.source)
  assert.equal(((top.anchors as Schema).propertyNames as Schema).pattern, ANCHOR_NAME_RE.source)
  const kinds = (defs.node!.oneOf as Schema[]).map(b => ((b.properties as Record<string, Schema>).kind as Schema).const)
  assert.deepEqual(kinds, [...PRIM_KINDS])
})

test('every valid fixture satisfies the schema', () => {
  const schema = loadSchema()
  const files = readdirSync(VALID_DIR).filter(f => f.endsWith('.raa.prims.json')).sort()
  assert.ok(files.length > 0, 'no valid fixture found')
  for (const file of files) {
    const value: unknown = JSON.parse(readFileSync(join(VALID_DIR, file), 'utf8'))
    assert.deepEqual(validateAgainst(schema, value), [], `fixture ${file}`)
  }
})

test('the walker reports the failing pointer', () => {
  const schema = loadSchema()
  const file = readdirSync(VALID_DIR).filter(f => f.endsWith('.raa.prims.json')).sort()[0]!
  const asset = JSON.parse(readFileSync(join(VALID_DIR, file), 'utf8')) as Record<string, unknown>
  const nodes = asset.nodes as Record<string, unknown>[]
  nodes[0]!.extra = 1
  delete (nodes[0]!.transform as Record<string, unknown>).s
  ;(nodes[0]!.params as Record<string, unknown>).bogus = 2
  const errors = validateAgainst(schema, asset)
  assert.ok(errors.includes('/nodes/0/extra: additional property not allowed'), errors.join('\n'))
  assert.ok(errors.includes('/nodes/0/transform/s: required field missing'), errors.join('\n'))
  assert.ok(errors.includes('/nodes/0/params/bogus: additional property not allowed'), errors.join('\n'))
  nodes[0]!.kind = 'blob'
  assert.ok(validateAgainst(schema, asset).includes('/nodes/0: oneOf matched 0 branches'))
})

function listTsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...listTsFiles(path))
    else if (name.endsWith('.ts')) out.push(path)
  }
  return out
}

test('src/format and src/index.ts are browser-safe', () => {
  const files = [...listTsFiles(join(ROOT, 'src', 'format')), join(ROOT, 'src', 'index.ts')]
  assert.ok(files.length > 1)
  const problems: string[] = []
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const where = `${file.slice(ROOT.length)}:${i + 1}`
      // also catches the closing `} from 'node:…'` line of a multi-line import
      const isImportExport = /^\s*import\b/.test(line) || /\bfrom\s*['"]/.test(line) || /\bimport\s*\(/.test(line)
      if (isImportExport && line.includes('node:')) problems.push(`${where}: node: import`)
      if (/\bprocess\./.test(line)) problems.push(`${where}: process.`)
      if (/\bBuffer\b/.test(line)) problems.push(`${where}: Buffer`)
    })
  }
  assert.deepEqual(problems, [])
})
