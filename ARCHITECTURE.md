# Architecture: raa-assets-tools

## Purpose

`raa-assets-tools` is a standalone TypeScript package with four parts:

- the `raa.prims` v0 primitive-asset format: its validator, its canonical writer and conformance fixtures;
- the content-addressed asset manifest;
- the local asset store and the `raa-assets` command-line tool;
- a git guard that keeps binaries and assets out of repositories, and an optional vendor packer.

The package depends on no game, engine or editor. Other tools read and write the format through `schema/` and `fixtures/`, and they never need this package at runtime except through its exports or its CLI.

`runs/obstacles-v0/` is an example authoring run. It is example data, described in `runs/README.md`, and is not part of the library.

## Conventions

### Package

- Node >= 22.18, ESM (`"type": "module"`). The sources are TypeScript that Node runs directly (`node file.ts`). `npm run build` compiles them with `tsc -p tsconfig.json` into `dist/` (JavaScript and `.d.ts`), which is what the published package contains. Zero runtime dependencies; devDependencies are `typescript` and `@types/node` only.
- `tsconfig.json`:
  - `rootDir` is `src` and `outDir` is `dist`;
  - `skipLibCheck: true`, so builds do not depend on how complete the installed `@types/node` tree is. Project sources are still fully type-checked.
- `tsconfig.check.json`:
  - `noEmit: true` and `rootDir: "."`;
  - it includes `src/**`, `test/**`, `proof/**`, `runs/**` and `scripts/**`.
- `npm run build`, `npm run typecheck` and `npm test` each exit 0.
- Package exports, all declared in `package.json`:

  | subpath | content |
  |---|---|
  | `.` | format, validator, writer |
  | `./manifest` | manifest format |
  | `./node` | hash, store, gc, redaction (Node only) |
  | `./schema` | `schema/raa.prims.v0.schema.json` |
  | `./package.json` | the package file |

  The bin is `raa-assets` -> `dist/cli/main.js`. There is no `./node/guard` subpath; the guard is reached through the CLI or the `dist/node/guard/index.js` module path.
- Code under `src/format/` and `src/manifest/` is browser-safe: no `node:` import, and a test checks this. Node-only code lives under `src/node/` and `src/cli/`.
- Errors are `RaaError(code, message, fix)`. Every message is a plain English sentence that names the offending node ids or files. Every fix says what to do next.
- CLI exit codes:

  | exit | meaning |
  |---|---|
  | 0 | success |
  | 1 | content refusals: `OBJECT_TOO_LARGE`, `OBJECT_HASH_MISMATCH`, `MANIFEST_INVALID`, `ASSET_INVALID`, `GC_ROOT_NOT_MANIFEST`, `validate` with any refused file, `guard-check` with violations |
  | 2 | usage and configuration: `USAGE`, `UNKNOWN_COMMAND`, `NO_STORE`, `BAD_HASH`, `BAD_ROOT_NAME`, `GC_DELETE_UNAVAILABLE` |
  | 3 | any other store, filesystem or internal error |

- Every CLI message goes through `redactSecrets`.
- Tests use `node --test "test/**/*.test.ts"`. Proofs use `proof/lib.ts`. Cases that spawn processes run through `parallelMap`, bounded by the `PROOF_CPUS` environment variable (a positive integer, default 1).

### Store

- **Local-only store.** The asset store is a local directory. It is chosen by `--store <dir>`, then `RAA_ASSETS_STORE_DIR`, then the default `~/.raa-assets/store` when that directory exists.
  - There is no ssh store, no public-URL client and no store credential.
  - Outputs and evidence record relative object keys `objects/<2hex>/<sha256>`, never URLs.
  - Committed files, logs and evidence never contain absolute store paths, hosts, users or keys.
- Publishing is outside this package. A store directory can be copied unchanged to the web root of a static file server (see `docs/store.md`, "Publishing a store").
- Asset binaries (PNG, GLB, ...) never go to git. Evidence files are committed JSON and record only hashes, sizes and keys.

### Optional consumers

Applications that build on the format (for example an editor that exports `raa.prims` files) depend on this package from npm, or copy a built vendor tree made by `scripts/pack-vendor.ts`. The package itself has no knowledge of them. Their own source code is not part of this repository.

## Shared contracts

The format, manifest, store, CLI and guard rules below are owned by this package. Consumers use the published package or its vendored build; they keep no copy of the rules.

## S1. raa.prims v0 file

UTF-8 JSON. Units are metres, +Y is up, the frame is right-handed, colours are LINEAR RGB in [0,1], and quaternions are `[x, y, z, w]`.

Top-level keys, in canonical order:

| key | type | rule |
|---|---|---|
| format | string | exactly `raa.prims` |
| version | integer | exactly 0 |
| id | string | `ASSET_ID_RE` = `^[a-z][a-z0-9_.-]{0,63}$` |
| name | string | 1..128 chars |
| budget | object | `{triangles, segments}`. triangles: integer 1..100000 (default 1500). segments: integer 4..128 and a multiple of 4 (default 16). Optional on input (defaults apply); the canonical writer always writes it |
| nodes | array | root nodes; 1..64 nodes in total over the whole tree |
| materials | object | id (`MATERIAL_ID_RE` = `^[a-z][a-z0-9_]{0,47}$`) -> material; 1..32 entries |
| anchors | object | name (`ANCHOR_NAME_RE` = `^[A-Za-z][A-Za-z0-9_]{0,31}$`) -> `{t, r}`; 0..32 entries |
| collision | object | `{mode: 'derived' or 'override', colliders: [...]}`; 0..256 colliders |

Unknown keys anywhere are refused (UNKNOWN_FIELD).

**Node.** Keys in canonical order:

- `id`: `NODE_ID_RE` = `^[a-z][a-z0-9_]{0,47}$`, unique in the asset;
- `kind`;
- `params`;
- `transform`: `{t: Vec3, r: Quat, s: Vec3}`;
- `material`: a key of materials;
- `op`: 'union', 'subtract' or 'intersect';
- `children`: optional, written only when non-empty.

Transform rules:

- The local matrix is M = T(t) · R(r) · S(s). Children live in the node frame, including its scale.
- Every s component must be > 0, and r must be unit: abs(norm - 1) <= 1e-6.
- A node that has children must have a uniform scale: max abs(si - sj) <= 1e-9 · max abs(s).
- Every primitive is centred on its origin. Capsule, cylinder, cone and torus have their axis along Y.

**Kinds and params.** Keys are in this canonical order and every key is required. Lengths are in [0.001, 1000] unless stated otherwise.

| kind | params |
|---|---|
| sphere | radius |
| box | size [x,y,z] (full size) |
| roundBox | size [x,y,z], radius in [0, min(size)/2] |
| capsule | height (total, caps included, >= 2·radius), radius |
| cylinder | height, radius |
| cone | height, radiusBottom, radiusTop (each in [0,1000], max >= 0.001; bottom at y = -height/2) |
| torus | majorRadius, minorRadius (minorRadius < majorRadius; ring in the XZ plane) |
| ellipsoid | radii [x,y,z] |

`PRIM_KINDS` lists the kinds in this order. `CONVEX_KINDS` holds every kind except torus.

**Booleans.**

