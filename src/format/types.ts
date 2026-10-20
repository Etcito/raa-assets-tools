export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number] // x, y, z, w

export type PrimKind = 'sphere' | 'box' | 'roundBox' | 'capsule' | 'cylinder' | 'cone' | 'torus' | 'ellipsoid'
export type NodeOp = 'union' | 'subtract' | 'intersect'

export interface RaaTransform {
  t: Vec3
  r: Quat
  s: Vec3
}

export interface ParamsByKind {
  sphere: { radius: number }
  box: { size: Vec3 }
  roundBox: { size: Vec3; radius: number }
  capsule: { height: number; radius: number }
  cylinder: { height: number; radius: number }
  cone: { height: number; radiusBottom: number; radiusTop: number }
  torus: { majorRadius: number; minorRadius: number }
  ellipsoid: { radii: Vec3 }
}

export type RaaNode = {
  [K in PrimKind]: {
    id: string
    kind: K
    params: ParamsByKind[K]
    transform: RaaTransform
    material: string
    op: NodeOp
    children?: RaaNode[]
  }
}[PrimKind]

export interface RaaMaterial {
  color: Vec3
  roughness: number
  metallic: number
  emissive: Vec3
}

export interface RaaAnchor {
  t: Vec3
  r: Quat
}

export type ColliderShape = 'ball' | 'cuboid' | 'roundCuboid' | 'capsule' | 'cylinder' | 'cone'

export interface ColliderParamsByShape {
  ball: { radius: number }
  cuboid: { halfExtents: Vec3 }
  roundCuboid: { halfExtents: Vec3; borderRadius: number }
  capsule: { halfHeight: number; radius: number }
  cylinder: { halfHeight: number; radius: number }
  cone: { halfHeight: number; radius: number }
}

export type RaaCollider = {
  [S in ColliderShape]: {
    node: string | null
    shape: S
    params: ColliderParamsByShape[S]
    t: Vec3
    r: Quat
  }
}[ColliderShape]

export interface RaaCollision {
  mode: 'derived' | 'override'
  colliders: RaaCollider[]
}

export interface RaaBudget {
  triangles: number
  segments: number
}

export interface RaaPrimsAsset {
  format: 'raa.prims'
  version: 0
  id: string
  name: string
  budget: RaaBudget
  nodes: RaaNode[]
  materials: Record<string, RaaMaterial>
  anchors: Record<string, RaaAnchor>
  collision: RaaCollision
}

export type RefusalCode =
  | 'JSON_PARSE'
  | 'NOT_OBJECT'
  | 'BAD_FORMAT'
  | 'BAD_VERSION'
  | 'MISSING_FIELD'
  | 'UNKNOWN_FIELD'
  | 'BAD_TYPE'
  | 'BAD_ID'
  | 'DUPLICATE_ID'
  | 'BAD_NAME'
  | 'UNKNOWN_KIND'
  | 'BAD_PARAMS'
  | 'PARAM_RANGE'
  | 'NUMBER_NOT_FINITE'
  | 'NUMBER_RANGE'
  | 'BAD_TRANSFORM'
  | 'SCALE_NONUNIFORM_PARENT'
  | 'UNKNOWN_MATERIAL'
  | 'BAD_MATERIAL'
  | 'BAD_ANCHOR'
  | 'BAD_BUDGET'
  | 'CAP_NODES'
  | 'CAP_DEPTH'
  | 'CAP_MATERIALS'
  | 'CAP_ANCHORS'
  | 'CAP_COLLIDERS'
  | 'BOOL_NO_HOST'
  | 'BOOL_HOST_NOT_CONVEX'
  | 'BOOL_CUTTER_NOT_CONVEX'
  | 'BOOL_NESTED'
  | 'BOOL_INTERSECT_MIXED'
  | 'BOOL_CUTTERS_OVERLAP'
  | 'BUDGET_EXCEEDED'
  | 'COLLISION_STALE'
  | 'BAD_COLLIDER'

export interface RaaIssue {
  code: RefusalCode
  path: string // JSON pointer, '' = root
  message: string
  nodes: string[] // offending node ids, [] when none
}

export interface RaaValidation {
  ok: boolean
  issues: RaaIssue[]
  triangles: number | null
  asset: RaaPrimsAsset | null // normalised (budget defaults filled) when ok
}
