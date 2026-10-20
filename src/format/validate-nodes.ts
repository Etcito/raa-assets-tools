import {
  MAX_LENGTH,
  MIN_LENGTH,
  NODE_ID_RE,
  NODE_KEYS,
  PARAM_ORDER,
  PRIM_KINDS,
  QUAT_UNIT_TOLERANCE,
  TRANSFORM_KEYS,
} from './constants.ts'
import { isUniformScale } from './math.ts'
import type { PrimKind, RaaNode, Vec3 } from './types.ts'
import { checkKeys, isRecord, ptr, readNumber, readVec } from './validate-util.ts'
import type { IssueSink } from './validate-util.ts'

export interface NodeInfo {
  id: string | null
  path: string
  depth: number
  parentId: string | null
  childIds: string[]
  kind: string | null
  op: string | null
  ok: boolean
  node: RaaNode | null
}

const REQUIRED_NODE_KEYS = NODE_KEYS.filter((key) => key !== 'children')

// The JSON pre-pass has already rejected cycles and non-JSON objects. An explicit
// stack also lets malformed, very deep trees reach the later depth-cap check.
export function validateNodes(
  nodes: unknown,
  materialIds: ReadonlySet<string>,
  sink: IssueSink,
): NodeInfo[] {
  const infos: NodeInfo[] = []
  if (!Array.isArray(nodes)) {
    sink.add('BAD_TYPE', '/nodes', 'nodes must be an array')
    return infos
  }
  const seenIds = new Map<string, string>()
  const stack: { value: unknown; path: string; depth: number; parentId: string | null }[] = []
  for (let i = nodes.length - 1; i >= 0; i--) {
    stack.push({ value: nodes[i], path: ptr('/nodes', i), depth: 1, parentId: null })
  }
  while (stack.length > 0) {
    const { value, path, depth, parentId } = stack.pop()!
    if (!isRecord(value)) {
      sink.add('BAD_TYPE', path, 'node must be a plain object')
      continue
    }
    const id = typeof value.id === 'string' ? value.id : null
    const nodeIds = id === null ? [] : [id]
    // Shared helpers report field details; this adapter adds node context to
    // every message without changing their code precedence or issue order.
    const local: IssueSink = {
      issues: sink.issues,
      add(code, issuePath, message) {
        sink.add(code, issuePath, id === null ? message : `node '${id}': ${message}`, nodeIds)
      },
    }
    const start = sink.issues.length
    checkKeys(local, value, path, NODE_KEYS, REQUIRED_NODE_KEYS, nodeIds)
    const children = Array.isArray(value.children) ? value.children : []
    if (Object.hasOwn(value, 'children') && !Array.isArray(value.children)) {
      local.add('BAD_TYPE', ptr(path, 'children'), 'children must be an array')
    }

    if (Object.hasOwn(value, 'id')) {
      if (id === null || !NODE_ID_RE.test(id)) {
        local.add('BAD_ID', ptr(path, 'id'), 'id must match NODE_ID_RE')
      }
      if (id !== null) {
        const firstPath = seenIds.get(id)
        if (firstPath !== undefined) {
          local.add('DUPLICATE_ID', ptr(path, 'id'), `id occurs at both ${firstPath} and ${path}`)
        } else {
          seenIds.set(id, path)
        }
      }
    }
    const kind = typeof value.kind === 'string' ? value.kind : null
    if (Object.hasOwn(value, 'kind')) {
      if (kind === null || !PRIM_KINDS.includes(kind as PrimKind)) {
        local.add('UNKNOWN_KIND', ptr(path, 'kind'), 'kind must be a known primitive kind')
      } else if (Object.hasOwn(value, 'params')) {
        validateParams(value.params, kind as PrimKind, ptr(path, 'params'), nodeIds, local)
      }
    }
    if (Object.hasOwn(value, 'transform')) {
      validateTransform(value.transform, children.length > 0, ptr(path, 'transform'), nodeIds, local)
    }
    if (Object.hasOwn(value, 'material') &&
        (typeof value.material !== 'string' || !materialIds.has(value.material))) {
      local.add('UNKNOWN_MATERIAL', ptr(path, 'material'), 'material must name an existing material')
    }
    const op = typeof value.op === 'string' ? value.op : null
    if (Object.hasOwn(value, 'op') && op !== 'union' && op !== 'subtract' && op !== 'intersect') {
      local.add('BAD_TYPE', ptr(path, 'op'), 'op must be union, subtract or intersect')
    }
    const childIds = children.flatMap((child: unknown) =>
      isRecord(child) && typeof child.id === 'string' ? [child.id] : [])
    const ok = sink.issues.length === start
    infos.push({
      id, path, depth, parentId, childIds, kind, op, ok,
      node: ok ? value as RaaNode : null,
    })
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ value: children[i], path: ptr(path, 'children', i), depth: depth + 1, parentId: id })
    }
  }
  return infos
}

