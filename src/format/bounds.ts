import { OVERLAP_EPSILON } from './constants.ts'
import { transformPoint, trsMatrix } from './math.ts'
import type { ParamsByKind, PrimKind, RaaNode, Vec3 } from './types.ts'

export interface Aabb {
  min: Vec3
  max: Vec3
}

function halfExtents(kind: PrimKind, params: ParamsByKind[PrimKind]): Vec3 {
  switch (kind) {
    case 'sphere': {
      const { radius } = params as ParamsByKind['sphere']
      return [radius, radius, radius]
    }
    case 'box':
    case 'roundBox': {
      const { size } = params as ParamsByKind['box']
      return [size[0] / 2, size[1] / 2, size[2] / 2]
    }
    case 'capsule':
    case 'cylinder': {
      const { height, radius } = params as ParamsByKind['cylinder']
      return [radius, height / 2, radius]
    }
    case 'cone': {
      const { height, radiusBottom, radiusTop } = params as ParamsByKind['cone']
      const r = Math.max(radiusBottom, radiusTop)
      return [r, height / 2, r]
    }
    case 'torus': {
      const { majorRadius, minorRadius } = params as ParamsByKind['torus']
      const r = majorRadius + minorRadius
      return [r, minorRadius, r]
    }
    case 'ellipsoid': {
      const { radii } = params as ParamsByKind['ellipsoid']
      return [radii[0], radii[1], radii[2]]
    }
  }
}

/** Exact box of the primitive, centred on its origin (axis along Y for capsule, cylinder, cone, torus). */
export function localBounds<K extends PrimKind>(kind: K, params: ParamsByKind[K]): Aabb {
  const h = halfExtents(kind, params)
  return { min: [-h[0], -h[1], -h[2]], max: h }
}

/** The 8 corners of localBounds through trsMatrix(node.transform), boxed in the parent frame. */
export function boundsInParent(node: RaaNode): Aabb {
  const local = localBounds(node.kind, node.params)
  const m = trsMatrix(node.transform)
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < 8; i++) {
    const corner: Vec3 = [
      i & 1 ? local.max[0] : local.min[0],
      i & 2 ? local.max[1] : local.min[1],
      i & 4 ? local.max[2] : local.min[2],
    ]
    const p = transformPoint(m, corner)
    for (let a = 0; a < 3; a++) {
      if (p[a] < min[a]) min[a] = p[a]
      if (p[a] > max[a]) max[a] = p[a]
    }
  }
  return { min, max }
}

/** S1 open-interior test: minA < maxB - eps and minB < maxA - eps on all three axes. */
export function aabbOverlap(a: Aabb, b: Aabb): boolean {
  for (let i = 0; i < 3; i++) {
    if (!(a.min[i] < b.max[i] - OVERLAP_EPSILON && b.min[i] < a.max[i] - OVERLAP_EPSILON)) return false
  }
  return true
}
