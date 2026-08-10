# WorldClaw Pilot Region Plan

Status: identity pilot, bounded review, browser identity, gameplay regressions, packaged performance, streaming, bundle budget, and release gates complete  
Evidence snapshot: 2026-08-10; descriptor `fnv1a32:9001acf2`; compiled manifest `af5e0267029a03485c051a4ab8159032653e0e00f694bed4e465ec777cbf27ff`

## Selection

Pilot ID: pilot-chunk-near-airport-arctic-tundra  
Existing chunk ID: chunk:0:1  
Existing region template: region-biome-arctic-tundra  
Chunk center: (0, 0, 1280)  
Chunk bounds: x -640 to 640, z 640 to 1920  
World status: existing deterministic region, not a newly designed map area

The pilot is one existing Arctic Tundra chunk in the initial 3 by 3 stream window. It begins 640 m north of the origin, beyond both the 430 m airport reserve and the 560 m terrain-blend extent. The checked-in selector and runtime round-trip test confirm the assignment for world seed `119278167`.

The airport has decorative harvest fields, but it does not have farming gameplay and its fields lie inside the flight-critical origin reserve. Chunk `0:0` therefore remains procedural and airport-owned. The Arctic pilot is directly ahead of the default `+Z` departure and visible without a teleport or recenter.

## Why this region validates the pipeline

- It preserves an existing biome instead of inventing a region.
- It exercises centered chunk-boundary math at an origin-adjacent coordinate.
- It exercises a complete 41 by 41 height grid and all four shared edges.
- It exercises deterministic vegetation/rock/deadwood placement and global instancing.
- It exercises off-airport manual landing, full stop, relaunch, and touch-and-go.
- It exercises chunk loading, recycling, fallback, disposal, and return-to-airport reset.
- It is outside the fixed airport overlay and cinematic route.
- It can be reverted by removing one authored chunk key.

It does not test roads, buildings, water, farming machinery, multiplayer, or hero assets because the selected existing region contains none of those systems. Those fields are explicitly empty rather than fabricated.

## Existing regional function

The chunk is open natural countryside and a flight/terrain region. Its current gameplay function is traversal and potentially landable streamed terrain. It has no named landmark, settlement, objective, road, waterway, or interaction.

## Existing content to preserve

| Content | Current source | Compiled identity count |
| --- | --- | ---: |
| Terrain | Arctic Tundra procedural height profile | 41 by 41 rendered samples |
| Snow patches | Snow prototype | 62 instances |
| Crystals | Crystal prototype | 58 instances |
| Visual water or ice | Water prototype | 24 instances |
| Rocks | Rock prototype | 38 instances |
| Ground material | Arctic Tundra palette and roughness | One shared terrain material |

The ready descriptor contains all 182 current prototype transforms with exact chunk-local translation, quaternion, scale, and linear instance color. It introduces no new placement and the runtime test requires zero newly dropped instances relative to the procedural source.

## Regional function and player objectives

No new objective is introduced. Existing outcomes used to validate the region are:

- Fly into and across the chunk in manual mode.
- Perform a safe off-airport landing on a slope at or below the controller limit.
- Perform a deliberately hard contact, settle into controllable ground operation, and keep play active.
- Brake to a full stop without entering autopilot completion.
- Taxi, stop, relaunch, or perform a powered touch-and-go in any order.
- Optionally reset from the nearby region to return to the airport/origin stream window.

These are existing manual-flight behaviors, not new missions.

## Entry and exit routes

- Player-facing entry: unrestricted manual aircraft flight through neighboring chunks.
- Player-facing exit: unrestricted flight or reset-to-airport.
- Test entry: the chunk loads in the initial 3 by 3 window; the bounded review harness may center it directly without adding a shipped teleport, checkpoint, or save feature.
- Critical seam routes: crossing each of the four chunk edges into and out of the pilot.

There is no ground road, taxiway, on-foot route, boat route, or authored autopilot route in this region.

## Terrain

Current terrain contract:

- Chunk size: 1280 world units treated as meters by the WorldClaw specification.
- Chunk-local bounds: -640 to 640 on X and Z.
- Resolution: 40 by 40 cells and 41 by 41 height samples.
- Cell size: 32.
- Same PlaneGeometry triangle diagonal for render and contact.
- Arctic Tundra profile: low icy ridges.
- 300-unit biome transition near chunk boundaries.

Pilot pass 1 serializes and round-trips the existing height grid without changing a sample. Authored height editing is out of scope until the identity adapter proves zero visual and gameplay delta.

Required terrain checks:

- Exactly 1681 finite float-compatible height samples.
- Bit-identical shared edges against all four neighbors.
- Render/contact interpolation equality in both cell triangles.
- Surface slope sampling around safe and hard landing points.
- Procedural fallback parity before the pilot artifact is enabled.