- Root nodes and `union` children are separate closed meshes generated in place. Nothing is cut.
- A `subtract` child removes its volume from its PARENT primitive's mesh only.
- An `intersect` child keeps parent ∩ child.
- A conforming mesher implements both by cutting the faces of the parent's mesh exactly with the convex child.

A cut is accepted only when all of these hold:

- the parent kind is convex (else BOOL_HOST_NOT_CONVEX);
- the cutter kind is convex (else BOOL_CUTTER_NOT_CONVEX);
- the cutter has no children (else BOOL_NESTED);
- a parent with an intersect child has no other cutter (else BOOL_INTERSECT_MIXED);
- the cutters of one parent do not overlap pairwise (else BOOL_CUTTERS_OVERLAP). The test uses their AABBs in the parent frame (`boundsInParent`): two cutters overlap when, on all three axes, minA < maxB - 1e-9 and minB < maxA - 1e-9;
- the node is not a root (a root subtract or intersect has no host: BOOL_NO_HOST).

**Material.** Keys in order:

- `color`: [r,g,b], each in [0,1];
- `roughness`: in [0,1];
- `metallic`: in [0,1];
- `emissive`: [r,g,b], each in [0,100].

**Anchor.** `{t: Vec3, r: Quat}` in the asset frame (named spawn, pivot, hand…).

**Numbers.** Every number must be finite, else NUMBER_NOT_FINITE. JSON `1e400` parses to Infinity and is refused. Every number must have abs value <= 1e6, else NUMBER_RANGE.

## S2. Triangle rule

S2 sets the triangle count that a conforming mesher generates at LOD0 and the validator's budget arithmetic. S = budget.segments and k = S/4.

| kind | triangles |
|---|---|
| box | 12 |
| roundBox | radius = 0: 12; otherwise 12 + 24k + 8k(2k - 1) |
| sphere, ellipsoid | S(S - 2) |
| capsule | S(S - 2) + 2S |
| cylinder | 4S - 4 |
| cone | both radii > 0: 4S - 4; one radius = 0: 2S - 2 |
| torus | S^2 |

At S = 16 this gives: box 12, roundBox 332, sphere 224, capsule 256, cylinder 60, cone 60 or 30, torus 256.

The asset total is the sum of primitiveTriangles over ALL nodes, plus primitiveTriangles once more for every subtract or intersect node (the cut allowance). The asset is refused with BUDGET_EXCEEDED when total > budget.triangles. A conforming mesher must never generate more than this count.

## S3. Collision

`collision.mode`:

- 'derived': `colliders` MUST equal `deriveColliders(asset)`, else COLLISION_STALE. The canonical writer fills the list, so consumers only read it.
- 'override': the colliders are hand-written and only shape-checked (BAD_COLLIDER).

A collider has keys in this order: `node` (the source node id, or null for override), `shape`, `params`, `t`, `r`. All values are in the ASSET frame, with no scale.

Shapes and params use Rapier names:

- `ball {radius}`
- `cuboid {halfExtents}`
- `roundCuboid {halfExtents, borderRadius}`
- `capsule {halfHeight, radius}` (Y axis)
- `cylinder {halfHeight, radius}` (Y axis)
- `cone {halfHeight, radius}` (Y axis, apex at +Y)

Derivation (`deriveColliders`):

- Nodes are walked depth-first in pre-order. Cutters (subtract or intersect) produce nothing.
- A node's world transform is the composition of its TRS chain. Every parent has a uniform scale, so the world matrix is a similarity times the leaf's own scale. t and r come from that matrix. The effective scale e is the leaf s × the product of the ancestors' uniform scales.
- Per kind:
  - sphere: ball(radius·e) when e is uniform, else cuboid(radius·e).
  - ellipsoid: ball when radii·e are all equal, else cuboid(radii·e).
  - box: cuboid(size/2·e).
  - roundBox: b = radius·min(e); roundCuboid(max(size/2·e - b, 0), b).
  - capsule: r' = radius·max(ex, ez); capsule(max(height/2·ey - r', 0), r').
  - cylinder: cylinder(height/2·ey, radius·max(ex, ez)).
  - cone:
    - radiusTop = 0: cone(height/2·ey, radiusBottom·max(ex, ez));
    - radiusBottom = 0: the same cone, with r multiplied by a 180° turn about X;
    - otherwise: cylinder(height/2·ey, max(radii)·max(ex, ez)).
  - torus: 8 capsules, j = 0..7, at angle a = j·π/4.
    - Centre: the node transform applied to (R cos a, 0, R sin a), with R = majorRadius·max(ex, ez).
    - Axis: the ring tangent.
    - halfHeight = R·sin(π/8); radius = minorRadius·max(e).

## S4. Canonical form (byte-identical round trip)

- Keys follow the orders above. The `materials` and `anchors` maps are sorted by key in UTF-16 code-unit order.
- Indentation is 2 spaces, one member per line, with the separator `": "`.
- Any array whose elements are ALL numbers is written on one line as `[a, b, c]`.
- Empty objects and arrays are `{}` and `[]`.
- The file ends with exactly one `\n` and has no BOM.
- Numbers (`formatNumber`):
  - The exact decimal value of the double is rounded to 6 decimals, ties away from zero.
  - Trailing zeros are stripped, then a trailing '.'.
  - '-0' becomes '0'.
  - There is never an exponent (abs value <= 1e6 is guaranteed).
  - Integer fields (version, budget.*) are written as integers.
- Quaternions are normalised and written with w >= 0 (negated when w < 0).
- In 'derived' mode the writer recomputes the colliders.
- Writing, then re-parsing, then writing again gives identical bytes.

## S5. Refusal codes

Each refusal is a `RaaIssue`: `code`; `message`, an English sentence naming the node ids; `path`, a JSON pointer; `nodes`, the node ids.

Codes: JSON_PARSE, NOT_OBJECT, BAD_FORMAT, BAD_VERSION, MISSING_FIELD, UNKNOWN_FIELD, BAD_TYPE, BAD_ID, DUPLICATE_ID, BAD_NAME, UNKNOWN_KIND, BAD_PARAMS, PARAM_RANGE, NUMBER_NOT_FINITE, NUMBER_RANGE, BAD_TRANSFORM, SCALE_NONUNIFORM_PARENT, UNKNOWN_MATERIAL, BAD_MATERIAL, BAD_ANCHOR, BAD_BUDGET, CAP_NODES, CAP_DEPTH, CAP_MATERIALS, CAP_ANCHORS, CAP_COLLIDERS, BOOL_NO_HOST, BOOL_HOST_NOT_CONVEX, BOOL_CUTTER_NOT_CONVEX, BOOL_NESTED, BOOL_INTERSECT_MIXED, BOOL_CUTTERS_OVERLAP, BUDGET_EXCEEDED, COLLISION_STALE, BAD_COLLIDER.

Validation order. All issues are collected, never only the first.

1. JSON and top-level structure.
2. Per node, in pre-order: structure, ids, kind, params, numbers, transform, material reference.
3. Materials, anchors and budget.
4. Caps: more than 64 nodes is CAP_NODES; a node at depth 9 or deeper (roots are at depth 1) is CAP_DEPTH.
5. Boolean rules.
6. Triangle budget. It is computed only when steps 1–5 produced no issue; otherwise `triangles` is null.
7. Collision.

## S6. Manifest (an object in the store)

