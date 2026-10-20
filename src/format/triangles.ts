import { DEFAULT_SEGMENTS } from './constants.ts'
import type { ParamsByKind, RaaNode, RaaPrimsAsset } from './types.ts'

/** S2 table: LOD0 triangle count of one primitive at S = segments (k = S/4). */
export function primitiveTriangles(node: Pick<RaaNode, 'kind' | 'params'>, segments: number): number {
  const s = segments
  const k = s / 4
  switch (node.kind) {
    case 'box':
      return 12
    case 'roundBox':
      return (node.params as ParamsByKind['roundBox']).radius === 0 ? 12 : 12 + 24 * k + 8 * k * (2 * k - 1)
    case 'sphere':
    case 'ellipsoid':
      return s * (s - 2)
    case 'capsule':
      return s * (s - 2) + 2 * s
    case 'cylinder':
      return 4 * s - 4
    case 'cone': {
      const { radiusBottom, radiusTop } = node.params as ParamsByKind['cone']
      return radiusBottom > 0 && radiusTop > 0 ? 4 * s - 4 : 2 * s - 2
    }
    case 'torus':
      return s * s
  }
}

/**
 * S2 asset total: every node (children included) once, plus once more for each
 * subtract or intersect node (the cut allowance). perNode holds each node's own
 * count, with the allowance added for cutters.
 */
export function assetTriangles(asset: Pick<RaaPrimsAsset, 'nodes' | 'budget'>): {
  total: number
  perNode: Record<string, number>
} {
  const segments = asset.budget?.segments ?? DEFAULT_SEGMENTS
  const perNode: Record<string, number> = {}
  let total = 0
  const walk = (nodes: readonly RaaNode[]): void => {
    for (const node of nodes) {
      const own = primitiveTriangles(node, segments)
      const count = node.op === 'union' ? own : 2 * own
      perNode[node.id] = count
      total += count
      if (node.children) walk(node.children)
    }
  }
  walk(asset.nodes)
  return { total, perNode }
}
