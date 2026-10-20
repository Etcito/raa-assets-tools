import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deriveColliders, worldTransforms } from '../../src/format/colliders.ts'
import { quatRotate } from '../../src/format/math.ts'
import type { ParamsByKind, PrimKind, Quat, RaaCollider, RaaNode, Vec3 } from '../../src/format/types.ts'

const H = Math.SQRT1_2
const IDENTITY: Quat = [0, 0, 0, 1]

function near(actual: readonly number[], expected: readonly number[]): void {
  assert.equal(actual.length, expected.length)
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Math.abs(actual[i] - expected[i]) <= 1e-12, `index ${i}: ${actual[i]} vs ${expected[i]}`)
  }
}

function node<K extends PrimKind>(kind: K, params: ParamsByKind[K], s: Vec3 = [1, 1, 1], id: string = kind): RaaNode {
  return { id, kind, params, transform: { t: [0, 0, 0], r: [...IDENTITY], s }, material: 'plain', op: 'union' } as RaaNode
}

function canonical(q: Quat): void {
  assert.ok(q[3] >= 0)
  near([Math.hypot(...q)], [1])
}

describe('per-kind S3 scale rules', () => {
  const scales: Vec3[] = [[2, 2, 2], [2, 3, 4]]
  for (const scale of scales) {
    const uniform = scale[1] === 2
    const cases: [RaaNode, RaaCollider['shape'], RaaCollider['params']][] = [
      [node('sphere', { radius: 2 }, scale), uniform ? 'ball' : 'cuboid',
        uniform ? { radius: 4 } : { halfExtents: [4, 6, 8] }],
      [node('ellipsoid', { radii: [2, 3, 4] }, scale), 'cuboid',
        { halfExtents: uniform ? [4, 6, 8] : [4, 9, 16] }],
      [node('box', { size: [4, 6, 8] }, scale), 'cuboid',
        { halfExtents: uniform ? [4, 6, 8] : [4, 9, 16] }],
      [node('roundBox', { size: [4, 6, 8], radius: 1 }, scale), 'roundCuboid',
        { halfExtents: uniform ? [2, 4, 6] : [2, 7, 14], borderRadius: 2 }],
      [node('capsule', { height: 10, radius: 2 }, scale), 'capsule',
        { halfHeight: uniform ? 6 : 7, radius: uniform ? 4 : 8 }],
      [node('cylinder', { height: 10, radius: 2 }, scale), 'cylinder',
        { halfHeight: uniform ? 10 : 15, radius: uniform ? 4 : 8 }],
      [node('cone', { height: 10, radiusBottom: 2, radiusTop: 0 }, scale), 'cone',
        { halfHeight: uniform ? 10 : 15, radius: uniform ? 4 : 8 }],
      [node('torus', { majorRadius: 3, minorRadius: 0.5 }, scale), 'capsule',
        { halfHeight: (uniform ? 6 : 12) * Math.sin(Math.PI / 8), radius: uniform ? 1 : 2 }],
    ]
    for (const [source, shape, params] of cases) {
      it(`${source.kind} with scale [${scale}]`, () => {
        source.transform.t = [1, 2, 3]
        source.transform.r = [0, 0, -H, -H]
        const colliders = deriveColliders({ nodes: [source] })
        assert.equal(colliders.length, source.kind === 'torus' ? 8 : 1)
        for (const collider of colliders) {
          assert.equal(collider.node, source.id)
          assert.equal(collider.shape, shape)
          assert.deepEqual(collider.params, params)
          canonical(collider.r)
          if (source.kind !== 'torus') {
            near(collider.t, [1, 2, 3])
            near(collider.r, [0, 0, H, H])
          }
        }
      })
    }
  }

  it('ellipsoids with equal scaled radii become balls under either scale', () => {
    for (const source of [
      node('ellipsoid', { radii: [3, 3, 3] }, [2, 2, 2]),
      node('ellipsoid', { radii: [6, 4, 3] }, [2, 3, 4]),
    ]) {
      const [collider] = deriveColliders({ nodes: [source] })
      assert.equal(collider.shape, 'ball')
      assert.deepEqual(collider.params, { radius: source.transform.s[1] === 2 ? 6 : 12 })
    }
  })

  it('roundBox subtracts its scaled border, clamping the inner half extents to zero', () => {
    const [collider] = deriveColliders({ nodes: [node('roundBox', { size: [2, 4, 6], radius: 1 }, [3, 2, 4])] })
    assert.equal(collider.shape, 'roundCuboid')
    assert.deepEqual(collider.params, { halfExtents: [1, 2, 10], borderRadius: 2 })
    const [atLimit] = deriveColliders({ nodes: [node('roundBox', { size: [2, 2, 2], radius: 1 }, [2, 3, 4])] })
    assert.deepEqual(atLimit.params, { halfExtents: [0, 1, 2], borderRadius: 2 })
  })

  it('capsule halfHeight clamps to zero when its scaled radius exceeds half the height', () => {
    const [collider] = deriveColliders({ nodes: [node('capsule', { height: 4, radius: 2 }, [3, 1, 4])] })
    assert.equal(collider.shape, 'capsule')
    assert.deepEqual(collider.params, { halfHeight: 0, radius: 8 })
  })
})

