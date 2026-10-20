# raa.prims v0 for implementers

This page is for engineers who write their own `raa.prims` parser, mesher or
collider builder, for example in RAA or Royal Fiesta. It restates the format
rules S1 to S5 in one place. The reference implementation in this package
(`parseRaaPrims`, `serializeRaaPrims`, `deriveColliders`) follows exactly this
text, and the conformance fixtures let you check that your parser agrees with it.

Values named in UPPER_SNAKE come from `src/format/constants.ts`.

## S1. The file

A `raa.prims` v0 file is UTF-8 JSON. Units are metres, +Y is up and the frame is
right-handed. Colours are linear RGB in [0, 1]. Quaternions are written
`[x, y, z, w]`.

### Top-level keys

The keys appear in this canonical order (`TOP_KEYS`):

| key | type | rule |
|---|---|---|
| format | string | exactly `raa.prims` |
| version | integer | exactly 0 |
| id | string | matches `ASSET_ID_RE` = `^[a-z][a-z0-9_.-]{0,63}$` |
| name | string | 1 to 128 characters |
| budget | object | `{triangles, segments}`, see below; optional on input |
| nodes | array | the root nodes; 1 to 64 nodes in total over the whole tree |
| materials | object | material id -> material; 1 to 32 entries |
| anchors | object | anchor name -> anchor; 0 to 32 entries |
| collision | object | `{mode, colliders}`; 0 to 256 colliders |

`budget.triangles` is an integer in 1..100000 (default 1500). `budget.segments`
is an integer in 4..128 that is a multiple of 4 (default 16). When `budget` is
absent the defaults apply; the canonical writer always writes it.

An unknown key anywhere in the file is refused with UNKNOWN_FIELD.

### Nodes

A node has these keys, in order (`NODE_KEYS`):

| key | rule |
|---|---|
| id | matches `NODE_ID_RE` = `^[a-z][a-z0-9_]{0,47}$`, unique in the asset |
| kind | one of the eight kinds below |
| params | the params of that kind |
| transform | `{t, r, s}`: translation Vec3, rotation quaternion, scale Vec3 |
| material | a key of `materials` |
| op | `union`, `subtract` or `intersect` |
| children | optional array of nodes; written only when non-empty |

Transforms:

- The local matrix is M = T(t) · R(r) · S(s). Children live in the frame of
  their node, including its scale.
- Every component of s must be > 0, and r must be a unit quaternion:
  abs(norm - 1) <= 1e-6 (`QUAT_UNIT_TOLERANCE`).
- A node that has children must have a uniform scale:
  max abs(si - sj) <= 1e-9 · max abs(s) (`UNIFORM_SCALE_TOLERANCE`). Otherwise
  the node is refused with SCALE_NONUNIFORM_PARENT.
- Every primitive is centred on its origin. Capsule, cylinder, cone and torus
  have their axis along Y.

### Kinds and params

The kinds are listed in `PRIM_KINDS` in this order. Params keys follow this
order (`PARAM_ORDER`) and every key is required. Lengths lie in [0.001, 1000]
(`MIN_LENGTH`, `MAX_LENGTH`) unless the table says otherwise.

| kind | params |
|---|---|
| sphere | `radius` |
| box | `size` [x, y, z], the full size |
| roundBox | `size` [x, y, z], `radius` in [0, min(size)/2] |
| capsule | `height` (total, caps included, >= 2 · radius), `radius` |
| cylinder | `height`, `radius` |
| cone | `height`, `radiusBottom`, `radiusTop`; each radius in [0, 1000] and the larger one >= 0.001; the bottom is at y = -height/2 |
| torus | `majorRadius`, `minorRadius`, with minorRadius < majorRadius; the ring lies in the XZ plane |
| ellipsoid | `radii` [x, y, z] |

`CONVEX_KINDS` is every kind except torus.

### Booleans

- Root nodes and `union` children are separate closed meshes generated in
  place. Nothing is cut.
- A `subtract` child removes its volume from the mesh of its parent primitive
  only. An `intersect` child keeps parent ∩ child. RAA does this by exact face
  cutting of the parent mesh by the convex child.

A cut is accepted only when all of these hold:

