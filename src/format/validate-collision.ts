import { COLLIDER_KEYS, COLLIDER_PARAM_ORDER, QUAT_UNIT_TOLERANCE } from './constants.ts'
import { deriveColliders } from './colliders.ts'
import type { ColliderShape, RaaCollider, RaaPrimsAsset } from './types.ts'
import { checkKeys, isRecord, ptr, readNumber, readVec, roundCanonical } from './validate-util.ts'
import type { IssueSink } from './validate-util.ts'

const STALE_TOLERANCE = 1e-6

/** Step 7: per-entry collider checks, then COLLISION_STALE in derived mode when `asset` is given. */
export function checkCollision(
  top: Record<string, unknown>,
  nodeIds: ReadonlySet<string>,
  asset: RaaPrimsAsset | null,
  sink: IssueSink,
): void {
  const collision = top.collision
  if (!isRecord(collision) || !Array.isArray(collision.colliders)) return
  const entries: unknown[] = collision.colliders
  const found: RaaCollider[] = []
  let wellFormed = true
  for (let i = 0; i < entries.length; i++) {
    const collider = checkCollider(entries[i], i, nodeIds, sink)
    if (collider === null) wellFormed = false
    else found.push(collider)
  }
  if (collision.mode !== 'derived' || !wellFormed || asset === null) return
  checkStale(deriveColliders(asset), found, sink)
}

function checkCollider(
  entry: unknown,
  index: number,
  nodeIds: ReadonlySet<string>,
  sink: IssueSink,
): RaaCollider | null {
  const path = ptr('/collision/colliders', index)
  if (!isRecord(entry)) {
    sink.add('BAD_TYPE', path, `Collider ${index} must be an object, got ${describe(entry)}.`)
    return null
  }
  const node = entry.node
  const nodes = typeof node === 'string' ? [node] : []
  const label = `Collider ${index} (node ${typeof node === 'string' ? `'${node}'` : describe(node)})`
  const before = sink.issues.length
  checkKeys(sink, entry, path, COLLIDER_KEYS, COLLIDER_KEYS, nodes)

  if (Object.hasOwn(entry, 'node') && node !== null && !(typeof node === 'string' && nodeIds.has(node))) {
    sink.add('BAD_COLLIDER', ptr(path, 'node'), `${label} must name null or an existing node id.`, nodes)
  }

  let params: Record<string, number | number[]> | null = null
  const shape = entry.shape
  if (Object.hasOwn(entry, 'shape')) {
    if (typeof shape !== 'string' || !Object.hasOwn(COLLIDER_PARAM_ORDER, shape)) {
      const shapes = Object.keys(COLLIDER_PARAM_ORDER).join(', ')
      sink.add('BAD_COLLIDER', ptr(path, 'shape'), `${label} has the unknown shape ${describe(shape)}: expected one of ${shapes}.`, nodes)
    } else if (Object.hasOwn(entry, 'params')) {
      params = checkParams(entry.params, shape as ColliderShape, ptr(path, 'params'), label, nodes, sink)
    }
  }

  let t: number[] | null = null
  if (Object.hasOwn(entry, 't')) t = readVec(sink, entry.t, 3, ptr(path, 't'), nodes, 'BAD_COLLIDER')
  let r: number[] | null = null
  if (Object.hasOwn(entry, 'r')) {
    r = readVec(sink, entry.r, 4, ptr(path, 'r'), nodes, 'BAD_COLLIDER')
    if (r !== null) {
      const norm = Math.hypot(r[0]!, r[1]!, r[2]!, r[3]!)
      if (!(Math.abs(norm - 1) <= QUAT_UNIT_TOLERANCE)) {
        sink.add('BAD_COLLIDER', ptr(path, 'r'), `${label} has a quaternion of norm ${norm}, which is not unit.`, nodes)
        r = null
      }
    }
  }

  if (sink.issues.length !== before || params === null || t === null || r === null) return null
  return { node, shape, params, t, r } as RaaCollider
}

