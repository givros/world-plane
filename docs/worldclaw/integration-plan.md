# WorldClaw Integration Plan

Status: Stages 0-6, integrated QA, bundle budget, and release gate complete  
Evidence snapshot: 2026-08-10; compiled manifest `af5e0267029a03485c051a4ab8159032653e0e00f694bed4e465ec777cbf27ff`  
Runtime world change: 17 identity-preserving authored chunk records are statically bundled behind procedural fallback; no new art or gameplay was added

## Goal

Introduce a WorldClaw-inspired authoring pipeline that can progressively enrich the existing world while keeping the current game architecture, flight behavior, controls, airfield, streaming, visual direction, and performance characteristics intact.

WorldClaw is treated as an offline compiler and review workflow. It is not a browser-time AI agent and does not own the game loop.

## Non-goals

- Rebuilding the game or replacing Game, RunwayWorld, or InfiniteBiomeWorld.
- Replacing the current infinite world with a finite generated map.
- Adding a new physics engine as part of world ingestion.
- Inventing multiplayer, farming, road-vehicle, boat, character, mission, or save systems.
- Loading generated content from an API at runtime.
- Generating all regions or all assets in one pass.
- Performing mobile-specific work in this desktop-only project phase.

## Target architecture

The existing public seam remains:

Game -> InfiniteBiomeWorld -> renderer and synchronous terrain height

The implemented internal seam is:

Reviewed source material -> offline WorldClaw compiler -> validated versioned artifacts -> generated static module -> WorldChunkSource -> InfiniteBiomeWorld

WorldChunkSource must be a data provider, while InfiniteBiomeWorld remains responsible for the active 3 by 3 grid, slot pooling, materials, instancing, visibility, diagnostics, and disposal.

### Implemented WorldChunkSource contract

`src/world/WorldChunkSource.ts` now provides the contract below:

- Resolve a versioned descriptor for integer chunk X/Z.
- Return authored content when available.
- Return the current procedural descriptor when authored content is absent or invalid.
- Provide or delegate a synchronous total sampleHeight(worldX, worldZ).
- Expose deterministic content and schema hashes for diagnostics.
- Keep collision terrain available before any optional visual asset finishes loading.
- Never make a network or AI call in the browser.

The generated runtime module embeds deterministic base64 payloads containing exact little-endian Float32 height samples and 13-float prototype transforms. It decodes them synchronously at module initialization and does not use `?raw`, `JSON.parse`, or browser fetches for WorldClaw data. WorldClaw does not call an AI, asset-generation, or world-generation service in the browser.

## Stage status ledger

| Stage | Implementation status | Acceptance status |
| --- | --- | --- |
| 0 - trustworthy baseline | Complete | Green historical baseline recorded below and in `performance-baseline.md` |
| 1 - schemas and offline validator | Implemented: five schemas, deterministic compiler, 17 ready descriptors, canonical manifest | Export, manifest, and generated-module freshness checks pass; compiler tests pass 10/10 and emitter tests pass 5/5 |
| 2 - chunk-source adapter | Implemented and enabled with procedural fallback | Runtime pipeline tests pass 3/3, the 10-view review has identical renderer statistics, and full-game matched performance passes |
| 3 - pilot round-trip and semantic review | Pilot artifact and bounded offline review implemented | Semantic tests pass 2/2; the 10-view browser identity set passes with identical renderer statistics and bounded raster-edge noise |
| 4 - pilot composition | Complete as an identity/no-op composition decision | No new art, no missing pilot asset, and no pilot hero asset; no external asset generator or service was selected or required |
| 5 - gameplay and performance gate | Complete: full verification, flight regressions, packaged captures, bundle budget, and 100-crossing measurement pass | Accepted |
| 6 - controlled regional expansion | Complete for the identity rollout: 17 representative chunks cover all 14 biomes and round-trip against the runtime selector | Accepted within the documented identity scope |

The detailed artifact and test snapshot is in the [completion and production ledger](completion-ledger.md).

## Artifact contract

### Coordinate and chunk rules

- Units: meters.
- Axes: +Y up; runway and preferred forward direction +Z.
- Chunk origin: center at (chunkX * 1280, 0, chunkZ * 1280).
- Serialized instance transforms: chunk-local.
- Height grid: 41 by 41 float samples for 40 by 40 cells.
- Cell size: 32 m.
- Triangle split: the same PlaneGeometry diagonal used by current render and contact sampling.
- Shared boundaries: bit-identical float samples and compatible normals.
- Fixed origin reservation: max(abs(x), abs(z)) less than 430 m.
- Airport overlay: authoritative and protected.