| condition | refusal otherwise |
|---|---|
| the cutting node is not a root (a root has no host) | BOOL_NO_HOST |
| the parent kind is convex | BOOL_HOST_NOT_CONVEX |
| the cutter kind is convex | BOOL_CUTTER_NOT_CONVEX |
| the cutter has no children | BOOL_NESTED |
| a parent with an intersect child has no other cutter | BOOL_INTERSECT_MIXED |
| the cutters of one parent do not overlap pairwise | BOOL_CUTTERS_OVERLAP |

The overlap test uses the axis-aligned bounds of each cutter in the parent frame
(`boundsInParent`). Two cutters A and B overlap when, on all three axes,
minA < maxB - 1e-9 and minB < maxA - 1e-9 (`OVERLAP_EPSILON`). Touching
cutters therefore do not overlap.

### Materials

A material has these keys, in order (`MATERIAL_KEYS`): `color` [r, g, b] with
each channel in [0, 1]; `roughness` in [0, 1]; `metallic` in [0, 1];
`emissive` [r, g, b] with each channel in [0, 100]. Material ids match
`MATERIAL_ID_RE` = `^[a-z][a-z0-9_]{0,47}$`.

### Anchors

An anchor is `{t: Vec3, r: Quat}` (`ANCHOR_KEYS`) in the asset frame: a named
spawn point, pivot, hand and so on. Anchor names match
`ANCHOR_NAME_RE` = `^[A-Za-z][A-Za-z0-9_]{0,31}$`. The quaternion must be
unit, as for node transforms.

### Numbers

Every number must be finite, otherwise NUMBER_NOT_FINITE. Note that JSON
`1e400` parses to Infinity in most parsers and is refused. Every number must
also have an absolute value <= 1e6 (`MAX_ABS_NUMBER`), otherwise NUMBER_RANGE.

## S2. Triangle rule

This is what RAA generates at LOD0, and the arithmetic the validator uses for
the budget. Let S = `budget.segments` and k = S/4.

| kind | triangles | at S = 16 |
|---|---|---|
| box | 12 | 12 |
| roundBox | radius = 0: 12; otherwise 12 + 24k + 8k(2k - 1) | 12 or 332 |
| sphere, ellipsoid | S(S - 2) | 224 |
| capsule | S(S - 2) + 2S | 256 |
| cylinder | 4S - 4 | 60 |
| cone | both radii > 0: 4S - 4; one radius = 0: 2S - 2 | 60 or 30 |
| torus | S² | 256 |

The asset total is the sum of the primitive triangles over ALL nodes, plus the
primitive triangles once more for every `subtract` or `intersect` node. This
extra term is the cut allowance: cutting a parent by a convex child adds at most
that many triangles. The asset is refused with BUDGET_EXCEEDED when the total is
greater than `budget.triangles`. RAA must never generate more triangles than
this count.

Example at S = 16: a box with one cylinder subtract child counts
12 + 60 + 60 = 132 triangles.

## S3. Collision

`collision.mode` is one of:

- `derived`: `colliders` must equal `deriveColliders(asset)`, otherwise
  COLLISION_STALE. The canonical writer fills the list, so a consumer can simply
  read it.
- `override`: the colliders are hand-written and only shape-checked
  (BAD_COLLIDER).

A collider has these keys, in order (`COLLIDER_KEYS`): `node` (the id of the
source node, or null in override mode), `shape`, `params`, `t`, `r`. All of them
are in the ASSET frame, with no scale. Shapes use the Rapier names, and their
params follow `COLLIDER_PARAM_ORDER`:

| shape | params | axis |
|---|---|---|
| ball | `radius` | |
| cuboid | `halfExtents` | |
| roundCuboid | `halfExtents`, `borderRadius` | |
| capsule | `halfHeight`, `radius` | Y |
| cylinder | `halfHeight`, `radius` | Y |
| cone | `halfHeight`, `radius` | Y, apex at +Y |

### Derivation

- Nodes are walked depth-first in pre-order. Cutters (`subtract` or
  `intersect`) produce nothing.