## Bounded semantic review evidence

The offline semantic reviewer produced a finite 3 by 3 review window for chunks X `-1..1` and Z `0..2`. Image X runs from `-X` to `+X`; image Y runs from `-Z` to `+Z`; `+Y` is world up. The output is explicitly `bounded-review-only`, sets `globalMapClaimed` to `false`, sets `runtimeLoaded` to `false`, and is never runtime world authority.

For the pilot's exact 40 by 40 cells and current triangle split, the report records:

- 1,681 samples and 1,600 cells.
- Height range `2.2824366..20.4242630` m.
- Maximum triangle slope `13.5298345` degrees; 1,157 cells are at or below 4 degrees.
- 182 placement footprints from the four existing prototype batches.
- A deterministic review-only corridor centered at local X/Z `(-368, -144)`, heading 90 degrees from `+X`, 160 by 30 m, 257 m edge margin, `0.7138593` degree maximum sampled slope, and `6.5912` m minimum placement-footprint clearance.

The corridor is a geometric review candidate, not a certified runway, collider, mission, or proof that aircraft landing/relaunch behavior passes. The [bounded semantic report](../../output/worldclaw/semantic-review/pilot-chunk-near-airport-arctic-tundra/report.json) indexes the six PNGs.

## Materials

Existing palette:

- Ground: #c8d6d5
- Roughness: 0.76
- Primary: #78918e
- Secondary: #eaf2ef
- Accent: #8bd4df
- Rock: #78878b
- Water/ice: #5e9fb4

The first pilot adds no texture, atlas, material, or shader. It reuses the current vertex-colored terrain and shared biome materials.

## Implemented identity composition

The Stage 4 review selected an identity composition rather than a redesign:

- The 1,681 float32 height samples reproduce the current procedural terrain.
- The four prototype batches reproduce all 182 current placements and their per-instance colors.
- Existing pooled geometry and materials remain in use.
- Missing pilot assets: none.
- New art assets: none.
- Pilot hero asset: none required and none generated.
- External generation: no external asset generator or service was selected or required, and no external asset was added.

This is a deliberate completed composition decision, not an unperformed art pass. It makes no premium, AAA, or newly authored visual-quality claim.

## Vegetation and repeated assets

Existing required prototype IDs:

- proto-biome-crystal
- proto-biome-rock
- proto-biome-snow
- proto-biome-water

Compiled placements use chunk-local transforms. The adapter converts them exactly once into the current world-absolute matrices expected by the global natural-family meshes.

Any later missing repeated prototype must have a stable ID, shared geometry/material, footprint, height, slope limit, LOD policy, and deterministic placement rules. No missing repeated asset is approved in pass 1.

## Hero assets

Required existing hero asset IDs: none.  
Approved missing hero asset IDs: none.

The complete pipeline validates this natural identity region without forcing a landmark that the current map does not contain. Existing hero entries elsewhere in the world registry are unaffected. Any later pilot hero proposal would be new scope and would need its own quality, LOD, collision, and performance review.

## Interactive assets

Resident interactive assets: none.  
Visiting interactive actor: interactive-airplane-taildragger.

There are no doors, gates, machines, tractors, crops, pickups, or world interaction anchors. The airplane remains owned by Game and is not serialized into the chunk.

## Vehicle compatibility

- Aircraft air access: implemented.
- Aircraft terrain landing: implemented and critical.
- Certified runway: absent from this region.
- Ground vehicles: absent.
- Water vehicles: absent.
- On-foot navigation: absent.

New visual placements must preserve viable landing samples used by the pilot tests. Since world props have no collision, no placement may depend on a new collider for safety.

## Multiplayer and persistence

Multiplayer requirements: none; the repository has no network system, authority, relevancy, network IDs, or multiplayer spawns.

Persistence requirements: resetting from this chunk must preserve the existing aircraft paint key and must not add saved world position, chunk state, or pilot progress.

## Pilot pipeline

