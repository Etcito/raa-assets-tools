import type { RaaBudget } from './types.ts'
import {
  ANCHOR_KEYS,
  ANCHOR_NAME_RE,
  ASSET_ID_RE,
  BUDGET_KEYS,
  COLLISION_KEYS,
  DEFAULT_SEGMENTS,
  DEFAULT_TRIANGLE_BUDGET,
  FORMAT,
  FORMAT_VERSION,
  MATERIAL_ID_RE,
  MATERIAL_KEYS,
  MAX_SEGMENTS,
  MAX_TRIANGLE_BUDGET,
  MIN_SEGMENTS,
  NAME_MAX,
  QUAT_UNIT_TOLERANCE,
  TOP_KEYS,
} from './constants.ts'
import type { IssueSink } from './validate-util.ts'
import { checkKeys, isRecord, ptr, readNumber, readVec } from './validate-util.ts'

export interface TopParts {
  top: Record<string, unknown>
  materialIds: ReadonlySet<string>
}

const TOP_REQUIRED = TOP_KEYS.filter((key) => key !== 'budget')
const NO_NODES: readonly string[] = []

/** Step 1: top-level structure. Returns null only when the value is not an object. */
export function validateTopLevel(value: unknown, sink: IssueSink): TopParts | null {
  if (!isRecord(value)) {
    sink.add('NOT_OBJECT', '', `The top-level value is ${describe(value)}, not a JSON object.`)
    return null
  }
  const top = value
  checkKeys(sink, top, '', TOP_KEYS, TOP_REQUIRED, NO_NODES)

  if (Object.hasOwn(top, 'format') && top.format !== FORMAT) {
    sink.add('BAD_FORMAT', '/format', `The format field must be the string '${FORMAT}'.`)
  }
  if (Object.hasOwn(top, 'version')) {
    const version = readNumber(sink, top.version, '/version', NO_NODES, 'BAD_VERSION')
    if (version !== null && version !== FORMAT_VERSION) {
      sink.add('BAD_VERSION', '/version', `The version field must be the integer ${FORMAT_VERSION}, got ${version}.`)
    }
  }
  if (Object.hasOwn(top, 'id')) {
    if (typeof top.id !== 'string') {
      sink.add('BAD_TYPE', '/id', `The asset id must be a string, got ${describe(top.id)}.`)
    } else if (!ASSET_ID_RE.test(top.id)) {
      sink.add('BAD_ID', '/id', `The asset id '${top.id}' does not match ${ASSET_ID_RE.source}.`)
    }
  }
  if (Object.hasOwn(top, 'name')) {
    if (typeof top.name !== 'string') {
      sink.add('BAD_TYPE', '/name', `The asset name must be a string, got ${describe(top.name)}.`)
    } else if (top.name.length < 1 || top.name.length > NAME_MAX) {
      sink.add('BAD_NAME', '/name', `The asset name must have 1 to ${NAME_MAX} characters, got ${top.name.length}.`)
    }
  }
  if (Object.hasOwn(top, 'budget') && !isRecord(top.budget)) {
    sink.add('BAD_TYPE', '/budget', `The budget field must be an object, got ${describe(top.budget)}.`)
  }
  if (Object.hasOwn(top, 'nodes') && !Array.isArray(top.nodes)) {
    sink.add('BAD_TYPE', '/nodes', `The nodes field must be an array, got ${describe(top.nodes)}.`)
  }
  for (const key of ['materials', 'anchors'] as const) {
    if (Object.hasOwn(top, key) && !isRecord(top[key])) {
      sink.add('BAD_TYPE', ptr('', key), `The ${key} field must be an object, got ${describe(top[key])}.`)
    }
  }
  if (Object.hasOwn(top, 'collision')) checkCollisionShape(top.collision, sink)

  const materialIds = new Set<string>(isRecord(top.materials) ? Object.keys(top.materials) : [])
  return { top, materialIds }
}

function checkCollisionShape(collision: unknown, sink: IssueSink): void {
  if (!isRecord(collision)) {
    sink.add('BAD_TYPE', '/collision', `The collision field must be an object, got ${describe(collision)}.`)
    return
  }
  checkKeys(sink, collision, '/collision', COLLISION_KEYS, COLLISION_KEYS, NO_NODES)
  if (Object.hasOwn(collision, 'mode') && collision.mode !== 'derived' && collision.mode !== 'override') {
    sink.add(
      'BAD_TYPE',
      '/collision/mode',
      `The collision mode must be 'derived' or 'override', got ${describe(collision.mode)}.`,
    )
  }
  if (Object.hasOwn(collision, 'colliders') && !Array.isArray(collision.colliders)) {
    sink.add(
      'BAD_TYPE',
      '/collision/colliders',
      `The collision colliders field must be an array, got ${describe(collision.colliders)}.`,
    )
  }
}

