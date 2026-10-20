import test from 'node:test'
import assert from 'node:assert/strict'
import { validateNodes } from '../../src/format/validate-nodes.ts'
import { createSink } from '../../src/format/validate-util.ts'
import type { ParamsByKind, PrimKind, RefusalCode } from '../../src/format/types.ts'

const materials = new Set(['plain'])

function node(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'shape', kind: 'sphere', params: { radius: 1 },
    transform: { t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] },
    material: 'plain', op: 'union', ...overrides,
  }
}

function validate(value: unknown) {
  const sink = createSink()
  const infos = validateNodes(value, materials, sink)
  return { infos, issues: sink.issues }
}

function expectIssue(value: unknown, code: RefusalCode, path: string, nodes: string[] = ['shape']) {
  const result = validate(value)
  assert.deepEqual(result.issues.map((issue) => [issue.code, issue.path, issue.nodes]), [[code, path, nodes]])
  for (const id of nodes) assert.ok(result.issues[0].message.includes(id))
  return result
}

test('BAD_TYPE: nodes and each node must have the right type', () => {
  expectIssue({}, 'BAD_TYPE', '/nodes', [])
  for (const bad of [null, 3, 'node', [], new Date(0)]) {
    assert.deepEqual(expectIssue([bad], 'BAD_TYPE', '/nodes/0', []).infos, [])
  }
  expectIssue([node({ children: {} })], 'BAD_TYPE', '/nodes/0/children')
})

test('MISSING_FIELD: a missing node key does not also fail its value check', () => {
  for (const key of ['id', 'kind', 'params', 'transform', 'material', 'op']) {
    const value = node()
    delete value[key]
    expectIssue([value], 'MISSING_FIELD', `/nodes/0/${key}`, key === 'id' ? [] : ['shape'])
  }
})

test('UNKNOWN_FIELD: unknown node and transform keys use escaped pointers', () => {
  expectIssue([node({ 'extra/~': true })], 'UNKNOWN_FIELD', '/nodes/0/extra~1~0')
  expectIssue([node({ transform: { t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1], extra: 0 } })],
    'UNKNOWN_FIELD', '/nodes/0/transform/extra')
  expectIssue([node({ transform: { t: [0, 0, 0], s: [1, 1, 1] } })],
    'MISSING_FIELD', '/nodes/0/transform/r')
})

test('BAD_ID: invalid strings and non-string ids', () => {
  expectIssue([node({ id: 'Wrong' })], 'BAD_ID', '/nodes/0/id', ['Wrong'])
  expectIssue([node({ id: 3 })], 'BAD_ID', '/nodes/0/id', [])
})

test('DUPLICATE_ID: the message names both paths, including across roots', () => {
  const result = expectIssue([node(), node()], 'DUPLICATE_ID', '/nodes/1/id')
  assert.ok(result.issues[0].message.includes('/nodes/0'))
  assert.ok(result.issues[0].message.includes('/nodes/1'))
  assert.equal(result.infos[0].ok, true)
  assert.equal(result.infos[1].ok, false)
  assert.equal(result.infos[1].node, null)
})

test('UNKNOWN_KIND: unknown params are skipped', () => {
  expectIssue([node({ kind: 'pyramid', params: { bad: NaN } })], 'UNKNOWN_KIND', '/nodes/0/kind')
  expectIssue([node({ kind: 1 })], 'UNKNOWN_KIND', '/nodes/0/kind')
  expectIssue([node({ kind: 'toString' })], 'UNKNOWN_KIND', '/nodes/0/kind')
})

test('BAD_PARAMS: key sets and shapes use the params code', () => {
  for (const value of [null, [], 1]) {
    expectIssue([node({ params: value })], 'BAD_PARAMS', '/nodes/0/params')
  }
  expectIssue([node({ params: {} })], 'BAD_PARAMS', '/nodes/0/params/radius')
  expectIssue([node({ params: { radius: 1, extra: 0 } })], 'BAD_PARAMS', '/nodes/0/params/extra')
  expectIssue([node({ params: { radius: '1' } })], 'BAD_PARAMS', '/nodes/0/params/radius')
  expectIssue([node({ kind: 'box', params: { size: [1, 2] } })], 'BAD_PARAMS', '/nodes/0/params/size')
  expectIssue([node({ kind: 'ellipsoid', params: { radii: [1, '2', 3] } })],
    'BAD_PARAMS', '/nodes/0/params/radii/1')
})

test('PARAM_RANGE: nested path and offending node id', () => {
  const bad = node({ id: 'hole', params: { radius: 0 } })
  expectIssue([node({ children: [node({ id: 'first' }), bad] })],
    'PARAM_RANGE', '/nodes/0/children/1/params/radius', ['hole'])
})