### Required chunk metadata

- Schema version and generator/compiler version.
- World seed and data revision.
- Chunk coordinates and bounds.
- Height payload hash.
- Semantic region/mask IDs.
- Material layer IDs.
- Prototype placement arrays with stable asset IDs.
- Transform convention and bounds.
- Hero-asset references.
- Optional interaction/collision sidecar references.
- Per-family instance counts and capacity validation.
- LOD, culling, and preload metadata.
- Whole-chunk content hash.

### Runtime validation

An artifact is rejected to procedural fallback if any required field is invalid, a reference is unknown, a height is non-finite, dimensions differ, capacity is exceeded, a shared edge mismatches, the origin reservation is violated, or its version/hash is unsupported.

All emitted artifact and asset paths must resolve both at local root and under the GitHub Pages base path /world-plane/. Runtime code must use the Vite base URL rather than hard-coded root-relative paths.

## Delivery stages

### Stage 0: trustworthy baseline - complete 2026-08-10

Completed before runtime integration:

1. The procedural urban shader compiles while a real urban chunk is active.
2. Terrain has an explicit semantic test identity, and the test uses the exported 1280 m contract.
3. Seven Node regressions and seven desktop Playwright scenarios pass.
4. Root and `/world-plane/` production builds pass, including a packaged browser smoke.
5. Deployment runs Node, desktop browser, build, and packaged-preview gates before upload.
6. A multi-phase packaged performance baseline is captured in `performance-baseline.md`.

This stage changes defects, not world composition.

### Stage 1: schemas and offline validator

Implementation status: complete. Verification status: export, compiler, manifest, emitter, and unit checks pass.

1. Five JSON Schemas cover the world specification, region graph, asset registry, gameplay routes, and chunk descriptor.
2. The offline export, compiler, and generated-module emitter have check-only commands.
3. Stable IDs, references, transforms, bounds, capacities, hashes, origin reservation, and shared-edge hooks are validated.
4. The canonical manifest contains no timestamps in hashed content.
5. Fixture, deterministic output, static-module, semantic-review, and runtime round-trip tests exist.

No runtime world behavior changes in this step.

### Stage 2: chunk-source adapter with zero visual delta

Implementation status: complete. Acceptance status: runtime round-trip, 10-view identity renderer comparison, and full-game packaged performance pass.

1. Extract current procedural descriptor generation behind WorldChunkSource.
2. Keep InfiniteBiomeWorld's public API unchanged.
3. Feed the same terrain and placement results through the adapter.
4. Verify screenshot, route, terrain-contact, resource-identity, and performance equivalence.
5. Keep immediate procedural fallback at every coordinate.

The acceptance criterion is zero intended visual or gameplay change.

### Stage 3: semantic source and pilot round-trip

Implementation status: artifact and bounded-review tooling complete. Acceptance status: semantic tests pass 2/2 and the 10-view browser identity comparison passes.

1. Confirm that existing chunk 0:1 resolves to Arctic Tundra for the default seed and loads in the initial stream window.
2. Register the existing terrain, snow, crystal, visual water/ice, and rock identities.
3. Compile the pilot chunk and its four shared edges without changing heights or placements.
4. Validate the pilot descriptor through the adapter and procedural fallback.
5. The offline review identifies a review-only landing corridor; it does not prove aircraft landing gameplay.
6. The 10-view browser pilot identity set and the off-airport contact/taxi/stop/relaunch validation pass.

This proves the pipeline before content generation.

### Stage 4: pilot composition and missing assets

Implementation status: complete for the identity pilot. The reviewed decision is to preserve the existing composition unchanged.

1. Produce a reviewed composition proposal based on the captured current region.
2. No genuinely missing pilot asset was found.
3. Current procedural terrain, placements, per-instance colors, geometries, and materials are retained exactly.
4. For a generated 2D or 3D source, record source, license/ownership, prompt/reference revision, output hash, scale, pivots, materials, LODs, and collision sidecars.
5. Repeated assets use shared prototypes and instancing.
6. No hero asset is required or generated for this pilot; the hero-asset quality gate is therefore not applicable.
7. Interactive assets require explicit gameplay approval and part hierarchies before generation.

