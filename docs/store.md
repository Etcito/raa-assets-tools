# Asset store, manifest and CLI reference

This page documents the manifest format (`src/manifest/`), the content-addressed store (`src/node/`) and the `raa-assets` CLI (`src/cli/`). The asset store is a local directory only. No remote store, network path or store credential exists in this project.

Run the CLI from sources with `node src/cli/main.ts <command>`. The built bin is `raa-assets` (`dist/cli/main.js`). `node src/cli/main.ts --help` lists the commands, and `<command> --help` prints the usage line of one command. File paths and the `--store` directory resolve against the current working directory.

## Manifest format

A manifest is a UTF-8 JSON object stored as an ordinary object in the store. It has exactly these fields, in this canonical order:

| field | type | rule |
|---|---|---|
| `format` | string | exactly `raa.manifest` (`MANIFEST_FORMAT`) |
| `version` | integer | exactly `0` (`MANIFEST_VERSION`) |
| `name` | string | matches `LOGICAL_NAME_RE` |
| `entries` | object | logical name (matches `LOGICAL_NAME_RE`) -> entry |

`LOGICAL_NAME_RE` is `^[a-z][a-z0-9_.-]{0,127}$`. An entry has exactly these fields, in this order:

| field | type | rule |
|---|---|---|
| `sha256` | string | 64 lowercase hex characters |
| `size` | integer | bytes, 0..52428800 (`BAD_SIZE` otherwise) |
| `contentType` | string | `type/subtype`, normally from `contentTypeFor` |
| `version` | integer | >= 1, the revision of that logical asset |

Unknown fields are refused with `UNKNOWN_FIELD`. `validateManifest` and `parseManifest` never throw; they return `{ok, issues, manifest}`. The issue codes are JSON_PARSE, NOT_OBJECT, BAD_FORMAT, BAD_VERSION, MISSING_FIELD, UNKNOWN_FIELD, BAD_TYPE, BAD_NAME, BAD_HASH, BAD_SIZE, BAD_CONTENT_TYPE and BAD_ENTRY_VERSION. `serializeManifest` is the only producer of manifest bytes. It throws `RaaError('MANIFEST_INVALID')` on an invalid manifest. Otherwise it sorts the entries by key, indents with 2 spaces and ends the text with one LF.

`contentTypeFor(fileName)` compares the file name in lower case. It picks the longest matching suffix first:

