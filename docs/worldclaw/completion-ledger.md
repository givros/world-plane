# WorldClaw Completion and Production Ledger

Status: identity pipeline, 14-biome rollout, integrated QA, bundle budget, and release gate complete and green  
Snapshot: 2026-08-10  
Data revision: `917550d`  
Manifest hash: `af5e0267029a03485c051a4ab8159032653e0e00f694bed4e465ec777cbf27ff`

## Preserved scope

WorldClaw is an offline compiler and review workflow. It does not replace the game loop, the fixed airport, aircraft ownership, or the infinite procedural fallback. The rollout adds no multiplayer, farming gameplay, driveable road vehicles, boats, character system, mission system, or world-state save system.

The browser receives statically bundled, validated identity records. It does not fetch WorldClaw manifests or descriptors and makes no browser-time AI, asset-generation, or world-generation API call.

## Stage ledger

| Stage | Implemented | Production-accepted |
| --- | --- | --- |
| 0 - baseline | Yes | Yes, as the historical pre-integration baseline |
| 1 - schemas/compiler | Yes | Yes; freshness checks, compiler 10/10, and emitter 5/5 pass |
| 2 - runtime adapter | Yes | Yes; runtime 3/3 and ten-view renderer-stat parity pass |
| 3 - pilot round-trip/review | Yes | Yes for identity scope; semantic 2/2 and ten-view browser review pass |
| 4 - pilot composition | Yes, as an identity/no-op decision | No separate art gate is required; no art was generated |
| 5 - gameplay/performance | Yes | Accepted: full verification, packaged phases, flight regressions, bundle budget, and 100 crossings pass |
| 6 - regional expansion | Yes for representative artifact/runtime rollout | Accepted within the documented identity scope across all 14 representatives |

## Checked-in artifacts

| Artifact | Current contract |
| --- | --- |
| [World specification](../../data/world/world_spec.json), [region graph](../../data/world/region_graph.json), [asset registry](../../data/world/asset_registry.json), and [gameplay routes](../../data/world/gameplay_routes.json) | Versioned source data with absent-system policy |
| [Schema directory](../../data/world/schemas) | Five schemas, including the chunk descriptor contract |
| [Pilot descriptor](../../data/world/pilots/chunk_0_1.json) | Ready 41 by 41 float32 height record plus four prototype batches |
| [Regional descriptors](../../data/world/regions) | Sixteen ready expansion records |
| [Compiled manifest](../../data/world/compiled/world_manifest.json) | Canonical, timestamp-free inventory of 17 ready descriptors and 14 represented biomes |
| [Runtime chunk source](../../src/world/WorldChunkSource.ts) | Synchronous authored/procedural/fallback resolution and validation |
| [Generated runtime module](../../src/world/generated/CompiledWorldManifest.generated.ts) | Deterministic exact Float32 base64 packing with synchronous local decode; ready records and prototype-batch map |
| [Bounded semantic report](../../output/worldclaw/semantic-review/pilot-chunk-near-airport-arctic-tundra/report.json) | Offline review evidence only; never runtime authority |

Raw checked-in descriptor size is 3,553,581 bytes. The manifest is 12,569 bytes and the generated packed runtime module is 531,702 bytes. Across the 17 records there are 28,577 height samples and 5,120 existing prototype instances.

## Pilot composition decision

Pilot chunk `0:1` remains Arctic Tundra and preserves:

- 1,681 exact float32 height samples.
- 58 crystal, 38 rock, 62 snow, and 24 visual water/ice transforms: 182 instances total.
- Existing placement transforms, linear per-instance colors, pooled geometry, and shared materials.
- Procedural fallback if the authored record is absent, disabled, or rejected.

New pilot art: none.  
Missing pilot assets: none.  
Pilot hero asset: none required or generated.  
External generation: no external asset generator or service was selected or required; no external asset was added.

## Bounded semantic review

The semantic output is a finite 3 by 3 review window, not a global map. It sets `scope` to `bounded-review-only`, `globalMapClaimed` to `false`, and `runtimeLoaded` to `false`.