function checkParams(
  value: unknown,
  shape: ColliderShape,
  path: string,
  label: string,
  nodes: readonly string[],
  sink: IssueSink,
): Record<string, number | number[]> | null {
  const expected = COLLIDER_PARAM_ORDER[shape]
  if (!isRecord(value)) {
    sink.add('BAD_COLLIDER', path, `${label} params must be an object, got ${describe(value)}.`, nodes)
    return null
  }
  const keys = Object.keys(value)
  if (keys.length !== expected.length || !expected.every((key) => Object.hasOwn(value, key))) {
    sink.add(
      'BAD_COLLIDER',
      path,
      `${label} params for a ${shape} must be exactly {${expected.join(', ')}}, got {${keys.join(', ')}}.`,
      nodes,
    )
    return null
  }
  const out: Record<string, number | number[]> = {}
  let clean = true
  for (const key of expected) {
    const keyPath = ptr(path, key)
    if (key === 'halfExtents') {
      const v = readVec(sink, value[key], 3, keyPath, nodes, 'BAD_COLLIDER')
      if (v === null) clean = false
      else if (v.some((x) => x < 0)) {
        sink.add('BAD_COLLIDER', keyPath, `${label} has a negative halfExtents component.`, nodes)
        clean = false
      } else out[key] = v
      continue
    }
    const v = readNumber(sink, value[key], keyPath, nodes, 'BAD_COLLIDER')
    if (v === null) {
      clean = false
    } else if (shape === 'ball' && key === 'radius' && v <= 0) {
      sink.add('BAD_COLLIDER', keyPath, `${label} has a ball radius of ${v}, which must be > 0.`, nodes)
      clean = false
    } else if (v < 0) {
      sink.add('BAD_COLLIDER', keyPath, `${label} has a ${key} of ${v}, which must be >= 0.`, nodes)
      clean = false
    } else {
      out[key] = v
    }
  }
  return clean ? out : null
}

function checkStale(expected: RaaCollider[], found: RaaCollider[], sink: IssueSink): void {
  const length = Math.max(expected.length, found.length)
  const differing = new Set<string>()
  let first = -1
  for (let i = 0; i < length; i++) {
    const a = expected[i]
    const b = found[i]
    if (a !== undefined && b !== undefined && sameCollider(a, b)) continue
    if (first < 0) first = i
    if (a?.node) differing.add(a.node)
    if (b?.node) differing.add(b.node)
  }
  if (first < 0) return
  const ids = [...differing]
  const named = ids.length > 0 ? ids.map((id) => `'${id}'`).join(', ') : 'none'
  sink.add(
    'COLLISION_STALE',
    '/collision/colliders',
    `In derived mode the colliders must equal deriveColliders(asset): expected ${expected.length} colliders, found ${found.length}; the first difference is at index ${first}; nodes whose colliders differ: ${named}.`,
    ids,
  )
}

function sameCollider(a: RaaCollider, b: RaaCollider): boolean {
  if (a.node !== b.node || a.shape !== b.shape) return false
  for (const key of COLLIDER_PARAM_ORDER[a.shape]) {
    const pa = (a.params as Record<string, number | number[]>)[key]!
    const pb = (b.params as Record<string, number | number[]>)[key]!
    if (!sameNumbers(typeof pa === 'number' ? [pa] : pa, typeof pb === 'number' ? [pb] : pb)) return false
  }
  if (!sameNumbers(a.t, b.t)) return false
  return sameNumbers(a.r, b.r) || sameNumbers(a.r, b.r.map((x) => -x))
}

function sameNumbers(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    // The small slack absorbs binary noise in the difference of two 6-decimal values.
    if (!(Math.abs(roundCanonical(a[i]!) - roundCanonical(b[i]!)) <= STALE_TOLERANCE + 1e-12)) return false
  }
  return true
}

function describe(v: unknown): string {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  if (Array.isArray(v)) return 'an array'
  if (typeof v === 'string') return `the string ${JSON.stringify(v)}`
  if (typeof v === 'number' || typeof v === 'boolean') return `${typeof v} ${String(v)}`
  if (typeof v === 'object') return 'an object'
  return typeof v
}
