import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { REFUSAL_CODES, parseRaaPrims, serializeRaaPrims } from '../../src/index.ts'
import type { RefusalCode } from '../../src/index.ts'

interface Expected {
  valid: Record<string, { triangles: number }>
  refused: Record<string, { codes: RefusalCode[]; nodes: string[] }>
}

const FIXTURES = fileURLToPath(new URL('../../fixtures/', import.meta.url))
const expected = JSON.parse(readFileSync(`${FIXTURES}expected.json`, 'utf8')) as Expected
const validFiles = readdirSync(`${FIXTURES}valid`).filter((f) => f.endsWith('.raa.prims.json')).sort()
const refusedFiles = readdirSync(`${FIXTURES}refused`).filter((f) => f.endsWith('.json')).sort()

test('every fixture file has an expected entry and vice versa', () => {
  assert.deepEqual(validFiles, Object.keys(expected.valid).sort())
  assert.deepEqual(refusedFiles, Object.keys(expected.refused).sort())
})

test('at least 10 valid fixtures', () => {
  assert.ok(validFiles.length >= 10, `${validFiles.length} valid fixtures`)
})

test('every RefusalCode appears in at least one refused entry', () => {
  const covered = new Set(Object.values(expected.refused).flatMap((e) => e.codes))
  assert.deepEqual(REFUSAL_CODES.filter((c) => !covered.has(c)), [])
})

for (const file of validFiles) {
  test(`valid ${file}: ok, triangles, byte-identical round trip`, () => {
    const text = readFileSync(`${FIXTURES}valid/${file}`, 'utf8')
    const result = parseRaaPrims(text)
    assert.deepEqual(result.issues, [])
    assert.equal(result.ok, true)
    assert.equal(result.triangles, expected.valid[file]?.triangles)
    assert.ok(result.asset)
    const once = serializeRaaPrims(result.asset)
    assert.equal(once, text)
    const again = parseRaaPrims(once)
    assert.ok(again.asset)
    assert.equal(serializeRaaPrims(again.asset), once)
  })
}

for (const file of refusedFiles) {
  test(`refused ${file}: codes, nodes, paths, messages`, () => {
    const result = parseRaaPrims(readFileSync(`${FIXTURES}refused/${file}`, 'utf8'))
    const want = expected.refused[file]
    assert.ok(want, `no expected entry for ${file}`)
    assert.equal(result.ok, false)
    assert.deepEqual(result.issues.map((i) => i.code).sort(), want.codes)
    assert.deepEqual([...new Set(result.issues.flatMap((i) => i.nodes))].sort(), want.nodes)
    for (const issue of result.issues) {
      assert.ok(issue.path === '' || issue.path.startsWith('/'), `path ${JSON.stringify(issue.path)}`)
      assert.ok(issue.message.length > 0, `${issue.code} has an empty message`)
      for (const id of issue.nodes) {
        assert.ok(issue.message.includes(id), `${issue.code} message does not name '${id}': ${issue.message}`)
      }
    }
  })
}
