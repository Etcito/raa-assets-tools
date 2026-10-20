# Dogfood: obstacles-v0 authoring

Format: what broke / what was done by hand / what the orchestrator or the MCP must do instead.

## Batch A: spinning-bar, pendulum-hammer, see-saw

1. No SDF Modeler MCP was attached to the card.
   - Broke: no `sdfm` MCP tools in the session.
   - By hand: ran the identical calls through `node bin/sdfm.mjs call <tool> --doc ... --input '<json>' --save`, driven by a throwaway replay script in `out/` that reads `recipes/<name>.calls.json` call by call. `doc_new` with `--doc` and `--save` creates the file.
   - Instead: attach the MCP, or ship the recipe replayer as a documented command so no script is needed.

2. The sdfm checkout given to the card cannot run as is.
   - Broke: it is read-only and has no `node_modules` (tsc missing, then `@webgpu/types`, then `<private UI package>` unresolved).
   - By hand: copied the tree to a scratch dir, ran `npm install --ignore-scripts`, and symlinked two sibling packages siblings to the sibling worktrees so the `file:../` dependencies resolve. This took several build attempts.
   - Instead: the orchestrator should provision a runnable sdfm (dependencies installed, the `<sibling checkout sibling package>` and `<sibling checkout sibling package>` siblings reachable, build-node writable).

3. The render tool and the node_add_batch visual receipt could not run.
   - Broke: `PAGE_BUILD_FAILED` / `PAGE_PUBLISH_FAILED` ("orch_gpu publish exited with code 1", "GPU HTTP timeout"); there is no `orch_gpu` command in the sandbox.
   - By hand: nothing. The iso look check required by the card was NOT done through the MCP; shapes, sizes and colours were checked only by reading the exported prims (triangles, anchors, extents by design arithmetic).
   - Instead: the MCP must have a GPU render backend in the sandbox, or a CPU fallback for `render`. A failing receipt must not print the error after a committed edit as if it were a failure of the edit.

4. The default store directory cannot be written.
   - Broke: `put into the default store directory` fails with `INTERNAL: ENOENT: mkdir of the default store's parent`. The parent does not exist and the parent mount is a read-only file system in this sandbox. The CLI also reports a plain filesystem error where a clear `STORE_UNWRITABLE` would help.
   - By hand: used `RAA_ASSETS_STORE_DIR=out/asset-store` (git-ignored, documented in docs/store.md). Objects are content-addressed, so keys and sha256 in `evidence.json` are identical. The owner must copy that directory into the default store: `cp -a out/asset-store/. <default store dir>/ (see docs/store.md)`.
   - Instead: the orchestrator should mount a writable default store directory for cards, and put should create missing parent directories.

5. Pivot on a rotated primitive.
   - Broke: nothing, but a `moving` hub rotated to align with an axis would rotate its children's frame. The pendulum-hammer therefore uses a sphere for `moving` so the arm and head are placed in an unrotated frame.
   - By hand: chose the sphere (224 triangles, well in budget).
   - Instead: the S12 rule could say that `moving` should be rotation-free.

6. `node_add_batch` ids come from names; `parentRef` is an index into the batch, so inserting an item shifts all later refs.
   - By hand: counted indexes manually in each recipe.
   - Instead: allow `parentRef` by item name, with the export mapping it to indexes.

## Batch B: rotating-door, swinging-gate, bouncy-pad, conveyor-belt

7. The MCP was again not attached; the fallback of item 1 was used.
   - Broke: no `sdfm` MCP tools. The sdfm checkout again had no `node_modules`.
   - By hand: scratch copy of the checkout under `/tmp`, `npm install --ignore-scripts`, sibling symlinks for two sibling packages, and the same throwaway replay script (one `bin/sdfm.mjs call` per recipe line).
   - Instead: same as items 1 and 2: attach the MCP, or ship the replayer and a runnable sdfm.

8. `node_add_batch` takes 60-120 s through the CLI because its visual receipt tries a vite page build that always fails (`PAGE_BUILD_FAILED`), and it timed out at 55 s on the first attempt, leaving the document empty at export (`RAA_EXPORT_REFUSED: There is no shape to export`).
   - By hand: ran the replays in the background with a 300 s timeout and checked the log files with short commands.
   - Instead: a `--no-receipt` option (or a receipt that fails fast without a GPU) so that a batch of 8 nodes is not a 2 minute step.

9. The render look check (Q11(a)) was NOT done again, for the reason in item 3. Silhouettes were designed by arithmetic only (rotating-door: frame + yellow panel on a pink hub; swinging-gate: orange panel on two violet posts; bouncy-pad: lime disc, pink torus rim; conveyor-belt: orange rails, yellow end rollers, cyan arrows along +X). The owner review of colours and shapes is still open.
   - Instead: a CPU or software-GPU `render` for the sandbox.

