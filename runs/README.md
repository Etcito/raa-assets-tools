# Example data: the obstacles-v0 run

Everything under `runs/` is **example data**. It is a recorded authoring run kept as a worked example of the format and the store. It is not part of the library, and the library never reads it except through `runs/obstacles-v0/check.ts`, which checks the committed files offline.

The run authored 11 small obstacle assets (plus one character asset) for a sample game, named `rf.obstacle.<name>` and `rf.character.bean`. The names, budgets and shapes are sample content. Nothing in `src/`, `schema/` or `docs/` depends on them.

## Files

- `spec.json`: `{assets: [{name, logical, id, file, footprint: Vec3, anchors: string[], budget: 1500, moving: boolean, notes}]}`, 11 entries. `logical` is `rf.obstacle.<name>` or `rf.character.bean`, and `id` equals `logical`. A moving part is a root node with id `moving`, placed at its pivot anchor.
- `recipes/<name>.calls.json`: an ordered array of `{tool, input}` calls made to an external SDF modeling tool through its MCP interface. The tool is not part of this package. Each asset is built in four steps:
  1. `doc_new`;
  2. ONE `node_add_batch` (parent-reference-only nesting, node colours);
  3. `doc_save` to `out/obstacles-v0/<name>.sdfm.json`;
  4. `export_raa_prims` with `{out: out/obstacles-v0/<name>.raa.prims.json, id, budget: 1500[, segments]}`.
- `recipes/contact-sheet.calls.json`: composes the 11 batches under grid groups and ends with `render_views` on a GPU client.
- Store: the `raa.prims` files, the source documents, the manifest and the contact sheet are put through the CLI with `RAA_ASSETS_STORE_DIR`. The manifest is the GC root `rf.assets.obstacles-v0`.
- `evidence.json`: the S11 shape of `ARCHITECTURE.md`, with `{run, toolsCommit, sdfmCommit, store, assets: [...], manifest, contactSheet}`. It holds no URL, no absolute path and no `@`.
- `manifest.json`: the exact stored bytes of the manifest `rf.assets.obstacles-v0`, 22 entries at version 1: `<logical>` -> the `raa.prims` file, and `<logical>.source` -> the source document.
- `report.md`: the triangle table, the manifest and contact-sheet hashes and keys, a public-fetch check, and the regeneration commands.
- `dogfood.md`: a log of what broke during the run, what was done by hand, and what the orchestration should do instead.

The logs describe the orchestration that ran the example. Its environment variables are shown as `ORCH_*`, and its private packages and sibling checkouts are shown as placeholders.

## Check

```
node runs/obstacles-v0/check.ts [--only <regex>]
```

It runs offline and prints one `PASS` or `FAIL` line per check:

- `m6.assets`: the evidence names equal the 11 spec names, the ids and logical names match, and every spec anchor is included.
- `m6.budget`: the worst triangles/budget ratio is <= 1, and every budget is 1500.
- `m6.manifest`: `parseManifest` is ok; the sha256 and size of `manifest.json` equal the evidence; the 22 entries equal the evidence; every entry is <= `OBJECT_MAX_BYTES`.
- `m6.store`: the store kind is local; the keys equal `objectKey(sha)`; the stored manifest file matches the manifest sha.
- `m6.review`: the contact sheet has a 64-hex sha and a matching key, a GPU renderer is recorded, `report.md` and `dogfood.md` are non-empty, and the evidence contains no secret pattern or absolute path.