- The world transform of a node is the composition of its TRS chain. Because
  every parent has a uniform scale, the world matrix is a similarity times the
  leaf's own scale. The collider t and r come from that similarity, and the
  effective scale is e = leaf s × the product of the ancestors' uniform scales.

Per kind, with e = (ex, ey, ez):

| kind | collider |
|---|---|
| sphere | ball(radius · e) when e is uniform, else cuboid(radius · e) |
| ellipsoid | ball when the components of radii · e are all equal, else cuboid(radii · e) |
| box | cuboid(size/2 · e) |
| roundBox | b = radius · min(e); roundCuboid(max(size/2 · e - b, 0), b) |
| capsule | r' = radius · max(ex, ez); capsule(max(height/2 · ey - r', 0), r') |
| cylinder | cylinder(height/2 · ey, radius · max(ex, ez)) |
| cone | see the cone flip below |
| torus | 8 capsules, see below |

**Cone flip.** If radiusTop = 0 the collider is
cone(height/2 · ey, radiusBottom · max(ex, ez)), whose apex is at +Y like the
node. If radiusBottom = 0 the apex points to -Y, so the collider is the same cone
built from radiusTop, with its rotation r multiplied by a 180° turn about X.
When both radii are > 0 the collider is
cylinder(height/2 · ey, max(radiusBottom, radiusTop) · max(ex, ez)).

**Torus capsules.** A torus gives 8 capsules, j = 0..7, at angle a = j · π/4.
Let R = majorRadius · max(ex, ez). The centre of capsule j is the node transform
applied to (R cos a, 0, R sin a). Its axis is the tangent of the ring at that
point. halfHeight = R · sin(π/8), so neighbouring capsules meet on the ring, and
radius = minorRadius · max(e).

## S4. Canonical form

The canonical writer gives a byte-identical round trip: writing, re-parsing and
writing again yields the same bytes. A parser does not have to produce this
form, but a writer that claims to be canonical must.

- Keys follow the orders of S1 and S3. The `materials` and `anchors` maps are
  sorted by key in UTF-16 code-unit order.
- Indentation is 2 spaces, one member per line, and the separator is `": "`.
- An array whose elements are ALL numbers is written on one line as
  `[a, b, c]`. Empty objects and arrays are `{}` and `[]`.
- The file ends with exactly one `\n`. There is no BOM.
- Quaternions are normalised and written with w >= 0 (all four components are
  negated when w < 0).
- In `derived` mode the writer recomputes the colliders.

### Number rule (`formatNumber`)

1. Round the exact decimal value of the double to 6 decimals
   (`NUMBER_DECIMALS`), ties away from zero.
2. Strip trailing zeros, then a trailing `.`.
3. Write `-0` as `0`.
4. Never use an exponent; the S1 range rule guarantees abs value <= 1e6.

Integer fields (`version`, `budget.triangles`, `budget.segments`) are written
as integers. For example 0.1 + 0.2 is written `0.3`, 2.0 is written `2`, and
-0.0000004 is written `0`.

## S5. Validation

Validation never throws on bad data. It returns a list of issues
`{code, path, message, nodes}`: `path` is a JSON pointer (`''` is the root),
`message` is an English sentence naming the offending node ids, and `nodes`
lists those ids (`[]` when none). All issues are collected, never only the
first one.

### Order

1. JSON and top-level structure.
2. Per node, in pre-order: structure, ids, kind, params, numbers, transform,
   material reference.
3. Materials, anchors and budget.
4. Caps. More than 64 nodes is CAP_NODES. A node at depth 9 or deeper, with
   roots at depth 1, is CAP_DEPTH.
5. Boolean rules.
6. Triangle budget. It is computed only when steps 1 to 5 produced no issue;
   otherwise the reported triangle count is null.
7. Collision.

### Refusal codes

The codes are stable and listed in S5 order (`REFUSAL_CODES`). The meaning is
the `REFUSAL_SUMMARY` sentence.

