import type { ColliderShape, PrimKind, RefusalCode } from './types.ts'

export const FORMAT = 'raa.prims'
export const FORMAT_VERSION = 0

export const PRIM_KINDS: readonly PrimKind[] = [
  'sphere',
  'box',
  'roundBox',
  'capsule',
  'cylinder',
  'cone',
  'torus',
  'ellipsoid',
]

export const CONVEX_KINDS: readonly PrimKind[] = [
  'sphere',
  'box',
  'roundBox',
  'capsule',
  'cylinder',
  'cone',
  'ellipsoid',
]

export const PARAM_ORDER: Readonly<Record<PrimKind, readonly string[]>> = {
  sphere: ['radius'],
  box: ['size'],
  roundBox: ['size', 'radius'],
  capsule: ['height', 'radius'],
  cylinder: ['height', 'radius'],
  cone: ['height', 'radiusBottom', 'radiusTop'],
  torus: ['majorRadius', 'minorRadius'],
  ellipsoid: ['radii'],
}

export const COLLIDER_PARAM_ORDER: Readonly<Record<ColliderShape, readonly string[]>> = {
  ball: ['radius'],
  cuboid: ['halfExtents'],
  roundCuboid: ['halfExtents', 'borderRadius'],
  capsule: ['halfHeight', 'radius'],
  cylinder: ['halfHeight', 'radius'],
  cone: ['halfHeight', 'radius'],
}

export const TOP_KEYS: readonly string[] = [
  'format',
  'version',
  'id',
  'name',
  'budget',
  'nodes',
  'materials',
  'anchors',
  'collision',
]

export const NODE_KEYS: readonly string[] = [
  'id',
  'kind',
  'params',
  'transform',
  'material',
  'op',
  'children',
]

export const TRANSFORM_KEYS: readonly string[] = ['t', 'r', 's']

export const MATERIAL_KEYS: readonly string[] = ['color', 'roughness', 'metallic', 'emissive']

export const ANCHOR_KEYS: readonly string[] = ['t', 'r']

export const BUDGET_KEYS: readonly string[] = ['triangles', 'segments']

export const COLLISION_KEYS: readonly string[] = ['mode', 'colliders']

export const COLLIDER_KEYS: readonly string[] = ['node', 'shape', 'params', 't', 'r']

export const MAX_NODES = 64
export const MAX_DEPTH = 8
export const MAX_MATERIALS = 32
export const MAX_ANCHORS = 32
export const MAX_COLLIDERS = 256

export const DEFAULT_TRIANGLE_BUDGET = 1500
export const MAX_TRIANGLE_BUDGET = 100000
export const DEFAULT_SEGMENTS = 16
export const MIN_SEGMENTS = 4
export const MAX_SEGMENTS = 128

export const NUMBER_DECIMALS = 6
export const MAX_ABS_NUMBER = 1e6
export const MIN_LENGTH = 0.001
export const MAX_LENGTH = 1000

export const QUAT_UNIT_TOLERANCE = 1e-6
export const UNIFORM_SCALE_TOLERANCE = 1e-9
export const OVERLAP_EPSILON = 1e-9

export const NODE_ID_RE = /^[a-z][a-z0-9_]{0,47}$/
export const ASSET_ID_RE = /^[a-z][a-z0-9_.-]{0,63}$/
export const MATERIAL_ID_RE = /^[a-z][a-z0-9_]{0,47}$/
export const ANCHOR_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/
export const NAME_MAX = 128