- Fields: `{format: 'raa.manifest', version: 0, name, entries}`. name matches `LOGICAL_NAME_RE` = `^[a-z][a-z0-9_.-]{0,127}$`.
- `entries` maps a logical name (LOGICAL_NAME_RE) to an entry:
  - `sha256`: 64 lowercase hex;
  - `size`: bytes, integer in 0..52428800;
  - `contentType`;
  - `version`: integer >= 1, the revision of that logical asset.
- `serializeManifest` writes it in the S4 style. Entries are sorted by key, and keys follow the order above.
- `contentTypeFor(fileName)` gives contentType, matching the longest suffix first:
  - `.raa.prims.json` -> `application/vnd.raa.prims+json`
  - `.sdfm.json` -> `application/vnd.sdfm+json`
  - `.json` -> `application/json`
  - `.png` -> `image/png`; `.jpg` and `.jpeg` -> `image/jpeg`
  - `.glb` -> `model/gltf-binary`
  - anything else -> `application/octet-stream`
- A consumer fetches a manifest by its sha256, then each entry by its sha256.

## S7. Asset store (local directory)

- An object lives at `<root>/objects/<first 2 hex>/<sha256>` and is immutable. Its key is the relative path `objects/<2hex>/<sha256>` (`objectKey`).
- Named roots (GC roots) are text files `<root>/roots/<name>`, each holding one manifest sha256 and a newline.
- Store selection (`storeFromEnv`), in order:
  1. `--store <dir>`;
  2. env `RAA_ASSETS_STORE_DIR`;
  3. `STORE_DIR_DEFAULT` = `~/.raa-assets/store`, only if it is an existing directory.

  Otherwise it throws `NO_STORE` ('no asset store is configured and the default store directory does not exist'; fix 'pass --store <dir> or set RAA_ASSETS_STORE_DIR').
- Put:
  - It checks the size first: a file larger than 52428800 bytes is refused with OBJECT_TOO_LARGE before any byte is written.
  - It writes `objects/<2hex>/.<sha>.tmp.<nonce>`, renames it to the final name, then re-reads the file and verifies its hash.
  - Temp names start with '.', are never listed, and none is left behind after a successful put.
  - An existing object is never rewritten: put reports created=false.
- Get re-hashes the bytes. It fails with OBJECT_HASH_MISMATCH on a mismatch and OBJECT_NOT_FOUND when the object is absent.
- Publishing is outside this package: a store directory is copied unchanged to a static file server, which serves `objects/<2hex>/<sha256>`. No tool in this package opens a socket or spawns ssh.

## S8. CLI `raa-assets` (src/cli/main.ts)

Store selection follows S7: `--store <dir>`, then `RAA_ASSETS_STORE_DIR`, then the existing default directory, otherwise NO_STORE (exit 2).

| command | effect | output (text; `--json` gives the object) |
|---|---|---|
| `put <file>...` | hash, cap check, store (dedupe), verify | text `<sha256>  <size>  created\|exists  <key>` per file, then the store size line; JSON `{objects: [{file, sha256, size, created, key}], store}` |
| `get <sha256> [-o <file>]` | reads the local store and verifies the hash | bytes to the file or stdout |
| `ls` | lists objects sorted by sha | `<sha256> <size>` lines + a total |
| `stat [<sha256>]` | one object (size from the listing), or the store report | object: sha256, size, key (JSON `{sha256, size, key}`); store: objects, bytes, freeBytes, kind 'local' (never a path) |
| `manifest --name <name> <logical>=<file>[@<version>]... [--root <rootName>]` | puts each file, builds and puts the manifest, optionally writes the root | text `manifest <sha256>  <size>  <key>` + entries; JSON `{name, sha256, size, key, root, entries}` |
| `manifest --show <sha256>` | reads, validates and prints a manifest | the manifest |
| `gc --dry-run [--keep <sha256>]...` | reachability from roots + keep (manifests -> entries) | the unreachable objects and their bytes; without `--dry-run`: GC_DELETE_UNAVAILABLE (exit 2) |
| `validate <file>...` | parseRaaPrims on each file | per file: ok + triangles/budget, or each issue `CODE path: message` (exit 1 if any is refused) |
| `install-guard <repo> [--force]` | installs the pre-commit guard | hook path and action |
| `guard-check [<repo>] [--tracked]` | runs the guard rules on the staged (or tracked) files | violations (exit 1 if any) |

Exit codes are listed under Conventions.

## S9. Git guard

- A staged path (`git diff --cached --name-only -z --diff-filter=ACMRT`) is refused when any of these holds:
  - its last extension, compared case-insensitively, is one of .glb .gltf .png .jpg .jpeg .avif .ktx2 .bin (reason 'asset-extension');
  - its size is > 1048576 bytes (reason 'too-large');
  - its staged blob contains a NUL byte in the first 8000 bytes (reason 'binary').
- Sizes come from `git cat-file -s :<path>` and heads from `git cat-file blob :<path>`.
- The hook is ONE standalone Node ESM script with the rules inlined, so it does not need raa-assets to be installed. It contains the marker `raa-assets-guard v1` and is installed at `$(git rev-parse --git-path hooks)/pre-commit`.
  - An existing hook without the marker is refused with GUARD_FOREIGN_HOOK unless `--force` is given. `--force` first renames that hook to `pre-commit.bak-<n>`.
  - Reinstalling over our own hook is 'unchanged' when the content is identical, else 'updated'.
- On refusal the hook prints each `  <path>: <reason> (<size> bytes)`, then the fix line `put it in the asset store (raa-assets put <path>) and reference its sha256; see docs/private-assets.md`, and exits 1. There is no bypass list and no per-file exception.

## S11. Evidence files

Evidence files are committed JSON. They never hold secrets, binaries, URLs or absolute paths.

- `evidence/store-real.json` (written by `proof/store-real.ts`):
  - Shape: `{store: {kind: 'local', layout: 'objects/<2hex>/<sha256>', isDefaultDir}, object: {sha256, size, created, key}, storedFile: {sha256}, get: {sha256, size, bytesEqual}, manifest: {sha256, size, key, storedFile: {sha256}, entrySha256}, stat: {objects, bytes}, recordedAt}`.
  - Format: 2-space indent and a trailing LF.
- `runs/obstacles-v0/evidence.json`: the evidence of the example run. Its shape is described in `runs/README.md`.

## Module ownership

| Module | Consumes |
|---|---|
| package-base | — |
| format-types | — |
| format-geometry | format-types |
| format-validator | format-types, format-geometry |
| format-writer | format-types, format-geometry, format-validator |
| format-api | format-types, format-geometry, format-validator, format-writer |
| conformance-fixtures | format-api |
| proof-kit | — |
| format-proof | proof-kit, format-api, conformance-fixtures |
| manifest-format | format-api |
| store-client | format-api, manifest-format |
| cli | format-api, manifest-format, store-client |
| store-proof | proof-kit, cli, store-client, manifest-format |
| git-guard | store-client, cli |
| guard-proof | proof-kit, git-guard |
| vendor-pack | package-base, git-guard |
| example-run | proof-kit, manifest-format, cli, format-api, store-client (see `runs/README.md`) |

## Module: package-base

Files: `package.json`, `tsconfig.json`, `tsconfig.check.json`, `.gitignore`, `README.md`, `LICENSE`, `docs/format.md`.

