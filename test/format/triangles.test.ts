import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { aabbOverlap, boundsInParent, localBounds } from '../../src/format/bounds.ts'
import type { Aabb } from '../../src/format/bounds.ts'
import { assetTriangles, primitiveTriangles } from '../../src/format/triangles.ts'
import type { RaaBudget, RaaNode, RaaTransform } from '../../src/format/types.ts'

const IDENTITY: RaaTransform = { t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1] }

function near(actual: readonly number[], expected: readonly number[], eps = 1e-12): void {
  assert.equal(actual.length, expected.length)
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Math.abs(actual[i]! - expected[i]!) <= eps, `index ${i}: ${actual[i]} vs ${expected[i]}`)
  }
}

type Sample = Pick<RaaNode, 'kind' | 'params'>
const SAMPLES: Record<string, Sample> = {
  box: { kind: 'box', params: { size: [1, 2, 3] } },
  roundBox: { kind: 'roundBox', params: { size: [1, 2, 3], radius: 0.1 } },
  roundBoxSharp: { kind: 'roundBox', params: { size: [1, 2, 3], radius: 0 } },
  sphere: { kind: 'sphere', params: { radius: 0.5 } },
  ellipsoid: { kind: 'ellipsoid', params: { radii: [1, 2, 3] } },
  capsule: { kind: 'capsule', params: { height: 2, radius: 0.5 } },
  cylinder: { kind: 'cylinder', params: { height: 2, radius: 0.5 } },
  cone: { kind: 'cone', params: { height: 2, radiusBottom: 0.5, radiusTop: 0.25 } },
  coneApexTop: { kind: 'cone', params: { height: 2, radiusBottom: 0.5, radiusTop: 0 } },
  coneApexBottom: { kind: 'cone', params: { height: 2, radiusBottom: 0, radiusTop: 0.5 } },
  torus: { kind: 'torus', params: { majorRadius: 1, minorRadius: 0.25 } },
}

// Hand-computed from the S2 table (k = S/4).
// S = 4 (k = 1): roundBox 12 + 24 + 8 = 44; sphere 4·2 = 8; capsule 8 + 8 = 16; cylinder 12; cone 12 / 6; torus 16.
// S = 16 (k = 4): roundBox 12 + 96 + 224 = 332; sphere 16·14 = 224; capsule 224 + 32 = 256; cylinder 60; cone 60 / 30; torus 256.
// S = 128 (k = 32): roundBox 12 + 768 + 16128 = 16908; sphere 128·126 = 16128; capsule 16128 + 256 = 16384;
//   cylinder 508; cone 508 / 254; torus 16384.
const EXPECTED: Record<number, Record<string, number>> = {
  4: { box: 12, roundBox: 44, roundBoxSharp: 12, sphere: 8, ellipsoid: 8, capsule: 16, cylinder: 12, cone: 12, coneApexTop: 6, coneApexBottom: 6, torus: 16 },
  16: { box: 12, roundBox: 332, roundBoxSharp: 12, sphere: 224, ellipsoid: 224, capsule: 256, cylinder: 60, cone: 60, coneApexTop: 30, coneApexBottom: 30, torus: 256 },
  128: { box: 12, roundBox: 16908, roundBoxSharp: 12, sphere: 16128, ellipsoid: 16128, capsule: 16384, cylinder: 508, cone: 508, coneApexTop: 254, coneApexBottom: 254, torus: 16384 },
}

describe('primitiveTriangles', () => {
  for (const s of [4, 16, 128]) {
    it(`matches the S2 table for every kind at S = ${s}`, () => {
      for (const [name, sample] of Object.entries(SAMPLES)) {
        assert.equal(primitiveTriangles(sample, s), EXPECTED[s]![name], `${name} at S = ${s}`)
      }
    })
  }
})

