# Royal Fiesta obstacles v0: authoring run report

Run `obstacles-v0`. Tools commit `e5a624497ef8f59ff8ee276c32740a353275f1f2`, SDF Modeler (sdfm) commit `a6caa04d4909ac9aa8395d273da9a0c4ff1b3b26`. Sources: `evidence.json`, `spec.json`, `manifest.json` and `recipes/` in this directory. Store kind `local`, layout `objects/<2hex>/<sha256>`.

## 1. Triangles

Every budget is 1500 triangles at LOD0. Ratio = triangles / budget. Worst: gap-platform, 944/1500 = 0.629. sha256 and size are for the `.raa.prims.json` export. The source sha256 is for the `.sdfm.json` document. Store keys are `objects/<first 2 hex>/<sha256>`.

| name | logical | triangles | budget | ratio | nodes | anchors | sha256 | size | source sha256 |
|---|---|---:|---:|---:|---:|---|---|---:|---|
| spinning-bar | `rf.obstacle.spinning-bar` | 640 | 1500 | 0.427 | 6 | pivot | `391f050fb8a6793aebf3bbe627bb4e8196a4db5f8da7bf49818059f665b6de6a` | 3962 | `6c0fafc8029d1235a0ff89b77090ae420597fed76da93ba5be177789202d17a1` |
| pendulum-hammer | `rf.obstacle.pendulum-hammer` | 404 | 1500 | 0.269 | 8 | pivot | `da1919e19472d3f85b3cecfe71a8da052ed08826d836983c0208ec9e61e2df36` | 4929 | `aa412ec823972de31ee07e05b5970267f17c42740a1267e233a0ea8242d2070f` |
| see-saw | `rf.obstacle.see-saw` | 96 | 1500 | 0.064 | 4 | pivot | `d75a27c1b10949f38ee06d63c76e9458dc080031fb523d6538fe7772003bf9b0` | 2858 | `c7339562cff63480c5c8fbbbbdfba5cc9bb6597c7f97ae7081ba4f99d3169a62` |
| rotating-door | `rf.obstacle.rotating-door` | 132 | 1500 | 0.088 | 7 | pivot | `e1434ed50843526994a7b2df8debb2ae1260a13497eece4fe48a46049d2b85e2` | 4398 | `5ce2d70b018719443927e4b1a3f8ba08f52a7ee3bb76dd0678a5c65298db4366` |
| swinging-gate | `rf.obstacle.swinging-gate` | 556 | 1500 | 0.371 | 7 | hinge | `d02686c32f1de02040b57db7ba9670d93ee447345793d8db6f4a017f42298ae1` | 4372 | `862f6d2af74161eedf3a5b9b9dbf3c3fc11106db716cdf73eb8457711b055056` |
| bouncy-pad | `rf.obstacle.bouncy-pad` | 376 | 1500 | 0.251 | 3 | bounce | `13e76487c234389ec9de04caced0685466c7f5142e5d960e5b709fa8402411e1` | 3912 | `2e3073dc90f5c379897e16a3f9a5fdc5dde8b5ade59ae9843629d4e0a81e4782` |
| conveyor-belt | `rf.obstacle.conveyor-belt` | 566 | 1500 | 0.377 | 8 | beltEnd, beltStart | `846d7162a48ac5c2297d53a407758b64d3aec2a6379b338125bc15a717cb02e7` | 5259 | `5aa07b6cf92c0b5e665c4c1d1345de39c65be57338938b76d116ce83a9a14092` |
| gap-platform | `rf.obstacle.gap-platform` | 944 | 1500 | 0.629 | 5 | landing | `429e5892e0b2549897dc5dd6c650b7dcaa65068608cc150d5e814b645efa457a` | 5008 | `c55642671d62213c1836e289de21b1e7bd3792e8722845454b347d28f05605b0` |
| wall-with-hole | `rf.obstacle.wall-with-hole` | 156 | 1500 | 0.104 | 4 | passage | `f163d7d447690b3b3d19e9ce07dbfe5296c6ca35e334326758d9ba15114cdda3` | 2446 | `587487755c6b453912150868c1cdc8e41d1e3610ceb6cd19fd702739fbc4168d` |
| start-finish-arch | `rf.obstacle.start-finish-arch` | 508 | 1500 | 0.339 | 7 | line | `340def5a56f4e71b20947f0a787689ecbbe12bd10c003abff31fef2417bb99c2` | 4318 | `db495e4fb41e43925682a6e5a09493774e84b20cb99582d02b523650e2b5aa46` |
| bean | `rf.character.bean` | 912 | 1500 | 0.608 | 7 | handL, handR, head, spawn | `dfebaea3a2ae5801ee4e943de3ce9517ccaddeccf4b91eb5d7ca7123d747d292` | 4532 | `5861b3c0671e1cb87c488c0ca213148cdea9df4e22bc63bb3c2745e7b661b05d` |