External asset generation was not selected because the identity composition has no missing art. No external asset generator or service was selected or required, and no external asset was added.

### Stage 5: pilot gameplay and performance gate

Status: complete and green, including the explicit aggregate bundle budget.

1. Run manual, autopilot, reset, persistence, streaming, and terrain-seam tests.
2. Validate all exclusion volumes and sight lines.
3. Compare matched production captures and diagnostic counts.
4. Reject or simplify content that exceeds the current budgets.
5. Update all audit/specification files to match the accepted artifact.

### Stage 6: controlled regional expansion

Artifact/runtime rollout status: complete. Automated technical acceptance status: pass across all 14 representatives.

Expand one semantic template or authored region at a time. Keep the fixed origin airport procedural and place identity-authored representatives in seven of the eight surrounding initial-window chunks, while retaining all 14 biome templates and the 17-descriptor ceiling.

The identity rollout order is:

1. Initial-window natural pilot and connectors: Arctic Tundra `0:1` pilot plus `1:0` and `1:1`; Volcanic Wastes `-1:0` and `-1:1`; Red Rock Canyon `-1:-1`.
2. Initial-window urban representative: Ironworks District `1:-1`.
3. Retained distant natural templates: Sunlit Meadow `-13:-5`, Azure Harbor `-11:-5`, Sunstone Citadel `-12:-4`, Crystal Salt Flats `-11:0`, Sahara Dunes `-13:-12`, Emerald Marsh `-8:-5`, Autumn Forest `-8:-9`, Tropical Lagoon `-24:-7`, and Alpine Peaks `-17:-5`.
4. Retained distant urban template: Metropolitan Core `-21:-5`.

These 17 descriptors cover all 14 current biome templates. Chunk `0:0` and the origin airport remain outside this migration; `0:-1` remains procedural so the descriptor count and complete biome coverage do not grow. The identity rollout passes descriptor/runtime round-trip validation without adding new regional composition.

## Source-of-truth migration

For the 17 listed representative coordinates, validated JSON runtime records and prototype batches are now authoritative through `src/world/generated/CompiledWorldManifest.generated.ts`. The generated records reproduce the procedural chunk-source samples and prototype batches; the 10-view review confirms renderer-stat parity and only bounded rasterization-level pixel differences. Every unlisted coordinate remains procedural, and an invalid or disabled authored record falls back immediately.

Runtime ownership moved only after:

1. A schema exists.
2. Round-trip output is deterministic.
3. The adapter reproduces the current result.
4. Tests compare the structured artifact with the source behavior.
5. A migration entry explicitly changes authority for the selected region.

The fixed airfield metadata remains authoritative in TypeScript. The origin airport was not migrated.

## Data and asset strategy

### Terrain

Keep collision data small, prevalidated, and immediately available. A future binary height payload may replace JSON arrays, but its decoded result must be the exact 41 by 41 contract. Authored height is optional; the pilot initially keeps current height generation.

### Repeated prototypes

Compiled prototype IDs map to the existing biome families. Shared geometry and material reuse is preserved. Chunk-local compiled transforms are converted during slot population, including their exact linear per-instance colors.

### Hero assets

Load each hero once through a shared registry, clone/instance only as its hierarchy permits, provide LOD and simplified collision sidecars, and dispose through existing world ownership. The first pilot round-trip does not require a new hero.

### Interactive assets

The airplane remains owned by Game and AirplaneModel. WorldClaw must not absorb it into chunk data. Future interactive world assets require independent pivots, named parts, interaction anchors, collision shapes, authority ownership, and save/network policy. Since those systems are absent today, no interactive world asset is in the initial pipeline.

## Validation matrix

| Gate | Evidence |
| --- | --- |
| Schema | JSON Schema and cross-reference validation |
| Determinism | Repeated compiler output has identical content hashes |
| Terrain | Random sample, triangle, edge, authored/fallback seam tests |
| Streaming | 100-plus boundary crossings, fixed resource identity, no dropped instances |
| Gameplay | Manual and autopilot desktop tests |
| Spawn | Wheel contact and parking reset checks |
| Visual | Top-down, four oblique, player/aircraft-height captures |
| Hero | 3 by 3 comparison, at least 9/10 |
| Performance | Matched production captures inside existing budgets |
| Build | TypeScript and Vite production build |
| Persistence | Existing aircraft-paint key unchanged |
| Absent systems | No false multiplayer/farming/vehicle/save claims |