| suffix | contentType |
|---|---|
| `.raa.prims.json` | `application/vnd.raa.prims+json` |
| `.sdfm.json` | `application/vnd.sdfm+json` |
| `.json` | `application/json` |
| `.png` | `image/png` |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.glb` | `model/gltf-binary` |
| anything else | `application/octet-stream` |

The game fetches a manifest by its sha256 and then each entry by its sha256.

### Canonical example

Generated on a temporary store with two small files: `f1.json` (`{"a":1}` and a newline) and `f2.txt` (`hello` and a newline). The command was `manifest --name m2.example a.one=f1.json b.two=<f2.txt at version 3> --root main --store <tmp>` (the second spec uses the `<file>@<version>` form). The block below is the verbatim output of `manifest --show <sha256> --store <tmp>`:

```json
{
  "format": "raa.manifest",
  "version": 0,
  "name": "m2.example",
  "entries": {
    "a.one": {
      "sha256": "e346432021b04179518d9614f3560ccd71354a4ee101ddcb893d6959a9d6301c",
      "size": 8,
      "contentType": "application/json",
      "version": 1
    },
    "b.two": {
      "sha256": "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
      "size": 6,
      "contentType": "application/octet-stream",
      "version": 3
    }
  }
}
```

These bytes (464 bytes) have the sha256 `6bf6ea2f0bbc4f588409509ef8f13d76ddffc0ae6df5298becf5e4a322faae2b`.

## Store layout

A store is one directory (`localStore(root)`):

```
<root>/objects/<first 2 hex>/<sha256>    one immutable object, named by the sha256 of its bytes
<root>/roots/<name>                      a named GC root: one manifest sha256 and a newline
```

- `objectKey(sha256)` gives the relative key `objects/<2hex>/<sha256>`. It throws `BAD_HASH` unless the hash matches `^[0-9a-f]{64}$`. The CLI reports this key, never an absolute path.
- A root name matches `LOGICAL_NAME_RE` (`BAD_ROOT_NAME` otherwise).
- The layout is the same as the store the game serves from, so a plain copy of the directory works unchanged (see "Copy to the owner's store" below).
- Objects are immutable. A put of an object that is already there writes nothing and returns `created: false`.
- Size cap: `OBJECT_MAX_BYTES` = 52428800 (50 MiB). `assertSize(size)` throws `OBJECT_TOO_LARGE` (`<size> bytes is over the 52428800-byte limit`, fix `keep objects under 50 MiB; split or compress the file`). The CLI checks it on the `fs.stat` size before it reads the file. `put` checks it again before any write. A 52428801-byte file is therefore refused without being read, and the store stays unchanged.

### The put sequence

`store.put(data)` writes an object atomically:

1. `assertSize(data.byteLength)`, before anything else.
2. `sha256 = sha256Hex(data)`, `key = objectKey(sha256)`.
3. If `<root>/<key>` exists, return `{sha256, size, created: false, key}`.
4. Create the shard directory `objects/<2hex>/`.
5. Write the bytes to the temp file `objects/<2hex>/.<sha256>.tmp.<nonce>` (12 random hex characters).
6. Read the temp file back and hash it again. On a mismatch, remove the temp file and throw `OBJECT_HASH_MISMATCH`.
7. Rename the temp file to its final name, `objects/<2hex>/<sha256>`, and return `{sha256, size, created: true, key}`.

On any failure the temp file is removed. Names that start with `.` are never listed and never counted, so an interrupted put cannot show up as an object. `writeRoot` uses the same temp-then-rename for `roots/<name>`.

Reads: `get(sha256)` reads the file and re-hashes it (`OBJECT_HASH_MISMATCH` on corruption, `OBJECT_NOT_FOUND` when missing). `list()` is sorted by sha256. `stat()` gives `{kind: 'local', objects, bytes, freeBytes}`, where `freeBytes` comes from `fs.statfs` on the store directory (or its nearest existing parent).

## Store selection

`storeFromEnv(env, {local})` picks the store in this order:

1. `--store <dir>` (resolved against the current directory);
2. env `RAA_ASSETS_STORE_DIR`;
3. `STORE_DIR_DEFAULT` = `/root/nmc/asset-store/royal-fiesta`, but only if that path already exists as a directory;
4. otherwise `NO_STORE` (exit 2): `no asset store is configured and the default store directory does not exist`, fix `pass --store <dir> or set RAA_ASSETS_STORE_DIR`.

An explicit `--store` or `RAA_ASSETS_STORE_DIR` directory is created on the first write. Tests and proofs never use the default directory: they always pass `--store` or `RAA_ASSETS_STORE_DIR`.

| variable | meaning |
|---|---|
| `RAA_ASSETS_STORE_DIR` | store directory when `--store` is not given |
| `RAA_ASSETS_REAL_STORE` | `1` turns on the opt-in real-store test (with `RAA_ASSETS_STORE_DIR` set) |

### No credentials, no absolute paths

The store needs no credential, and the code reads no secret from the environment. Command output, evidence files and committed docs never contain an absolute store path, a host, a user or a key path. Outputs name objects by sha256 and by relative key only, and the store by its kind (`local`). Error text and every message `main` prints still go through `redactSecrets` as a safety net.

## Commands

Every store command takes `--store <dir>` and `--json`. With `--json` it prints exactly one JSON object followed by a newline on stdout. Errors go to stderr as `error <CODE>: <message>` and then `  fix: <fix>`. The examples below are real output from the temporary store of the manifest example; `<free>` stands for the free-byte count of the host.

### Exit codes

| exit | meaning | codes (`src/cli/main.ts`) |
|---|---|---|
| 0 | ok | |
| 1 | refused | `OBJECT_TOO_LARGE`, `OBJECT_HASH_MISMATCH`, `MANIFEST_INVALID`, `ASSET_INVALID`, `GC_ROOT_NOT_MANIFEST`; `validate` with a refused file |
| 2 | usage | `USAGE`, `UNKNOWN_COMMAND`, `NO_STORE`, `BAD_HASH`, `BAD_ROOT_NAME`, `GC_DELETE_UNAVAILABLE`; no command given |
| 3 | store, filesystem or internal error | every other code, e.g. `OBJECT_NOT_FOUND`, `FILE_READ_FAILED`, `FILE_WRITE_FAILED`, `GC_ROOT_MISSING`, `INTERNAL` |

`--help` exits 0. Running with no command prints the command list and exits 2.

### put

Usage: `raa-assets put <file>... [--store <dir>] [--json]`

For each file it runs `fs.stat` and `assertSize` before reading the file, then calls `store.put`. A put of an existing object reports `exists`. With no file it fails with `USAGE`.

```
e346432021b04179518d9614f3560ccd71354a4ee101ddcb893d6959a9d6301c  8  created  objects/e3/e346432021b04179518d9614f3560ccd71354a4ee101ddcb893d6959a9d6301c
store local: 1 objects, 8 bytes
```

JSON: `{objects: [{file, sha256, size, created, key}], store: {kind, objects, bytes, freeBytes}}`

```json
{"objects":[{"file":"f1.json","sha256":"e346432021b04179518d9614f3560ccd71354a4ee101ddcb893d6959a9d6301c","size":8,"created":false,"key":"objects/e3/e346432021b04179518d9614f3560ccd71354a4ee101ddcb893d6959a9d6301c"}],"store":{"kind":"local","objects":1,"bytes":8,"freeBytes":<free>}}
```

A file over the cap gives `error OBJECT_TOO_LARGE: 52428801 bytes is over the 52428800-byte limit` (exit 1).

### get

Usage: `raa-assets get <sha256> [-o|--out <file>] [--store <dir>] [--json]`

It reads the object from the store and re-hashes it (`OBJECT_HASH_MISMATCH` exit 1, `OBJECT_NOT_FOUND` exit 3, a malformed hash `BAD_HASH` exit 2). Without `--out`, the raw bytes go to `process.stdout` (binary-safe; `--json` has no effect). With `--out` it creates the parent directories and writes the file:

```
6bf6ea2f0bbc4f588409509ef8f13d76ddffc0ae6df5298becf5e4a322faae2b  464  out/m
```

JSON: `{sha256, size, file}`

```json
{"sha256":"6bf6ea2f0bbc4f588409509ef8f13d76ddffc0ae6df5298becf5e4a322faae2b","size":464,"file":"out/m"}
```

### ls

Usage: `raa-assets ls [--store <dir>] [--json]`

It prints one `<sha256> <size>` line per object, sorted by sha256, then a total. Temp files are not listed.

```
5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03 6
6bf6ea2f0bbc4f588409509ef8f13d76ddffc0ae6df5298becf5e4a322faae2b 464
e346432021b04179518d9614f3560ccd71354a4ee101ddcb893d6959a9d6301c 8
total 3 objects, 478 bytes
```

JSON: `{objects: [{sha256, size}], count, bytes}`

### stat

Usage: `raa-assets stat [<sha256>] [--store <dir>] [--json]`

Without an argument it reports the whole store:

```
kind local
objects 3
bytes 478
freeBytes <free>
```

JSON: the `StoreStat` object `{kind, objects, bytes, freeBytes}` (`freeBytes` is `unknown` in text and `null` in JSON when it is not available).

With a sha256 it reports one object, taking the size from the listing. A missing object is `OBJECT_NOT_FOUND` (exit 3).

```
sha256 6bf6ea2f0bbc4f588409509ef8f13d76ddffc0ae6df5298becf5e4a322faae2b
size 464
key objects/6b/6bf6ea2f0bbc4f588409509ef8f13d76ddffc0ae6df5298becf5e4a322faae2b
present true
```

JSON: `{sha256, size, key, present}`

### manifest

Usage:

```
raa-assets manifest --name <name> <logical>=<file>[@<version>]... [--root <rootName>] [--store <dir>] [--json]
raa-assets manifest --show <sha256> [--store <dir>] [--json]
```

Build mode:

- Each spec is split on its first `=`. An optional trailing `@<integer>` sets the version (default 1).
- Each file is size-checked before it is read, then put. Its entry is `{sha256, size, contentType: contentTypeFor(file), version}`.
- The manifest is serialized with `serializeManifest` and put as UTF-8 bytes. An invalid manifest (for example a bad logical name) gives `MANIFEST_INVALID` (exit 1).
- `--root <rootName>` writes `roots/<rootName>`.
- A missing `--name`, a missing spec, a malformed spec or a logical name given twice is `USAGE` (exit 2).

```
manifest 6bf6ea2f0bbc4f588409509ef8f13d76ddffc0ae6df5298becf5e4a322faae2b  464  objects/6b/6bf6ea2f0bbc4f588409509ef8f13d76ddffc0ae6df5298becf5e4a322faae2b
  a.one e346432021b04179518d9614f3560ccd71354a4ee101ddcb893d6959a9d6301c 8 application/json v1
  b.two 5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03 6 application/octet-stream v3
