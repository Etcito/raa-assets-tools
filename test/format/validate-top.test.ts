import test from 'node:test'
import assert from 'node:assert/strict'
import { createSink } from '../../src/format/validate-util.ts'
import type { IssueSink } from '../../src/format/validate-util.ts'
import {
  validateAnchors,
  validateBudget,
  validateMaterials,
  validateTopLevel,
} from '../../src/format/validate-top.ts'

function baseTop(): Record<string, unknown> {
  return {
    format: 'raa.prims',
    version: 0,
    id: 'demo',
    name: 'Demo',
    budget: { triangles: 1500, segments: 16 },
    nodes: [],
    materials: { red: { color: [1, 0, 0], roughness: 0.5, metallic: 0, emissive: [0, 0, 0] } },
    anchors: { spawn: { t: [0, 0, 0], r: [0, 0, 0, 1] } },
    collision: { mode: 'derived', colliders: [] },
  }
}

function only(sink: IssueSink): { code: string; path: string } {
  assert.equal(sink.issues.length, 1, JSON.stringify(sink.issues))
  const issue = sink.issues[0]!
  // Messages written by validate-top.ts are full sentences; helper messages come from validate-util.ts.
  if (!/^(expected|number|missing|unknown) /.test(issue.message)) assert.match(issue.message, /^[A-Z].*\.$/)
  return { code: issue.code, path: issue.path }
}

function top(patch: Record<string, unknown>, drop: string[] = []): IssueSink {
  const value = { ...baseTop(), ...patch }
  for (const key of drop) delete value[key]
  const sink = createSink()
  validateTopLevel(value, sink)
  return sink
}

function step3(fn: (t: Record<string, unknown>, s: IssueSink) => unknown, patch: Record<string, unknown>): IssueSink {
  const sink = createSink()
  fn({ ...baseTop(), ...patch }, sink)
  return sink
}

test('a clean asset produces no issue in steps 1 and 3', () => {
  const sink = createSink()
  const parts = validateTopLevel(baseTop(), sink)
  assert.ok(parts)
  validateMaterials(parts.top, sink)
  validateAnchors(parts.top, sink)
  assert.deepEqual(validateBudget(parts.top, sink), { triangles: 1500, segments: 16 })
  assert.deepEqual(sink.issues, [])
  assert.deepEqual([...parts.materialIds], ['red'])
})

test('NOT_OBJECT for a non-object', () => {
  const sink = createSink()
  assert.equal(validateTopLevel([1], sink), null)
  assert.deepEqual(only(sink), { code: 'NOT_OBJECT', path: '' })
})

test('BAD_FORMAT, BAD_VERSION, BAD_ID, BAD_NAME', () => {
  assert.deepEqual(only(top({ format: 'raa.prim' })), { code: 'BAD_FORMAT', path: '/format' })
  assert.deepEqual(only(top({ version: 1 })), { code: 'BAD_VERSION', path: '/version' })
  assert.deepEqual(only(top({ id: 'Demo' })), { code: 'BAD_ID', path: '/id' })
  assert.deepEqual(only(top({ name: '' })), { code: 'BAD_NAME', path: '/name' })
  assert.deepEqual(only(top({ name: 'x'.repeat(129) })), { code: 'BAD_NAME', path: '/name' })
})

test('BAD_TYPE for top-level field types and collision mode', () => {
  assert.deepEqual(only(top({ nodes: {} })), { code: 'BAD_TYPE', path: '/nodes' })
  assert.deepEqual(only(top({ materials: [] })), { code: 'BAD_TYPE', path: '/materials' })
  assert.deepEqual(only(top({ anchors: null })), { code: 'BAD_TYPE', path: '/anchors' })
  assert.deepEqual(only(top({ collision: 'derived' })), { code: 'BAD_TYPE', path: '/collision' })
  assert.deepEqual(only(top({ collision: { mode: 'auto', colliders: [] } })), {
    code: 'BAD_TYPE',
    path: '/collision/mode',
  })
  assert.deepEqual(only(top({ collision: { mode: 'override', colliders: {} } })), {
    code: 'BAD_TYPE',
    path: '/collision/colliders',
  })
})

test('MISSING_FIELD and UNKNOWN_FIELD at top level and in collision; budget is optional', () => {
  assert.deepEqual(top({}, ['budget']).issues, [])
  assert.deepEqual(only(top({}, ['materials'])), { code: 'MISSING_FIELD', path: '/materials' })
  assert.deepEqual(only(top({ extra: 1 })), { code: 'UNKNOWN_FIELD', path: '/extra' })
  assert.deepEqual(only(top({ collision: { mode: 'derived' } })), {
    code: 'MISSING_FIELD',
    path: '/collision/colliders',
  })
  assert.deepEqual(only(top({ collision: { mode: 'derived', colliders: [], x: 0 } })), {
    code: 'UNKNOWN_FIELD',
    path: '/collision/x',
  })
})