| Step | Status | Evidence or remaining work |
| --- | --- | --- |
| Stage 0 desktop and renderer baseline | Complete | Historical seven-scenario desktop baseline and multi-phase packaged capture |
| Procedural and validated `WorldChunkSource` | Complete | Synchronous authored/procedural/fallback adapter integrated without changing the public world API |
| Pilot export and compiler validation | Complete | Ready 41 by 41 runtime record, hashes, shared-edge hooks, capacities, origin reserve, and 182 prototype transforms |
| Static runtime enablement | Complete | Pilot is one of 17 statically embedded packed descriptor records; invalid/disabled records fall back procedurally |
| Bounded semantic review | Complete | Deterministic six-PNG review package and report; review-only, not global or runtime |
| Composition decision | Complete | Identity/no-op; no missing art, new art, or hero asset |
| Runtime identity round-trip | Complete | Direct runtime pipeline tests pass 3/3 across all 14 biome representatives |
| Browser matched view set | Complete | Ten views pass with identical renderer statistics; the measured worst 960 by 600 image has 70 raster-edge pixels changed, maximum channel delta 68, and mean delta 0.001351 |
| Semantic failure-path fixture | Complete | Ready-record determinism and non-ready rejection pass 2/2 |
| Flight and persistence regressions | Complete | Twelve Node regressions and ten Playwright scenarios pass, including free ground operation, safe/hard terrain contact, authored-region taxi, optional reset, autopilot completion/replay, relaunch, and touch-and-go coverage |
| Integrated performance and streaming | Complete | Seven packaged phase captures and 100 boundary crossings pass with zero browser errors, fixed resources, and zero dropped instances |
| Bundle and release decision | Complete | Exact packed-Float32 runtime; aggregate JavaScript measures 1,291,344 raw / 485,557 gzip bytes within 1,400,000 / 550,000-byte limits |

## Placement validation

Every future placement must pass:

- Chunk-local bounds and finite transform checks.
- Terrain-height and surface-normal sampling.
- Maximum slope for its footprint.
- Center and corner ground-contact checks.
- Existing placement overlap and minimum-spacing checks.
- Selected landing-test reservation.
- Chunk-edge footprint rule.
- Deterministic seed/revision replay.
- Global family capacity validation across the active 3 by 3 window.
- Multiple-view floating, burial, scale, orientation, and repetition review.

## Required visual validation set

- One top-down view covering the full 1280 by 1280 chunk.
- Northeast, southeast, southwest, and northwest oblique views.
- Low aircraft-height views along both horizontal axes.
- Player/chase-camera approaches to the selected landing area.
- Ground-level views of crystal, snow, rock, and visual water/ice contact.
- Views across all four pilot/neighbor seams.
- Matched current-versus-artifact screenshots from identical cameras.

No region is approved from only the composition camera.

## Performance budget

The checked-in hard ceilings apply to the initial parked scene and the bounded review harness. Active flight phases are compared with the matching Stage 0 phase rather than the parked ceiling:

- Parked/review draw calls: at most 260.
- Parked/review triangles: at most 180,000.
- Parked/review geometries: at most 240.
- Parked/review textures: at most 16.
- Terrain slots: exactly 9.
- Dropped instances: 0 relative to the procedural source.
- Resource identity growth across the 100-boundary route: 0.

Adapter parity adds no intended visual or renderer-resource change in the 10-view harness. The final packed `/world-plane/` run preserves the parked counters exactly at 197 calls, 137,239 triangles, 240 geometries, and 7 textures. All seven phase windows hold 60 median fps with zero console, page, or network errors. The final 100-crossing run keeps nine slots, stable resource identities, and zero dropped instances while measuring mean/p95/max crossing time of `56.222/58.7/75.5` ms against the Stage 0 `160/185/233` ms.

## Exit gates

| Gate | Current state |
| --- | --- |
| Selector confirms Arctic Tundra at `0:1` | Pass |
| Artifact parses, validates, and reproduces height and prototype data | Pass in direct runtime tests |
| Shared-edge hooks and exact float32 payloads | Pass; compiled validation and east/south seam review views are green |
| Rendered terrain/contact agreement | Pass in the desktop terrain-contact scenario |
| Safe landing, hard contact, stop, relaunch, touch-and-go, and reset | Pass across Node and desktop Playwright regressions |
| Nine active slots and zero dropped/fallback instances | Pass in every 10-view identity-harness capture |
| Repeated streaming resource identity | Pass across 100 boundaries: mean/p95/max `56.222/58.7/75.5` ms, fixed nine slots, stable identity, zero dropped instances |
| Invalid or disabled record falls back immediately | Pass in direct runtime tests |
| Automated identity visual set | Pass across top, four oblique, two low, two seam, and landing-approach views |
| Review-harness renderer budgets and matched statistics | Pass; procedural and compiled counters are identical in all ten views |
| Whole-game renderer budgets and matched regression limits | Pass in seven packaged production phase captures with zero console/page/network errors |
| Bundle/load-size release gate | Pass: 1,291,344 raw / 485,557 gzip bytes within enforced aggregate limits of 1,400,000 / 550,000 |
| No absent road, farming, hero, interaction, multiplayer, boat, or save behavior is invented | Pass by scope and data contract |

The identity composition decision is complete without asset generation. Runtime, visual, gameplay-regression, packaged-performance, streaming, bundle, and release gates are green.