```

JSON: `{name, sha256, size, key, root: string|null, entries}`, where `entries` maps each logical name to its entry.

Show mode (`--show <sha256>`) gets the object, checks its hash, parses it with `parseManifest` and prints the canonical manifest text (see the example above). An object that is not a valid manifest gives `MANIFEST_INVALID` with the first issue (exit 1). JSON: `{sha256, manifest}`.

### gc

Usage: `raa-assets gc --dry-run [--keep <sha256>]... [--store <dir>] [--json]`

`gcPlan(store, keep)` treats every root and every `--keep` sha as a manifest. The reachable objects are those manifests plus their entries; every other object is unreachable. A root or kept sha that is missing gives `GC_ROOT_MISSING` (exit 3). One that is not a manifest gives `GC_ROOT_NOT_MANIFEST` (exit 1).

```
reachable 3
unreachable 0 objects, 0 bytes
```

Each unreachable object adds one `<sha256> <size>` line before the total. JSON: `{roots, keep, reachable, unreachable: [{sha256, size}], unreachableBytes}`, where `roots` maps a root name to its sha and `reachable` is a count.

Without `--dry-run` nothing is deleted: `error GC_DELETE_UNAVAILABLE: deleting objects is not available`, fix `run raa-assets gc --dry-run` (exit 2).

### validate

Usage: `raa-assets validate <file>... [--json]`

It runs `parseRaaPrims` on each file (no store is opened). It exits 1 if any file is refused.

```
ok fixtures/valid/capsule-cylinder.raa.prims.json  triangles 316/1500
```

A refused file prints `refused <file>` and then one `  <CODE> <path>: <message>` line per issue. JSON: `{files: [{file, ok, triangles, budget, issues: [{code, path, message}]}]}`.

### Adding a command

Add one file `src/cli/commands/<name>.ts` that exports `command: CliCommand` (`{name, summary, usage, run(argv, io)}`). `main.ts` finds the command files when it runs (`.ts` from sources, `.js` from `dist/`), so `main.ts` needs no change. Parse flags with `parseArgs` from `../args.ts`, and open the store with `storeFromEnv(io.env, {local})`.

## Regeneration and verification

| command | what it does |
|---|---|
| `node --test test/store/ test/manifest/ test/cli/` | store, manifest and CLI tests on temp directories. On some Node versions a bare directory argument does not collect `.ts` files; then use globs, e.g. `node --test "test/cli/**/*.test.ts"` |
| `RAA_ASSETS_REAL_STORE=1 RAA_ASSETS_STORE_DIR=out/asset-store/royal-fiesta node --test test/store/real.test.ts` | opt-in real-store test: puts a timestamped probe, checks the raw file hash at `<dir>/<key>`, `get`, `has` and `stat().kind`. It is skipped unless both variables are set and never falls back to the default directory |
| `RAA_ASSETS_STORE_DIR=out/asset-store/royal-fiesta node proof/m2-real-store.ts` | writes `evidence/m2-real-store.json` |
| `node proof/m2.ts [--only <regex>]` | milestone proof: `m2.local-roundtrip`, `m2.cap`, `m2.atomic`, `m2.store-selection`, `m2.real-store` (offline; it checks the committed evidence) |

`out/` is git-ignored, so no object bytes reach git.

### Real-store evidence

`evidence/m2-real-store.json` comes from a real round trip in the store directory:

- a probe object is put;
- its raw stored file is re-hashed, and the object is read back with `get`;
- a one-entry manifest that references the probe is put and its stored file re-hashed;
- the store `stat` is recorded.

The file records `{store: {kind, layout, isDefaultDir}, object: {sha256, size, created, key}, storedFile: {sha256}, get: {sha256, size, bytesEqual}, manifest: {sha256, size, key, storedFile: {sha256}, entrySha256}, stat: {objects, bytes}, recordedAt}`. It holds no absolute path, host, user or key. `m2.real-store` checks the shas and the key, and scans the file for absolute paths and secret patterns.

### Copy to the owner's store

The real-store run writes into the worktree. Merge it into the default store with:

```
cp -a out/asset-store/royal-fiesta/. /root/nmc/asset-store/royal-fiesta/
```

Objects are immutable and content-addressed, so the copy merges safely. The owner then copies that directory to the game's store root unchanged. When `RAA_ASSETS_STORE_DIR` points at the default directory itself, no copy is needed.
