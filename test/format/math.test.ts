import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  isUniformScale,
  mulMat4,
  quatCanonical,
  quatFromEulerXYZDeg,
  quatFromMat3,
  quatMul,
  quatNormalize,
  quatRotate,
  transformPoint,
  trsMatrix,
} from '../../src/format/math.ts'
import type { Quat, Vec3 } from '../../src/format/types.ts'

const H = Math.SQRT1_2

function near(actual: readonly number[], expected: readonly number[], eps = 1e-12): void {
  assert.equal(actual.length, expected.length)
  for (let i = 0; i < expected.length; i++) {
    assert.ok(
      Math.abs(actual[i]! - expected[i]!) <= eps,
      `index ${i}: ${actual[i]} vs ${expected[i]} (eps ${eps}) in [${actual.join(', ')}]`,
    )
  }
}

const IDENTITY: Quat = [0, 0, 0, 1]
const ONE: Vec3 = [1, 1, 1]
const ZERO: Vec3 = [0, 0, 0]

describe('quatNormalize / quatCanonical', () => {
  it('normalises to unit length', () => {
    near(quatNormalize([0, 0, 0, 2]), [0, 0, 0, 1])
    near(quatNormalize([1, 1, 1, 1]), [0.5, 0.5, 0.5, 0.5])
  })

  it('keeps w >= 0 as is and negates w < 0', () => {
    near(quatCanonical([0, 2, 0, 2]), [0, H, 0, H])
    near(quatCanonical([-1, 1, -1, -1]), [0.5, -0.5, 0.5, 0.5])
    near(quatCanonical([0, 0, 0, -3]), [0, 0, 0, 1])
  })
})

describe('quatMul / quatRotate', () => {
  const a = quatNormalize([0.1, -0.7, 0.3, 0.6])
  const b = quatNormalize([-0.4, 0.2, 0.9, -0.1])
  const c = quatNormalize([0.5, 0.5, -0.2, 0.7])

  it('is associative', () => {
    near(quatMul(quatMul(a, b), c), quatMul(a, quatMul(b, c)))
  })

  it('composes rotations: (a · b) v = a (b v)', () => {
    const v: Vec3 = [0.3, -1.2, 2.5]
    near(quatRotate(quatMul(a, b), v), quatRotate(a, quatRotate(b, v)))
  })

  it('agrees with the rotation part of trsMatrix', () => {
    const m = trsMatrix({ t: ZERO, r: a, s: ONE })
    for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.3, -1.2, 2.5]] as Vec3[]) {
      near(quatRotate(a, v), transformPoint(m, v))
    }
  })

  it('rotates 90 degrees about Y: +X goes to -Z', () => {
    near(quatRotate([0, H, 0, H], [1, 0, 0]), [0, 0, -1])
  })
})

describe('quatFromEulerXYZDeg', () => {
  it('90 degrees about X', () => {
    near(quatFromEulerXYZDeg([90, 0, 0]), [H, 0, 0, H])
  })

  it('90 degrees about Y', () => {
    near(quatFromEulerXYZDeg([0, 90, 0]), [0, H, 0, H])
  })

  it('mixed (90, 90, 0) = qx · qy = [0.5, 0.5, 0.5, 0.5]', () => {
    near(quatFromEulerXYZDeg([90, 90, 0]), [0.5, 0.5, 0.5, 0.5])
  })

  it('mixed (30, 45, 60) matches the matrix Rx · Ry · Rz written by hand', () => {
    const d = Math.PI / 180
    const [cx, sx] = [Math.cos(30 * d), Math.sin(30 * d)]
    const [cy, sy] = [Math.cos(45 * d), Math.sin(45 * d)]
    const [cz, sz] = [Math.cos(60 * d), Math.sin(60 * d)]
    // three.js Matrix4.makeRotationFromEuler, order 'XYZ' (row-major rows)
    const rows = [
      [cy * cz, -cy * sz, sy],
      [cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy],
      [sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy],
    ]
    const q = quatFromEulerXYZDeg([30, 45, 60])
    for (let col = 0; col < 3; col++) {
      const v: Vec3 = [0, 0, 0]
      v[col] = 1
      near(quatRotate(q, v), [rows[0]![col]!, rows[1]![col]!, rows[2]![col]!])
    }
  })
})

