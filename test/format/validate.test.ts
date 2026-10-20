import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveColliders } from '../../src/format/colliders.ts'
import type { RaaNode, RaaPrimsAsset, RaaValidation } from '../../src/format/types.ts'
import { parseRaaPrims } from '../../src/format/parse.ts'
import { validateRaaPrims } from '../../src/format/validate.ts'

/** A minimal valid asset as plain JSON, without a budget. */
function validJson(): Record<string, unknown> {
  const nodes: RaaNode[] = [
    {
      id: 'body', kind: 'sphere', params: { radius: 0.5 },
      transform: { t: [0, 1, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, material: 'red', op: 'union',
    },
  ]
  return JSON.parse(JSON.stringify({
    format: 'raa.prims',
    version: 0,
    id: 'demo',
    name: 'Demo',
    nodes,
    materials: { red: { color: [1, 0, 0], roughness: 0.5, metallic: 0, emissive: [0, 0, 0] } },
    anchors: { spawn: { t: [0, 0, 0], r: [0, 0, 0, 1] } },
    collision: { mode: 'derived', colliders: deriveColliders({ nodes }) },
  })) as Record<string, unknown>
}

function codes(result: RaaValidation): string[] {
  return result.issues.map((issue) => issue.code)
}

function assertSane(result: RaaValidation): void {
  assert.equal(typeof result.ok, 'boolean')
  assert.ok(Array.isArray(result.issues))
  assert.ok(result.triangles === null || Number.isInteger(result.triangles))
  assert.equal(result.ok, result.issues.length === 0)
  if (result.ok) assert.notEqual(result.asset, null)
  else assert.equal(result.asset, null)
}

test('a minimal valid asset without budget is accepted with the default budget', () => {
  const input = validJson()
  const result = validateRaaPrims(input)
  assert.deepEqual(result.issues, [])
  assert.equal(result.ok, true)
  assert.equal(result.triangles, 224)
  assert.deepEqual(result.asset?.budget, { triangles: 1500, segments: 16 })
  assert.equal(result.asset?.nodes, input.nodes)
  assert.equal(Object.hasOwn(input, 'budget'), false)
})

test('all issues are collected in S5 order', () => {
  const input = validJson()
  input.name = ''
  const nodes = input.nodes as Record<string, unknown>[]
  nodes[0]!.material = 'blue'
  nodes.push({
    id: 'eye', kind: 'sphere', params: { radius: 0 },
    transform: { t: [1, 1, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, material: 'red', op: 'union',
  })
  const result = validateRaaPrims(input)
  assertSane(result)
  assert.deepEqual(codes(result), ['BAD_NAME', 'UNKNOWN_MATERIAL', 'PARAM_RANGE'])
  assert.deepEqual(result.issues.map((issue) => issue.path), ['/name', '/nodes/0/material', '/nodes/1/params/radius'])
  assert.deepEqual(result.issues[1]!.nodes, ['body'])
  assert.deepEqual(result.issues[2]!.nodes, ['eye'])
  assert.equal(result.triangles, null)
})

test('triangles is null when step 5 fails', () => {
  const input = validJson()
  ;(input.nodes as Record<string, unknown>[])[0]!.op = 'subtract'
  const result = validateRaaPrims(input)
  assertSane(result)
  assert.deepEqual(codes(result), ['BOOL_NO_HOST'])
  assert.equal(result.triangles, null)
  assert.equal(result.asset, null)
})

test('BUDGET_EXCEEDED keeps the computed triangle count', () => {
  const input = validJson()
  input.budget = { triangles: 100, segments: 16 }
  const result = validateRaaPrims(input)
  assertSane(result)
  assert.deepEqual(codes(result), ['BUDGET_EXCEEDED'])
  assert.equal(result.triangles, 224)
})

test('NaN and -Infinity give NUMBER_NOT_FINITE without throwing', () => {
  const input = validJson()
  const node = (input.nodes as Record<string, any>[])[0]!
  node.params.radius = Number.NaN
  node.transform.t[0] = Number.NEGATIVE_INFINITY
  const result = validateRaaPrims(input)
  assertSane(result)
  const notFinite = result.issues.filter((issue) => issue.code === 'NUMBER_NOT_FINITE')
  assert.deepEqual(notFinite.map((issue) => issue.path).sort(), ['/nodes/0/params/radius', '/nodes/0/transform/t/0'])
  assert.ok(notFinite.every((issue) => issue.nodes.includes('body')))
  assert.equal(result.triangles, null)
})

test('a cyclic object, undefined, a function and a BigInt are refused without throwing', () => {
  const cyclic = validJson()
  ;(cyclic.anchors as Record<string, unknown>).self = cyclic
  const withUndefined = validJson()
  withUndefined.name = undefined
  const withFunction = validJson()
  withFunction.extra = () => 1
  const withBigInt = validJson()
  withBigInt.version = 0n
  for (const value of [cyclic, undefined, withUndefined, withFunction, withBigInt, () => 1, 1n, new Map()]) {
    const result = validateRaaPrims(value)
    assertSane(result)
    assert.equal(result.ok, false)
    assert.ok(result.issues.length >= 1)
    assert.ok(result.issues.every((issue) => issue.code === 'BAD_TYPE'))
    assert.equal(result.triangles, null)
  }
  assert.equal(validateRaaPrims(cyclic).issues[0]!.path, '/anchors/self')
})

test('an unreadable input becomes one BAD_TYPE issue at the root', () => {
  const hostile = new Proxy({}, {
    getPrototypeOf() { throw new Error('boom') },
    ownKeys() { throw new Error('boom') },
  })
  const result = validateRaaPrims(hostile)
  assertSane(result)
  assert.equal(result.issues.length, 1)
  assert.equal(result.issues[0]!.code, 'BAD_TYPE')
  assert.equal(result.issues[0]!.path, '')
})

test('parseRaaPrims refuses a syntax error with one JSON_PARSE issue', () => {
  const result = parseRaaPrims('{')
  assert.equal(result.ok, false)
  assert.equal(result.issues.length, 1)
  assert.equal(result.issues[0]!.code, 'JSON_PARSE')
  assert.equal(result.issues[0]!.path, '')
  assert.ok(result.issues[0]!.message.length > 'The text is not valid JSON: .'.length)
  assert.equal(result.triangles, null)
  assert.equal(result.asset, null)
})

test('parseRaaPrims refuses 1e400 as NUMBER_NOT_FINITE plus the structural issues', () => {
  const result = parseRaaPrims('{"a":1e400}')
  assertSane(result)
  const found = codes(result)
  assert.ok(found.includes('NUMBER_NOT_FINITE'), `codes: ${found.join(', ')}`)
  assert.ok(found.includes('MISSING_FIELD'))
  assert.ok(found.includes('UNKNOWN_FIELD'))
  assert.equal(result.issues.find((issue) => issue.code === 'NUMBER_NOT_FINITE')?.path, '/a')
  assert.equal(found.filter((code) => code === 'NUMBER_NOT_FINITE').length, 1)
  const parsed = parseRaaPrims(JSON.stringify(validJson()))
  assert.equal(parsed.ok, true)
  assert.equal(parsed.triangles, 224)
})

test('200 random mutations of the valid asset never throw and never give NaN', () => {
  let seed = 0x2545f491
  const random = (): number => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
    return (seed >>> 0) / 0x100000000
  }
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!
  const values: unknown[] = [
    Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 0.5, 1e7, 3.7, '', 'x', 'subtract', 'torus', 'override',
    null, true, [], {}, [1, 2, 3], [0, 0, 0, 1], undefined,
  ]
  const containers = (root: unknown): { obj: any; key: string | number }[] => {
    const out: { obj: any; key: string | number }[] = []
    const seen = new Set<unknown>()
    const walk = (v: unknown): void => {
      if (seen.has(v)) return
      if (v !== null && typeof v === 'object') seen.add(v)
      if (Array.isArray(v)) v.forEach((item, i) => { out.push({ obj: v, key: i }); walk(item) })
      else if (v !== null && typeof v === 'object') {
        for (const key of Object.keys(v)) { out.push({ obj: v, key }); walk((v as any)[key]) }
      }
    }
    walk(root)
    return out
  }
  let accepted = 0
  for (let round = 0; round < 200; round++) {
    const input: any = validJson()
    const mutations = 1 + Math.floor(random() * 3)
    for (let m = 0; m < mutations; m++) {
      const slot = pick(containers(input))
      const action = random()
      if (action < 0.15 && !Array.isArray(slot.obj)) delete slot.obj[slot.key]
      else if (action < 0.25) slot.obj[slot.key] = input
      else if (action < 0.3) slot.obj[slot.key] = structuredClone(input)
      else slot.obj[slot.key] = pick(values)
    }
    const result = validateRaaPrims(input)
    assertSane(result)
    assert.ok(!Number.isNaN(result.triangles))
    if (result.ok) accepted++
  }
  assert.ok(accepted < 200)
})
