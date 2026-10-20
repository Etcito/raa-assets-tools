import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatNumber, normalizeRaaPrims, serializeRaaPrims, writeCanonicalJson } from '../../src/format/canonical.ts'
import type { KeyOrder } from '../../src/format/canonical.ts'
import { deriveColliders } from '../../src/format/colliders.ts'
import { RaaError } from '../../src/format/errors.ts'
import { quatFromEulerXYZDeg } from '../../src/format/math.ts'
import { parseRaaPrims } from '../../src/format/parse.ts'
import type { Quat, RaaNode, RaaPrimsAsset } from '../../src/format/types.ts'

test('formatNumber follows the S4 number rule', () => {
  const table: [number, string][] = [
    [0.1 + 0.2, '0.3'],
    [1e-7, '0'],
    [-1e-7, '0'],
    [-0, '0'],
    // The double nearest 0.0000005 is slightly below it, so its exact value rounds down.
    [0.0000005, '0'],
    [0.0000005000001, '0.000001'],
    [0.0000015, '0.000002'],
    [0.1234565, '0.123456'],
    [-2.0000005, '-2.000001'],
    [123456.7891234, '123456.789123'],
    [42, '42'],
    [-2.5, '-2.5'],
    [1e6, '1000000'],
    [-1e6, '-1000000'],
  ]
  for (const [x, want] of table) assert.equal(formatNumber(x), want, `formatNumber(${x})`)
})

test('formatNumber is stable on its own output', () => {
  for (const x of [0.1 + 0.2, 123456.7891234, -0.333333333, 0.0000015, 999999.9999994]) {
    const s = formatNumber(x)
    assert.equal(formatNumber(Number(s)), s)
  }
})

test('formatNumber throws NUMBER_NOT_WRITABLE', () => {
  for (const x of [NaN, Infinity, -Infinity, 1e6 + 1, -(1e6 + 1)]) {
    assert.throws(
      () => formatNumber(x),
      (e: unknown) => e instanceof RaaError && e.code === 'NUMBER_NOT_WRITABLE' && e.fix.length > 0,
      `formatNumber(${x})`,
    )
  }
})

test('writeCanonicalJson writes the S4 style', () => {
  const value = {
    zeta: 'last in order',
    format: 'raa.prims',
    version: 0,
    skipped: undefined,
    dropped: 'not in the key list',
    flags: { on: true, off: false, none: null },
    nodes: [
      { id: 'a', t: [0.1 + 0.2, -0, 1e-7], s: [1, 1, 1], children: [{ id: 'b', t: [1, 2, 3] }] },
      { id: 'c', t: [], children: [] },
    ],
    map: { b: { v: 2 }, B: { v: 1 }, a: {}, é: { v: 3 } },
    mixed: [1, 'two', [3, 4]],
    empty: {},
  }
  const order: KeyOrder = (path) => {
    if (path.length === 0) return ['format', 'version', 'skipped', 'flags', 'nodes', 'map', 'mixed', 'empty', 'zeta']
    if (path[0] === 'flags') return ['on', 'off', 'none']
    if (path[0] === 'map') return path.length === 1 ? 'sorted' : ['v']
    return ['id', 't', 's', 'children']
  }
  const expected = `{
  "format": "raa.prims",
  "version": 0,
  "flags": {
    "on": true,
    "off": false,
    "none": null
  },
  "nodes": [
    {
      "id": "a",
      "t": [0.3, 0, 0],
      "s": [1, 1, 1],
      "children": [
        {
          "id": "b",
          "t": [1, 2, 3]
        }
      ]
    },
    {
      "id": "c",
      "t": [],
      "children": []
    }
  ],
  "map": {
    "B": {
      "v": 1
    },
    "a": {},
    "b": {
      "v": 2
    },
    "é": {
      "v": 3
    }
  },
  "mixed": [
    1,
    "two",
    [3, 4]
  ],
  "empty": {},
  "zeta": "last in order"
}
`
  assert.equal(writeCanonicalJson(value, order), expected)
})