- Window: chunk X `-1..1`, chunk Z `0..2`.
- Image axes: left-to-right `-X` to `+X`; top-to-bottom `-Z` to `+Z`; world up `+Y`.
- Terrain: 40 by 40 exact cells using the runtime triangle split; 1,157 of 1,600 cells are at or below 4 degrees.
- Review-only corridor: local X/Z `(-368, -144)`, heading 90 degrees from `+X`, 160 by 30 m, 257 m edge margin, `0.7138593` degree maximum sampled slope, and `6.5912` m placement-footprint clearance.

The corridor is not a runway, gameplay route, collider, or landing certification.

## Controlled rollout coordinates

| Order | Biome template | Representative chunk coordinates |
| ---: | --- | --- |
| 1 | Arctic Tundra | `0:1` pilot; connectors `1:0`, `1:1` |
| 2 | Azure Harbor | `-11:-5` |
| 3 | Sunstone Citadel | `-12:-4` |
| 4 | Crystal Salt Flats | `-11:0` |
| 5 | Sahara Dunes | `-13:-12` |
| 6 | Emerald Marsh | `-8:-5` |
| 7 | Autumn Forest | `-8:-9` |
| 8 | Tropical Lagoon | `-24:-7` |
| 9 | Sunlit Meadow | `-13:-5` |
| 10 | Volcanic Wastes | `-1:0`, `-1:1` |
| 11 | Red Rock Canyon | `-1:-1` |
| 12 | Alpine Peaks | `-17:-5` |
| 13 | Metropolitan Core | `-21:-5` |
| 14 | Ironworks District | `1:-1` |

The origin airport is deliberately not migrated.

## Verification snapshot

| Check | Result |
| --- | --- |
| Descriptor export freshness | Pass: 17 descriptors, 14 biome templates, 5,120 instances |
| Manifest validation/freshness | Pass |
| Generated runtime module freshness | Pass |
| Runtime identity and fallback | Pass: 3/3 |
| Runtime-module emitter | Pass: 5/5 |
| Bundle-budget suite | Pass: 2/2 |
| Compiler suite | Pass: 10/10 |
| Semantic-review suite | Pass: 2/2 |
| Browser WorldClaw view set | Pass: ten views, identical renderer statistics; measured worst image 70 raster-edge pixels, channel delta 68, mean delta 0.001351 |
| Full repository verification | Pass |
| Root build | Pass |
| Standalone Node regressions | Pass: 12/12 |
| Desktop Playwright suite | Pass: 10/10 |
| `/world-plane/` build and seven packaged phase captures | Pass: all 60 median fps; zero console, page, or network errors |
| Flight behavior regressions | Pass: terrain contact, manual control/reset, autopilot completion/replay, relaunch, and touch-and-go coverage |
| 100 boundary crossings | Pass: mean/p95/max `56.222/58.7/75.5` ms, fixed nine slots, stable resources, zero drops |
| Final Vite main JavaScript | Pass: 1,291.34 kB raw / 487.80 kB gzip |
| Aggregate JavaScript budget | Pass: 1,291,344 / 1,400,000 raw bytes and 485,557 / 550,000 gzip bytes |

The [ten-view browser metrics](../../output/worldclaw/visual-review/metrics.json) retain the compiled/procedural counters and image differences. The [performance baseline](performance-baseline.md) records all seven packaged phases and the [100-crossing result](../../output/worldclaw/performance/streaming.json).

All automated runtime behavior, rendering, streaming, bundle, and release gates are green. The generic Vite advisory for a raw chunk above 900 kB is known; the build is governed by the stricter fail-closed aggregate raw/gzip budgets above. The WorldClaw identity rollout is release-complete within its preserved scope.

## Related records

- [Integration plan](integration-plan.md)
- [Pilot region plan](pilot-region-plan.md)
- [Performance baseline](performance-baseline.md)
- [Current world audit](current-world-audit.md)
- [Asset inventory](asset-inventory.md)