| code | meaning |
|---|---|
| JSON_PARSE | The file is not valid JSON, so nothing can be read from it. |
| NOT_OBJECT | The top-level JSON value is not an object, so the file cannot be a raa.prims asset. |
| BAD_FORMAT | The format field is not the string "raa.prims". |
| BAD_VERSION | The version field is not the integer 0. |
| MISSING_FIELD | A required field is absent. |
| UNKNOWN_FIELD | An unknown key appears; every key must belong to the format. |
| BAD_TYPE | A value has the wrong JSON type. |
| BAD_ID | An identifier does not match its required pattern. |
| DUPLICATE_ID | The same node id is used more than once; node ids must be unique in the asset. |
| BAD_NAME | The asset name is empty or longer than 128 characters. |
| UNKNOWN_KIND | A node kind is not one of the eight primitive kinds. |
| BAD_PARAMS | A params object has missing keys, unknown keys or wrong value types for its kind. |
| PARAM_RANGE | A parameter is outside the range its kind allows. |
| NUMBER_NOT_FINITE | A number is NaN or Infinity, so the asset would not describe a finite shape. |
| NUMBER_RANGE | A number has an absolute value greater than 1e6. |
| BAD_TRANSFORM | A transform has a non-unit quaternion or a scale component that is not positive. |
| SCALE_NONUNIFORM_PARENT | A node with children has a non-uniform scale, which its children cannot inherit exactly. |
| UNKNOWN_MATERIAL | A node references a material id that the materials map does not contain. |
| BAD_MATERIAL | A material entry is malformed or a colour channel is out of range. |
| BAD_ANCHOR | An anchor is malformed or its quaternion is not unit. |
| BAD_BUDGET | The budget is malformed: triangles or segments is out of range, not an integer, or not a multiple of 4. |
| CAP_NODES | The asset contains more than 64 nodes. |
| CAP_DEPTH | The node tree is deeper than 8 levels. |
| CAP_MATERIALS | The asset contains more than 32 materials. |
| CAP_ANCHORS | The asset contains more than 32 anchors. |
| CAP_COLLIDERS | The asset contains more than 256 colliders. |
| BOOL_NO_HOST | A root node uses subtract or intersect, but a root node has no parent volume to cut. |
| BOOL_HOST_NOT_CONVEX | A subtract or intersect child cuts a non-convex parent; only convex primitives can host a cut. |
| BOOL_CUTTER_NOT_CONVEX | A subtract or intersect child is a torus; only convex primitives can cut. |
| BOOL_NESTED | A subtract or intersect cutter has children, but a cutter must be a leaf. |
| BOOL_INTERSECT_MIXED | A parent with an intersect child also has a subtract child; intersect cannot be mixed with other cutters. |
| BOOL_CUTTERS_OVERLAP | Two cutters of the same parent overlap; cutters of one parent must be disjoint. |
| BUDGET_EXCEEDED | The generated triangle total exceeds budget.triangles. |
| COLLISION_STALE | In derived mode the colliders do not match deriveColliders(asset). |
| BAD_COLLIDER | A collider is malformed: unknown shape, bad params, bad transform or a node id that does not exist. |

## Conformance fixtures

The package ships the fixtures (`files` includes `fixtures/`) so that other
parsers can be checked against the same cases:

| path | meaning |
|---|---|
| `fixtures/valid/` | assets that must be accepted. Each one is in canonical form, so writing it back must give the same bytes |
| `fixtures/refused/` | assets that must be refused. Every refusal code has at least one fixture here |
| `fixtures/expected.json` | the expected outcome of every fixture: the exact triangle count of each valid fixture, and the exact set of issue codes of each refused fixture |

A conforming parser:

- accepts every file of `fixtures/valid/` with exactly the triangle count that
  `fixtures/expected.json` gives for it;
- refuses every file of `fixtures/refused/` with exactly the expected issue
  codes, no more and no fewer;
- if it also writes the format, reproduces each valid fixture byte for byte.

## Published schema

The JSON Schema is published as the package subpath `./schema`
(`schema/raa.prims.v0.schema.json`, draft 2020-12, `$id` `urn:raa:prims:v0`).
It expresses the structure only: keys, types, enums, required fields, the S1
patterns, `additionalProperties: false`, and the params of each kind through
`oneOf` on `kind`. It does not check caps, transforms, boolean rules, the
triangle budget or collider equality. A file that passes the schema can still
be refused; the rules on this page, and the fixtures, are the reference.