test('writeCanonicalJson passes string keys and indices as the path', () => {
  const seen: string[] = []
  writeCanonicalJson({ list: [{ x: 1 }] }, (path) => {
    seen.push(path.join('/'))
    return 'sorted'
  })
  assert.deepEqual(seen, ['', 'list/0'])
})

test('writeCanonicalJson refuses unwritable values', () => {
  assert.throws(() => writeCanonicalJson({ a: NaN }, () => 'sorted'), { code: 'NUMBER_NOT_WRITABLE' })
  assert.throws(() => writeCanonicalJson([undefined], () => 'sorted'), { code: 'VALUE_NOT_WRITABLE' })
})

const RED = { color: [1, 0, 0], roughness: 0.5, metallic: 0, emissive: [0, 0, 0] }
const IDENTITY: Quat = [0, 0, 0, 1]

function asset(id: string, nodes: unknown[], extra: Record<string, unknown> = {}): RaaPrimsAsset {
  return {
    format: 'raa.prims',
    version: 0,
    id,
    name: id,
    nodes,
    materials: { red: RED },
    anchors: {},
    collision: { mode: 'derived', colliders: [] },
    ...extra,
  } as unknown as RaaPrimsAsset
}

function plainBox(): RaaPrimsAsset {
  return asset('box', [
    {
      id: 'box', kind: 'box', params: { size: [1, 0.1 + 0.2, 2] },
      transform: { t: [0, 0.5, 0], r: IDENTITY, s: [1, 1, 1] }, material: 'red', op: 'union', children: [],
    },
  ])
}

function wallWithHole(): RaaPrimsAsset {
  // Keys deliberately out of canonical order; numbers deliberately unquantised.
  return {
    collision: { colliders: [], mode: 'derived' },
    anchors: { passage: { r: IDENTITY, t: [0, 1.2, 0] } },
    materials: { stone: { emissive: [0, 0, 0], metallic: 0, roughness: 0.9, color: [0.5, 0.5, 0.45] } },
    nodes: [
      {
        children: [
          {
            op: 'subtract', material: 'stone',
            transform: { s: [1, 1, 1], r: quatFromEulerXYZDeg([90, 0, 0]), t: [0, -0.3, 0] },
            params: { radius: 0.6, height: 1 }, kind: 'cylinder', id: 'hole',
          },
        ],
        op: 'union', material: 'stone',
        transform: { s: [1.5, 1.5, 1.5], r: quatFromEulerXYZDeg([0, 30, 0]), t: [0.1 + 0.2, 1.5, 0] },
        params: { size: [4 / 1.5, 3 / 1.5, 0.5 / 1.5] }, kind: 'box', id: 'wall',
      },
    ],
    budget: { segments: 16, triangles: 1500 },
    name: 'Wall with hole',
    id: 'wall-with-hole',
    version: 0,
    format: 'raa.prims',
  } as unknown as RaaPrimsAsset
}

function torusWithAnchor(): RaaPrimsAsset {
  const r = quatFromEulerXYZDeg([20, 40, 10])
  return asset('ring', [
    {
      id: 'ring', kind: 'torus', params: { majorRadius: 1, minorRadius: 0.2 },
      transform: { t: [0, 0.2, 0], r: [-r[0], -r[1], -r[2], -r[3]], s: [1, 1, 1] }, material: 'red', op: 'union',
    },
  ], { anchors: { bounce: { t: [0, 0.4, 0], r: [0, 0.6, 0, -0.8] } } })
}

const SAMPLES: [string, () => RaaPrimsAsset][] = [
  ['plain box', plainBox],
  ['wall with a subtract cylinder', wallWithHole],
  ['torus with an anchor', torusWithAnchor],
]