describe('world TRS composition', () => {
  it('composes a rotated, scaled parent and a non-uniform child by hand', () => {
    const parent = node('box', { size: [2, 2, 2] }, [2, 2, 2], 'parent')
    parent.transform.t = [10, 20, 30]
    parent.transform.r = [0, 0, H, H]
    const child = node('box', { size: [2, 4, 6] }, [3, 4, 5], 'child')
    child.transform.t = [1, 2, 3]
    child.transform.r = [H, 0, 0, H]
    parent.children = [child]
    const worlds = worldTransforms([parent])
    assert.deepEqual([...worlds.keys()], ['parent', 'child'])
    const world = worlds.get('child')!
    // S: (2,4,6), Rz90: (-4,2,6), T: (6,22,36).
    near(world.t, [6, 22, 36])
    // qz90 * qx90 = (1/2, 1/2, 1/2, 1/2).
    near(world.r, [0.5, 0.5, 0.5, 0.5])
    near(world.e, [6, 8, 10])
    const colliders = deriveColliders({ nodes: [parent] })
    assert.deepEqual(colliders.map(c => c.node), ['parent', 'child'])
    near(colliders[1].t, world.t)
    near(colliders[1].r, world.r)
    assert.deepEqual(colliders[1].params, { halfExtents: [6, 16, 30] })
  })

  it('multiplies all ancestor scales and preserves pre-order across roots and siblings', () => {
    const root = node('sphere', { radius: 1 }, [2, 2, 2], 'root')
    root.transform.r = [0, 0, 0, -1]
    const middle = node('sphere', { radius: 1 }, [3, 3, 3], 'middle')
    middle.transform.t = [1, 0, 0]
    const leaf = node('sphere', { radius: 1 }, [4, 5, 6], 'leaf')
    leaf.transform.t = [0, 1, 0]
    middle.children = [leaf]
    root.children = [middle, node('sphere', { radius: 1 }, [1, 1, 1], 'sibling')]
    const nodes = [root, node('sphere', { radius: 1 }, [1, 1, 1], 'other')]
    const worlds = worldTransforms(nodes)
    assert.deepEqual([...worlds.keys()], ['root', 'middle', 'leaf', 'sibling', 'other'])
    near(worlds.get('leaf')!.t, [2, 6, 0])
    near(worlds.get('leaf')!.e, [24, 30, 36])
    for (const world of worlds.values()) canonical(world.r)
    assert.deepEqual(deriveColliders({ nodes }).map(c => c.node), [...worlds.keys()])
  })
})

describe('cone apex and frustum', () => {
  for (const [bottom, top, shape, rotation] of [
    [2, 0, 'cone', [0, 0, H, H]],
    [0, 2, 'cone', [H, H, 0, 0]],
    [1, 2, 'cylinder', [0, 0, H, H]],
    [2, 1, 'cylinder', [0, 0, H, H]],
  ] as const) {
    it(`bottom ${bottom}, top ${top} gives ${shape} with the expected rotation`, () => {
      const source = node('cone', { height: 10, radiusBottom: bottom, radiusTop: top }, [2, 3, 4])
      source.transform.r = [0, 0, -H, -H]
      const [collider] = deriveColliders({ nodes: [source] })
      assert.equal(collider.shape, shape)
      assert.deepEqual(collider.params, { halfHeight: 15, radius: 8 })
      near(collider.r, rotation)
      canonical(collider.r)
      // Local +Y becomes -X for the unflipped cone and +X for the flipped cone.
      near(quatRotate(collider.r, [0, 1, 0]), top > 0 && bottom === 0 ? [1, 0, 0] : [-1, 0, 0])
    })
  }
})

