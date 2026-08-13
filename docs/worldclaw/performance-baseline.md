# WorldClaw Performance Baseline

Status: Stage 0 baseline and final integrated WorldClaw renderer, streaming, bundle, and release gates are green  
Measurement date: 2026-08-10  
Repository starting revision: 917550d; measurement includes the Stage 0 changes below  
Target: packaged production build, Chrome desktop, 1440 by 900, device-pixel ratio 1

## Interpretation

The baseline is now suitable for attribution. The production build, seven standalone Node regressions, seven desktop Playwright scenarios, and the packaged `/world-plane/` preview all pass. The initial loaded grid includes one Ironworks urban chunk, so the clean browser run exercises the repaired urban shader rather than passing without urban content.

The timing values below come from headless Chrome on the same machine and remain hardware-specific. The display cadence caps most windows at 60 fps, so renderer counters and matched before/after phase windows are more informative than the apparent fps alone.

This document preserves the Stage 0 numbers as the comparison baseline. The later WorldClaw implementation must not be described as performance-accepted until a matched packaged-production capture passes the same phases and streaming protocol.

## Stage 0 verification

| Check | Result |
| --- | --- |
| TypeScript plus Vite production build at `/` | Pass |
| Vite production build at `/world-plane/` | Pass |
| Main JavaScript | 752.70 kB raw, 199.61 kB gzip |
| CSS | 18.94 kB raw, 4.76 kB gzip |
| Standalone Node regression tests | 7 of 7 pass |
| Desktop Playwright scenarios | 7 of 7 pass |
| Packaged `/world-plane/` preview | Nonblank 1440 by 900 canvas; JS and CSS load |
| Browser errors in packaged captures | Zero console, page, and network errors |
| Initial urban precondition | One active urban chunk; 352 boxes and 49 roofs |

The unused public airplane reference image remains part of the production output and contributes approximately 790 kB.

## Capture method

- The build uses `VITE_BASE_PATH=/world-plane/` and is served with the same base configuration.
- Chrome runs at 1440 by 900 and DPR 1.
- The game performs its built-in cinematic-view and shader prewarm before measurement.
- For later phases, time scale 20 is used only to reach the named phase. The inspector restores time scale 1 before the warm-up delay and sample window.
- Parked and takeoff-roll windows contain two seconds of frame samples. Other named phases contain 1.5 seconds.
- Every capture records min, median, p95, and maximum renderer counters, the actual captured phase, a screenshot, and browser errors.
- Parked and final-approach screenshots were also inspected visually.

Raw local evidence is written under `output/baseline/`. The repeatable capture tool is `scripts/inspect-threejs-canvas.mjs`.

## Packaged renderer baseline

| Phase | FPS median | Frame time median / p95 | Calls median / p95 / max | Triangles median / p95 / max | Geometries | Textures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Parked | 60 | 16.67 / 16.67 ms | 197 / 197 / 197 | 137,239 / 137,239 / 137,239 | 240 | 7 |
| Takeoff roll | 58 | 17.24 / 17.86 ms | 218 / 417 / 421 | 138,931 / 255,542 / 255,590 | 240 | 7 |
| Climb | 60 | 16.67 / 16.67 ms | 174 / 177 / 177 | 113,654 / 119,672 / 119,672 | 240 | 7 |
| Scenic outbound | 60 | 16.67 / 16.67 ms | 178 / 181 / 182 | 121,472 / 127,490 / 130,690 | 240 | 7 |
| Return | 60 | 16.67 / 16.67 ms | 180 / 180 / 180 | 128,782 / 128,782 / 128,782 | 240 | 7 |
| Final approach | 60 | 16.67 / 16.67 ms | 525 / 597 / 597 | 258,218 / 271,966 / 271,966 | 241 | 7 |
| Rollout | 60 | 16.67 / 16.67 ms | 366 / 386 / 386 | 253,232 / 254,808 / 254,808 | 241 | 7 |

The earlier 506-call / 262,610-triangle value had no raw artifact, phase progress, camera, or sampling provenance. It is removed from the canonical baseline. It remains plausible as a single late ground-level frame, but it cannot be used for comparison.

Calls and triangles vary substantially during ground-level cinematic views as the camera frustum moves across airport scenery. The diagnostic `visibleMeshes` count only checks each object's visibility flag; it does not count frustum inclusion. The high final-approach and rollout values are therefore real phase baselines, not accumulated prewarm renders.