- `package.json`:
  - name `@etcito/raa-assets-tools`, `"type": "module"`, MIT, engines node >= 22.18;
  - all subpath exports ('.', './manifest', './node', './schema', './package.json') and the bin `raa-assets`;
  - scripts: `build` (`tsc -p tsconfig.json`), `typecheck` (`tsc -p tsconfig.check.json`), `test` (`node --test "test/**/*.test.ts"`), `release:pack`;
  - zero runtime dependencies.
- `tsconfig.json` and `tsconfig.check.json`: as described under Conventions.
- `.gitignore`: `node_modules/`, `dist/`, `out/` (which also holds the worktree store), `*.tsbuildinfo`.
- `README.md`:
  - purpose and scope: the package depends on no game, engine or editor;
  - quick start (`node src/cli/main.ts validate fixtures/valid/*.json`);
  - links to docs/format.md, docs/store.md and docs/private-assets.md;
  - the store rule: the store is a local directory chosen by `--store <dir>`, `RAA_ASSETS_STORE_DIR` or the default `~/.raa-assets/store/`. No store credentials are used. Committed files, logs and evidence never contain absolute store paths, hosts, users or keys. Asset binaries never go to git.
- `docs/format.md`: S1 to S5 explained for implementers, including the refusal table.
- `LICENSE`: MIT, unchanged.

## Module: format-types

Browser-safe.

Files: `src/format/types.ts`, `src/format/constants.ts`, `src/format/errors.ts`, `schema/raa.prims.v0.schema.json`, `test/format/schema.test.ts`.

```ts
// types.ts
export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number] // x, y, z, w
export type PrimKind = 'sphere' | 'box' | 'roundBox' | 'capsule' | 'cylinder' | 'cone' | 'torus' | 'ellipsoid'
export type NodeOp = 'union' | 'subtract' | 'intersect'
export interface RaaTransform { t: Vec3; r: Quat; s: Vec3 }
export interface ParamsByKind {
  sphere: { radius: number }; box: { size: Vec3 }; roundBox: { size: Vec3; radius: number }
  capsule: { height: number; radius: number }; cylinder: { height: number; radius: number }
  cone: { height: number; radiusBottom: number; radiusTop: number }
  torus: { majorRadius: number; minorRadius: number }; ellipsoid: { radii: Vec3 }
}
export type RaaNode = { [K in PrimKind]: { id: string; kind: K; params: ParamsByKind[K]; transform: RaaTransform; material: string; op: NodeOp; children?: RaaNode[] } }[PrimKind]
export interface RaaMaterial { color: Vec3; roughness: number; metallic: number; emissive: Vec3 }
export interface RaaAnchor { t: Vec3; r: Quat }
export type ColliderShape = 'ball' | 'cuboid' | 'roundCuboid' | 'capsule' | 'cylinder' | 'cone'
export interface ColliderParamsByShape {
  ball: { radius: number }; cuboid: { halfExtents: Vec3 }; roundCuboid: { halfExtents: Vec3; borderRadius: number }
  capsule: { halfHeight: number; radius: number }; cylinder: { halfHeight: number; radius: number }; cone: { halfHeight: number; radius: number }
}
export type RaaCollider = { [S in ColliderShape]: { node: string | null; shape: S; params: ColliderParamsByShape[S]; t: Vec3; r: Quat } }[ColliderShape]
export interface RaaCollision { mode: 'derived' | 'override'; colliders: RaaCollider[] }
export interface RaaBudget { triangles: number; segments: number }
export interface RaaPrimsAsset { format: 'raa.prims'; version: 0; id: string; name: string; budget: RaaBudget; nodes: RaaNode[]; materials: Record<string, RaaMaterial>; anchors: Record<string, RaaAnchor>; collision: RaaCollision }
export type RefusalCode = /* exactly the S5 list */ 'JSON_PARSE' | 'NOT_OBJECT' | /* … */ 'BAD_COLLIDER'
export interface RaaIssue { code: RefusalCode; path: string /* JSON pointer, '' = root */; message: string; nodes: string[] /* offending node ids, [] when none */ }
export interface RaaValidation { ok: boolean; issues: RaaIssue[]; triangles: number | null; asset: RaaPrimsAsset | null /* normalised (budget defaults filled) when ok */ }
// constants.ts
export const FORMAT = 'raa.prims'; export const FORMAT_VERSION = 0
export const PRIM_KINDS: readonly PrimKind[] // S1 order
export const CONVEX_KINDS: readonly PrimKind[] // all but torus
export const PARAM_ORDER: Readonly<Record<PrimKind, readonly string[]>>
export const TOP_KEYS, NODE_KEYS, TRANSFORM_KEYS, MATERIAL_KEYS, ANCHOR_KEYS, BUDGET_KEYS, COLLISION_KEYS, COLLIDER_KEYS: readonly string[]
export const COLLIDER_PARAM_ORDER: Readonly<Record<ColliderShape, readonly string[]>>
export const MAX_NODES = 64, MAX_DEPTH = 8, MAX_MATERIALS = 32, MAX_ANCHORS = 32, MAX_COLLIDERS = 256
export const DEFAULT_TRIANGLE_BUDGET = 1500, MAX_TRIANGLE_BUDGET = 100000, DEFAULT_SEGMENTS = 16, MIN_SEGMENTS = 4, MAX_SEGMENTS = 128
export const NUMBER_DECIMALS = 6, MAX_ABS_NUMBER = 1e6, MIN_LENGTH = 0.001, MAX_LENGTH = 1000
export const QUAT_UNIT_TOLERANCE = 1e-6, UNIFORM_SCALE_TOLERANCE = 1e-9, OVERLAP_EPSILON = 1e-9
export const NODE_ID_RE: RegExp, ASSET_ID_RE: RegExp, MATERIAL_ID_RE: RegExp, ANCHOR_NAME_RE: RegExp; export const NAME_MAX = 128
export const REFUSAL_CODES: readonly RefusalCode[] // S5 order
export const REFUSAL_SUMMARY: Readonly<Record<RefusalCode, string>> // one plain sentence per code (the docs table)
// errors.ts
export class RaaError extends Error { readonly code: string; readonly fix: string; constructor(code: string, message: string, fix: string) }
```

The schema `schema/raa.prims.v0.schema.json` (draft 2020-12, `$id` 'urn:raa:prims:v0') expresses the structure only:

- keys, types, enums, required fields and patterns;
- `additionalProperties: false`;
- the per-kind params, through `oneOf` on kind.

Caps, booleans, the budget and collision equality are the TypeScript validator's job.

`schema.test.ts` checks that:

- the schema parses;
- its kind enum equals PRIM_KINDS and its patterns equal the RE sources;
- every valid fixture satisfies the schema's required and additionalProperties rules, through a tiny in-test walker with no dependency;
- no `src/format` file has a `node:` import.

## Module: format-geometry

Browser-safe pure functions. Inputs are assumed structurally valid: the validator calls these functions only after the structure checks pass.

Files: `src/format/math.ts`, `src/format/bounds.ts`, `src/format/triangles.ts`, `src/format/colliders.ts`, `test/format/math.test.ts`, `test/format/triangles.test.ts`, `test/format/colliders.test.ts`.

