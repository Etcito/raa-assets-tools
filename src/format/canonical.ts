import { deriveColliders } from './colliders.ts'
import {
  ANCHOR_KEYS,
  BUDGET_KEYS,
  COLLIDER_KEYS,
  COLLIDER_PARAM_ORDER,
  COLLISION_KEYS,
  DEFAULT_SEGMENTS,
  DEFAULT_TRIANGLE_BUDGET,
  MATERIAL_KEYS,
  MAX_ABS_NUMBER,
  NODE_KEYS,
  NUMBER_DECIMALS,
  PARAM_ORDER,
  TOP_KEYS,
  TRANSFORM_KEYS,
} from './constants.ts'
import { RaaError } from './errors.ts'
import { quatCanonical } from './math.ts'
import type { Quat, RaaIssue, RaaNode, RaaPrimsAsset } from './types.ts'
import { validateRaaPrims } from './validate.ts'

// S4 number rule. toFixed rounds the exact decimal value of the double (ties
// toward the larger magnitude) and never uses an exponent below 1e21.
export function formatNumber(x: number): string {
  if (!Number.isFinite(x) || Math.abs(x) > MAX_ABS_NUMBER) {
    throw new RaaError(
      'NUMBER_NOT_WRITABLE',
      `cannot write the number ${x}: it must be finite with abs value <= ${MAX_ABS_NUMBER}`,
      `use a finite number between -${MAX_ABS_NUMBER} and ${MAX_ABS_NUMBER}`,
    )
  }
  let s = x.toFixed(NUMBER_DECIMALS)
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s === '-0' ? '0' : s
}

// Keys of the object at path (string keys and array indices from the root),
// in writing order, or 'sorted' for UTF-16 code-unit order.
export type KeyOrder = (path: readonly string[]) => readonly string[] | 'sorted'

// S4 style: 2-space indent, one member per line, inline all-number arrays,
// exactly one trailing newline.
export function writeCanonicalJson(value: unknown, order: KeyOrder): string {
  return writeValue(value, order, [], '') + '\n'
}

function writeValue(value: unknown, order: KeyOrder, path: string[], indent: string): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return writeArray(value, order, path, indent)
  if (typeof value === 'object') return writeObject(value as Record<string, unknown>, order, path, indent)
  throw new RaaError(
    'VALUE_NOT_WRITABLE',
    `cannot write a value of type ${typeof value} at /${path.join('/')}`,
    'pass only objects, arrays, strings, finite numbers, booleans and null',
  )
}

function writeArray(items: readonly unknown[], order: KeyOrder, path: string[], indent: string): string {
  if (items.length === 0) return '[]'
  if (items.every((v) => typeof v === 'number')) {
    return '[' + items.map((v) => formatNumber(v as number)).join(', ') + ']'
  }
  const inner = indent + '  '
  const lines = items.map((v, i) => inner + writeValue(v, order, [...path, String(i)], inner))
  return '[\n' + lines.join(',\n') + '\n' + indent + ']'
}

function writeObject(obj: Record<string, unknown>, order: KeyOrder, path: string[], indent: string): string {
  const wanted = order(path)
  const keys = wanted === 'sorted' ? Object.keys(obj).sort() : wanted
  const inner = indent + '  '
  const lines: string[] = []
  for (const key of keys) {
    if (!Object.hasOwn(obj, key) || obj[key] === undefined) continue
    lines.push(inner + JSON.stringify(key) + ': ' + writeValue(obj[key], order, [...path, key], inner))
  }
  if (lines.length === 0) return '{}'
  return '{\n' + lines.join(',\n') + '\n' + indent + '}'
}

// Every number quantised to its written value; non-writable numbers are kept
// as they are so that validation reports them (NUMBER_NOT_FINITE / NUMBER_RANGE).
function quantise(x: number): number {
  return Number.isFinite(x) && Math.abs(x) <= MAX_ABS_NUMBER ? Number(formatNumber(x)) : x
}

// Deep copy of a JSON-like value with every number quantised.
function copyQuantised(value: unknown): unknown {
  if (typeof value === 'number') return quantise(value)
  if (Array.isArray(value)) return value.map(copyQuantised)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value)) out[key] = copyQuantised(v)
    return out
  }
  return value
}

// quatCanonical then quantise, repeated until stable so that normalising the
// written quaternion again gives the same digits. Anything that is not four
// finite numbers with a non-zero norm is left for validation to refuse.
function canonicalQuat(q: unknown): unknown {
  if (!Array.isArray(q) || q.length !== 4 || !q.every((x) => typeof x === 'number' && Number.isFinite(x))) return q
  let cur = q as Quat
  if (Math.hypot(...cur) === 0) return q
  for (let i = 0; i < 4; i++) {
    const next = quatCanonical(cur).map(quantise) as Quat
    if (next.every((x, k) => x === cur[k])) break
    cur = next
  }
  return cur
}