The additional geometry observed during approach and rollout is also part of the current game baseline. The checked-in 240-geometry assertion is evaluated only in the initial parked scenario and must not be described as an all-phase ceiling.

## Streaming CPU baseline

The direct world benchmark is retained because the Stage 0 shader and identity repairs do not alter terrain generation or slot population. The complete desktop streaming regression reran successfully and again proved fixed resources, nine slots, 100 boundary crossings, 300 evictions/reuses, and zero dropped instances.

| Measure | Result |
| --- | ---: |
| Initial 3 by 3 population | 575 ms |
| 100 chunk-boundary crossings, mean | 160 ms |
| 100 chunk-boundary crossings, p95 | 185 ms |
| Maximum observed crossing | 233 ms |
| Terrain slots | Fixed at 9 |
| Resource identity across crossings | Stable |
| Dropped instances | 0 |

These synchronous rebuild costs are far above one frame. WorldClaw must not add browser-time topology compilation, image decoding, validation, or network waits to this path.

## Integrated WorldClaw artifact disposition

The integrated identity rollout has the following measured file inventory:

| Artifact | Raw checked-in size |
| --- | ---: |
| 17 ready descriptor JSON files | 3,553,581 bytes |
| Canonical compiled manifest | 12,569 bytes |
| Generated packed-Float32 runtime module | 531,702 bytes |

The generated module packs all height samples and 13-float prototype transforms as exact little-endian Float32 base64 payloads. It decodes them synchronously at module initialization and exposes ready runtime records and prototype batches without `?raw`, `JSON.parse`, or browser fetches. The runtime makes no browser-time AI, asset-generation, or world-generation API call. Unlisted or rejected coordinates resolve through the synchronous procedural fallback.

The descriptors cover 14 biome templates, 28,577 height samples, and 5,120 existing prototype instances. This is identity data: it reuses the current pooled terrain slots, global instance families, geometry, materials, and per-instance colors. It adds no texture or hero asset.

These structural properties reduce runtime risk but do not substitute for measurement. The final production results below measure bundle size, renderer parity, and streaming timing. Packed-payload decode cost, retained heap, and isolated first-load cost remain unmeasured.

## Integrated packaged production capture

The `/world-plane/` production build completed successfully. Seven 1440 by 900 packaged captures are retained under [the WorldClaw performance output](../../output/worldclaw/performance). Every phase reports 60 median fps and zero console, page, or network errors.

| Phase | FPS median | Frame time median / p95 | Calls median / p95 / max | Triangles median / p95 / max | Geometries | Textures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Parked | 60 | 16.67 / 16.67 ms | 197 / 197 / 197 | 137,239 / 137,239 / 137,239 | 240 | 7 |
| Takeoff roll | 60 | 16.67 / 16.67 ms | 218 / 419 / 421 | 138,931 / 255,566 / 255,590 | 240 | 7 |
| Climb | 60 | 16.67 / 16.67 ms | 174 / 176 / 176 | 113,654 / 119,670 / 119,670 | 240 | 7 |
| Scenic outbound | 60 | 16.66 / 16.67 ms | 179 / 181 / 182 | 121,474 / 127,490 / 130,690 | 240 | 7 |
| Return | 60 | 16.67 / 16.67 ms | 180 / 180 / 180 | 128,782 / 128,782 / 128,782 | 240 | 7 |
| Final approach | 60 | 16.67 / 16.67 ms | 195 / 519 / 525 | 137,429 / 258,126 / 258,218 | 241 | 7 |
| Rollout | 60 | 16.67 / 16.67 ms | 201 / 386 / 386 | 138,054 / 254,808 / 254,808 | 241 | 7 |

The parked result is exactly equal to Stage 0. The takeoff maximum counters are equal, climb is effectively equal, and scenic/final/rollout results remain inside the corresponding historical ranges. This capture shows no sustained renderer or frame-time regression attributable to the identity adapter.

The integrated streaming measurement is retained in [streaming.json](../../output/worldclaw/performance/streaming.json):