function quaternionsOf(value: RaaPrimsAsset): Quat[] {
  const out: Quat[] = []
  const walk = (nodes: RaaNode[]): void => {
    for (const node of nodes) {
      out.push(node.transform.r)
      walk(node.children ?? [])
    }
  }
  walk(value.nodes)
  for (const anchor of Object.values(value.anchors)) out.push(anchor.r)
  for (const collider of value.collision.colliders) out.push(collider.r)
  return out
}

function written(text: string): RaaPrimsAsset {
  const result = parseRaaPrims(text)
  assert.deepEqual(result.issues, [])
  return result.asset!
}

function assertOrdered(text: string, keys: readonly string[], from = 0): void {
  let last = -1
  for (const key of keys) {
    const at = text.indexOf(`"${key}": `, from)
    assert.ok(at > last, `"${key}" comes after the previous key`)
    last = at
  }
}

test('Q2: serialize(parse(serialize(a))) === serialize(a)', () => {
  for (const [label, make] of SAMPLES) {
    const once = serializeRaaPrims(make())
    const twice = serializeRaaPrims(written(once))
    assert.equal(twice, once, label)
    assert.ok(once.endsWith('}\n') && !once.endsWith('\n\n'), label)
  }
})

test('serializeRaaPrims writes the S1 key orders', () => {
  const text = serializeRaaPrims(wallWithHole())
  assertOrdered(text, ['format', 'version', 'id', 'name', 'budget', 'nodes', 'materials', 'anchors', 'collision'])
  assertOrdered(text, ['triangles', 'segments'], text.indexOf('"budget"'))
  const wall = text.indexOf('"id": "wall"')
  assertOrdered(text, ['id', 'kind', 'params', 'transform', 'material', 'op', 'children'], wall)
  assertOrdered(text, ['t', 'r', 's'], text.indexOf('"transform"', wall))
  const hole = text.indexOf('"id": "hole"')
  assertOrdered(text, ['id', 'kind', 'params', 'height', 'radius', 'transform', 'material', 'op'], hole)
  assertOrdered(text, ['color', 'roughness', 'metallic', 'emissive'], text.indexOf('"stone"'))
  assertOrdered(text, ['t', 'r'], text.indexOf('"passage"'))
  assertOrdered(text, ['mode', 'colliders', 'node', 'shape', 'params', 'halfExtents', 't', 'r'], text.indexOf('"collision"'))
  assert.match(text, /"t": \[0\.3, 1\.5, 0\]/)
  assert.match(text, /"size": \[2\.666667, 2, 0\.333333\]/)

  const cone = serializeRaaPrims(asset('cone', [
    {
      id: 'tip', kind: 'cone', params: { radiusTop: 0, radiusBottom: 0.5, height: 1 },
      transform: { t: [0, 0, 0], r: IDENTITY, s: [1, 1, 1] }, material: 'red', op: 'union',
    },
  ]))
  assertOrdered(cone, ['height', 'radiusBottom', 'radiusTop'])
  assertOrdered(cone, ['shape', 'params', 'halfHeight', 'radius'], cone.indexOf('"colliders"'))
})

test('serializeRaaPrims sorts the materials and anchors maps', () => {
  const zeta = { ...RED, color: [0, 0, 1] }
  const text = serializeRaaPrims(asset('sorted', plainBox().nodes, {
    materials: { zeta, red: RED, alpha: RED },
    anchors: { spawn: { t: [0, 0, 0], r: IDENTITY }, apex: { t: [0, 1, 0], r: IDENTITY }, Head: { t: [0, 2, 0], r: IDENTITY } },
  }))
  assertOrdered(text, ['alpha', 'red', 'zeta'], text.indexOf('"materials"'))
  assertOrdered(text, ['Head', 'apex', 'spawn'], text.indexOf('"anchors"'))
  assert.deepEqual(Object.keys(written(text).anchors), ['Head', 'apex', 'spawn'])
})