function canonicalNodes(nodes: unknown): void {
  if (!Array.isArray(nodes)) return
  for (const node of nodes) {
    if (!isObject(node)) continue
    if (isObject(node.transform)) node.transform.r = canonicalQuat(node.transform.r)
    if (Array.isArray(node.children) && node.children.length === 0) delete node.children
    else canonicalNodes(node.children)
  }
}

function canonicalColliders(colliders: unknown): void {
  if (!Array.isArray(colliders)) return
  for (const collider of colliders) if (isObject(collider)) collider.r = canonicalQuat(collider.r)
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

// Deep copy; budget defaults; quaternions canonical (w >= 0); every number
// quantised; derived colliders recomputed from the quantised nodes; empty
// children omitted. Quantising before deriving makes derive(parse(written))
// equal the written colliders (S4).
export function normalizeRaaPrims(asset: RaaPrimsAsset): RaaPrimsAsset {
  const out = copyQuantised(asset) as Record<string, unknown>
  if (out.budget === undefined) out.budget = { triangles: DEFAULT_TRIANGLE_BUDGET, segments: DEFAULT_SEGMENTS }
  canonicalNodes(out.nodes)
  if (isObject(out.anchors)) {
    for (const anchor of Object.values(out.anchors)) if (isObject(anchor)) anchor.r = canonicalQuat(anchor.r)
  }
  const collision = out.collision
  if (isObject(collision)) {
    if (collision.mode === 'derived') {
      collision.colliders = copyQuantised(deriveColliders(out as unknown as RaaPrimsAsset))
    }
    canonicalColliders(collision.colliders)
  }
  return out as unknown as RaaPrimsAsset
}

// The only producer of raa.prims bytes: normalise, refuse unless valid, write
// with the S1 key orders and sorted materials and anchors.
export function serializeRaaPrims(asset: RaaPrimsAsset): string {
  let normalised: RaaPrimsAsset
  try {
    normalised = normalizeRaaPrims(asset)
  } catch (error) {
    // A structurally broken input can make normalisation fail; report why.
    const raw = validateRaaPrims(asset)
    if (!raw.ok) throw invalid(raw.issues)
    throw error
  }
  const result = validateRaaPrims(normalised)
  if (!result.ok) throw invalid(result.issues)
  return writeCanonicalJson(normalised, assetKeyOrder(normalised))
}

function invalid(issues: readonly RaaIssue[]): RaaError {
  const first = issues[0]
  const detail = first ? `${first.code} ${first.path}: ${first.message}` : 'unknown'
  return new RaaError(
    'ASSET_INVALID',
    `${issues.length} issues; first: ${detail}`,
    'fix the listed issues; run raa-assets validate',
  )
}

function assetKeyOrder(asset: RaaPrimsAsset): KeyOrder {
  return (path) => {
    const [head, ...rest] = path
    if (head === undefined) return TOP_KEYS
    switch (head) {
      case 'budget':
        return BUDGET_KEYS
      case 'materials':
        return rest.length === 0 ? 'sorted' : MATERIAL_KEYS
      case 'anchors':
        return rest.length === 0 ? 'sorted' : ANCHOR_KEYS
      case 'collision': {
        if (rest.length === 0) return COLLISION_KEYS
        const collider = asset.collision.colliders[Number(rest[1])]
        if (collider === undefined) return []
        return rest.length === 2 ? COLLIDER_KEYS : COLLIDER_PARAM_ORDER[collider.shape]
      }
      case 'nodes':
        return nodeKeyOrder(asset.nodes, rest)
    }
    return []
  }
}

// rest = [index, ('children', index)*, ('params' | 'transform')?]
function nodeKeyOrder(nodes: RaaNode[], rest: readonly string[]): readonly string[] {
  let list: RaaNode[] | undefined = nodes
  let node: RaaNode | undefined
  let i = 0
  while (i < rest.length) {
    node = list?.[Number(rest[i])]
    if (node === undefined) return []
    i++
    if (rest[i] !== 'children') break
    list = node.children
    i++
  }
  if (node === undefined) return []
  if (i === rest.length) return NODE_KEYS
  if (rest[i] === 'params') return PARAM_ORDER[node.kind]
  if (rest[i] === 'transform') return TRANSFORM_KEYS
  return []
}
