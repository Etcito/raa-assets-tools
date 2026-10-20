# raa-assets-tools

Tools for **primitive assets**: a JSON format, `raa.prims`, that describes a shape as a tree of simple primitives (sphere, box, rounded box, capsule, cylinder, cone, torus, ellipsoid) with optional boolean cuts. The package provides:

- a validator that refuses malformed or over-budget files with stable error codes, and a canonical writer, so the same asset always produces the same bytes;
- a JSON Schema for editors and a set of conformance fixtures, valid and refused, that any other implementation can test against;
- a content-addressed asset store (a plain directory of files named by their SHA-256) and manifests that map logical names to stored files;
- the `raa-assets` command-line tool;
- a git guard that refuses commits of binaries and large files.

It has no runtime dependencies and does not depend on any game engine or editor.

Status: version 0.1.0. See [Status](#status).

## Requirements

- Node.js 22.18 or newer.

## Install

The package is not yet on the npm registry. Install it from a release tarball:

```sh
# download raa-assets-tools-<version>.tgz and SHA256SUMS from the GitHub Release, then:
sha256sum -c SHA256SUMS
npm install ./raa-assets-tools-0.1.0.tgz
npx raa-assets --help
```

Or from a clone, for development:

```sh
npm install
npm run build        # compiles src/ to dist/ (JavaScript and .d.ts)
npm test             # node --test over test/**
npm run typecheck    # tsc over src, test, proof, runs and scripts
```

## CLI

The example below uses only files that ship with the package (`fixtures/`). It stores them in `./out/store`, a directory inside the working tree that is git-ignored. Run it from the package root (or from the installed package directory):

```sh
# 1. Check an asset against the format
raa-assets validate fixtures/valid/sphere-spawn.raa.prims.json

# 2. Store it. The output gives the SHA-256, the size and the object key.
raa-assets put fixtures/valid/sphere-spawn.raa.prims.json --store ./out/store

# 3. Name it with a manifest (logical name -> stored file)
raa-assets manifest --name demo.assets sphere=fixtures/valid/sphere-spawn.raa.prims.json \
  --root main --store ./out/store

# 4. Read it back by hash; the bytes are verified on the way out
raa-assets get 48689566af2f03378a09539874bf123b64f8dce0ab988525822b2c3aadee17f9 \
  -o out/sphere.raa.prims.json --store ./out/store

# 5. List the store, and see what is no longer referenced by any root
raa-assets ls --store ./out/store
raa-assets gc --dry-run --store ./out/store
```

The hash in step 4 is the SHA-256 printed by step 2. Every command takes `--store <dir>` and `--json`. Without `--store`, the store is `RAA_ASSETS_STORE_DIR` if set, otherwise `~/.raa-assets/store` if that directory exists.

| command | purpose |
|---|---|
| `validate <file>...` | parse and check `raa.prims` files; exit 1 if any is refused |
| `put <file>...` | store files, deduplicated |
| `get <sha256> [-o <file>]` | read an object back and verify its hash |
| `ls`, `stat [<sha256>]` | list objects, or report the store or one object |
| `manifest --name <name> <logical>=<file>[@<version>]...` | store files and a manifest that names them; `manifest --show <sha256>` prints one |
| `gc --dry-run [--keep <sha256>]...` | report objects no root or kept manifest reaches (deletion is not implemented) |
| `guard-check [<repo>] [--tracked]`, `install-guard <repo>` | run or install the git guard |

Exit codes: 0 success; 1 a refused file or content error; 2 usage or configuration; 3 any other store or filesystem error. Error messages name the problem and give a fix on the next line.

## The `raa.prims` format

A file is UTF-8 JSON with these top-level keys, in canonical order: `format` (`"raa.prims"`), `version` (`0`), `id`, `name`, `budget` (`triangles`, `segments`), `nodes`, `materials`, `anchors` and `collision`. Units are metres, +Y is up, and quaternions are `[x, y, z, w]`.

The JSON Schema is `schema/raa.prims.v0.schema.json` (also exported as `@etcito/raa-assets-tools/schema`). It checks the structure only; the validator checks everything else (triangle budget, boolean-cut rules, collider consistency, numeric ranges). The rules are in [docs/format.md](docs/format.md), and the refusal codes are listed there too. `fixtures/valid/` and `fixtures/refused/` are the conformance cases; `fixtures/expected.json` lists the codes each refused case must produce.

## The asset store

The store is a single directory:

```
<store>/objects/<first 2 hex>/<sha256>    one immutable object, named by the SHA-256 of its bytes
<store>/roots/<name>                      a named root: one manifest SHA-256 and a newline
```

Objects are never overwritten. A manifest (`raa.manifest`) is an ordinary object: a JSON map from logical names to `{sha256, size, contentType, version}`. The store has no credentials, no network code and no delete command. To publish a store, copy the directory unchanged to any static file server that serves `objects/`. Details, including the manifest and CLI reference, are in [docs/store.md](docs/store.md).

## Keeping assets out of git

Binaries (`.glb`, `.png`, ...) and large files are stored in the asset store, and the repository keeps only their hashes. `raa-assets install-guard <repo>` installs a pre-commit hook that refuses such files, and `raa-assets guard-check --tracked` audits a repository. See [docs/private-assets.md](docs/private-assets.md).

## Documentation

- [docs/format.md](docs/format.md): the `raa.prims` rules and refusal codes, for implementers
- [docs/store.md](docs/store.md): manifest format, store layout, CLI reference
- [docs/private-assets.md](docs/private-assets.md): the git guard
- [ARCHITECTURE.md](ARCHITECTURE.md): contracts, module boundaries and proofs

## Example data

`runs/` holds a recorded authoring run that produced sample assets. It is example data, not part of the library; see [runs/README.md](runs/README.md). The conformance cases in `fixtures/` are also sample content: their names and values are examples chosen to exercise the rules.

## Proofs

The `proof/` scripts check the format, the store and the guard end to end and print one `PASS` or `FAIL` line per check:

```sh
node proof/format.ts
node proof/store.ts
node proof/guard.ts
node runs/obstacles-v0/check.ts
```

`proof/store-real.ts` writes a real round-trip record to `evidence/store-real.json` when run against a store directory given with `--store`.

## Status

- 0.1.0. The `raa.prims` format is version 0 and may change before version 1; the `version` field exists so that files can say which rules they follow.
- Implemented: the format, validator, canonical writer, manifests, local store, CLI, git guard.
- Not implemented: remote stores, object deletion (`gc` is a dry run), a graphical editor, mesh generation.
- Tests: `npm test` passes 271 tests. The skips are the opt-in real-store test (it needs `RAA_ASSETS_REAL_STORE=1`) and, on Windows, the POSIX file-mode check of the hook.

## Licence

MIT. See [LICENSE](LICENSE).

## Secrets

The tools read no credentials. Output, logs and committed evidence never contain absolute paths, hosts, users or keys.