## 2. Manifest

| field | value |
|---|---|
| name | `rf.assets.obstacles-v0` |
| sha256 | `e9f5556a27e86135ec388c73ea16487cc26ad2db7b8683bcc4531d76be402317` |
| size | 4940 bytes |
| store key | `objects/e9/e9f5556a27e86135ec388c73ea16487cc26ad2db7b8683bcc4531d76be402317` |
| GC root | `roots/rf.assets.obstacles-v0` (root name `rf.assets.obstacles-v0`) |
| entries | 22 (`<logical>` -> raa.prims, `<logical>.source` -> sdfm document, all version 1) |

`manifest.json` in this directory holds the exact stored bytes. The stored file and `raa-assets get` both hash to the manifest sha256 above.

## 3. Contact sheet (owner review item Q11(a))

Rendered on 2026-10-18 at 08:21 UTC on the GPU client. The sdfm `render_views` tool ran as a job on the host at `ORCH_GPU_URL` and returned `renderer=host-webgpu`. The value is copied from the tool result, not written by hand. No Node/Dawn render was used.

| field | value |
|---|---|
| sha256 | `e152f8e8d1093190c4632bd20c0febd2dcd3db49a8edb820f357a4ed4398ad4f` |
| size | 52210 bytes (PNG, 1536 × 792: two 768 × 768 cells, `iso` and `front`, `shaded`, with 24 px captions) |
| store key | `objects/e1/e152f8e8d1093190c4632bd20c0febd2dcd3db49a8edb820f357a4ed4398ad4f` |
| renderer | `host-webgpu` |
| URL | none yet (`url: null` in `evidence.json`): the store is local-only. After the owner copy (section 4) the sheet is served at `https://assets.etcito.com/objects/e1/e152f8e8d1093190c4632bd20c0febd2dcd3db49a8edb820f357a4ed4398ad4f` |

The sheet is a review object only. It is not a manifest entry, and the PNG is not committed. All 11 assets are visible in the iso cell, laid out on the 10 m grid of `recipes/contact-sheet.calls.json`. The owner review of colours and shapes is open until the owner has looked at the sheet.

Render command (step 3 of section 5), from the root of this repository with the scratch sdfm at `$SDFM`:

```sh
# GPU env exactly as the card provides it: ORCH_GPU_URL, ORCH_GPU_TOKEN, ORCH_GPU_PROJECT, ORCH_GPU_CLIENT, HTTP_PROXY, NO_PROXY.
# Page target: ORCH_GPU_PAGE_REF if set; otherwise ORCH_GPU_REVISION is unset, so sdfm publishes its own page through ORCH_GPU_CLIENT.
env -u ORCH_GPU_REVISION ORCH_GPU_TIMEOUT_MS=240000 \
  node "$SDFM/bin/sdfm.mjs" call render_views --doc out/obstacles-v0/contact-sheet.sdfm.json \
  --input '{"views":["iso","front"],"width":768,"height":768,"mode":"shaded","out":"out/obstacles-v0/contact-sheet.png"}' --save
RAA_ASSETS_STORE_DIR=<store dir> node src/cli/main.ts put out/obstacles-v0/contact-sheet.png
```

The `render_views` line printed `render_views out/obstacles-v0/contact-sheet.png (1536x792); cells row-major: 1=iso, 2=front; renderer=host-webgpu`. The `put` line printed `e152f8e8d1093190c4632bd20c0febd2dcd3db49a8edb820f357a4ed4398ad4f  52210  created  objects/e1/e152f8e8d1093190c4632bd20c0febd2dcd3db49a8edb820f357a4ed4398ad4f`. Like the batch cards, it used `RAA_ASSETS_STORE_DIR=out/asset-store`, because `STORE_DIR_DEFAULT` does not exist in the sandbox.

## 4. Store notes