10. The default store directory (`STORE_DIR_DEFAULT`, see docs/store.md) is still missing in this sandbox, so `put` used `RAA_ASSETS_STORE_DIR=out/asset-store` (see item 4). Keys and hashes are content-addressed and identical.

## Batch C: gap-platform, wall-with-hole, start-finish-arch, bean

11. The MCP was not attached a third time; the fallback of items 1 and 7 was used.
   - Broke: no `sdfm` MCP tools; the read-only sdfm checkout again had no `node_modules`.
   - By hand: scratch copy under `/tmp`, `npm install --ignore-scripts` (4 s this time), sibling symlinks for two sibling packages, and a throwaway replayer in `out/obstacles-v0/` (one `bin/sdfm.mjs call <tool> --doc ... --input ... --save` per recipe line).
   - Instead: same as items 1 and 2.

12. The render look check DID run this time, in Node, but only once `ORCH_GPU_URL` was unset.
   - Broke: with `ORCH_GPU_URL` set in the card env, `render` and the `node_add_batch` receipt route to the host job API and fail with `GPU_HOST_UNREACHABLE` (ECONNREFUSED on 127.0.0.1:8000). Without a vite `dist/`, the receipt failed earlier with `PAGE_BUILD_FAILED`.
   - By hand: `env -u ORCH_GPU_URL node bin/sdfm.mjs call render --doc out/obstacles-v0/<name>.sdfm.json --input '{"out": "out/obstacles-v0/<name>.png", ...}'` renders in Node with the Dawn software adapter (`renderer=node; pipeline=deferred`). The first call takes about 40 s (shader warm-up), the next ones about 1 s. All 4 PNGs and a front-view scale check (bean next to the wall) stay in `out/obstacles-v0/`. The batch A and B assets could be checked the same way, but were not re-rendered by this card.
   - Instead: when the GPU host is unreachable, render should fall back to Node itself (and say so) instead of failing, or the card env should not set `ORCH_GPU_URL` when no host listens.

13. The first start-finish-arch design (two pillars + a half-buried torus) rendered badly.
   - Broke: nothing in export (316 triangles, valid), but the SDF render has no ground clip. It shows the full ring, including the half under y = 0, and the ring hid the banner.
   - By hand: switched to the box-arch option of S12 (two violet pillars, a pink lintel with a yellow banner, cyan balls on top, a white line stripe on the ground; 508 triangles).
   - Instead: render could have a `ground: true` option that clips at y = 0, so that buried parts look as they will in the game.

14. The bean at 16 segments with hands is over budget.
   - Broke: capsule 256 + 4 spheres 896 + 2 hand capsules 512 = 1664 > 1500 by S2 arithmetic (counted before the export, not hit).
   - By hand: `segments: 12` on the bean export (912 triangles). The other three keep 16.
   - Instead: a per-node segments hint would let the eyes stay round at a lower cost elsewhere; S1 has only an asset-wide value.

15. The wall-with-hole subtract worked first time: the cylinder child of the box with `op: "subtract"`, turned 90° about X, exports as an S1 cut (box 12 + cylinder 60 × 2 = 156 triangles). No friction; noted as a confirmation of the S10 mapping.

16. The default store directory (STORE_DIR_DEFAULT) is still missing (`INTERNAL: ENOENT: mkdir` of its parent, exit 2), so `put` used `RAA_ASSETS_STORE_DIR=out/asset-store` (see items 4 and 10). This card's worktree started with an empty `out/`, so its local store holds only the 8 batch C objects. The owner copy step must gather the objects of every batch's worktree, or re-run the recipes, which give the same bytes.

## Batch D: contact sheet (2026-10-18)

17. The 11-asset contact sheet cannot be rendered or stored because the card GPU client is unreachable.
   - Command: `node bin/sdfm.mjs call render_views --doc out/obstacles-v0/contact-sheet.sdfm.json --input '{"views":["iso","front"],"width":768,"height":768,"mode":"shaded","out":"out/obstacles-v0/contact-sheet.png"}' --save` with the card's `ORCH_GPU_URL` and token unchanged.
   - Error at 2026-10-18 07:46:39 UTC: `GPU_HOST_UNREACHABLE: GPU host at ORCH_GPU_URL (http://127.0.0.1:8000/api/gpu/jobs) is unreachable: ECONNREFUSED`.
   - By hand: replayed the composed contact-sheet recipe, but did not substitute a Node/Dawn software render or write a placeholder. No contact sheet was stored and `evidence.json` has no `contactSheet` field.
   - Instead: supervisor must provide a reachable GPU client at the card's `ORCH_GPU_URL`; then rerun the render command above, store the PNG with `raa-assets put`, and record its hash, key, renderer and URL.
   - Closed on 2026-10-18 at 08:21 UTC by the report card (item 19): rendered with `renderer=host-webgpu`, stored as `objects/e1/e152f8e8d1093190c4632bd20c0febd2dcd3db49a8edb820f357a4ed4398ad4f`, and recorded as `contactSheet` in `evidence.json`.