```ts
// math.ts
export type Mat4 = Float64Array // 16, column-major
export function quatNormalize(q: Quat): Quat
export function quatCanonical(q: Quat): Quat // normalised, w >= 0
export function quatMul(a: Quat, b: Quat): Quat
export function quatRotate(q: Quat, v: Vec3): Vec3
export function quatFromEulerXYZDeg(e: Vec3): Quat // three.js 'XYZ' order
export function quatFromMat3(m: Mat4): Quat // Shepperd, canonical sign
export function trsMatrix(tr: RaaTransform): Mat4 // T·R·S
export function mulMat4(a: Mat4, b: Mat4): Mat4
export function transformPoint(m: Mat4, p: Vec3): Vec3
export function isUniformScale(s: Vec3): boolean // UNIFORM_SCALE_TOLERANCE rule of S1
// bounds.ts
export interface Aabb { min: Vec3; max: Vec3 }
export function localBounds<K extends PrimKind>(kind: K, params: ParamsByKind[K]): Aabb // exact primitive box, centred
export function boundsInParent(node: RaaNode): Aabb // 8 corners of localBounds through trsMatrix(node.transform)
export function aabbOverlap(a: Aabb, b: Aabb): boolean // open-interior test with OVERLAP_EPSILON (S1)
// triangles.ts
export function primitiveTriangles(node: Pick<RaaNode, 'kind' | 'params'>, segments: number): number // S2 table
export function assetTriangles(asset: Pick<RaaPrimsAsset, 'nodes' | 'budget'>): { total: number; perNode: Record<string, number> } // S2 total incl. cut allowance
// colliders.ts
export function worldTransforms(nodes: RaaNode[]): Map<string, { t: Vec3; r: Quat; e: Vec3 }> // S3 composition (pre-order)
export function deriveColliders(asset: Pick<RaaPrimsAsset, 'nodes'>, include?: (nodeId: string) => boolean): RaaCollider[] // S3 rules, pre-order, torus capsules in j order
```

Tests cover:

- hand-computed triangle counts for every kind at S = 4, 16 and 128;
- the cut allowance;
- collider shapes per kind under uniform and non-uniform scale and under a rotated parent;
- the cone apex flip;
- the 8 torus capsules;
- quaternion round trips through Euler angles and the matrix.

## Module: format-validator

Browser-safe.

Files: `src/format/validate.ts`, `src/format/parse.ts`, `src/format/validate-util.ts`, `src/format/validate-top.ts`, `src/format/validate-nodes.ts`, `src/format/validate-rules.ts`, `src/format/validate-collision.ts`, and the tests `test/format/validate.test.ts`, `test/format/validate-util.test.ts`, `test/format/validate-top.test.ts`, `test/format/validate-nodes.test.ts`, `test/format/validate-rules.test.ts`, `test/format/validate-collision.test.ts`.

Public API, re-exported by src/index.ts:

```ts
export function validateRaaPrims(value: unknown): RaaValidation // validate.ts
export function parseRaaPrims(text: string): RaaValidation // parse.ts; a syntax error -> one JSON_PARSE issue (path '', the parser's text), never throws
```

Internal step files, not re-exported:

```ts
// validate-util.ts
export interface IssueSink { readonly issues: RaaIssue[]; add(code: RefusalCode, path: string, message: string, nodes?: readonly string[]): void }
export function createSink(): IssueSink
export function ptr(base: string, ...keys: (string | number)[]): string // RFC 6901 escaping, '' = root
export function isRecord(v: unknown): v is Record<string, unknown> // plain object, not array
export function checkKeys(sink: IssueSink, obj: Record<string, unknown>, path: string, allowed: readonly string[], required: readonly string[], nodes: readonly string[]): boolean
export function readNumber(sink: IssueSink, v: unknown, path: string, nodes: readonly string[], badCode: RefusalCode): number | null
export function readVec(sink: IssueSink, v: unknown, n: 3 | 4, path: string, nodes: readonly string[], badCode: RefusalCode): number[] | null
export function roundCanonical(x: number): number // Number(x.toFixed(NUMBER_DECIMALS)), -0 -> 0
export function scanJsonValue(sink: IssueSink, v: unknown, path: string): boolean // BAD_TYPE on cycles and non-JSON values
// validate-top.ts
export interface TopParts { top: Record<string, unknown>; materialIds: ReadonlySet<string> }
export function validateTopLevel(value: unknown, sink: IssueSink): TopParts | null // step 1
export function validateMaterials(top: Record<string, unknown>, sink: IssueSink): void // step 3
export function validateAnchors(top: Record<string, unknown>, sink: IssueSink): void // step 3
export function validateBudget(top: Record<string, unknown>, sink: IssueSink): RaaBudget | null // step 3, defaults filled
// validate-nodes.ts
export interface NodeInfo { id: string | null; path: string; depth: number; parentId: string | null; childIds: string[]; kind: string | null; op: string | null; ok: boolean; node: RaaNode | null }
export function validateNodes(nodes: unknown, materialIds: ReadonlySet<string>, sink: IssueSink): NodeInfo[] // step 2, pre-order, roots depth 1
// validate-rules.ts
export function checkCaps(infos: readonly NodeInfo[], top: Record<string, unknown>, sink: IssueSink): void // step 4
export function checkBooleans(infos: readonly NodeInfo[], sink: IssueSink): void // step 5
export function checkBudget(asset: RaaPrimsAsset, sink: IssueSink): number // step 6
// validate-collision.ts
export function checkCollision(top: Record<string, unknown>, nodeIds: ReadonlySet<string>, asset: RaaPrimsAsset | null, sink: IssueSink): void // step 7
```

Rules:

- The validator applies exactly S1, S3 and S5, in S5 order, and collects every issue.
- Every issue names the offending node ids in `nodes` and in the message. Example: `node 'hole' subtracts from 'ring', a torus: only convex shapes (sphere, box, roundBox, capsule, cylinder, cone, ellipsoid) can be cut`.
- `triangles` is `assetTriangles(asset).total` when steps 1–5 passed, else null.
- `ok` means there is no issue. `asset` is the input with the budget defaults filled (not re-quantised) when ok.
- It never throws and never returns NaN.

Code precedence. Each defect gets one code, and all step files agree:

| defect | code |
|---|---|
| cycles and non-JSON JS values (undefined, function, symbol, bigint, non-plain objects); a pre-pass finds them and stops validation | BAD_TYPE |
| NaN or ±Infinity anywhere a value is read | NUMBER_NOT_FINITE |
| a finite number with abs > 1e6 | NUMBER_RANGE |
| a missing or unknown key of a top-level, node, transform, material, anchor, budget, collision or collider object | MISSING_FIELD / UNKNOWN_FIELD |
| a wrong JS type of a top-level field; a node that is not an object; children that are not an array; an invalid op or collision.mode | BAD_TYPE |
| an asset id, node id or material id that does not match its pattern | BAD_ID |
| a repeated node id | DUPLICATE_ID |
| an invalid name | BAD_NAME |
| an anchor name that does not match its pattern | BAD_ANCHOR |
| an unknown kind (its params are not checked) | UNKNOWN_KIND |
| a params key set that differs from the kind's, or an ill-shaped value | BAD_PARAMS |
| a numeric S1 range violation | PARAM_RANGE |
| a bad transform shape, s <= 0, or a non-unit r | BAD_TRANSFORM |
| a parent with a non-uniform s | SCALE_NONUNIFORM_PARENT |
| bad material values | BAD_MATERIAL |
| a bad anchor t or r | BAD_ANCHOR |
| bad budget values | BAD_BUDGET |
| 0 or > 64 nodes | CAP_NODES |
| 0 or > 32 materials | CAP_MATERIALS |
| > 32 anchors | CAP_ANCHORS |
| > 256 colliders | CAP_COLLIDERS |
| each node at depth > 8 | CAP_DEPTH |
| every other collider-entry defect (shape, params set, negative or zero values, t, r, an unknown node id) | BAD_COLLIDER |

