import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RaaError } from '../../src/format/errors.ts'
import {
  contentTypeFor,
  parseManifest,
  serializeManifest,
  validateManifest
} from '../../src/manifest/index.ts'

const HASH_A = 'a'.repeat(64)
const HASH_B = '0123456789abcdef'.repeat(4)

function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { sha256: HASH_A, size: 10, contentType: 'application/json', version: 1, ...over }
}

function base(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { format: 'raa.manifest', version: 0, name: 'set', entries: { 'a.one': entry() }, ...over }
}

function codes(value: unknown): string[] {
  return validateManifest(value).issues.map((i) => `${i.code} ${i.path}`)
}

const EXPECTED = `{
  "format": "raa.manifest",
  "version": 0,
  "name": "set",
  "entries": {
    "a.first": {
      "sha256": "${HASH_A}",
      "size": 52428800,
      "contentType": "model/gltf-binary",
      "version": 2
    },
    "b.second": {
      "sha256": "${HASH_B}",
      "size": 12,
      "contentType": "application/vnd.raa.prims+json",
      "version": 1
    }
  }
}
`

test('valid manifest validates and serializes canonically', () => {
  const m = {
    format: 'raa.manifest',
    version: 0,
    name: 'set',
    entries: {
      'b.second': { sha256: HASH_B, size: 12, contentType: 'application/vnd.raa.prims+json', version: 1 },
      'a.first': { sha256: HASH_A, size: 52428800, contentType: 'model/gltf-binary', version: 2 }
    }
  }
  const v = validateManifest(m)
  assert.equal(v.ok, true)
  assert.equal(v.issues.length, 0)
  const text = serializeManifest(v.manifest!)
  assert.equal(text, EXPECTED)
  const parsed = parseManifest(text)
  assert.equal(parsed.ok, true)
  assert.equal(serializeManifest(parsed.manifest!), text)
})

test('empty entries serialize as {}', () => {
  const text = serializeManifest({ format: 'raa.manifest', version: 0, name: 'x', entries: {} })
  assert.equal(text, '{\n  "format": "raa.manifest",\n  "version": 0,\n  "name": "x",\n  "entries": {}\n}\n')
})

test('JSON_PARSE', () => {
  const r = parseManifest('{')
  assert.equal(r.ok, false)
  assert.equal(r.manifest, null)
  assert.deepEqual(r.issues.map((i) => [i.code, i.path]), [['JSON_PARSE', '']])
})

test('NOT_OBJECT', () => {
  const r = parseManifest('[]')
  assert.deepEqual(r.issues.map((i) => [i.code, i.path]), [['NOT_OBJECT', '']])
})

test('BAD_FORMAT and BAD_VERSION', () => {
  assert.deepEqual(codes(base({ format: 'other' })), ['BAD_FORMAT /format'])
  assert.deepEqual(codes(base({ version: 1 })), ['BAD_VERSION /version'])
})

test('MISSING_FIELD', () => {
  const m = base()
  delete m.entries
  assert.deepEqual(codes(m), ['MISSING_FIELD /entries'])
  assert.deepEqual(codes(base({ entries: { 'a.one': { sha256: HASH_A } } })), [
    'MISSING_FIELD /entries/a.one/size',
    'MISSING_FIELD /entries/a.one/contentType',
    'MISSING_FIELD /entries/a.one/version'
  ])
})

test('UNKNOWN_FIELD at top and in an entry', () => {
  assert.deepEqual(codes(base({ extra: 1 })), ['UNKNOWN_FIELD /extra'])
  assert.deepEqual(codes(base({ entries: { 'a.one': entry({ extra: 1 }) } })), ['UNKNOWN_FIELD /entries/a.one/extra'])
})

test('BAD_TYPE', () => {
  assert.deepEqual(codes(base({ name: 5 })), ['BAD_TYPE /name'])
  assert.deepEqual(codes(base({ entries: [] })), ['BAD_TYPE /entries'])
  assert.deepEqual(codes(base({ entries: { 'a.one': 'x' } })), ['BAD_TYPE /entries/a.one'])
  assert.deepEqual(codes(base({ entries: { 'a.one': entry({ size: '1' }) } })), ['BAD_TYPE /entries/a.one/size'])
})

test('BAD_NAME', () => {
  assert.deepEqual(codes(base({ name: 'Bad Name' })), ['BAD_NAME /name'])
  assert.deepEqual(codes(base({ entries: { '9x': entry() } })), ['BAD_NAME /entries/9x'])
})

test('BAD_HASH', () => {
  assert.deepEqual(codes(base({ entries: { 'a.one': entry({ sha256: 'A'.repeat(64) }) } })), ['BAD_HASH /entries/a.one/sha256'])
})

test('BAD_SIZE', () => {
  for (const size of [52428801, -1, 1.5]) {
    assert.deepEqual(codes(base({ entries: { 'a.one': entry({ size }) } })), ['BAD_SIZE /entries/a.one/size'])
  }
})

test('BAD_CONTENT_TYPE', () => {
  assert.deepEqual(codes(base({ entries: { 'a.one': entry({ contentType: '' }) } })), ['BAD_CONTENT_TYPE /entries/a.one/contentType'])
})

test('BAD_ENTRY_VERSION', () => {
  assert.deepEqual(codes(base({ entries: { 'a.one': entry({ version: 0 }) } })), ['BAD_ENTRY_VERSION /entries/a.one/version'])
})

test('several faults are all reported', () => {
  const r = validateManifest(base({
    format: 'x',
    name: 'Bad Name',
    entries: { 'a.one': entry({ sha256: 'zz', size: -1, version: 0 }) }
  }))
  assert.equal(r.ok, false)
  assert.equal(r.manifest, null)
  assert.deepEqual(r.issues.map((i) => i.code).sort(), [
    'BAD_ENTRY_VERSION', 'BAD_FORMAT', 'BAD_HASH', 'BAD_NAME', 'BAD_SIZE'
  ])
})

test('serializeManifest throws MANIFEST_INVALID on an invalid manifest', () => {
  assert.throws(
    () => serializeManifest(base({ name: 'Bad Name' }) as never),
    (e: unknown) => e instanceof RaaError && e.code === 'MANIFEST_INVALID'
  )
})

test('contentTypeFor covers the S6 table', () => {
  assert.equal(contentTypeFor('x.raa.prims.json'), 'application/vnd.raa.prims+json')
  assert.equal(contentTypeFor('x.sdfm.json'), 'application/vnd.sdfm+json')
  assert.equal(contentTypeFor('x.json'), 'application/json')
  assert.equal(contentTypeFor('X.PNG'), 'image/png')
  assert.equal(contentTypeFor('x.jpg'), 'image/jpeg')
  assert.equal(contentTypeFor('x.jpeg'), 'image/jpeg')
  assert.equal(contentTypeFor('x.glb'), 'model/gltf-binary')
  assert.equal(contentTypeFor('x.txt'), 'application/octet-stream')
  assert.equal(contentTypeFor('noext'), 'application/octet-stream')
})