- The run uses the default local store directory, `STORE_DIR_DEFAULT` (the path is in docs/store.md, section on store selection). That directory did not exist in the authoring sandboxes, so every batch put into `RAA_ASSETS_STORE_DIR=out/asset-store` instead. Objects are content-addressed, so the keys and sha256 values are the same. docs/store.md gives the merge step into the default directory.
- The owner copies the default store directory **unchanged** to the VM store root. Objects are immutable `objects/<2hex>/<sha256>` files, and `roots/rf.assets.obstacles-v0` holds the manifest sha256.
- Then the owner runs the public check:

  ```sh
  curl -sI https://assets.etcito.com/objects/e9/e9f5556a27e86135ec388c73ea16487cc26ad2db7b8683bcc4531d76be402317
  curl -s https://assets.etcito.com/objects/e9/e9f5556a27e86135ec388c73ea16487cc26ad2db7b8683bcc4531d76be402317 | sha256sum
  ```

  The first command must answer `HTTP/... 200` with an immutable `cache-control` (e.g. `public, max-age=31536000, immutable`) and an `access-control-allow-origin` header. The second must print `e9f5556a27e86135ec388c73ea16487cc26ad2db7b8683bcc4531d76be402317`, the same as `manifest.json`.
- **The agent did not run this HTTP check.** Since the M2 amendment the store is local-only: the agent has no ssh store, no public-URL client and no network route to assets.etcito.com. `m6.store` checks only local facts (the stored-file hash, the `get` hash and the keys).

## 5. Regeneration

Step 0: make a runnable scratch sdfm at the sdfm commit above (dogfood items 2, 11 and 24). The siblings must sit next to it, because sdfm declares `file:<sibling checkout sibling package>` and `file:<sibling checkout sibling package>`:

```sh
SCRATCH=<scratch dir>; SDFM=$SCRATCH/sdfm
mkdir -p "$SDFM"
ln -s <sibling package worktree> "$SCRATCH/sibling package"; ln -s <sibling package worktree> "$SCRATCH/sibling package"
git -C <sdfm checkout> archive a6caa04d4909ac9aa8395d273da9a0c4ff1b3b26 | tar -x -C "$SDFM"
(cd "$SDFM" && npm install --ignore-scripts)
(cd "$SDFM/vendor/atoms" && npm install)   # its prepare step builds vendor/atoms/dist, which --ignore-scripts skipped
(cd "$SDFM" && node node_modules/vite/bin/vite.js build --configLoader runner)   # dist/gpu.html, the GPU page sdfm publishes
```

Step 1: replay every recipe, one `sdfm call` per line of its calls file. Each recipe ends with `doc_save` (writes `out/obstacles-v0/<name>.sdfm.json`) and `export_raa_prims` (writes `out/obstacles-v0/<name>.raa.prims.json`). Use the card GPU env unchanged (env-var names in section 3) with `ORCH_GPU_REVISION` unset, so the `node_add_batch` receipts render on the published sdfm page. `doc_new --save` refuses an existing document file, so the loop removes it first:

```sh
mkdir -p out/obstacles-v0
for name in spinning-bar pendulum-hammer see-saw rotating-door swinging-gate bouncy-pad conveyor-belt gap-platform wall-with-hole start-finish-arch bean; do
  rm -f "out/obstacles-v0/$name.sdfm.json"
  node -e 'for (const c of require(process.argv[1])) console.log(c.tool + "\t" + JSON.stringify(c.input))' "$PWD/runs/obstacles-v0/recipes/$name.calls.json" |
  while IFS="$(printf '\t')" read -r tool input; do
    env -u ORCH_GPU_REVISION ORCH_GPU_TIMEOUT_MS=240000 \
      node "$SDFM/bin/sdfm.mjs" call "$tool" --doc "out/obstacles-v0/$name.sdfm.json" --input "$input" --save < /dev/null || exit 1
  done || break
done
```

MCP equivalent: start `node "$SDFM/bin/sdfm.mjs" mcp` with the same env and send, for each recipe, its `{tool, input}` items in order as MCP tool calls (`doc_new`, `node_add_batch`, `doc_save`, `export_raa_prims`).

Without a reachable GPU page, the `node_add_batch` receipt prints `PAGE_BUILD_FAILED`, `GPU_HOST_UNREACHABLE` or `GPU_JOB_FAILED`. The edit is still committed and the replay carries on, but each call then takes up to about 100 s (dogfood items 3, 8 and 22).