The boolean rules run only on nodes whose own checks passed.

COLLISION_STALE comparison:

- It runs in mode 'derived', when steps 1–5 are clean and every entry is well-formed.
- It requires the same length, node and shape as `deriveColliders(asset)`, and every number equal within 1e-6 after `roundCanonical` on both sides. Quaternions are compared up to sign.
- A mismatch gives one issue at '/collision/colliders'.

Tests cover:

- one targeted case per code, spread over the step test files;
- multi-issue collection;
- the default budget;
- non-JSON JS inputs (NaN, -Infinity, cycles);
- a fuzz loop that never throws.

## Module: format-writer

Browser-safe.

Files: `src/format/canonical.ts`, `test/format/canonical.test.ts`.

```ts
export function formatNumber(x: number): string // S4 number rule; throws RaaError('NUMBER_NOT_WRITABLE') for non-finite or abs(x) > 1e6
export type KeyOrder = (path: readonly string[]) => readonly string[] | 'sorted'
export function writeCanonicalJson(value: unknown, order: KeyOrder): string // S4 style
export function normalizeRaaPrims(asset: RaaPrimsAsset): RaaPrimsAsset // deep copy; budget defaults; quatCanonical; every number quantised to Number(formatNumber(x)); in mode 'derived' colliders recomputed from the QUANTISED nodes and quantised; empty children omitted
export function serializeRaaPrims(asset: RaaPrimsAsset): string // validates the normalised asset, else RaaError('ASSET_INVALID', '<n> issues; first: <CODE> <path>: <message>', 'fix the listed issues; run raa-assets validate')
```

Colliders are derived from the quantised nodes, so deriving from the re-parsed file gives exactly the written colliders, and the round trip is byte-identical (S4).

Tests cover:

- the formatNumber table: 0.1+0.2 -> '0.3', 1e-7 -> '0', -0 -> '0', 0.0000005 -> '0.000001', 123456.7891234 -> '123456.789123', integers without a dot;
- idempotence: `serialize(parse(serialize(a))) === serialize(a)`;
- key orders and sorted maps;
- w >= 0.

## Module: format-api

File: `src/index.ts`.

This is the '.' entry. It re-exports every export of format-types (types, constants, RaaError), format-geometry, format-validator (public API) and format-writer. It is browser-safe: it has no `node:` import.

## Module: conformance-fixtures

Files: `fixtures/valid/*.raa.prims.json`, `fixtures/refused/*.json`, `fixtures/expected.json`, `test/format/conformance.test.ts`.

Other implementations of the format are expected to pass these fixtures.

- Size: every fixture is <= 8 KB, except `fixtures/refused/cap_nodes.json` and `fixtures/refused/cap_colliders.json`. Those two must exceed a cap; they are written minified and may be up to 24 KB.
- `fixtures/valid/`: 11 canonical files, each byte-identical to its own canonical serialization. Together they cover:
  - one file per kind;
  - a wall with a subtract cylinder;
  - an intersect;
  - a host with two non-overlapping cutters;
  - nested union children under a uniformly scaled parent;
  - anchors;
  - a collision override;
  - non-default segments and budget;
  - a cone with each radius 0.
- `fixtures/refused/`: at least one file per RefusalCode, named `<code-lowercase>[-n].json`. Refused files need not be canonical. JSON_PARSE is a syntactically broken file, and NUMBER_NOT_FINITE uses `1e400`.
- `fixtures/expected.json`: `{valid: {<file>: {triangles}}, refused: {<file>: {codes: RefusalCode[] /* exact multiset, sorted */, nodes: string[] /* union of issue node ids, sorted */}}}`. The expectations come from the spec, never from tuning the code.

`conformance.test.ts` (also the project smoke test) asserts that:

- every valid file is ok with equal triangles, and `serializeRaaPrims(asset)` equals the file bytes;
- every refused file gives equal sorted codes and nodes;
- every RefusalCode appears in at least one refused entry.

## Module: proof-kit

Files: `proof/lib.ts`, `test/proof/lib.test.ts`.

```ts
export interface Measure { label: string; value: number | string | boolean; threshold: string; pass: boolean }
export interface ProofCheck { label: string; run(): Promise<Measure[]> }
export function measure(label: string, value: number, cmp: '<=' | '>=' | '<' | '>' | '==', threshold: number): Measure
export function flag(label: string, ok: boolean, detail: string): Measure
export function proofMode(argv?: string[]): 'quick' | 'full' // '--full' -> full
export function proofCpus(): number // integer PROOF_CPUS >= 1, default 1
export async function parallelMap<T, R>(items: readonly T[], fn: (item: T, index: number) => Promise<R>, limit?: number): Promise<R[]> // order-preserving, at most limit in flight
export async function runProof(checks: ProofCheck[], argv?: string[]): Promise<never>
```

`runProof` behaviour:

- `--only <regex>` filters the checks by label, case-insensitively. When nothing matches it prints `no check matches` and exits 2.
- It runs the selected checks in order and prints each measure as `PASS|FAIL  <label>  <value>  (threshold <threshold>)`.
- It exits 1 on the first FAIL. An exception exits 2 with the redacted message.
- At the end it prints `wall <ms> ms` and exits 0.

## Module: format-proof

File: `proof/format.ts`.

`node proof/format.ts [--only <regex>]` runs 4 checks:

- `m1.tests`: spawns `node --test test/format/` and parses the TAP summary. Threshold: fail == 0 and pass >= 1.
- `m1.conformance`: the conformance-fixtures assertions, counted. It reports the valid count, the refused count and the mismatches (== 0).
- `m1.roundtrip`: counts byte-identical files among the valid files (== the valid count), and checks that double serialization is stable.
- `m1.refusal-table`: prints `CODE | fixture | first message` for every RefusalCode. Threshold: codes without a fixture == 0.

## Module: manifest-format

This is the './manifest' entry. Browser-safe.

Files: `src/manifest/index.ts`, `src/manifest/manifest.ts`, `test/manifest/manifest.test.ts`.