test('every written quaternion has w >= 0', () => {
  for (const [label, make] of SAMPLES) {
    const quats = quaternionsOf(written(serializeRaaPrims(make())))
    assert.ok(quats.length > 1, label)
    for (const q of quats) assert.ok(q[3] >= 0, `${label}: ${q.join(', ')}`)
  }
  const text = serializeRaaPrims(torusWithAnchor())
  assert.match(text, /"r": \[0, -0\.6, 0, 0\.8\]/)
})

test('normalizeRaaPrims deep-copies and never mutates its input', () => {
  const input = torusWithAnchor()
  const before = structuredClone(input)
  const out = normalizeRaaPrims(input)
  assert.deepEqual(input, before)
  assert.notEqual(out.nodes, input.nodes)
  assert.notEqual(out.nodes[0]!.transform, input.nodes[0]!.transform)
  assert.notEqual(out.anchors.bounce, input.anchors.bounce)
  assert.deepEqual(out.budget, { triangles: 1500, segments: 16 })
  assert.deepEqual(out.anchors.bounce!.r, [0, -0.6, 0, 0.8])
})

test('normalizeRaaPrims quantises numbers and omits empty children', () => {
  const out = normalizeRaaPrims(plainBox())
  assert.equal(Object.hasOwn(out.nodes[0]!, 'children'), false)
  assert.deepEqual((out.nodes[0]!.params as { size: number[] }).size, [1, 0.3, 2])
  assert.doesNotMatch(serializeRaaPrims(plainBox()), /"children"/)
})

test('derived colliders are recomputed from a stale input list', () => {
  const input = asset('stale', plainBox().nodes, {
    collision: { mode: 'derived', colliders: [{ node: 'box', shape: 'ball', params: { radius: 9 }, t: [5, 5, 5], r: IDENTITY }] },
  })
  const out = normalizeRaaPrims(input)
  assert.deepEqual(out.collision.colliders, [
    { node: 'box', shape: 'cuboid', params: { halfExtents: [0.5, 0.15, 1] }, t: [0, 0.5, 0], r: [0, 0, 0, 1] },
  ])
  assert.equal(input.collision.colliders[0]!.shape, 'ball')
  const wall = normalizeRaaPrims(wallWithHole())
  assert.equal(wall.collision.colliders.length, deriveColliders(wall).length)
  assert.equal(wall.collision.colliders.length, 1)
  written(serializeRaaPrims(input))
})

test('override colliders are kept, canonicalised and quantised', () => {
  const input = asset('override', plainBox().nodes, {
    collision: { mode: 'override', colliders: [{ node: null, shape: 'ball', params: { radius: 0.1 + 0.2 }, t: [0, 0, 0], r: [0, 0, 0, -1] }] },
  })
  assert.deepEqual(normalizeRaaPrims(input).collision.colliders, [
    { node: null, shape: 'ball', params: { radius: 0.3 }, t: [0, 0, 0], r: [0, 0, 0, 1] },
  ])
})

test('an invalid asset throws ASSET_INVALID', () => {
  const missing = plainBox()
  ;(missing.nodes[0] as { material: string }).material = 'missing'
  assert.throws(() => serializeRaaPrims(missing), (e: unknown) => {
    assert.ok(e instanceof RaaError)
    assert.equal(e.code, 'ASSET_INVALID')
    assert.match(e.message, /^1 issues; first: UNKNOWN_MATERIAL \/nodes\/0\/material: .*'box'/)
    assert.equal(e.fix, 'fix the listed issues; run raa-assets validate')
    return true
  })
  const broken = plainBox()
  delete (broken.nodes[0] as { transform?: unknown }).transform
  assert.throws(() => serializeRaaPrims(broken), { code: 'ASSET_INVALID' })
  const huge = plainBox()
  ;(huge.nodes[0]!.transform.t as number[])[0] = 2e6
  assert.throws(() => serializeRaaPrims(huge), /NUMBER_RANGE/)
  const zero = plainBox()
  zero.nodes[0]!.transform.r = [0, 0, 0, 0]
  assert.throws(() => serializeRaaPrims(zero), /BAD_TRANSFORM/)
})