## Run level: report, proof and owner handover (2026-10-18)

Format: what broke / what was done by hand / what the orchestrator or the MCP must do instead. These items cover the whole run. Items 1-17 above are the per-batch entries.

18. The SDF Modeler MCP was never attached, on any of the five cards of this run.
   - Broke: no card could call `sdfm` as MCP tools. All authoring (11 recipes, 44 calls), the contact-sheet composition and the replay check of this card went through `node bin/sdfm.mjs call ...` from a scratch copy.
   - By hand: each card rebuilt a runnable sdfm under `/tmp`: `git archive` of the read-only checkout, `npm install --ignore-scripts`, and symlinks for `<sibling checkout sibling package>` and `<sibling checkout sibling package>`. Each card also wrote its own replay loop; report.md now documents one shell loop over the calls files.
   - Instead: attach `node bin/sdfm.mjs mcp` to the card with its dependencies installed, or give the sdfm CLI a `replay <calls.json> --doc <file>` command, so that a recipe is one command and not a shell loop.

19. The contact sheet (Q11(a)) was never rendered, so `node runs/obstacles-v0/check.ts` cannot pass `m6.review`.
   - Broke: on this card (2026-10-18), `ORCH_GPU_URL` (`http://127.0.0.1:8000/api/gpu/jobs`) still refuses a direct connection (`curl` exit 7, ECONNREFUSED, the same as item 17's `GPU_HOST_UNREACHABLE`). Through the sandbox proxy, which `$ORCH_GPU_CLIENT` uses, it answers `403 the orchestrator sandbox: host not in the network allowlist`. The sdfm job client goes through `HTTP_PROXY` when `NO_PROXY` is empty, as it is in this card's env. Through that route the job host does accept jobs, but every render fails. Probe at 2026-10-18 08:09 UTC: `node <sdfm>/bin/sdfm.mjs call render_views --doc <scratch>/bean.sdfm.json --input '{"views":["iso"],"width":256,"height":256,"mode":"shaded","out":"<scratch>/bean.png"}'` gave `GPU_JOB_FAILED: GPU host job 'render' failed: Render page timed out (85 s)` after 86 s, and all 11 `node_add_batch` receipts of the replay failed the same way. The job targets this project's committed revision, which has no sdfm GPU page. A published sdfm page (`$ORCH_GPU_CLIENT publish` of an sdfm build, then `ORCH_GPU_PAGE_REF`) is needed, and that is a card 3485 step that writes `evidence.json`.
   - By hand: nothing was substituted. No Node/Dawn render, no placeholder, and no hand-written `renderer`. `evidence.json` still has no `contactSheet`. The full proof stops at `FAIL  m6.review.contact-sheet  sha undefined key undefined` (exit 1), after the `m6.assets`, `m6.budget`, `m6.manifest` and `m6.store` checks all pass.
   - Instead: the orchestrator must give the card a GPU client it can reach. Either the proxy allowlist must include the GPU job host, or `ORCH_GPU_URL` must point at a host that listens. The card env should also not set `ORCH_GPU_URL` when no client is connected, so the failure shows at card start and not after authoring. The sdfm `render_views` tool should honour `HTTP_PROXY` the way `$ORCH_GPU_CLIENT` does, so that both paths agree.
   - Closed on 2026-10-18 at 08:21 UTC. The cause was the page target, not the host. With `ORCH_GPU_REVISION` unset and `ORCH_GPU_CLIENT` set, sdfm `publishGpuPage` publishes its own `dist/` build, and the job runs on that page. `ORCH_GPU_URL`, `ORCH_GPU_TOKEN`, `ORCH_GPU_PROJECT`, `HTTP_PROXY` and `NO_PROXY` stayed as provided, and `ORCH_GPU_TIMEOUT_MS` was raised to 240000. The contact-sheet replay ended with `render_views ... (1536x792) ... renderer=host-webgpu` (1.4 s render). The PNG was stored with `raa-assets put` as `objects/e1/e152f8e8d1093190c4632bd20c0febd2dcd3db49a8edb820f357a4ed4398ad4f` (52210 bytes). `evidence.json` now has `contactSheet` (`url` is null because the store is local-only), and `node runs/obstacles-v0/check.ts` passes `m6.review`. The exact command is in report.md section 3. The first `vite build` failed until `vendor/atoms` was built (item 24).

20. The public URL could not be fetched by the agent.
   - Broke: the brief's store check (`https://assets.etcito.com/objects/e9/e9f5556a27e86135ec388c73ea16487cc26ad2db7b8683bcc4531d76be402317`: status 200, immutable cache-control, CORS, sha match) cannot run from a card. The store is local-only since the M2 amendment, and the store host is not in the sandbox allowlist. `m6.store` checks only the local stored-file hash, the `get` hash and the keys.
   - By hand: report.md section 4 gives the owner the `curl -sI` and `curl -s ... | sha256sum` commands to run after copying the store directory unchanged to the VM store root.
   - Instead: after the owner copy, a the orchestrator step (or the owner) runs that check and records status, cache-control, access-control-allow-origin and the body sha256 as evidence. Until then the public half of `m6.store` is unverified.

21. The default store directory was never writable, so the run's objects are spread over each batch worktree's `out/asset-store`.
   - Broke: items 4, 10 and 16. Each authoring card put into its own git-ignored local store, and a card's `out/` does not survive into the next card's worktree.
   - By hand: nothing more on this card. The objects are content-addressed, and report.md section 5 regenerates all 22 entries and the manifest from the committed recipes.
   - Instead: mount `STORE_DIR_DEFAULT` read-write for the cards of a run, so that the owner copy is one directory and not a regeneration.

22. The `node_add_batch` receipt makes the replay slow and noisy (item 8, again on this card).
   - Broke: every `node_add_batch` call tries a vite page build that fails (`PAGE_BUILD_FAILED`), and the call still exits 0. The bean replay took 6.4 s, but the other recipes took about 100 s each in the same scratch copy, almost all of it in the failed build. The full 11-recipe replay therefore needs a background run and is far over a 60 s step.
   - By hand: ran the full replay in the background and polled its log.
   - Instead: `node_add_batch` needs a `--no-receipt` option, or a receipt that is skipped in one line when no GPU page can be built.

23. The dependency card that should have stored the contact sheet finished as done without it.
   - Broke: card 3485 was marked done although its own step (4) said to stay blocked until a GPU client is reachable. This card's acceptance (full `m6.review` PASS) therefore inherited a failure that, at first, it was not allowed to fix: evidence.json belonged to card 3485. It took one question and one answer (Q2) before this card could do the render and write `contactSheet`.
   - Instead: the orchestrator should keep a card blocked when its deliverable is a recorded GPU artefact that is absent, and not mark it done on a dogfood entry alone.

24. `npm install --ignore-scripts` leaves the sdfm GPU page unbuildable.
   - Broke: the first `vite build` of the scratch copy failed: `Rolldown failed to resolve import "@real3d/atoms/styles" from "src/gpu-page/main.ts"`. `vendor/atoms` exports `./styles` as `dist/atoms.css`, and that file is built only by its `prepare` script, which `--ignore-scripts` skipped. So `publishGpuPage` would have failed with `PAGE_BUILD_FAILED`, and this is probably also why every earlier receipt failed that way (items 8 and 22).
   - By hand: `npm install` inside `vendor/atoms` of the scratch copy only (9 s; it runs `vite build` and `vue-tsc` for atoms). After that, `vite build --configLoader runner` of sdfm produced `dist/gpu.html` in 3 s.
   - Instead: vendor `vendor/atoms` with its `dist/` (as `vendor/quadmesh` already is), or give sdfm a `setup` script that builds the vendored packages and the page in one command.

## What the agent could not do through the MCP (summary, 2026-10-18)

The sdfm MCP was never attached (item 18). Everything below went through `node bin/sdfm.mjs call` or the shell. It would still have needed a shell even with the MCP attached:

- Make sdfm runnable: copy the checkout at the M5 commit, `npm install --ignore-scripts`, symlink the `sibling package` and `sibling package` siblings, build `vendor/atoms` and run `vite build` (items 2, 11 and 24).
- Replay a recipe file in one step: there is no `replay` tool, so each card ran a shell loop of one `call` per line (item 18).
- Choose the GPU page target: unsetting `ORCH_GPU_REVISION` and raising `ORCH_GPU_TIMEOUT_MS` are process env settings, not tool inputs (item 19).
- Store anything: `raa-assets put`, `manifest` and `validate` are tools-repo CLI commands with no MCP tool, so every hash and key in `evidence.json` came from CLI output (items 4, 10, 16 and 21).
- Write the evidence: `evidence.json`, `manifest.json`, report.md and this file were written by hand from the tool and CLI output. The `renderer` value is copied from the `render_views` text (`renderer=host-webgpu`); it was never typed by hand.
- Fetch the public URL: not possible from the sandbox. This stays an owner step (item 20).
- Judge the look: the agent saw the contact sheet only as a PNG. Colours and shapes still need the owner's review (Q11(a), report.md section 3).