describe('quatFromMat3', () => {
  it('round trips quat -> trsMatrix -> quatFromMat3 within 1e-12', () => {
    const samples: Quat[] = [
      IDENTITY,
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [H, 0, 0, H],
      [0, -H, 0, H],
      quatFromEulerXYZDeg([30, 45, 60]),
      quatFromEulerXYZDeg([179, -89, 12]),
      quatFromEulerXYZDeg([-170, 10, 175]),
      quatNormalize([0.1, -0.7, 0.3, 0.6]),
      quatNormalize([-0.4, 0.2, 0.9, -0.1]),
    ]
    for (const q of samples) {
      const back = quatFromMat3(trsMatrix({ t: [1, 2, 3], r: q, s: ONE }))
      near(back, quatCanonical(q))
      assert.ok(back[3] >= 0)
    }
  })
})

describe('trsMatrix / mulMat4 / transformPoint', () => {
  it('applies S, then R, then T', () => {
    const m = trsMatrix({ t: [10, 20, 30], r: [0, 0, H, H], s: [2, 3, 4] })
    // (1, 1, 1) -> S (2, 3, 4) -> Rz 90 (-3, 2, 4) -> T (7, 22, 34)
    near(transformPoint(m, [1, 1, 1]), [7, 22, 34])
  })

  it('equals the product of separate T, R and S matrices', () => {
    const r = quatFromEulerXYZDeg([30, 45, 60])
    const T = trsMatrix({ t: [1, -2, 3], r: IDENTITY, s: ONE })
    const R = trsMatrix({ t: ZERO, r, s: ONE })
    const S = trsMatrix({ t: ZERO, r: IDENTITY, s: [2, 0.5, 3] })
    const trs = trsMatrix({ t: [1, -2, 3], r, s: [2, 0.5, 3] })
    near(Array.from(mulMat4(T, mulMat4(R, S))), Array.from(trs))
    near(Array.from(mulMat4(mulMat4(T, R), S)), Array.from(trs))
  })

  it('chains a parent and a child transform', () => {
    const parent = trsMatrix({ t: [0, 5, 0], r: [0, H, 0, H], s: [2, 2, 2] })
    const child = trsMatrix({ t: [1, 0, 0], r: IDENTITY, s: [1, 1, 1] })
    // child origin (1, 0, 0) in parent: scale 2 -> (2, 0, 0), Ry 90 -> (0, 0, -2), T -> (0, 5, -2)
    near(transformPoint(mulMat4(parent, child), [0, 0, 0]), [0, 5, -2])
    const p: Vec3 = [0.5, -1, 2]
    near(transformPoint(mulMat4(parent, child), p), transformPoint(parent, transformPoint(child, p)))
  })
})

describe('isUniformScale', () => {
  it('accepts exactly uniform scales', () => {
    assert.equal(isUniformScale([1, 1, 1]), true)
    assert.equal(isUniformScale([0.25, 0.25, 0.25]), true)
  })

  it('accepts a spread just under 1e-9 relative and refuses one just over', () => {
    // 2^-30 ~ 9.3e-10 and 2^-29 ~ 1.9e-9 are exact in binary
    assert.equal(isUniformScale([1, 1, 1 + 2 ** -30]), true)
    assert.equal(isUniformScale([1, 1, 1 + 2 ** -29]), false)
    assert.equal(isUniformScale([1 + 2 ** -30, 1, 1]), true)
    assert.equal(isUniformScale([1, 1 + 2 ** -29, 1]), false)
  })

  it('scales the tolerance with max abs(s)', () => {
    // at 1024 the bound is ~1.02e-6: 2^-20 ~ 9.5e-7 passes, 2^-19 ~ 1.9e-6 fails
    assert.equal(isUniformScale([1024, 1024, 1024 + 2 ** -20]), true)
    assert.equal(isUniformScale([1024, 1024, 1024 + 2 ** -19]), false)
    assert.equal(isUniformScale([1, 1, 1.5]), false)
  })
})