Verified on 2026-10-18 between 08:18 and 08:21 UTC with sdfm `a6caa04`. Each sdfm call published the page through `ORCH_GPU_CLIENT`, and all 11 receipts rendered on the GPU host (`feedback ok`; the first one took 15 s cold, the rest about 1 s). The whole loop took about 2 minutes. All 22 output files hash to the `sha256` values in `evidence.json`. On an earlier run, step 2 against an empty temp store printed manifest sha256 `e9f5556a27e86135ec388c73ea16487cc26ad2db7b8683bcc4531d76be402317` (4940 bytes). That stored manifest is byte-identical to `manifest.json`, and the root file holds that sha.

Step 2: validate, put, and build the manifest with its GC root. Leave out `RAA_ASSETS_STORE_DIR` to use the default directory, or set it to a store directory of your choice:

```sh
export RAA_ASSETS_STORE_DIR=<store dir>   # optional; omit to use STORE_DIR_DEFAULT
node src/cli/main.ts validate out/obstacles-v0/*.raa.prims.json
node src/cli/main.ts put out/obstacles-v0/*.raa.prims.json out/obstacles-v0/*.sdfm.json
node src/cli/main.ts manifest --name rf.assets.obstacles-v0 --root rf.assets.obstacles-v0 \
  rf.obstacle.spinning-bar=out/obstacles-v0/spinning-bar.raa.prims.json \
  rf.obstacle.spinning-bar.source=out/obstacles-v0/spinning-bar.sdfm.json \
  rf.obstacle.pendulum-hammer=out/obstacles-v0/pendulum-hammer.raa.prims.json \
  rf.obstacle.pendulum-hammer.source=out/obstacles-v0/pendulum-hammer.sdfm.json \
  rf.obstacle.see-saw=out/obstacles-v0/see-saw.raa.prims.json \
  rf.obstacle.see-saw.source=out/obstacles-v0/see-saw.sdfm.json \
  rf.obstacle.rotating-door=out/obstacles-v0/rotating-door.raa.prims.json \
  rf.obstacle.rotating-door.source=out/obstacles-v0/rotating-door.sdfm.json \
  rf.obstacle.swinging-gate=out/obstacles-v0/swinging-gate.raa.prims.json \
  rf.obstacle.swinging-gate.source=out/obstacles-v0/swinging-gate.sdfm.json \
  rf.obstacle.bouncy-pad=out/obstacles-v0/bouncy-pad.raa.prims.json \
  rf.obstacle.bouncy-pad.source=out/obstacles-v0/bouncy-pad.sdfm.json \
  rf.obstacle.conveyor-belt=out/obstacles-v0/conveyor-belt.raa.prims.json \
  rf.obstacle.conveyor-belt.source=out/obstacles-v0/conveyor-belt.sdfm.json \
  rf.obstacle.gap-platform=out/obstacles-v0/gap-platform.raa.prims.json \
  rf.obstacle.gap-platform.source=out/obstacles-v0/gap-platform.sdfm.json \
  rf.obstacle.wall-with-hole=out/obstacles-v0/wall-with-hole.raa.prims.json \
  rf.obstacle.wall-with-hole.source=out/obstacles-v0/wall-with-hole.sdfm.json \
  rf.obstacle.start-finish-arch=out/obstacles-v0/start-finish-arch.raa.prims.json \
  rf.obstacle.start-finish-arch.source=out/obstacles-v0/start-finish-arch.sdfm.json \
  rf.character.bean=out/obstacles-v0/bean.raa.prims.json \
  rf.character.bean.source=out/obstacles-v0/bean.sdfm.json
```

The last command prints `manifest e9f5556a27e86135ec388c73ea16487cc26ad2db7b8683bcc4531d76be402317  4940  objects/e9/e9f5556a27e86135ec388c73ea16487cc26ad2db7b8683bcc4531d76be402317`. `--json` gives the full object. The globs assume `out/obstacles-v0/` holds only the 11 replayed assets: remove any `contact-sheet.*` file first. The sheet is stored by its own `put` (section 3) and is not a manifest entry.

Step 3: compose and render the contact sheet. Replay `recipes/contact-sheet.calls.json` with the step 1 loop (`name` = contact-sheet). Its last call is the `render_views` command of section 3, which writes `out/obstacles-v0/contact-sheet.png`. Then `put` it as section 3 shows, and record `contactSheet` from the `put` line and the `renderer=` value printed by `render_views`. The replay took about 22 s on 2026-10-18, render included.

Step 4: run the proof with `node runs/obstacles-v0/check.ts`. It must print 5 groups of PASS lines and exit 0.