test('NUMBER_NOT_FINITE and NUMBER_RANGE take precedence over parameter ranges', () => {
  for (const radius of [NaN, Infinity, -Infinity]) {
    expectIssue([node({ params: { radius } })], 'NUMBER_NOT_FINITE', '/nodes/0/params/radius')
  }
  expectIssue([node({ params: { radius: 2e6 } })], 'NUMBER_RANGE', '/nodes/0/params/radius')
  expectIssue([node({ kind: 'box', params: { size: [1, NaN, 1] } })],
    'NUMBER_NOT_FINITE', '/nodes/0/params/size/1')
  expectIssue([node({ transform: { t: [0, -2e6, 0], r: [0, 0, 0, 1], s: [1, 1, 1] } })],
    'NUMBER_RANGE', '/nodes/0/transform/t/1')
  expectIssue([node({ transform: { t: [0, 0, 0], r: [0, 0, 0, Infinity], s: [1, 1, 1] } })],
    'NUMBER_NOT_FINITE', '/nodes/0/transform/r/3')
})

test('BAD_TRANSFORM: shape, component type, nonpositive scale and non-unit rotation', () => {
  expectIssue([node({ transform: null })], 'BAD_TRANSFORM', '/nodes/0/transform')
  for (const [key, bad] of [['t', [0, 0]], ['r', [0, 0, 1]], ['s', [1, 1]]]) {
    const transform = { t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1], [key as string]: bad }
    expectIssue([node({ transform })], 'BAD_TRANSFORM', `/nodes/0/transform/${key}`)
  }
  for (const scale of [0, -1, '1']) {
    expectIssue([node({ transform: { t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, scale, 1] } })],
      'BAD_TRANSFORM', '/nodes/0/transform/s/1')
  }
  expectIssue([node({ transform: { t: [0, 0, 0], r: [0, 0, 0, 2], s: [1, 1, 1] } })],
    'BAD_TRANSFORM', '/nodes/0/transform/r')
})

test('SCALE_NONUNIFORM_PARENT: scale is uniform only when there are children', () => {
  const value = node({
    transform: { t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 2, 1] },
    children: [node({ id: 'child' })],
  })
  expectIssue([value], 'SCALE_NONUNIFORM_PARENT', '/nodes/0/transform/s')
  value.children = []
  assert.deepEqual(validate([value]).issues, [])
})

test('UNKNOWN_MATERIAL: references must be keys in the supplied material set', () => {
  for (const material of ['absent', 1, 'toString']) {
    expectIssue([node({ material })], 'UNKNOWN_MATERIAL', '/nodes/0/material')
  }
})

test('BAD_TYPE: invalid op', () => {
  expectIssue([node({ op: 'add' })], 'BAD_TYPE', '/nodes/0/op')
})

test('S1 parameter bounds and relations for every kind', () => {
  const valid: { [K in PrimKind]: ParamsByKind[K] } = {
    sphere: { radius: 0.001 },
    box: { size: [0.001, 1, 1000] },
    roundBox: { size: [2, 4, 6], radius: 1 },
    capsule: { height: 2, radius: 1 },
    cylinder: { height: 0.001, radius: 1000 },
    cone: { height: 1000, radiusBottom: 0, radiusTop: 0.001 },
    torus: { majorRadius: 1000, minorRadius: 0.001 },
    ellipsoid: { radii: [0.001, 1, 1000] },
  }
  for (const [kind, params] of Object.entries(valid)) {
    const value = node({ kind, params })
    const { infos, issues } = validate([value])
    assert.deepEqual(issues, [], kind)
    assert.equal(infos[0].ok, true)
    assert.equal(infos[0].node, value)
  }
  assert.deepEqual(validate([node({ kind: 'roundBox', params: { size: [1, 1, 1], radius: 0 } })]).issues, [])
  assert.deepEqual(validate([node({ kind: 'cone', params: { height: 1, radiusBottom: 1000, radiusTop: 0 } })]).issues, [])
  const bad: [PrimKind, Record<string, unknown>, string][] = [
    ['sphere', { radius: 1001 }, 'radius'],
    ['box', { size: [1, 0, 1] }, 'size/1'],
    ['roundBox', { size: [2, 4, 6], radius: 1.01 }, 'radius'],
    ['roundBox', { size: [2, 4, 6], radius: -0.001 }, 'radius'],
    ['capsule', { height: 1, radius: 1 }, 'height'],
    ['cylinder', { height: 0, radius: 1 }, 'height'],
    ['cylinder', { height: 1, radius: 0 }, 'radius'],
    ['cone', { height: 1, radiusBottom: -0.001, radiusTop: 1 }, 'radiusBottom'],
    ['cone', { height: 1, radiusBottom: 1, radiusTop: 1001 }, 'radiusTop'],
    ['cone', { height: 1, radiusBottom: 0, radiusTop: 0.0009 }, ''],
    ['torus', { majorRadius: 1, minorRadius: 1 }, 'minorRadius'],
    ['ellipsoid', { radii: [1, 1, 1001] }, 'radii/2'],
  ]
  for (const [kind, params, suffix] of bad) {
    expectIssue([node({ kind, params })], 'PARAM_RANGE', `/nodes/0/params${suffix ? '/' + suffix : ''}`)
  }
})