function validateParams(
  value: unknown,
  kind: PrimKind,
  path: string,
  nodes: readonly string[],
  sink: IssueSink,
): void {
  if (!isRecord(value)) {
    sink.add('BAD_PARAMS', path, 'params must be an object')
    return
  }
  const keys = PARAM_ORDER[kind]
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      sink.add('BAD_PARAMS', ptr(path, key), `params require '${key}'`)
    }
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      sink.add('BAD_PARAMS', ptr(path, key), `params do not allow '${key}'`)
    }
  }
  const scalar = (key: string, min = MIN_LENGTH, max = MAX_LENGTH): number | null => {
    if (!Object.hasOwn(value, key)) return null
    const n = readNumber(sink, value[key], ptr(path, key), nodes, 'BAD_PARAMS')
    if (n !== null && (n < min || n > max)) {
      sink.add('PARAM_RANGE', ptr(path, key), `${key} must be in [${min}, ${max}]`)
      return null
    }
    return n
  }
  const vector = (key: string): number[] | null => {
    if (!Object.hasOwn(value, key)) return null
    const v = readVec(sink, value[key], 3, ptr(path, key), nodes, 'BAD_PARAMS')
    if (v === null) return null
    let clean = true
    v.forEach((n, i) => {
      if (n < MIN_LENGTH || n > MAX_LENGTH) {
        sink.add('PARAM_RANGE', ptr(path, key, i), `${key} lengths must be in [${MIN_LENGTH}, ${MAX_LENGTH}]`)
        clean = false
      }
    })
    return clean ? v : null
  }
  switch (kind) {
    case 'sphere':
      scalar('radius')
      break
    case 'box':
      vector('size')
      break
    case 'roundBox': {
      const size = vector('size')
      scalar('radius', 0, size === null ? MAX_LENGTH : Math.min(...size) / 2)
      break
    }
    case 'capsule':
    case 'cylinder': {
      const height = scalar('height')
      const radius = scalar('radius')
      if (kind === 'capsule' && height !== null && radius !== null && height < 2 * radius) {
        sink.add('PARAM_RANGE', ptr(path, 'height'), 'capsule height must be at least twice its radius')
      }
      break
    }
    case 'cone': {
      scalar('height')
      const bottom = scalar('radiusBottom', 0)
      const top = scalar('radiusTop', 0)
      if (bottom !== null && top !== null && Math.max(bottom, top) < MIN_LENGTH) {
        sink.add('PARAM_RANGE', path, `at least one cone radius must be at least ${MIN_LENGTH}`)
      }
      break
    }
    case 'torus': {
      const major = scalar('majorRadius')
      const minor = scalar('minorRadius')
      if (major !== null && minor !== null && minor >= major) {
        sink.add('PARAM_RANGE', ptr(path, 'minorRadius'), 'minorRadius must be less than majorRadius')
      }
      break
    }
    case 'ellipsoid':
      vector('radii')
      break
  }
}

function validateTransform(
  value: unknown,
  hasChildren: boolean,
  path: string,
  nodes: readonly string[],
  sink: IssueSink,
): void {
  if (!isRecord(value)) {
    sink.add('BAD_TRANSFORM', path, 'transform must be an object')
    return
  }
  checkKeys(sink, value, path, TRANSFORM_KEYS, TRANSFORM_KEYS, nodes)
  if (Object.hasOwn(value, 't')) {
    readVec(sink, value.t, 3, ptr(path, 't'), nodes, 'BAD_TRANSFORM')
  }
  if (Object.hasOwn(value, 'r')) {
    const r = readVec(sink, value.r, 4, ptr(path, 'r'), nodes, 'BAD_TRANSFORM')
    if (r !== null && Math.abs(Math.hypot(...r) - 1) > QUAT_UNIT_TOLERANCE) {
      sink.add('BAD_TRANSFORM', ptr(path, 'r'), 'rotation quaternion must be unit length')
    }
  }
  if (Object.hasOwn(value, 's')) {
    const s = readVec(sink, value.s, 3, ptr(path, 's'), nodes, 'BAD_TRANSFORM')
    if (s !== null) {
      s.forEach((n, i) => {
        if (n <= 0) sink.add('BAD_TRANSFORM', ptr(path, 's', i), 'scale must be positive')
      })
      if (hasChildren && s.every((n) => n > 0) && !isUniformScale(s as Vec3)) {
        sink.add('SCALE_NONUNIFORM_PARENT', ptr(path, 's'), 'a node with children must have uniform scale')
      }
    }
  }
}