```ts
export const MANIFEST_FORMAT = 'raa.manifest'; export const MANIFEST_VERSION = 0
export const LOGICAL_NAME_RE: RegExp // ^[a-z][a-z0-9_.-]{0,127}$
export interface ManifestEntry { sha256: string; size: number; contentType: string; version: number }
export interface RaaManifest { format: 'raa.manifest'; version: 0; name: string; entries: Record<string, ManifestEntry> }
export interface ManifestIssue { code: 'JSON_PARSE' | 'NOT_OBJECT' | 'BAD_FORMAT' | 'BAD_VERSION' | 'MISSING_FIELD' | 'UNKNOWN_FIELD' | 'BAD_TYPE' | 'BAD_NAME' | 'BAD_HASH' | 'BAD_SIZE' | 'BAD_CONTENT_TYPE' | 'BAD_ENTRY_VERSION'; path: string; message: string }
export function validateManifest(value: unknown): { ok: boolean; issues: ManifestIssue[]; manifest: RaaManifest | null }
export function parseManifest(text: string): { ok: boolean; issues: ManifestIssue[]; manifest: RaaManifest | null }
export function serializeManifest(m: RaaManifest): string // S6 canonical; RaaError('MANIFEST_INVALID') when invalid
export function contentTypeFor(fileName: string): string // S6 table, longest suffix first
```

BAD_SIZE means a size that is not an integer in 0..52428800.

## Module: store-client

This is the './node' entry, which re-exports hash, redact, store/types, store/local, store/open and store/gc. Node-only.

Files: `src/node/index.ts`, `src/node/hash.ts`, `src/node/redact.ts`, `src/node/store/types.ts`, `src/node/store/local.ts`, `src/node/store/open.ts`, `src/node/store/gc.ts`, `test/store/hash.test.ts`, `test/store/local.test.ts`, `test/store/select.test.ts`, `test/store/gc.test.ts`, `test/store/real.test.ts`.

```ts
// types.ts
export const OBJECT_MAX_BYTES = 52428800
export const STORE_DIR_DEFAULT = join(homedir(), '.raa-assets', 'store')
export interface StoreObject { sha256: string; size: number }
export interface PutResult extends StoreObject { created: boolean; key: string /* objectKey(sha256) */ }
export interface StoreStat { kind: 'local'; objects: number; bytes: number; freeBytes: number | null }
export interface AssetStore {
  readonly kind: 'local'
  put(data: Uint8Array): Promise<PutResult>
  get(sha256: string): Promise<Uint8Array> // re-hashes; RaaError('OBJECT_HASH_MISMATCH'|'OBJECT_NOT_FOUND')
  has(sha256: string): Promise<boolean>
  list(): Promise<StoreObject[]> // sorted by sha, '.'-prefixed temp files excluded
  stat(): Promise<StoreStat> // fs.statfs for freeBytes
  readRoot(name: string): Promise<string | null>; writeRoot(name: string, sha256: string): Promise<void>; listRoots(): Promise<Record<string, string>>
}
export function assertSize(size: number): void // RaaError('OBJECT_TOO_LARGE', '<size> bytes is over the 52428800-byte limit', 'keep objects under 50 MiB; split or compress the file')
// hash.ts
export function sha256Hex(data: Uint8Array | string): string
export async function sha256File(path: string): Promise<{ sha256: string; size: number }>
export function objectKey(sha256: string): string // 'objects/<2hex>/<sha>'; RaaError('BAD_HASH') unless /^[0-9a-f]{64}$/
// local.ts
export function localStore(root: string): AssetStore
// open.ts
export function storeFromEnv(env: Record<string, string | undefined>, opts?: { local?: string }): AssetStore // S7 selection; RaaError('NO_STORE')
// gc.ts
export async function gcPlan(store: AssetStore, keep: string[]): Promise<{ reachable: string[]; unreachable: StoreObject[]; unreachableBytes: number }> // roots + keep are manifests; reachable = those manifests + their entries
// redact.ts
export function redactSecrets(text: string, env?: Record<string, string | undefined>): string // masks any ASSET_STORE_SSH / ASSET_STORE_KEY values (and host / basename) still present in the environment
```

Rules:

- Every put calls `assertSize` before any write, then follows S7: temp file, rename, re-read verification.
- An existing object gives created=false and is not rewritten.
- Error messages never include absolute store paths of the default directory, hosts or keys.
- `select.test.ts` covers the selection precedence, the NO_STORE refusal, and the absence of any ssh or URL behaviour even with ssh-style env sentinels set.
- `real.test.ts` runs only when both `RAA_ASSETS_REAL_STORE=1` and `RAA_ASSETS_STORE_DIR` are set; its skip message names both. It never falls back to the default directory. It:
  1. puts a timestamped probe;
  2. re-hashes the raw file at `<dir>/<key>` and compares it with the put sha;
  3. checks that get returns identical bytes, that has is true and that `stat.kind` is 'local'.
- No test opens a socket or spawns ssh.

## Module: cli

Files: `src/cli/main.ts`, `src/cli/args.ts`, `src/cli/types.ts`, `src/cli/commands/put.ts`, `src/cli/commands/get.ts`, `src/cli/commands/ls.ts`, `src/cli/commands/stat.ts`, `src/cli/commands/manifest.ts`, `src/cli/commands/gc.ts`, `src/cli/commands/validate.ts`, `test/cli/cli.test.ts`, `docs/store.md`.

```ts
// types.ts
export interface CliIo { stdout(s: string): void; stderr(s: string): void; env: Record<string, string | undefined>; cwd: string }
export interface CliCommand { name: string; summary: string; usage: string; run(argv: string[], io: CliIo): Promise<number> }
// args.ts
export function parseArgs(argv: string[], spec: { flags: Record<string, 'boolean' | 'string' | 'string[]'> }): { positional: string[]; flags: Record<string, boolean | string | string[]> } // RaaError('USAGE') on unknown flags
// main.ts
export async function main(argv: string[], io?: CliIo): Promise<number>
```

`main.ts` behaviour:

- It discovers the command modules at run time by reading `new URL('./commands/', import.meta.url)`: `.ts` files from sources, `.js` files from dist. Each module exports `command: CliCommand`.
- It dispatches on argv[0]. `--help` lists the commands; an unknown command is UNKNOWN_COMMAND (exit 2).
- RaaError codes map to the exit codes of Conventions, and every message goes through `redactSecrets`.
- It runs as a bin (`#!/usr/bin/env node`) when it is the entry module.

The commands behave exactly as in S8. Store selection always goes through `storeFromEnv`, and there is no ssh or public-URL branch.

`cli.test.ts`:

- It spawns `node src/cli/main.ts` against a temp local store and covers put, get, ls, stat, manifest, manifest `--show`, `gc --dry-run`, validate, the `--json` shapes and the exit codes.
- It clears only `RAA_ASSETS_STORE_DIR` from the child env.
- Its NO_STORE case asserts NO_STORE with exit 2 only when `STORE_DIR_DEFAULT` (imported, not retyped) does not exist, and skips that assertion otherwise. No CLI test uses the default directory.

`docs/store.md` documents:

- the layout and the selection precedence, including the default path;
- that no credentials exist, and that outputs and evidence never contain absolute store paths;
- the command outputs and the exit codes;
- the opt-in test: `RAA_ASSETS_REAL_STORE=1 RAA_ASSETS_STORE_DIR=out/asset-store node --test test/store/real.test.ts`;
- the evidence command: `RAA_ASSETS_STORE_DIR=out/asset-store node proof/store-real.ts`;
- the publish step, when wanted: `cp -a out/asset-store/. /srv/assets/` (see `docs/store.md`, "Publishing a store").

It has no ssh, public URL, ASSET_STORE_* or CORS text.

## Module: store-proof

Files: `proof/store.ts`, `proof/store-real.ts`, `evidence/store-real.json`.

`node proof/store.ts [--only <regex>]` runs 5 checks. The cases that spawn processes run through `parallelMap`.

