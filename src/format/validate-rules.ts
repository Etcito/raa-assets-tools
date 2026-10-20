import { aabbOverlap, boundsInParent } from './bounds.ts'
import {
  CONVEX_KINDS,
  MAX_ANCHORS,
  MAX_COLLIDERS,
  MAX_DEPTH,
  MAX_MATERIALS,
  MAX_NODES,
} from './constants.ts'
import { assetTriangles } from './triangles.ts'
import type { RaaNode, RaaPrimsAsset } from './types.ts'
import { isRecord, ptr } from './validate-util.ts'
import type { IssueSink } from './validate-util.ts'
import type { NodeInfo } from './validate-nodes.ts'

const CONVEX_LIST = `only convex shapes (${CONVEX_KINDS.join(', ')}) can be cut`

function ids(infos: readonly NodeInfo[]): string[] {
  return infos.flatMap((info) => (info.id === null ? [] : [info.id]))
}

function quoted(list: readonly string[]): string {
  return list.map((id) => `'${id}'`).join(', ')
}

/** Step 4: node count, depth, materials, anchors and colliders caps. */
export function checkCaps(infos: readonly NodeInfo[], top: Record<string, unknown>, sink: IssueSink): void {
  if (Array.isArray(top.nodes) && top.nodes.length === 0) {
    sink.add('CAP_NODES', '/nodes', `The asset has no node; it needs 1 to ${MAX_NODES} nodes.`)
  } else if (infos.length > MAX_NODES) {
    sink.add('CAP_NODES', '/nodes', `The asset has ${infos.length} nodes, over the cap of ${MAX_NODES}.`)
  }
  for (const info of infos) {
    if (info.depth <= MAX_DEPTH) continue
    const nodes = info.id === null ? [] : [info.id]
    const who = info.id === null ? `the node at ${info.path}` : `node '${info.id}'`
    sink.add('CAP_DEPTH', info.path, `${who} is at depth ${info.depth}, deeper than the cap of ${MAX_DEPTH}.`, nodes)
  }
  if (isRecord(top.materials)) {
    const count = Object.keys(top.materials).length
    if (count === 0 || count > MAX_MATERIALS) {
      sink.add('CAP_MATERIALS', '/materials', `The asset has ${count} materials; it needs 1 to ${MAX_MATERIALS}.`)
    }
  }
  if (isRecord(top.anchors)) {
    const count = Object.keys(top.anchors).length
    if (count > MAX_ANCHORS) {
      sink.add('CAP_ANCHORS', '/anchors', `The asset has ${count} anchors, over the cap of ${MAX_ANCHORS}.`)
    }
  }
  if (isRecord(top.collision) && Array.isArray(top.collision.colliders)) {
    const count = top.collision.colliders.length
    if (count > MAX_COLLIDERS) {
      sink.add('CAP_COLLIDERS', '/collision/colliders',
        `The collision has ${count} colliders, over the cap of ${MAX_COLLIDERS}.`)
    }
  }
}

function isCutter(info: NodeInfo): boolean {
  return info.op === 'subtract' || info.op === 'intersect'
}

function cutVerb(info: NodeInfo): string {
  return info.op === 'subtract' ? 'subtracts from' : 'intersects'
}

/** Step 5: the S1 cut rules, over nodes whose own checks passed. */
export function checkBooleans(infos: readonly NodeInfo[], sink: IssueSink): void {
  const byPath = new Map<string, NodeInfo>()
  for (const info of infos) if (info.ok) byPath.set(info.path, info)

  for (const info of infos) {
    if (!info.ok || info.node === null) continue
    const node = info.node
    const id = node.id

    if (isCutter(info)) {
      if (info.depth === 1) {
        sink.add('BOOL_NO_HOST', info.path,
          `node '${id}' is a root ${info.op}: a cut needs a parent shape to act on`, [id])
      } else {
        const parent = byPath.get(info.path.replace(/\/children\/\d+$/, ''))
        if (parent?.node && !CONVEX_KINDS.includes(parent.node.kind)) {
          const host = parent.node
          sink.add('BOOL_HOST_NOT_CONVEX', info.path,
            `node '${id}' ${cutVerb(info)} '${host.id}', a ${host.kind}: ${CONVEX_LIST}`, [id, host.id])
        }
      }
      if (!CONVEX_KINDS.includes(node.kind)) {
        sink.add('BOOL_CUTTER_NOT_CONVEX', info.path,
          `node '${id}' is a ${node.kind} used as a cutter: only convex shapes ` +
          `(${CONVEX_KINDS.join(', ')}) can cut`, [id])
      }
      if (node.children !== undefined && node.children.length > 0) {
        sink.add('BOOL_NESTED', ptr(info.path, 'children'),
          `node '${id}' is a cutter with children (${quoted(info.childIds)}): a cutter cannot have children`,
          [id, ...info.childIds])
      }
    }

    const cutters: { info: NodeInfo; node: RaaNode }[] = []
    const children = node.children ?? []
    for (let i = 0; i < children.length; i++) {
      const child = byPath.get(ptr(info.path, 'children', i))
      if (child?.node && isCutter(child)) cutters.push({ info: child, node: child.node })
    }
    if (cutters.length === 0) continue

    if (cutters.length > 1 && cutters.some((c) => c.info.op === 'intersect')) {
      const cutIds = ids(cutters.map((c) => c.info))
      sink.add('BOOL_INTERSECT_MIXED', ptr(info.path, 'children'),
        `node '${id}' has an intersect child and other cutters (${quoted(cutIds)}): ` +
        'a shape with an intersect child can have no other cutter', [id, ...cutIds])
    }

    const boxes = cutters.map((c) => boundsInParent(c.node))
    for (let a = 0; a < cutters.length; a++) {
      for (let b = a + 1; b < cutters.length; b++) {
        if (!aabbOverlap(boxes[a], boxes[b])) continue
        const idA = cutters[a].node.id
        const idB = cutters[b].node.id
        sink.add('BOOL_CUTTERS_OVERLAP', cutters[b].info.path,
          `nodes '${idA}' and '${idB}' both cut '${id}' and their bounds overlap: ` +
          'the cutters of one shape must not overlap', [idA, idB])
      }
    }
  }
}

/** Step 6: S2 total against budget.triangles; returns the total. */
export function checkBudget(asset: RaaPrimsAsset, sink: IssueSink): number {
  const { total, perNode } = assetTriangles(asset)
  const budget = asset.budget.triangles
  if (total > budget) {
    const top = Object.entries(perNode)
      .map(([id, count], order) => ({ id, count, order }))
      .sort((x, y) => y.count - x.count || x.order - y.order)
      .slice(0, 3)
    const named = top.map((entry) => `'${entry.id}' (${entry.count})`).join(', ')
    sink.add('BUDGET_EXCEEDED', '/budget/triangles',
      `The asset needs ${total} triangles, over its budget of ${budget}; ` +
      `the most expensive nodes are ${named}.`, top.map((entry) => entry.id))
  }
  return total
}
