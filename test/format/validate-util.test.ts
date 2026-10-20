import test from 'node:test'
import assert from 'node:assert/strict'
import {
  checkKeys,
  createSink,
  isRecord,
  ptr,
  readNumber,
  readVec,
  roundCanonical,
  scanJsonValue,
} from '../../src/format/validate-util.ts'

test('ptr escapes RFC 6901 keys', () => {
  assert.equal(ptr(''), '')
  assert.equal(ptr('', 'a'), '/a')
  assert.equal(ptr('', 'a/b'), '/a~1b')
  assert.equal(ptr('', 'a~b'), '/a~0b')
  assert.equal(ptr('', '~1/'), '/~01~1')
  assert.equal(ptr('/nodes', 0, 'children', 2), '/nodes/0/children/2')
})

test('createSink appends issues in call order and defaults nodes to []', () => {
  const sink = createSink()
  sink.add('BAD_TYPE', '/a', 'first')
  sink.add('UNKNOWN_FIELD', '/b', 'second', ['n1'])
  assert.deepEqual(sink.issues, [
    { code: 'BAD_TYPE', path: '/a', message: 'first', nodes: [] },
    { code: 'UNKNOWN_FIELD', path: '/b', message: 'second', nodes: ['n1'] },
  ])
})

test('isRecord accepts only plain objects', () => {
  assert.equal(isRecord({}), true)
  assert.equal(isRecord(Object.create(null)), true)
  assert.equal(isRecord([]), false)
  assert.equal(isRecord(null), false)
  assert.equal(isRecord(new Date(0)), false)
  assert.equal(isRecord('x'), false)
})

test('checkKeys reports missing and unknown keys at the key path', () => {
  const sink = createSink()
  const clean = checkKeys(sink, { a: 1, c: 3 }, '/obj', ['a', 'b'], ['a', 'b'], ['n1'])
  assert.equal(clean, false)
  assert.deepEqual(
    sink.issues.map((issue) => [issue.code, issue.path]),
    [
      ['MISSING_FIELD', '/obj/b'],
      ['UNKNOWN_FIELD', '/obj/c'],
    ],
  )
  assert.deepEqual(sink.issues[0].nodes, ['n1'])

  const good = createSink()
  assert.equal(checkKeys(good, { a: 1, b: 2 }, '/obj', ['a', 'b'], ['a', 'b'], []), true)
  assert.equal(good.issues.length, 0)
})

test('readNumber reports NaN, -Infinity, 2e6, "1" and accepts 3', () => {
  const sink = createSink()
  assert.equal(readNumber(sink, NaN, '/n', [], 'BAD_PARAMS'), null)
  assert.equal(readNumber(sink, -Infinity, '/n', [], 'BAD_PARAMS'), null)
  assert.equal(readNumber(sink, 2e6, '/n', [], 'BAD_PARAMS'), null)
  assert.equal(readNumber(sink, '1', '/n', [], 'BAD_PARAMS'), null)
  assert.equal(readNumber(sink, 3, '/n', [], 'BAD_PARAMS'), 3)
  assert.deepEqual(
    sink.issues.map((issue) => issue.code),
    ['NUMBER_NOT_FINITE', 'NUMBER_NOT_FINITE', 'NUMBER_RANGE', 'BAD_PARAMS'],
  )
})

test('readVec checks exactly n numbers with per-element paths', () => {
  const sink = createSink()
  assert.equal(readVec(sink, [1, NaN, '2'], 3, '/v', [], 'BAD_PARAMS'), null)
  assert.deepEqual(
    sink.issues.map((issue) => [issue.code, issue.path]),
    [
      ['NUMBER_NOT_FINITE', '/v/1'],
      ['BAD_PARAMS', '/v/2'],
    ],
  )

  const wrong = createSink()
  assert.equal(readVec(wrong, [1, 2], 3, '/v', [], 'BAD_PARAMS'), null)
  assert.deepEqual(
    wrong.issues.map((issue) => [issue.code, issue.path]),
    [['BAD_PARAMS', '/v']],
  )

  const good = createSink()
  assert.deepEqual(readVec(good, [1, 2, 3, 4], 4, '/v', [], 'BAD_PARAMS'), [1, 2, 3, 4])
  assert.equal(good.issues.length, 0)
})

test('roundCanonical rounds to six decimals and turns -0 into 0', () => {
  assert.equal(roundCanonical(0.1 + 0.2), 0.3)
  assert.ok(Object.is(roundCanonical(-1e-7), 0))
  assert.equal(roundCanonical(0.0000005), 0)
  assert.equal(roundCanonical(0.0000006), 0.000001)
})

test('scanJsonValue refuses cycles, functions and Dates', () => {
  const cyclic: Record<string, unknown> = { name: 'loop' }
  cyclic.self = cyclic
  const cycleSink = createSink()
  assert.equal(scanJsonValue(cycleSink, cyclic, ''), false)
  assert.deepEqual(
    cycleSink.issues.map((issue) => [issue.code, issue.path]),
    [['BAD_TYPE', '/self']],
  )

  const fnSink = createSink()
  assert.equal(scanJsonValue(fnSink, { f: () => 1 }, ''), false)
  assert.deepEqual(
    fnSink.issues.map((issue) => [issue.code, issue.path]),
    [['BAD_TYPE', '/f']],
  )

  const dateSink = createSink()
  assert.equal(scanJsonValue(dateSink, { d: new Date(0) }, ''), false)
  assert.deepEqual(
    dateSink.issues.map((issue) => [issue.code, issue.path]),
    [['BAD_TYPE', '/d']],
  )
  assert.match(dateSink.issues[0].message, /Date/)

  const undefinedSink = createSink()
  assert.equal(scanJsonValue(undefinedSink, { a: [undefined] }, ''), false)
  assert.deepEqual(
    undefinedSink.issues.map((issue) => [issue.code, issue.path]),
    [['BAD_TYPE', '/a/0']],
  )
})

test('scanJsonValue accepts clean values and shared subtrees', () => {
  const clean = createSink()
  assert.equal(scanJsonValue(clean, { a: [1, 'x', null, true], b: -0 }, ''), true)
  assert.equal(clean.issues.length, 0)

  const shared = { x: 1 }
  const dag = createSink()
  assert.equal(scanJsonValue(dag, { a: shared, b: shared }, ''), true)
  assert.equal(dag.issues.length, 0)
})