- `m2.local-roundtrip`: drives the CLI against a temp local store. Measured value: the mismatches (== 0).
  1. Put 2 files.
  2. get: the bytes are equal.
  3. manifest: the sha equals the sha256 of the stored manifest bytes, and the entries resolve.
  4. ls: count 3.
  5. stat: objects 3, and bytes equal the sum.
  6. `gc --dry-run` with the root: unreachable 0.
- `m2.cap`: a sparse file of 52428801 bytes (`fs.truncate`) is refused with exit 1 and OBJECT_TOO_LARGE, and the store stays empty (objects after == 0).
- `m2.atomic`:
  - a planted `.<sha>.tmp.x` file is not listed, and `get` of its sha fails;
  - a later put of the same bytes creates the object;
  - after a successful put the shard directory holds no dot-file (`m2.atomic.no-temp-left`).
- `m2.store-selection`: with `RAA_ASSETS_STORE_DIR=A` in the child env, a put with `--store B` lands in B and not in A, and a put without `--store` lands in A.
- `m2.real-store`: reads `evidence/store-real.json` (S11) and requires:
  - `store.kind == 'local'`;
  - `object.key == objects/<2hex>/<object.sha256>`;
  - `storedFile.sha256 == object.sha256`;
  - `get.sha256 == object.sha256` and `get.bytesEqual` true;
  - `manifest.storedFile.sha256 == manifest.sha256`;
  - `manifest.entrySha256 == object.sha256`;
  - `stat.objects >= 2`;
  - no secret: the text contains none of '@', 'BEGIN', '.ssh', 'id_', '/root/', '/home/'.

`proof/store-real.ts` needs `RAA_ASSETS_STORE_DIR` or `--store <dir>`. Without either it fails with USAGE; it never uses the default. It drives the CLI (spawning `src/cli/main.ts --json`):

1. It puts a timestamped probe text file from `os.tmpdir()`.
2. It re-hashes `<dir>/<key>`.
3. It gets the object with `-o` into tmp, re-hashes it and compares the bytes.
4. It runs `manifest --name m2.real-store probe=<file>` and re-hashes the stored manifest file.
5. It reads the entry sha with `manifest --show`.
6. It runs `stat`.
7. It writes `evidence/store-real.json` in the S11 shape, with no path.

## Module: git-guard

Files: `src/node/guard/rules.ts`, `src/node/guard/git.ts`, `src/node/guard/hook.ts`, `src/node/guard/install.ts`, `src/node/guard/index.ts`, `src/cli/commands/install-guard.ts`, `src/cli/commands/guard-check.ts`, `docs/private-assets.md`, `test/guard/rules.test.ts`, `test/guard/install.test.ts`, `test/guard/repo-clean.test.ts`.

The guard is exported from `src/node/guard/index.ts`, which is reached as `dist/node/guard/index.js`. `src/node/index.ts` does not re-export it, and there is no package subpath; the CLI is the public door.

```ts
export const GUARD_BLOCKED_EXTENSIONS: readonly string[] // ['.glb','.gltf','.png','.jpg','.jpeg','.avif','.ktx2','.bin']
export const GUARD_MAX_BYTES = 1048576
export const GUARD_MARKER = 'raa-assets-guard v1'
export interface GuardViolation { path: string; reason: 'asset-extension' | 'binary' | 'too-large'; size: number }
export function classifyBlob(path: string, size: number, head: Uint8Array /* first <= 8000 bytes */): GuardViolation | null // order: extension, too-large, binary
export async function stagedViolations(repo: string): Promise<GuardViolation[]> // S9 git commands
export async function trackedViolations(repo: string): Promise<GuardViolation[]> // git ls-files -z + index blobs
export function hookScript(): string // standalone ESM, '#!/usr/bin/env node', GUARD_MARKER, constants inlined, S9 message, exit 1/0
export async function installGuard(repo: string, opts?: { force?: boolean }): Promise<{ hookPath: string; action: 'installed' | 'updated' | 'unchanged'; backup: string | null }> // chmod 0755; GUARD_FOREIGN_HOOK without force; RaaError('NOT_A_REPO')
```

- The CLI commands are `install-guard <repo> [--force]` and `guard-check [<repo>] [--tracked]` (S8).
- `docs/private-assets.md`: why assets stay out of git, the local store, how to install the guard, and what to do when a commit is refused.
- `repo-clean.test.ts` fails when this repository's tracked or staged files violate S9. It is the test that fails if an asset is staged.

## Module: guard-proof

File: `proof/guard.ts`.

`node proof/guard.ts [--only <regex>]` runs its cases through `parallelMap`. Each case uses a throwaway repo: `git init` in a temp dir, a local user.name and email, then `node src/cli/main.ts install-guard <dir>`. It runs 5 checks:

- `m3.refuse-asset`: a staged `fake.png` (valid text bytes) makes `git commit` exit non-zero. The output names `fake.png: asset-extension`, and HEAD has not moved.
- `m3.refuse-binary-size`: a staged `data.dat` holding a NUL byte and a staged 1048577-byte text file are both refused, each with its reason.
- `m3.allow-normal`: a staged `a.ts` and `b.json` commit fine.
- `m3.install`: a reinstall gives 'unchanged'. A foreign pre-commit is refused with GUARD_FOREIGN_HOOK, and `--force` backs it up.
- `m3.repo-clean`: `guard-check --tracked` on this repository reports 0 violations.

## Module: vendor-pack

Files: `scripts/pack-vendor.ts`, `test/scripts/pack-vendor.test.ts`.

`node scripts/pack-vendor.ts <targetDir>` requires typescript to be installed in this repository. It:

1. Runs `tsc -p tsconfig.json` after cleaning dist.
2. Replaces targetDir with:
   - `dist/**`;
   - `schema/raa.prims.v0.schema.json`;
   - `LICENSE` and `README.md`;
   - a reduced `package.json` (name, version, type, license, exports, types, bin; no scripts, no devDependencies);
   - a `.gitignore` containing `!dist/`;
   - `VENDOR.json` = `{package, version, commit (git rev-parse HEAD), dirty (git status --porcelain non-empty), builtAt (ISO), files: {<relative path>: sha256}}`.
3. Refuses (exit 1) when any written file would be blocked by the S9 guard rules.

The npm package does not need this script; it is for applications that copy the package into their own tree.

The exported helper is `packVendor(srcRoot: string, targetDir: string, opts?: { skipBuild?: boolean }): Promise<{ files: number; commit: string }>`. The test runs the file-list and VENDOR.json logic on a fake dist in a temp dir.

## Proofs

Each proof prints one `PASS` or `FAIL` line per check and exits non-zero when a check fails. Missing files or fields are `FAIL` lines, never exceptions. `--only <regex>` runs the checks whose label matches.

- `node proof/format.ts`: format, validator and conformance fixtures (`format-proof`).
- `node proof/store.ts`: content-addressed store client and CLI (`store-proof`).
- `node proof/guard.ts`: git guard keeps assets and binaries out of repositories (`guard-proof`).
- `RAA_ASSETS_STORE_DIR=<dir> node proof/store-real.ts`: a real round trip in a store directory; writes `evidence/store-real.json`.
- `node runs/obstacles-v0/check.ts`: the example run, checked offline against its committed files.