/** Step 3: material ids, keys and S1 value ranges. */
export function validateMaterials(top: Record<string, unknown>, sink: IssueSink): void {
  const materials = top.materials
  if (!isRecord(materials)) return
  for (const id of Object.keys(materials)) {
    const path = ptr('/materials', id)
    if (!MATERIAL_ID_RE.test(id)) {
      sink.add('BAD_ID', path, `The material id '${id}' does not match ${MATERIAL_ID_RE.source}.`)
    }
    const material = materials[id]
    if (!isRecord(material)) {
      sink.add('BAD_MATERIAL', path, `The material '${id}' must be an object, got ${describe(material)}.`)
      continue
    }
    checkKeys(sink, material, path, MATERIAL_KEYS, MATERIAL_KEYS, NO_NODES)
    if (Object.hasOwn(material, 'color')) checkChannels(sink, material.color, ptr(path, 'color'), id, 'color', 1)
    for (const key of ['roughness', 'metallic'] as const) {
      if (!Object.hasOwn(material, key)) continue
      const keyPath = ptr(path, key)
      const v = readNumber(sink, material[key], keyPath, NO_NODES, 'BAD_MATERIAL')
      if (v !== null && (v < 0 || v > 1)) {
        sink.add('BAD_MATERIAL', keyPath, `The material '${id}' has ${key} ${v}, outside [0, 1].`)
      }
    }
    if (Object.hasOwn(material, 'emissive')) {
      checkChannels(sink, material.emissive, ptr(path, 'emissive'), id, 'emissive', 100)
    }
  }
}

function checkChannels(sink: IssueSink, v: unknown, path: string, id: string, key: string, max: number): void {
  const rgb = readVec(sink, v, 3, path, NO_NODES, 'BAD_MATERIAL')
  if (rgb === null) return
  rgb.forEach((c, i) => {
    if (c < 0 || c > max) {
      sink.add('BAD_MATERIAL', ptr(path, i), `The material '${id}' has ${key} channel ${i} = ${c}, outside [0, ${max}].`)
    }
  })
}

/** Step 3: anchor names, keys, t and unit r. */
export function validateAnchors(top: Record<string, unknown>, sink: IssueSink): void {
  const anchors = top.anchors
  if (!isRecord(anchors)) return
  for (const name of Object.keys(anchors)) {
    const path = ptr('/anchors', name)
    if (!ANCHOR_NAME_RE.test(name)) {
      sink.add('BAD_ANCHOR', path, `The anchor name '${name}' does not match ${ANCHOR_NAME_RE.source}.`)
    }
    const anchor = anchors[name]
    if (!isRecord(anchor)) {
      sink.add('BAD_ANCHOR', path, `The anchor '${name}' must be an object, got ${describe(anchor)}.`)
      continue
    }
    checkKeys(sink, anchor, path, ANCHOR_KEYS, ANCHOR_KEYS, NO_NODES)
    if (Object.hasOwn(anchor, 't')) readVec(sink, anchor.t, 3, ptr(path, 't'), NO_NODES, 'BAD_ANCHOR')
    if (Object.hasOwn(anchor, 'r')) {
      const r = readVec(sink, anchor.r, 4, ptr(path, 'r'), NO_NODES, 'BAD_ANCHOR')
      if (r !== null) {
        const norm = Math.hypot(r[0]!, r[1]!, r[2]!, r[3]!)
        if (!(Math.abs(norm - 1) <= QUAT_UNIT_TOLERANCE)) {
          sink.add('BAD_ANCHOR', ptr(path, 'r'), `The anchor '${name}' has a quaternion of norm ${norm}, which is not unit.`)
        }
      }
    }
  }
}

/** Step 3: budget keys and ranges; returns the budget with defaults filled, or null when invalid. */
export function validateBudget(top: Record<string, unknown>, sink: IssueSink): RaaBudget | null {
  if (!Object.hasOwn(top, 'budget')) {
    return { triangles: DEFAULT_TRIANGLE_BUDGET, segments: DEFAULT_SEGMENTS }
  }
  const budget = top.budget
  // A non-object budget is reported as BAD_TYPE by step 1.
  if (!isRecord(budget)) return null
  const clean = checkKeys(sink, budget, '/budget', BUDGET_KEYS, BUDGET_KEYS, NO_NODES)
  let triangles: number | null = null
  let segments: number | null = null
  if (Object.hasOwn(budget, 'triangles')) {
    triangles = readNumber(sink, budget.triangles, '/budget/triangles', NO_NODES, 'BAD_BUDGET')
    if (triangles !== null && !(Number.isInteger(triangles) && triangles >= 1 && triangles <= MAX_TRIANGLE_BUDGET)) {
      sink.add(
        'BAD_BUDGET',
        '/budget/triangles',
        `The budget triangles must be an integer in 1..${MAX_TRIANGLE_BUDGET}, got ${triangles}.`,
      )
      triangles = null
    }
  }
  if (Object.hasOwn(budget, 'segments')) {
    segments = readNumber(sink, budget.segments, '/budget/segments', NO_NODES, 'BAD_BUDGET')
    if (
      segments !== null &&
      !(Number.isInteger(segments) && segments >= MIN_SEGMENTS && segments <= MAX_SEGMENTS && segments % 4 === 0)
    ) {
      sink.add(
        'BAD_BUDGET',
        '/budget/segments',
        `The budget segments must be an integer in ${MIN_SEGMENTS}..${MAX_SEGMENTS} and a multiple of 4, got ${segments}.`,
      )
      segments = null
    }
  }
  if (!clean || triangles === null || segments === null) return null
  return { triangles, segments }
}

function describe(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return 'an array'
  if (typeof v === 'string') return `the string ${JSON.stringify(v)}`
  if (typeof v === 'number' || typeof v === 'boolean') return `${typeof v} ${String(v)}`
  if (typeof v === 'object') return 'an object'
  return typeof v
}