describe('torus ring', () => {
  for (const scale of [[2, 2, 2], [2, 3, 4]] as Vec3[]) {
    it(`places 8 tangent capsules in j order with scale [${scale}]`, () => {
      const source = node('torus', { majorRadius: 3, minorRadius: 0.5 }, scale)
      source.transform.t = [1, 2, 3]
      source.transform.r = [0, 0, -H, -H]
      const colliders = deriveColliders({ nodes: [source] })
      const R = scale[2] === 2 ? 6 : 12
      assert.equal(colliders.length, 8)
      for (let j = 0; j < 8; j++) {
        const collider = colliders[j]
        assert.equal(collider.node, source.id)
        assert.equal(collider.shape, 'capsule')
        assert.deepEqual(collider.params, { halfHeight: R * Math.sin(Math.PI / 8), radius: scale[2] / 2 })
        const a = j * Math.PI / 4
        // Rz90 sends (R cos(a), 0, R sin(a)) to (0, R cos(a), R sin(a)).
        near(collider.t, [1, 2 + R * Math.cos(a), 3 + R * Math.sin(a)])
        near([Math.hypot(collider.t[0] - 1, collider.t[1] - 2, collider.t[2] - 3)], [R])
        near(quatRotate(collider.r, [0, 1, 0]), [0, -Math.sin(a), Math.cos(a)])
        canonical(collider.r)
      }
    })
  }

  it('includes ancestor scale and rotation in the capsule centres and tangents', () => {
    const parent = node('box', { size: [1, 1, 1] }, [2, 2, 2], 'parent')
    parent.transform.t = [10, 20, 30]
    parent.transform.r = [0, H, 0, H]
    const torus = node('torus', { majorRadius: 3, minorRadius: 0.5 }, [2, 3, 4])
    torus.transform.t = [1, 0, 0]
    parent.children = [torus]
    const colliders = deriveColliders({ nodes: [parent] }, id => id === 'torus')
    assert.equal(colliders.length, 8)
    for (let j = 0; j < 8; j++) {
      const a = j * Math.PI / 4
      near(colliders[j].t, [10 + 24 * Math.sin(a), 20, 28 - 24 * Math.cos(a)])
      near(quatRotate(colliders[j].r, [0, 1, 0]), [Math.cos(a), 0, Math.sin(a)])
      assert.deepEqual(colliders[j].params, { halfHeight: 24 * Math.sin(Math.PI / 8), radius: 4 })
    }
  })
})

describe('walk and include filter', () => {
  it('skips cutters and their subtrees, while a filtered parent still supplies its transform', () => {
    const root = node('box', { size: [2, 2, 2] }, [2, 2, 2], 'root')
    root.transform.t = [10, 0, 0]
    const subtract = node('sphere', { radius: 1 }, [1, 1, 1], 'subtract')
    subtract.op = 'subtract'
    const intersect = node('sphere', { radius: 1 }, [1, 1, 1], 'intersect')
    intersect.op = 'intersect'
    // Invalid cutter children also must not be visited by derivation.
    subtract.children = [node('sphere', { radius: 1 }, [1, 1, 1], 'hidden_subtract')]
    intersect.children = [node('sphere', { radius: 1 }, [1, 1, 1], 'hidden_intersect')]
    const child = node('sphere', { radius: 1 }, [1, 1, 1], 'child')
    child.transform.t = [1, 0, 0]
    root.children = [subtract, child, intersect]
    assert.deepEqual(deriveColliders({ nodes: [root] }).map(c => c.node), ['root', 'child'])
    const visited: string[] = []
    const filtered = deriveColliders({ nodes: [root] }, id => {
      visited.push(id)
      return id === 'child'
    })
    assert.deepEqual(visited, ['root', 'child'])
    assert.deepEqual(filtered, [{ node: 'child', shape: 'ball', params: { radius: 2 }, t: [12, 0, 0], r: IDENTITY }])
    assert.deepEqual(deriveColliders({ nodes: [root] }, () => false), [])
    assert.deepEqual(deriveColliders({ nodes: [subtract, intersect] }), [])
  })
})