test('materialIds is returned even when a material is invalid', () => {
  const sink = createSink()
  const parts = validateTopLevel({ ...baseTop(), materials: { red: 3, Bad: {} } }, sink)
  assert.ok(parts)
  assert.deepEqual([...parts.materialIds].sort(), ['Bad', 'red'])
})

test('validateMaterials: BAD_ID, MISSING_FIELD and BAD_MATERIAL', () => {
  const good = { color: [1, 0, 0], roughness: 0.5, metallic: 0, emissive: [0, 0, 0] }
  assert.deepEqual(only(step3(validateMaterials, { materials: { Red: good } })), {
    code: 'BAD_ID',
    path: '/materials/Red',
  })
  assert.deepEqual(only(step3(validateMaterials, { materials: { red: { ...good, roughness: 2 } } })), {
    code: 'BAD_MATERIAL',
    path: '/materials/red/roughness',
  })
  assert.deepEqual(only(step3(validateMaterials, { materials: { red: { ...good, color: [1, 1.5, 0] } } })), {
    code: 'BAD_MATERIAL',
    path: '/materials/red/color/1',
  })
  assert.deepEqual(only(step3(validateMaterials, { materials: { red: { ...good, emissive: [0, 0, 101] } } })), {
    code: 'BAD_MATERIAL',
    path: '/materials/red/emissive/2',
  })
  assert.deepEqual(only(step3(validateMaterials, { materials: { red: 'red' } })), {
    code: 'BAD_MATERIAL',
    path: '/materials/red',
  })
  const { metallic: _m, ...noMetallic } = good
  assert.deepEqual(only(step3(validateMaterials, { materials: { red: noMetallic } })), {
    code: 'MISSING_FIELD',
    path: '/materials/red/metallic',
  })
  assert.deepEqual(only(step3(validateMaterials, { materials: { red: { ...good, metallic: NaN } } })), {
    code: 'NUMBER_NOT_FINITE',
    path: '/materials/red/metallic',
  })
})

test('validateAnchors: BAD_ANCHOR for name, t and r', () => {
  const good = { t: [0, 0, 0], r: [0, 0, 0, 1] }
  assert.deepEqual(only(step3(validateAnchors, { anchors: { '1spawn': good } })), {
    code: 'BAD_ANCHOR',
    path: '/anchors/1spawn',
  })
  assert.deepEqual(only(step3(validateAnchors, { anchors: { spawn: { ...good, t: [0, 0] } } })), {
    code: 'BAD_ANCHOR',
    path: '/anchors/spawn/t',
  })
  assert.deepEqual(only(step3(validateAnchors, { anchors: { spawn: { ...good, r: [0, 0, 0, 2] } } })), {
    code: 'BAD_ANCHOR',
    path: '/anchors/spawn/r',
  })
  assert.deepEqual(only(step3(validateAnchors, { anchors: { spawn: { ...good, s: [1, 1, 1] } } })), {
    code: 'UNKNOWN_FIELD',
    path: '/anchors/spawn/s',
  })
})

test('validateBudget: BAD_BUDGET for range, integer and multiple of 4', () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ triangles: 0, segments: 16 }, '/budget/triangles'],
    [{ triangles: 100001, segments: 16 }, '/budget/triangles'],
    [{ triangles: 1500.5, segments: 16 }, '/budget/triangles'],
    [{ triangles: 1500, segments: 18 }, '/budget/segments'],
    [{ triangles: 1500, segments: 132 }, '/budget/segments'],
    [{ triangles: 1500, segments: '16' }, '/budget/segments'],
  ]
  for (const [budget, path] of cases) {
    const sink = createSink()
    assert.equal(validateBudget({ ...baseTop(), budget }, sink), null)
    assert.deepEqual(only(sink), { code: 'BAD_BUDGET', path })
  }
  const sink = createSink()
  assert.equal(validateBudget({ ...baseTop(), budget: { triangles: 10 } }, sink), null)
  assert.deepEqual(only(sink), { code: 'MISSING_FIELD', path: '/budget/segments' })
})

test('validateBudget fills the default budget {1500, 16}', () => {
  const sink = createSink()
  const value = baseTop()
  delete value.budget
  assert.deepEqual(validateBudget(value, sink), { triangles: 1500, segments: 16 })
  assert.deepEqual(validateBudget({ ...baseTop(), budget: { triangles: 4000, segments: 32 } }, sink), {
    triangles: 4000,
    segments: 32,
  })
  assert.deepEqual(sink.issues, [])
})