function node(id: string, sample: Sample, op: RaaNode['op'] = 'union', children?: RaaNode[]): RaaNode {
  const n = { id, ...sample, transform: IDENTITY, material: 'm', op } as RaaNode
  if (children) n.children = children
  return n
}

describe('assetTriangles', () => {
  const wall = node('wall', SAMPLES.box!, 'union', [node('hole', SAMPLES.cylinder!, 'subtract')])

  it('adds the cut allowance for a subtract cylinder at S = 16', () => {
    const r = assetTriangles({ nodes: [wall], budget: { triangles: 1500, segments: 16 } })
    assert.equal(r.total, 132)
    assert.deepEqual(r.perNode, { wall: 12, hole: 120 })
  })

  it('counts an intersect child twice and walks nested children', () => {
    const root = node('a', SAMPLES.sphere!, 'union', [
      node('b', SAMPLES.box!, 'intersect'),
      node('c', SAMPLES.torus!, 'union', [node('d', SAMPLES.cylinder!)]),
    ])
    const r = assetTriangles({ nodes: [root, node('e', SAMPLES.box!)], budget: { triangles: 1500, segments: 16 } })
    assert.deepEqual(r.perNode, { a: 224, b: 24, c: 256, d: 60, e: 12 })
    assert.equal(r.total, 224 + 24 + 256 + 60 + 12)
  })

  it('defaults missing budget.segments to DEFAULT_SEGMENTS', () => {
    const budget = { triangles: 1500 } as RaaBudget
    assert.equal(assetTriangles({ nodes: [wall], budget }).total, 132)
  })
})

describe('bounds', () => {
  it('localBounds is the exact centred box for every kind', () => {
    const cases: [Sample, [number, number, number]][] = [
      [SAMPLES.sphere!, [0.5, 0.5, 0.5]],
      [SAMPLES.box!, [0.5, 1, 1.5]],
      [SAMPLES.roundBox!, [0.5, 1, 1.5]],
      [SAMPLES.capsule!, [0.5, 1, 0.5]],
      [SAMPLES.cylinder!, [0.5, 1, 0.5]],
      [SAMPLES.cone!, [0.5, 1, 0.5]],
      [SAMPLES.coneApexBottom!, [0.5, 1, 0.5]],
      [SAMPLES.torus!, [1.25, 0.25, 1.25]],
      [SAMPLES.ellipsoid!, [1, 2, 3]],
    ]
    for (const [sample, h] of cases) {
      const b = localBounds(sample.kind, sample.params)
      near(b.min, [-h[0], -h[1], -h[2]])
      near(b.max, h)
    }
  })

  it('boundsInParent boxes the 8 corners of a 90°-rotated box', () => {
    const h = Math.SQRT1_2
    const n = node('b', SAMPLES.box!)
    n.transform = { t: [10, 0, 0], r: [0, 0, h, h], s: [2, 1, 1] } // 90° about Z
    const b = boundsInParent(n)
    // Scaled half extents (1, 1, 1.5); Z rotation maps x -> y and y -> -x.
    near(b.min, [9, -1, -1.5])
    near(b.max, [11, 1, 1.5])
  })

  it('aabbOverlap is an open-interior test with OVERLAP_EPSILON', () => {
    const unit: Aabb = { min: [0, 0, 0], max: [1, 1, 1] }
    const shifted = (dx: number): Aabb => ({ min: [dx, 0, 0], max: [dx + 1, 1, 1] })
    assert.equal(aabbOverlap(unit, shifted(1)), false, 'touching')
    assert.equal(aabbOverlap(shifted(1), unit), false, 'touching, swapped')
    assert.equal(aabbOverlap(unit, shifted(0.5)), true, 'overlapping')
    assert.equal(aabbOverlap(unit, shifted(1 - 1e-10)), false, '1e-10 overlap')
    assert.equal(aabbOverlap(unit, { min: [0.5, 2, 0], max: [1.5, 3, 1] }), false, 'apart on Y')
  })
})
