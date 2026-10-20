import { UNIFORM_SCALE_TOLERANCE } from './constants.ts'
import type { Quat, RaaTransform, Vec3 } from './types.ts'

/** 4x4 matrix, column-major: element (row, col) is at index col * 4 + row. */
export type Mat4 = Float64Array

export function quatNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3])
  if (n === 0 || !Number.isFinite(n)) return [0, 0, 0, 1]
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
}

/** Normalised, with w >= 0 (the S4 written form). */
export function quatCanonical(q: Quat): Quat {
  const n = quatNormalize(q)
  return n[3] < 0 ? [-n[0], -n[1], -n[2], -n[3]] : n
}

/** Hamilton product a · b (apply b first, then a). */
export function quatMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

/** Rotates v by the unit quaternion q. */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q
  // t = 2 (u × v); v' = v + w t + u × t
  const tx = 2 * (y * v[2] - z * v[1])
  const ty = 2 * (z * v[0] - x * v[2])
  const tz = 2 * (x * v[1] - y * v[0])
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ]
}

/** Euler angles in degrees, three.js 'XYZ' order (matrix Rx · Ry · Rz). */
export function quatFromEulerXYZDeg(e: Vec3): Quat {
  const h = Math.PI / 360
  const c1 = Math.cos(e[0] * h)
  const c2 = Math.cos(e[1] * h)
  const c3 = Math.cos(e[2] * h)
  const s1 = Math.sin(e[0] * h)
  const s2 = Math.sin(e[1] * h)
  const s3 = Math.sin(e[2] * h)
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ]
}

/** Shepperd's method on the upper 3x3 (assumed a pure rotation); canonical sign. */
export function quatFromMat3(m: Mat4): Quat {
  const m00 = m[0], m10 = m[1], m20 = m[2]
  const m01 = m[4], m11 = m[5], m21 = m[6]
  const m02 = m[8], m12 = m[9], m22 = m[10]
  const trace = m00 + m11 + m22
  let q: Quat
  if (trace >= m00 && trace >= m11 && trace >= m22) {
    const s = 2 * Math.sqrt(Math.max(1 + trace, 0))
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]
  } else if (m00 >= m11 && m00 >= m22) {
    const s = 2 * Math.sqrt(Math.max(1 + m00 - m11 - m22, 0))
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
  } else if (m11 >= m22) {
    const s = 2 * Math.sqrt(Math.max(1 + m11 - m00 - m22, 0))
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]
  } else {
    const s = 2 * Math.sqrt(Math.max(1 + m22 - m00 - m11, 0))
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]
  }
  return quatCanonical(q)
}

/** Local matrix M = T(t) · R(r) · S(s); r is normalised first. */
export function trsMatrix(tr: RaaTransform): Mat4 {
  const [x, y, z, w] = quatNormalize(tr.r)
  const [sx, sy, sz] = tr.s
  const m = new Float64Array(16)
  m[0] = (1 - 2 * (y * y + z * z)) * sx
  m[1] = 2 * (x * y + z * w) * sx
  m[2] = 2 * (x * z - y * w) * sx
  m[4] = 2 * (x * y - z * w) * sy
  m[5] = (1 - 2 * (x * x + z * z)) * sy
  m[6] = 2 * (y * z + x * w) * sy
  m[8] = 2 * (x * z + y * w) * sz
  m[9] = 2 * (y * z - x * w) * sz
  m[10] = (1 - 2 * (x * x + y * y)) * sz
  m[12] = tr.t[0]
  m[13] = tr.t[1]
  m[14] = tr.t[2]
  m[15] = 1
  return m
}

/** a · b (b applied first). */
export function mulMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k]
      out[c * 4 + r] = sum
    }
  }
  return out
}

/** Applies m to the point p (w = 1; the bottom row is assumed affine). */
export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const [x, y, z] = p
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ]
}

/** S1 rule: max abs(si - sj) <= UNIFORM_SCALE_TOLERANCE · max abs(s). */
export function isUniformScale(s: Vec3): boolean {
  const spread = Math.max(Math.abs(s[0] - s[1]), Math.abs(s[0] - s[2]), Math.abs(s[1] - s[2]))
  const size = Math.max(Math.abs(s[0]), Math.abs(s[1]), Math.abs(s[2]))
  return spread <= UNIFORM_SCALE_TOLERANCE * size
}