test('NodeInfo records pre-order, depth and parent across a three-level tree', () => {
  const leaf = node({ id: 'leaf', op: 'subtract' })
  const child = node({ id: 'child', children: [leaf] })
  const root = node({ id: 'root', children: [child, node({ id: 'sibling' })] })
  const { infos, issues } = validate([root, node({ id: 'other' })])
  assert.deepEqual(issues, [])
  assert.deepEqual(infos.map(({ id, depth, parentId, childIds, path, kind, op, ok }) =>
    ({ id, depth, parentId, childIds, path, kind, op, ok })), [
    { id: 'root', depth: 1, parentId: null, childIds: ['child', 'sibling'], path: '/nodes/0', kind: 'sphere', op: 'union', ok: true },
    { id: 'child', depth: 2, parentId: 'root', childIds: ['leaf'], path: '/nodes/0/children/0', kind: 'sphere', op: 'union', ok: true },
    { id: 'leaf', depth: 3, parentId: 'child', childIds: [], path: '/nodes/0/children/0/children/0', kind: 'sphere', op: 'subtract', ok: true },
    { id: 'sibling', depth: 2, parentId: 'root', childIds: [], path: '/nodes/0/children/1', kind: 'sphere', op: 'union', ok: true },
    { id: 'other', depth: 1, parentId: null, childIds: [], path: '/nodes/1', kind: 'sphere', op: 'union', ok: true },
  ])
  assert.equal(infos[2].node, leaf)
})

test('collects all issues in per-node order before visiting children', () => {
  const child = node({ id: 'child', params: { radius: -1 } })
  const root = node({
    extra: true, id: 'Wrong', kind: 'box', params: { size: 'bad' },
    transform: { t: [0, 0, 0], r: [0, 0, 0, 0], s: [1, 1, 1] },
    material: 'absent', op: 'bad', children: [child],
  })
  const { infos, issues } = validate([root])
  assert.deepEqual(issues.map(({ code, path, nodes }) => [code, path, nodes]), [
    ['UNKNOWN_FIELD', '/nodes/0/extra', ['Wrong']],
    ['BAD_ID', '/nodes/0/id', ['Wrong']],
    ['BAD_PARAMS', '/nodes/0/params/size', ['Wrong']],
    ['BAD_TRANSFORM', '/nodes/0/transform/r', ['Wrong']],
    ['UNKNOWN_MATERIAL', '/nodes/0/material', ['Wrong']],
    ['BAD_TYPE', '/nodes/0/op', ['Wrong']],
    ['PARAM_RANGE', '/nodes/0/children/0/params/radius', ['child']],
  ])
  for (const issue of issues) assert.ok(issue.message.includes(issue.nodes[0]))
  assert.ok(infos.every((info) => !info.ok && info.node === null))
})

test('NodeInfo.ok depends only on the node, including with existing sink issues', () => {
  const root = node({ children: [node({ id: 'child', params: {} }), null] })
  const sink = createSink()
  sink.add('BAD_FORMAT', '/format', 'existing issue')
  const infos = validateNodes([root], materials, sink)
  assert.equal(infos.length, 2)
  assert.equal(infos[0].ok, true)
  assert.equal(infos[0].node, root)
  assert.equal(infos[1].ok, false)
})

test('bounded malformed inputs never throw, and deep trees use no recursive call stack', () => {
  const values: unknown[] = [null, false, 0, 'x', [], {}, NaN, -Infinity, [1, 2], [0, 0, 0, 1]]
  for (const key of ['id', 'kind', 'params', 'transform', 'material', 'op', 'children']) {
    for (const value of values) assert.doesNotThrow(() => validate([node({ [key]: value })]))
  }
  let root = node({ id: 'n1000' })
  for (let i = 999; i >= 0; i--) root = node({ id: `n${i}`, children: [root] })
  const { infos, issues } = validate([root])
  assert.deepEqual(issues, [])
  assert.equal(infos.length, 1001)
  assert.equal(infos[1000].depth, 1001)
})
