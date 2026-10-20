import test from 'node:test'
import assert from 'node:assert/strict'
import { deriveColliders } from '../../src/format/colliders.ts'
import type { RaaPrimsAsset } from '../../src/format/types.ts'
import { checkCollision } from '../../src/format/validate-collision.ts'
import { createSink } from '../../src/format/validate-util.ts'
import type { IssueSink } from '../../src/format/validate-util.ts'

function baseAsset(): RaaPrimsAsset {
  return {
    format: 'raa.prims',
    version: 0,
    id: 'demo',
    name: 'Demo',
    budget: { triangles: 1500, segments: 16 },
    nodes: [
      {
        id: 'body', kind: 'sphere', params: { radius: 0.5 },
        transform: { t: [0, 1, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }, material: 'red', op: 'union',
      },
      {
        id: 'crate', kind: 'box', params: { size: [1, 2, 3] },
        transform: { t: [2, 0, 0], r: [0, 0.7071068, 0, 0.7071068], s: [1, 1, 1] }, material: 'red', op: 'union',
      },
    ],
    materials: { red: { color: [1, 0, 0], roughness: 0.5, metallic: 0, emissive: [0, 0, 0] } },
    anchors: {},
    collision: { mode: 'derived', colliders: [] },
  }
}

const NODE_IDS: ReadonlySet<string> = new Set(['body', 'crate'])

/** A JSON copy of the asset with the given colliders, as the validator receives it. */
function topWith(asset: RaaPrimsAsset, mode: string, colliders: unknown[]): Record<string, unknown> {
  const top = JSON.parse(JSON.stringify(asset)) as Record<string, unknown>
  top.collision = { mode, colliders }
  return top
}

function run(top: Record<string, unknown>, asset: RaaPrimsAsset | null): IssueSink {
  const sink = createSink()
  checkCollision(top, NODE_IDS, asset, sink)
  return sink
}

function derivedJson(asset: RaaPrimsAsset): Record<string, unknown>[] {
  return JSON.parse(JSON.stringify(deriveColliders(asset))) as Record<string, unknown>[]
}

test('a derived list that matches gives no issue, also with rounded numbers and a negated quaternion', () => {
  const asset = baseAsset()
  assert.deepEqual(run(topWith(asset, 'derived', derivedJson(asset)), asset).issues, [])
  const rounded = derivedJson(asset).map((c) => ({
    ...c,
    t: (c.t as number[]).map((x) => Number(x.toFixed(6))),
    r: (c.r as number[]).map((x) => -Number(x.toFixed(6))),
  }))
  assert.deepEqual(run(topWith(asset, 'derived', rounded), asset).issues, [])
})

test('a stale radius gives one COLLISION_STALE naming the node', () => {
  const asset = baseAsset()
  const colliders = derivedJson(asset)
  colliders[0]!.params = { radius: 0.6 }
  const issues = run(topWith(asset, 'derived', colliders), asset).issues
  assert.equal(issues.length, 1, JSON.stringify(issues))
  const issue = issues[0]!
  assert.equal(issue.code, 'COLLISION_STALE')
  assert.equal(issue.path, '/collision/colliders')
  assert.deepEqual(issue.nodes, ['body'])
  assert.match(issue.message, /expected 2 colliders, found 2/)
  assert.match(issue.message, /index 0/)
  assert.match(issue.message, /'body'/)
})

test('a missing collider gives COLLISION_STALE with the counts', () => {
  const asset = baseAsset()
  const colliders = derivedJson(asset).slice(0, 1)
  const issues = run(topWith(asset, 'derived', colliders), asset).issues
  assert.equal(issues.length, 1, JSON.stringify(issues))
  assert.equal(issues[0]!.code, 'COLLISION_STALE')
  assert.deepEqual(issues[0]!.nodes, ['crate'])
  assert.match(issues[0]!.message, /expected 2 colliders, found 1; the first difference is at index 1/)
})

test('COLLISION_STALE is not checked without a valid asset, in override mode or with a bad entry', () => {
  const asset = baseAsset()
  assert.deepEqual(run(topWith(asset, 'derived', []), null).issues, [])
  assert.deepEqual(run(topWith(asset, 'override', []), asset).issues, [])
  const colliders = derivedJson(asset)
  colliders[1]!.params = { halfExtents: [1, -1, 1] }
  const codes = run(topWith(asset, 'derived', colliders.slice(1)), asset).issues.map((i) => i.code)
  assert.deepEqual(codes, ['BAD_COLLIDER'])
})

test('override entries with a bad shape, wrong params keys and a negative radius give BAD_COLLIDER', () => {
  const asset = baseAsset()
  const base = { node: 'body', t: [0, 0, 0], r: [0, 0, 0, 1] }
  const issues = run(topWith(asset, 'override', [
    { ...base, shape: 'blob', params: { radius: 1 } },
    { ...base, shape: 'capsule', params: { radius: 1 } },
    { ...base, shape: 'cylinder', params: { halfHeight: 1, radius: -0.5 } },
    { ...base, shape: 'ball', params: { radius: 0 } },
    { ...base, node: 'ghost', shape: 'ball', params: { radius: 1 } },
    { ...base, shape: 'ball', params: { radius: 1 }, r: [0, 0, 0, 2] },
    { ...base, shape: 'ball', params: { radius: 1 }, t: [0, 0] },
  ]), asset).issues
  assert.deepEqual(issues.map((i) => [i.code, i.path]), [
    ['BAD_COLLIDER', '/collision/colliders/0/shape'],
    ['BAD_COLLIDER', '/collision/colliders/1/params'],
    ['BAD_COLLIDER', '/collision/colliders/2/params/radius'],
    ['BAD_COLLIDER', '/collision/colliders/3/params/radius'],
    ['BAD_COLLIDER', '/collision/colliders/4/node'],
    ['BAD_COLLIDER', '/collision/colliders/5/r'],
    ['BAD_COLLIDER', '/collision/colliders/6/t'],
  ])
  assert.match(issues[0]!.message, /Collider 0 \(node 'body'\)/)
  assert.match(issues[2]!.message, /Collider 2 \(node 'body'\)/)
  assert.deepEqual(issues[2]!.nodes, ['body'])
  assert.match(issues[4]!.message, /'ghost'/)
})

test('entry type, keys and numbers use BAD_TYPE, MISSING_FIELD / UNKNOWN_FIELD and readNumber codes', () => {
  const asset = baseAsset()
  const issues = run(topWith(asset, 'override', [
    7,
    { node: null, shape: 'ball', params: { radius: 1 }, t: [0, 0, 0], extra: 1 },
    { node: null, shape: 'ball', params: { radius: 2e6 }, t: [0, 0, 0], r: [0, 0, 0, 1] },
  ]), asset).issues
  assert.deepEqual(issues.map((i) => [i.code, i.path]), [
    ['BAD_TYPE', '/collision/colliders/0'],
    ['MISSING_FIELD', '/collision/colliders/1/r'],
    ['UNKNOWN_FIELD', '/collision/colliders/1/extra'],
    ['NUMBER_RANGE', '/collision/colliders/2/params/radius'],
  ])
})

test('an override with node null is accepted', () => {
  const asset = baseAsset()
  const issues = run(topWith(asset, 'override', [
    { node: null, shape: 'roundCuboid', params: { halfExtents: [1, 0, 1], borderRadius: 0 }, t: [0, 0, 0], r: [0, 0, 0, 1] },
    { node: 'crate', shape: 'cone', params: { halfHeight: 0, radius: 1 }, t: [1, 2, 3], r: [0, 0, 1, 0] },
  ]), asset).issues
  assert.deepEqual(issues, [])
})
