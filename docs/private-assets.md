# Keeping binaries out of git

Binary references and exported assets are never committed. The repository commits only a small JSON index of `{file, sha256}` (and `size`) that points into the content-addressed asset store. The bytes live outside git. A pre-commit guard enforces this, and its refusal message points to this page.

## Why assets stay out of git

- History is permanent and clones grow. A binary committed once stays in every clone forever, even after it is deleted.
- Binaries cannot be reviewed as diffs. A reviewer sees "binary files differ" and nothing else.
- Assets are versioned by sha256 in the store instead. An object is immutable and named by the hash of its bytes, so a changed asset is a new object and the old one is never overwritten.
- The rule: no asset or binary is committed to any repository. Captures, exported assets and authored source documents go to the store, or to a git-ignored `out/` directory. Committed evidence is JSON or markdown that records their sha256, byte size and store key.

`.gitignore` already ignores `out/` and the usual asset extensions (`*.glb`, `*.gltf`, `*.png`, `*.jpg`, `*.avif`, `*.ktx2`, `*.bin`). The guard below is the second line of defence: it also catches `.jpeg`, binary content and large files, and a forced `git add -f`.

## The store

The store is a local directory. See [store.md](store.md) for the layout, the store selection precedence (`--store`, then `RAA_ASSETS_STORE_DIR`, then the default directory if it exists) and the exit codes.

- `raa-assets put <file>...` hashes each file and stores it, deduplicated. The output line is `<sha256>  <size>  created|exists  <key>`.
- `raa-assets manifest --name <name> <logical>=<file>[@<version>]...` puts each file, then builds and puts a manifest that maps logical names to `{sha256, size, contentType, version}`.
- The object key is `objects/<2hex>/<sha256>`, where `<2hex>` is the first two hex characters of the sha256.

Reference an asset from committed JSON or markdown by recording its sha256, byte size and key, for example:

```json
{
  "file": "capture-01.png",
  "sha256": "<64 lowercase hex characters>",
  "size": 12345,
  "key": "objects/<2hex>/<sha256>"
}
```

Anyone with access to the store can fetch the bytes back with `raa-assets get <sha256> -o <file>`, and the hash is verified on the way out.

## What the guard refuses

A staged path is refused when any of these rules holds. The rules are checked in this order, and the first one that matches decides the reason.

| order | reason | rule |
|---|---|---|
| 1 | `asset-extension` | the last extension, compared case-insensitively, is one of `.glb` `.gltf` `.png` `.jpg` `.jpeg` `.avif` `.ktx2` `.bin` |
| 2 | `too-large` | the staged blob is over 1048576 bytes (1 MiB) |
| 3 | `binary` | the first 8000 bytes of the staged blob contain a NUL byte |

Only the last extension counts: `model.glb` and `SHOT.PNG` are refused, `notes.png.txt` is not (unless the content rules apply).

Sizes and content come from the STAGED blob (`git cat-file -s :<path>` and `git cat-file blob :<path>`), not from the working-tree file. Unstaged edits cannot hide a violation, and a clean working copy cannot excuse a staged one. Only added, copied, modified, renamed and type-changed paths are examined.

## Installing the guard

```
raa-assets install-guard <repo>
node src/cli/main.ts install-guard <repo>     # from sources, no build step
```

The hook is written to the `pre-commit` file in the repository's hooks directory (`git rev-parse --git-path hooks`) with mode 0755. The command reports the hook path and one action:

| action | meaning |
|---|---|
| `installed` | there was no pre-commit hook; ours was written |
| `updated` | our hook was already there with different content; it was rewritten |
| `unchanged` | our hook was already there with identical content; nothing was written |

A pre-commit hook that does not carry our marker is foreign. It is refused with `GUARD_FOREIGN_HOOK` and left untouched. `install-guard <repo> --force` first renames it to `pre-commit.bak-<n>` (so it is kept, though no longer run as `pre-commit`), then installs ours.

The hook is one standalone Node ESM script with the rules inlined. It carries the marker `raa-assets-guard v1`, which is how a reinstall recognises its own file. It needs only `node` and `git`, so it works on a machine where raa-assets is not installed.

## Checking without committing

```
raa-assets guard-check [<repo>] [--tracked] [--json]
```

Without `--tracked` it runs the rules on the staged files. With `--tracked` it runs them on every file git tracks (the index and `HEAD`), which finds anything that slipped in earlier. `<repo>` defaults to the current directory. `--json` prints exactly one JSON object on stdout.

| exit | meaning |
|---|---|
| 0 | clean, no violation |
| 1 | at least one violation; each is listed with its path, reason and size |
| 2 | usage error, or the directory is not a git repository |

## When a commit is refused

The hook prints each violation, then the fix line, and exits 1. Nothing is committed and `HEAD` does not move:

```
  <path>: <reason> (<size> bytes)
put it in the asset store (raa-assets put <path>) and reference its sha256; see docs/private-assets.md
```

To recover:

1. Unstage the file: `git restore --staged <path>`.
2. Store it: `raa-assets put <path>`. Note the sha256 and the size it prints.
3. Record the sha256, size and key in a committed JSON (or markdown) file in place of the binary.
4. If the file keeps showing up in `git status`, add its pattern to `.gitignore`, or move it under the git-ignored `out/`.
5. Commit again.

There is no bypass list and no per-file exception. Do not use `git commit --no-verify` to commit assets: the rule is that no asset or binary is ever committed to any repository, whatever the file and whatever the reason. If a file is flagged by mistake (for example a text file with a stray NUL byte), fix the file.

The guard can be skipped or removed locally, so there is a second net. `test/guard/repo-clean.test.ts` fails when any tracked or staged file of this repository violates the rules, and `raa-assets guard-check --tracked` reports the same violations on demand.