## Performance policy

- Use the checked-in parked budgets as hard ceilings until a new approved baseline replaces them.
- Treat sustained frame-time or stable counter regression above 5 percent as investigation-worthy.
- Treat resource-count growth across repeated streaming cycles as a failure.
- Compile topology, scatter, masks, and heavy validation offline.
- Use object pooling, shared materials, instancing, LOD/HLOD where useful, and distance activation.
- Do not add occlusion, texture atlases, compressed textures, or a new physics engine by default; add them only when measured content requires them and they preserve visual quality.
- Keep collision proxies simpler than render meshes.

## Principal risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Async chunk data races the 120 Hz contact sampler | Preload collision data, keep sampleHeight synchronous, and fall back procedurally |
| Finite authored map creates void beyond coverage | Hybrid authored/procedural WorldChunkSource |
| Visible/collision surface mismatch | One canonical 41 by 41 payload and exact triangle interpolation |
| Cracks at chunk edges | Shared-edge hash validation and bit-identical samples |
| Origin airfield is overwritten | Protected overlay, reservation mask, and source hash |
| Mixed local/world transforms misplace props | Chunk-local artifact convention plus explicit adapter conversion |
| Instance capacity silently drops content | Offline count validation and runtime diagnostic rejection |
| Generated hero assets bloat draw calls | Shared registry, LOD, material limits, and per-asset budgets |
| Static identity records bloat initial JavaScript | Resolved with exact Float32 packing plus enforced aggregate budgets of 1,400,000 raw and 550,000 gzip bytes; retain synchronous decode and procedural fallback |
| Baseline tests cannot distinguish regression | Keep the explicit urban compile and semantic terrain-identity regressions green |
| Random generation erases map identity | Semantic masks derived from existing source; no free redesign |

## Rollback

Every authored chunk must be independently disableable by manifest revision. If validation fails, WorldChunkSource returns the existing procedural descriptor. No save migration is involved in the pilot. The original fixed airfield remains a separate layer, so disabling authored pilot data restores the current world without rebuilding Game.

## Current completion checkpoint

Implemented in this phase:

- Repository audit, region and asset inventory, gameplay preservation contract, and Stage 0 baseline.
- Five schemas, offline export/compiler, deterministic manifest, exact packed-Float32 runtime module, and freshness checks.
- Hybrid `WorldChunkSource` integration with synchronous terrain sampling, authored identity records, validation, and procedural fallback.
- Ready near-airport pilot descriptor with 1,681 height samples and 182 existing prototype instances.
- Offline bounded semantic review with six deterministic PNGs and an explicit review-only landing corridor.
- Identity composition decision: no terrain edit, placement edit, new art, missing pilot asset, or pilot hero asset.
- Seventeen ready representative descriptors covering all 14 current biome templates.

Verified on the integrated identity pipeline:

- Descriptor export, canonical manifest, and generated-module freshness checks pass.
- Compiler tests pass 10/10, emitter tests pass 5/5, bundle-budget tests pass 2/2, semantic-review tests pass 2/2, and runtime pipeline tests pass 3/3.
- The 10-view compiled/procedural browser comparison passes with identical renderer statistics; the measured worst image has 70 raster-edge pixels changed, maximum channel delta 68, and mean delta `0.001351`.
- `npm run verify` passes: the root build, twelve Node regressions, and ten desktop Playwright scenarios are green.
- The `/world-plane/` production build and seven packaged phase captures pass with zero console, page, or network errors.
- The final 100-boundary run keeps nine slots, stable resource identities, and zero dropped instances; mean/p95/max crossing time is `56.222/58.7/75.5` ms.

Release gate closure:

- The deterministic packed runtime module is 531,702 bytes and preserves every serialized Float32 value exactly.
- Vite reports the final main JavaScript at 1,291.34 kB raw / 487.80 kB gzip.
- The enforced aggregate checker measures 1,291,344 raw / 485,557 gzip bytes against limits of 1,400,000 / 550,000 bytes.
- The generic Vite advisory for chunks above 900 kB raw is acknowledged. The stricter repository gate sums every emitted JavaScript file and fails the build if either explicit limit is exceeded.
- Stages 0-6 and the release gate are complete and green within the identity-rollout scope.

No WorldClaw stage introduces multiplayer, farming gameplay, driveable road vehicles, boats, world-state saving, or browser-time generation.
