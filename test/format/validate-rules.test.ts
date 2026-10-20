import test from 'node:test'
import assert from 'node:assert/strict'
import { checkBooleans, checkBudget, checkCaps } from '../../src/format/validate-rules.ts'
import { validateNodes } from '../../src/format/validate-nodes.ts'
import { createSink } from '../../src/format/validate-util.ts'
import type { RaaPrimsAsset } from '../../src/format/types.ts'

const materials = new Set(['plain'])

function node(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, kind: 'box', params: { size: [1, 1, 1] },
    transform: { t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    material: 'plain', op: 'union', ...overrides,
  }
}

function at(x: number): Record<string, unknown> {
  return { t: [x, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }
}

function cutter(id: string, x: number, op = 'subtract', extra: Record<string, unknown> = {}) {
  return node(id, { kind: 'sphere', params: { radius: 0.3 }, transform: at(x), op, ...extra })
}

function infosOf(nodes: unknown[]) {
  const sink = createSink()
  const infos = validateNodes(nodes, materials, sink)
  return { infos, nodeIssues: sink.issues }
}

function caps(nodes: unknown[], top: Record<string, unknown> = {}) {
  const { infos } = infosOf(nodes)
  const sink = createSink()
  checkCaps(infos, { nodes, materials: { plain: {} }, anchors: {}, ...top }, sink)
  return sink.issues
}

function booleans(nodes: unknown[]) {
  const { infos, nodeIssues } = infosOf(nodes)
  const sink = createSink()
  checkBooleans(infos, sink)
  return { issues: sink.issues, nodeIssues }
}

function summary(issues: { code: string; path: string; nodes: string[] }[]) {
  return issues.map((issue) => [issue.code, issue.path, issue.nodes])
}

function namesAll(issues: { message: string; nodes: string[] }[]) {
  for (const issue of issues) for (const id of issue.nodes) assert.ok(issue.message.includes(`'${id}'`), issue.message)
}

test('CAP_NODES: zero nodes and more than MAX_NODES', () => {
  assert.deepEqual(summary(caps([])), [['CAP_NODES', '/nodes', []]])
  const many = Array.from({ length: 65 }, (_, i) => node(`n${i}`, { transform: at(i * 2) }))
  assert.deepEqual(summary(caps(many)), [['CAP_NODES', '/nodes', []]])
  assert.deepEqual(caps(many.slice(0, 64)), [])
})

test('CAP_DEPTH: one issue per node deeper than MAX_DEPTH, naming it', () => {
  let chain: Record<string, unknown> = node('d10')
  for (let d = 9; d >= 1; d--) chain = node(`d${d}`, { children: [chain] })
  const issues = caps([chain])
  const deep = '/nodes/0' + '/children/0'.repeat(8)
  assert.deepEqual(summary(issues), [
    ['CAP_DEPTH', deep, ['d9']],
    ['CAP_DEPTH', deep + '/children/0', ['d10']],
  ])
  namesAll(issues)
})

test('CAP_MATERIALS: zero and more than MAX_MATERIALS', () => {
  assert.deepEqual(summary(caps([node('a')], { materials: {} })), [['CAP_MATERIALS', '/materials', []]])
  const many = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`m${i}`, {}]))
  assert.deepEqual(summary(caps([node('a')], { materials: many })), [['CAP_MATERIALS', '/materials', []]])
})

test('CAP_ANCHORS: more than MAX_ANCHORS', () => {
  const many = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`a${i}`, {}]))
  assert.deepEqual(summary(caps([node('a')], { anchors: many })), [['CAP_ANCHORS', '/anchors', []]])
  assert.deepEqual(caps([node('a')], { anchors: {} }), [])
})

test('CAP_COLLIDERS: more than MAX_COLLIDERS', () => {
  const collision = { mode: 'override', colliders: Array.from({ length: 257 }, () => ({})) }
  assert.deepEqual(summary(caps([node('a')], { collision })), [['CAP_COLLIDERS', '/collision/colliders', []]])
  collision.colliders.length = 256
  assert.deepEqual(caps([node('a')], { collision }), [])
})

test('BOOL_NO_HOST: a root cutter', () => {
  const { issues } = booleans([node('host'), cutter('hole', 0)])
  assert.deepEqual(summary(issues), [['BOOL_NO_HOST', '/nodes/1', ['hole']]])
  namesAll(issues)
})

