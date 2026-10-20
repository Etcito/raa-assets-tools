import { isUniformScale, mulMat4, quatCanonical, quatMul, transformPoint, trsMatrix } from './math.ts'
import type { Mat4 } from './math.ts'
import type { Quat, RaaCollider, RaaNode, RaaPrimsAsset, Vec3 } from './types.ts'

type WorldTransform = { t: Vec3; r: Quat; e: Vec3 }

/** Parents are uniformly scaled, so rotation and effective scale compose separately. */
function walkWorld(
  nodes: RaaNode[],
  visit: (node: RaaNode, world: WorldTransform) => void,
  skipCutters: boolean,
  parentMatrix?: Mat4,
  parentRotation: Quat = [0, 0, 0, 1],
  ancestorScale = 1,
): void {
  for (const node of nodes) {
    if (skipCutters && node.op !== 'union') continue
    const local = node.transform
    const t: Vec3 = parentMatrix ? transformPoint(parentMatrix, local.t) : [...local.t]
    const r = quatCanonical(quatMul(parentRotation, quatCanonical(local.r)))
    const e: Vec3 = [local.s[0] * ancestorScale, local.s[1] * ancestorScale, local.s[2] * ancestorScale]
    visit(node, { t, r, e })
    if (node.children?.length) {
      const matrix = trsMatrix(local)
      walkWorld(
        node.children, visit, skipCutters,
        parentMatrix ? mulMat4(parentMatrix, matrix) : matrix,
        r, ancestorScale * local.s[0],
      )
    }
  }
}

export function worldTransforms(nodes: RaaNode[]): Map<string, { t: Vec3; r: Quat; e: Vec3 }> {
  const result = new Map<string, WorldTransform>()
  walkWorld(nodes, (node, world) => result.set(node.id, world), false)
  return result
}

export function deriveColliders(
  asset: Pick<RaaPrimsAsset, 'nodes'>,
  include?: (nodeId: string) => boolean,
): RaaCollider[] {
  const result: RaaCollider[] = []
  walkWorld(asset.nodes, (node, { t, r, e }) => {
    if (include && !include(node.id)) return
    const base = { node: node.id, t, r: quatCanonical(r) }
    const radialScale = Math.max(e[0], e[2])
    switch (node.kind) {
      case 'sphere': {
        const radius = node.params.radius
        if (isUniformScale(e)) {
          result.push({ ...base, shape: 'ball', params: { radius: radius * e[0] } })
        } else {
          result.push({ ...base, shape: 'cuboid', params: { halfExtents: [radius * e[0], radius * e[1], radius * e[2]] } })
        }
        break
      }
      case 'ellipsoid': {
        const radii = node.params.radii
        const scaled: Vec3 = [radii[0] * e[0], radii[1] * e[1], radii[2] * e[2]]
        result.push(isUniformScale(scaled)
          ? { ...base, shape: 'ball', params: { radius: scaled[0] } }
          : { ...base, shape: 'cuboid', params: { halfExtents: scaled } })
        break
      }
      case 'box':
      case 'roundBox': {
        const size = node.params.size
        const halfExtents: Vec3 = [size[0] / 2 * e[0], size[1] / 2 * e[1], size[2] / 2 * e[2]]
        if (node.kind === 'box') {
          result.push({ ...base, shape: 'cuboid', params: { halfExtents } })
        } else {
          const borderRadius = node.params.radius * Math.min(...e)
          result.push({
            ...base, shape: 'roundCuboid',
            params: {
              halfExtents: halfExtents.map(value => Math.max(value - borderRadius, 0)) as Vec3,
              borderRadius,
            },
          })
        }
        break
      }
      case 'capsule': {
        const radius = node.params.radius * radialScale
        result.push({ ...base, shape: 'capsule', params: { halfHeight: Math.max(node.params.height / 2 * e[1] - radius, 0), radius } })
        break
      }
      case 'cylinder':
        result.push({ ...base, shape: 'cylinder', params: { halfHeight: node.params.height / 2 * e[1], radius: node.params.radius * radialScale } })
        break
      case 'cone': {
        const { height, radiusBottom, radiusTop } = node.params
        const params = { halfHeight: height / 2 * e[1], radius: Math.max(radiusBottom, radiusTop) * radialScale }
        if (radiusTop === 0) {
          result.push({ ...base, shape: 'cone', params })
        } else if (radiusBottom === 0) {
          result.push({ ...base, r: quatCanonical(quatMul(r, [1, 0, 0, 0])), shape: 'cone', params })
        } else {
          result.push({ ...base, shape: 'cylinder', params })
        }
        break
      }
      case 'torus': {
        const radius = node.params.minorRadius * Math.max(...e)
        const ringRadius = node.params.majorRadius * radialScale
        // Scale is already in ringRadius; place the ring with the world rigid transform.
        const frame = trsMatrix({ t, r, s: [1, 1, 1] })
        for (let j = 0; j < 8; j++) {
          const angle = j * Math.PI / 4
          const c = Math.cos(angle), s = Math.sin(angle)
          // The shortest turn from +Y to (-sin(a), 0, cos(a)).
          const tangentRotation: Quat = [c * Math.SQRT1_2, 0, s * Math.SQRT1_2, Math.SQRT1_2]
          result.push({
            node: node.id, shape: 'capsule',
            params: { halfHeight: ringRadius * Math.sin(Math.PI / 8), radius },
            t: transformPoint(frame, [ringRadius * c, 0, ringRadius * s]),
            r: quatCanonical(quatMul(r, tangentRotation)),
          })
        }
        break
      }
    }
  }, true)
  return result
}