export const REFUSAL_CODES: readonly RefusalCode[] = [
  'JSON_PARSE',
  'NOT_OBJECT',
  'BAD_FORMAT',
  'BAD_VERSION',
  'MISSING_FIELD',
  'UNKNOWN_FIELD',
  'BAD_TYPE',
  'BAD_ID',
  'DUPLICATE_ID',
  'BAD_NAME',
  'UNKNOWN_KIND',
  'BAD_PARAMS',
  'PARAM_RANGE',
  'NUMBER_NOT_FINITE',
  'NUMBER_RANGE',
  'BAD_TRANSFORM',
  'SCALE_NONUNIFORM_PARENT',
  'UNKNOWN_MATERIAL',
  'BAD_MATERIAL',
  'BAD_ANCHOR',
  'BAD_BUDGET',
  'CAP_NODES',
  'CAP_DEPTH',
  'CAP_MATERIALS',
  'CAP_ANCHORS',
  'CAP_COLLIDERS',
  'BOOL_NO_HOST',
  'BOOL_HOST_NOT_CONVEX',
  'BOOL_CUTTER_NOT_CONVEX',
  'BOOL_NESTED',
  'BOOL_INTERSECT_MIXED',
  'BOOL_CUTTERS_OVERLAP',
  'BUDGET_EXCEEDED',
  'COLLISION_STALE',
  'BAD_COLLIDER',
]

export const REFUSAL_SUMMARY: Readonly<Record<RefusalCode, string>> = {
  JSON_PARSE: 'The file is not valid JSON, so nothing can be read from it.',
  NOT_OBJECT: 'The top-level JSON value is not an object, so the file cannot be a raa.prims asset.',
  BAD_FORMAT: 'The format field is not the string "raa.prims".',
  BAD_VERSION: 'The version field is not the integer 0.',
  MISSING_FIELD: 'A required field is absent.',
  UNKNOWN_FIELD: 'An unknown key appears; every key must belong to the format.',
  BAD_TYPE: 'A value has the wrong JSON type.',
  BAD_ID: 'An identifier does not match its required pattern.',
  DUPLICATE_ID: 'The same node id is used more than once; node ids must be unique in the asset.',
  BAD_NAME: 'The asset name is empty or longer than 128 characters.',
  UNKNOWN_KIND: 'A node kind is not one of the eight primitive kinds.',
  BAD_PARAMS: 'A params object has missing keys, unknown keys or wrong value types for its kind.',
  PARAM_RANGE: 'A parameter is outside the range its kind allows.',
  NUMBER_NOT_FINITE: 'A number is NaN or Infinity, so the asset would not describe a finite shape.',
  NUMBER_RANGE: 'A number has an absolute value greater than 1e6.',
  BAD_TRANSFORM: 'A transform has a non-unit quaternion or a scale component that is not positive.',
  SCALE_NONUNIFORM_PARENT:
    'A node with children has a non-uniform scale, which its children cannot inherit exactly.',
  UNKNOWN_MATERIAL: 'A node references a material id that the materials map does not contain.',
  BAD_MATERIAL: 'A material entry is malformed or a colour channel is out of range.',
  BAD_ANCHOR: 'An anchor is malformed or its quaternion is not unit.',
  BAD_BUDGET:
    'The budget is malformed: triangles or segments is out of range, not an integer, or not a multiple of 4.',
  CAP_NODES: 'The asset contains more than 64 nodes.',
  CAP_DEPTH: 'The node tree is deeper than 8 levels.',
  CAP_MATERIALS: 'The asset contains more than 32 materials.',
  CAP_ANCHORS: 'The asset contains more than 32 anchors.',
  CAP_COLLIDERS: 'The asset contains more than 256 colliders.',
  BOOL_NO_HOST: 'A root node uses subtract or intersect, but a root node has no parent volume to cut.',
  BOOL_HOST_NOT_CONVEX:
    'A subtract or intersect child cuts a non-convex parent; only convex primitives can host a cut.',
  BOOL_CUTTER_NOT_CONVEX: 'A subtract or intersect child is a torus; only convex primitives can cut.',
  BOOL_NESTED: 'A subtract or intersect cutter has children, but a cutter must be a leaf.',
  BOOL_INTERSECT_MIXED:
    'A parent with an intersect child also has a subtract child; intersect cannot be mixed with other cutters.',
  BOOL_CUTTERS_OVERLAP: 'Two cutters of the same parent overlap; cutters of one parent must be disjoint.',
  BUDGET_EXCEEDED: 'The generated triangle total exceeds budget.triangles.',
  COLLISION_STALE: 'In derived mode the colliders do not match deriveColliders(asset).',
  BAD_COLLIDER:
    'A collider is malformed: unknown shape, bad params, bad transform or a node id that does not exist.',
}