test('BOOL_HOST_NOT_CONVEX: a cut on a torus, with the documented message', () => {
  const ring = node('ring', {
    kind: 'torus', params: { majorRadius: 1, minorRadius: 0.2 }, children: [cutter('hole', 0)],
  })
  const { issues } = booleans([ring])
  assert.deepEqual(summary(issues), [['BOOL_HOST_NOT_CONVEX', '/nodes/0/children/0', ['hole', 'ring']]])
  assert.equal(issues[0].message, "node 'hole' subtracts from 'ring', a torus: only convex shapes " +
    '(sphere, box, roundBox, capsule, cylinder, cone, ellipsoid) can be cut')
})

test('BOOL_CUTTER_NOT_CONVEX: a torus cutter', () => {
  const donut = node('donut', { kind: 'torus', params: { majorRadius: 0.3, minorRadius: 0.1 }, op: 'subtract' })
  const { issues } = booleans([node('host', { children: [donut] })])
  assert.deepEqual(summary(issues), [['BOOL_CUTTER_NOT_CONVEX', '/nodes/0/children/0', ['donut']]])
  namesAll(issues)
})

test('BOOL_NESTED: a cutter with children', () => {
  const hole = cutter('hole', 0, 'subtract', { children: [node('inner', { transform: at(0) })] })
  const { issues } = booleans([node('host', { children: [hole] })])
  assert.deepEqual(summary(issues), [['BOOL_NESTED', '/nodes/0/children/0/children', ['hole', 'inner']]])
  namesAll(issues)
})

test('BOOL_INTERSECT_MIXED: an intersect child plus another cutter', () => {
  const host = node('host', { params: { size: [4, 1, 1] }, children: [cutter('keep', -1, 'intersect'), cutter('hole', 1)] })
  const { issues } = booleans([host])
  assert.deepEqual(summary(issues), [['BOOL_INTERSECT_MIXED', '/nodes/0/children', ['host', 'keep', 'hole']]])
  namesAll(issues)
})

test('BOOL_CUTTERS_OVERLAP: each overlapping pair, naming both cutters', () => {
  const host = node('host', { children: [cutter('a', 0), cutter('b', 0.2), cutter('c', 0.6)] })
  const { issues } = booleans([host])
  assert.deepEqual(summary(issues), [
    ['BOOL_CUTTERS_OVERLAP', '/nodes/0/children/1', ['a', 'b']],
    ['BOOL_CUTTERS_OVERLAP', '/nodes/0/children/2', ['b', 'c']],
  ])
  namesAll(issues)
  for (const issue of issues) assert.ok(issue.message.includes("'host'"))
})

test('a host with two touching cutters and a union child is accepted', () => {
  const host = node('host', { children: [cutter('a', -0.3), cutter('b', 0.3), node('knob', { transform: at(0) })] })
  assert.deepEqual(booleans([host]).issues, [])
})

test('boolean rules skip nodes whose own checks failed', () => {
  const bad = cutter('hole', 0, 'subtract', { params: { radius: -1 } })
  const ring = node('ring', { kind: 'torus', params: { majorRadius: 1, minorRadius: 0.2 }, children: [bad] })
  const result = booleans([ring, { ...cutter('root', 0), material: 'missing' }])
  assert.ok(result.nodeIssues.length >= 2)
  assert.deepEqual(result.issues, [])
})

function asset(nodes: unknown[], triangles: number): RaaPrimsAsset {
  return {
    format: 'raa.prims', version: 0, id: 'a', name: 'A', budget: { triangles, segments: 16 },
    nodes: nodes as RaaPrimsAsset['nodes'], materials: {}, anchors: {}, collision: { mode: 'derived', colliders: [] },
  }
}

test('BUDGET_EXCEEDED: total and budget in the message, three most expensive nodes named', () => {
  const nodes = [
    node('base', { children: [node('hole', { kind: 'cylinder', params: { height: 1, radius: 0.2 }, op: 'subtract' })] }),
    node('ball', { kind: 'sphere', params: { radius: 1 }, transform: at(3) }),
    node('ring', { kind: 'torus', params: { majorRadius: 1, minorRadius: 0.2 }, transform: at(6) }),
  ]
  // 12 + 120 (cylinder 60 + allowance) + 224 + 256 = 612
  const sink = createSink()
  assert.equal(checkBudget(asset(nodes, 600), sink), 612)
  assert.deepEqual(summary(sink.issues), [['BUDGET_EXCEEDED', '/budget/triangles', ['ring', 'ball', 'hole']]])
  assert.match(sink.issues[0].message, /612/)
  assert.match(sink.issues[0].message, /600/)
  namesAll(sink.issues)

  const ok = createSink()
  assert.equal(checkBudget(asset(nodes, 612), ok), 612)
  assert.deepEqual(ok.issues, [])
})