| Measure | Stage 0 | Integrated capture |
| --- | ---: | ---: |
| World construction | Not separately recorded | 209.6 ms |
| Initial 3 by 3 population | 575 ms | 176.9 ms |
| 100 crossings, mean | 160 ms | 56.222 ms |
| 100 crossings, p95 | 185 ms | 58.7 ms |
| Maximum crossing | 233 ms | 75.5 ms |
| Terrain slots | 9 | 9 |
| Resource identity | Stable | Stable |
| Dropped instances | 0 | 0 |

The integrated timings are lower in this capture, but they remain machine- and run-specific; the gate is the absence of regression, stable resources, fixed slots, and zero drops.

## Resolved bundle and load-size gate

Exact Float32 packing removed the interim raw-JSON expansion while preserving deterministic values:

| Main JavaScript | Stage 0 | Interim raw descriptors | Final packed runtime |
| --- | ---: | ---: | ---: |
| Vite raw | 752.70 kB | 4,568.63 kB | 1,291.34 kB |
| Vite gzip | 199.61 kB | 928.21 kB | 487.80 kB |

The build runs an aggregate checker after Vite and sums every emitted JavaScript file. Its final measurement is 1,291,344 raw and 485,557 gzip bytes across one file, below enforced limits of 1,400,000 and 550,000 bytes. This leaves 108,656 raw and 64,443 gzip bytes of explicit headroom.

Vite still prints its generic advisory for a raw chunk above 900 kB. That advisory is acknowledged; the repository uses the stricter explicit aggregate raw/gzip limits above, covered by two fail-closed budget tests and enforced by every production build. The bundle gate and release decision are complete.

## Checked-in initial-scene budgets

`tests/visual.spec.ts` encodes the parked desktop ceilings:

- Draw calls: at most 260.
- Triangles: at most 180,000.
- Geometries: at most 240.
- Textures: at most 16.

Additional streaming expectations:

- Fog far at or below chunk size times 0.9.
- Nine active chunk slots.
- Stable geometry, material, texture, and child identities after recycling.
- No resource-count growth after repeated crossings.
- Zero textures owned by the streamed biome subsystem.
- No dropped natural or urban instances.

The parked hard ceilings remain release gates. Active phases must be compared to the matching phase windows above until separately reviewed active-phase ceilings are adopted.

## Renderer and scene policy

- WebGLRenderer with antialiasing and high-performance preference.
- SRGB output and ACES Filmic tone mapping.
- Game-level maximum DPR 1.35.
- PCF shadows.
- Real-time shadow updates only while aircraft altitude is below 12 m.
- Fog near/far 580/1040 m at ground level and adjusted with altitude.
- Repeated environment geometry uses InstancedMesh.
- Terrain and urban slots are pooled.
- The travelling sky/horizon hides the finite 3 by 3 loaded window.
- No explicit LOD/HLOD, occlusion system, texture atlas, or compressed texture pipeline exists.
- Global natural-family instanced meshes disable frustum culling, so fog, density, and fixed capacity remain important controls.

Sources: `src/core/Renderer.ts`, `src/game/Game.ts`, and `src/systems/QualityDiagnostics.ts`.

## Repaired baseline defects

### Procedural urban shader

`UrbanBiomeArt` now starts from the always-declared vertex `normal`, applies the same non-uniform instance-scale correction used by Three.js, transforms the result through view space, and converts it back to world space. The custom program cache key is versioned to v2. The full suite and packaged captures report no shader or WebGL errors while an urban chunk is active.

### Terrain-contact identity

Terrain slots now expose `userData.worldLayer = 'terrain'`. The terrain-contact test requires exactly one matching terrain mesh and derives coordinates and its search center from exported `BIOME_CHUNK_SIZE`; the obsolete 800 m / 400 m assumptions are gone.

### CI and packaged release gate

The Pages workflow now installs Chrome, runs the standalone Node regressions, runs the desktop Playwright suite, builds with `/world-plane/`, opens that exact packaged path, verifies a nonblank canvas and zero browser/network errors, and only then uploads `dist`. Browser artifacts are retained on failure.

## Unmeasured baseline fields

The following remain unknown and must not be estimated:

- JavaScript heap and garbage-collection pressure.
- GPU memory and decoded texture memory.
- Shader-program count in a valid worst-case scene.
- Packed Float32 base64 decode time, retained heap, and isolated first-load effect.

## WorldClaw regression policy

- Keep the initial parked scene inside its checked-in hard ceilings.
- Compare every active candidate against the same named phase, camera policy, viewport, browser, and warm-up procedure.
- Investigate more than 5 percent sustained frame-time regression.
- Investigate more than 10 percent increase in a stable counter even when still below a ceiling, unless a reviewed visual gain justifies it.
- Treat any resource-count growth across repeated streaming cycles as a failure.
- Add no synchronous compile, decode, validation, or network work to a boundary update.
- Allow no dropped instances.
- Add no texture without a declared budget and compression/color-space policy.
- Keep repeated assets instanced.
- Give measured hero assets appropriate LOD and simplified collision sidecars.
- Keep aggregate generated JavaScript at or below 1,425,000 raw and 550,000 gzip bytes; the checker must fail closed if either limit is exceeded. The later driveable-car feature baseline measures 1,418,845 raw and 518,084 gzip bytes; earlier WorldClaw-only measurements above remain historical baselines.

Initial geometry resources are already at the 240-geometry ceiling, and current approach/rollout reaches 241 after flight effects activate. Pilot content should first replace or reuse resources rather than add geometry or material families.

## Repeat protocol for candidate artifacts

1. Build the production output with the deployment base path.
2. Start the same production preview with the same base path.
3. Use the same desktop viewport, DPR, Chrome version, and hardware.
4. Warm cinematic views and shaders.
5. Capture parked, takeoff, climb, cruise, return, final approach, and rollout windows.
6. Add the pilot-region view once the Stage 3 round-trip exists.
7. Record median and p95 frame time plus min/median/p95/max renderer counters.
8. Run at least 100 deterministic boundary crossings and record mean, p95, maximum, resource identity, and dropped counts.
9. Inspect console, page, network, and shader logs.
10. Archive screenshots and raw diagnostics with the artifact revision.

## Optimization order if a measured regression appears

1. Remove accidental duplicate resources or updates.
2. Reuse existing geometry/materials and instance repeated content.
3. Reduce out-of-view or fog-hidden density.
4. Add distance activation or lower update frequency.
5. Add LOD/HLOD for measured hero or urban cost.
6. Consolidate materials or atlas textures when image quality permits.
7. Simplify collision separately from render meshes.
8. Tune shadow distance/update policy.
9. Consider occlusion only after profiling shows a benefit.

Do not add broad optimization machinery merely because it is available; each step requires evidence from the matched capture.

## Release-gate status

The historical Stage 0 baseline is complete:

- Urban shader compilation: pass.
- Explicit terrain identity and 1280 m test contract: pass.
- Standalone Node regressions: 7 of 7 pass.
- Desktop Playwright scenarios: 7 of 7 pass.
- Root and `/world-plane/` production builds: pass.
- Packaged `/world-plane/` browser smoke: pass.
- Multi-phase performance baseline: captured.
- Deployment test and packaged-preview gate: present.

The integrated WorldClaw automated gates are green:

- `npm run verify`: pass.
- Descriptor export freshness: pass, 17 descriptors, 14 biome templates, 5,120 instances.
- Manifest validation/freshness: pass, hash `af5e0267029a03485c051a4ab8159032653e0e00f694bed4e465ec777cbf27ff`.
- Generated static runtime module freshness: pass.
- Runtime identity/fallback tests: 3 of 3 pass.
- Runtime-module emitter tests: 5 of 5 pass.
- Bundle-budget tests: 2 of 2 pass.
- Compiler tests: 10 of 10 pass.
- Semantic-review tests: 2 of 2 pass.
- WorldClaw browser identity set: pass across ten views. Procedural and compiled renderer counters match exactly; the measured worst image has 70 raster-edge pixels, maximum channel delta 68, and mean channel delta `0.001351`. Raw results are in the [review metrics](../../output/worldclaw/visual-review/metrics.json).
- Root production build: pass.
- Standalone Node regressions: 12 of 12 pass.
- Desktop Playwright scenarios: 10 of 10 pass.
- `/world-plane/` build and seven packaged phase captures: pass with zero console, page, or network errors.
- Integrated 100-crossing run: pass with nine slots, stable resource identity, and zero dropped instances.

The final packed build passes the aggregate 1,400,000 raw / 550,000 gzip-byte JavaScript limits at 1,291,344 / 485,557 bytes. Stage 0 remains the canonical comparison baseline, and the final integrated results above are the accepted release measurements. The WorldClaw performance and release gates are complete.
