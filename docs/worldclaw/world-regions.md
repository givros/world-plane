# WorldClaw World Regions

Status: semantic inventory derived from the current code-authored map

## Regional model

The current world is not a finite authored map. It combines:

- One fixed origin overlay: the countryside airfield.
- Six authored field polygons inside that overlay.
- Fourteen repeatable biome templates.
- Deterministic biome-region instances selected by jittered Voronoi cells over an unbounded chunk plane.

Region-template IDs below are stable specification IDs. They do not yet replace the TypeScript biome IDs. Semantic colors are intentionally unique and reserved for the later top-down semantic map.

## Fixed region

| Stable ID | Semantic color | Function | Boundary |
| --- | --- | --- | --- |
| region-airport-origin | #FF365E | Flight spawn, runway, landing/takeoff, airfield landmarks, rural visual anchor | Axis-aligned reserve: x -430 to 430, z -430 to 430 |

Chunk 0:0 is forced to the Sunlit Meadow biome underneath the fixed region. The fixed overlay has higher semantic priority than the underlying biome for runway, field, building, and exclusion masks.

### Airport semantic zones

| Stable ID | Color | Current source geometry | Function |
| --- | --- | --- | --- |
| zone-airport-runway-18-36 | #F6F7F2 | Rectangle x -12 to 12, z -180 to 180 | Only certified aircraft ground surface |
| zone-airport-runway-safe-corridor | #FFD23F | Corridor centered x = 0, half-width 18 | Placement exclusion and flight safety |
| zone-airport-taxiway-apron | #FF9F1C | Curved ribbon to apron near (-54, -49) | Visual aircraft access between runway and hangars |
| zone-airport-west-light-meadow | #A3C85E | Polygon in RunwayWorld | Rural field band |
| zone-airport-west-deep-pasture | #3B6D39 | Polygon in RunwayWorld | Rural field band |
| zone-airport-west-harvest-field | #C8A447 | Polygon in RunwayWorld | Decorative harvested field |
| zone-airport-east-harvest-field | #D1B14C | Polygon in RunwayWorld | Decorative harvested field and pilot mask |
| zone-airport-east-light-meadow | #91BD59 | Polygon in RunwayWorld | Rural field band and pilot mask |
| zone-airport-east-deep-pasture | #315C37 | Polygon in RunwayWorld | Rural field band and pilot mask |

Exact field points remain authoritative in src/world/RunwayWorld.ts:241-276. The structured graph mirrors them so a later semantic map can be regenerated without asking an image model to redraw the airport.

## Biome region templates

| Stable ID | Runtime ID | Color | Identity and terrain | Current repeated content | Function |
| --- | --- | --- | --- | --- | --- |
| region-biome-sunlit-meadow | sunlit-meadow | #74B84A | Rolling green meadow | Broadleaf trees, ground cover, rocks, deadwood | Default countryside and origin substrate |
| region-biome-sahara-dunes | sahara-dunes | #D89A3D | Undulating dune field | Mesas, cacti, rocks, sparse cover | Arid flight scenery |
| region-biome-alpine-peaks | alpine-peaks | #6C7C8C | High ridged relief | Conifers, tall mesas, rocks, snow patches | Mountain flight scenery |
| region-biome-arctic-tundra | arctic-tundra | #D9F1F2 | Low tundra with icy ridges | Snow, crystals, visual water/ice patches, rocks | Polar flight scenery |
| region-biome-volcanic-wastes | volcanic-wastes | #4A3033 | Rugged volcanic relief | Dark rocks, mesas, glow fissures, crystals | Volcanic flight scenery |
| region-biome-emerald-marsh | emerald-marsh | #2C7D68 | Very low wetland terrain | Visual water patches, reeds, deadwood, ground cover | Wetland flight scenery |
| region-biome-red-rock-canyon | red-rock-canyon | #B94D35 | Terraced canyon relief | Mesas, spires, rocks, cacti | Canyon flight scenery |
| region-biome-autumn-forest | autumn-forest | #C2672E | Rolling forest floor | Autumn trees, ground cover, rocks, deadwood | Dense seasonal flight scenery |
| region-biome-tropical-lagoon | tropical-lagoon | #13A58D | Low islands and lagoon-like relief | Visual water patches, palms, trees, cover, rocks | Tropical flight scenery |
| region-biome-crystal-salt-flats | crystal-salt-flats | #D7CFC2 | Nearly flat pale terrain | Crystals, salt/snow crust, visual water patches, rocks | Open high-visibility scenery |
| region-biome-metropolitan-core | metropolitan-core | #4D6EA8 | Flattened urban foundation | Road grid, towers, blocks, plazas, parks, lights | Dense city visual region |
| region-biome-azure-harbor | azure-harbor | #197EA8 | Low harbor foundation | Road grid, visual basins, docks, warehouses, cranes, palms | Port-city visual region |
| region-biome-ironworks-district | ironworks-district | #66564A | Low industrial foundation | Heavy roads, halls, yards, tanks, pipes, stacks | Industrial visual region |
| region-biome-sunstone-citadel | sunstone-citadel | #D98C53 | Low desert-city foundation | Streets, adobe blocks, walls, markets, palms, minaret | Desert-city visual region |

Source: src/world/BiomeCatalog.ts:1-200 and src/world/InfiniteBiomeWorld.ts:215-269.

## Boundaries and adjacency

### Procedural boundary rule

Each biome instance is a runtime Voronoi region:

- The low-frequency region span is four chunks.
- Each region cell has one deterministically jittered site.
- Jitter amplitude is 0.72 of the normalized cell range.
- The nearest site selects one of the fourteen biome templates.
- Terrain heights blend across chunk boundaries over a 300 m transition band.
- The function is valid at all positive and negative chunk coordinates.

Source: src/world/BiomeCatalog.ts:212-247 and src/world/InfiniteBiomeWorld.ts:272-312.

Because the world is unbounded, a finite static edge list would be false. region_graph.json therefore records an adjacency rule: every biome-template instance may border any biome-template instance chosen by neighboring Voronoi cells. Concrete instance adjacency must be derived for a requested coordinate window and artifact revision.

### Origin overlay adjacency

The airfield is a protected overlay on region-biome-sunlit-meadow at chunk 0:0. Terrain is flat in the central area and transitions to the underlying natural region outside it. Generated props are excluded from the 430 m reserve. The fixed airport disappears only when chunk 0:0 leaves the active grid.

## Landmarks

### Fixed airport landmarks

| Stable ID | Location / relationship | Current behavior |
| --- | --- | --- |
| landmark-runway-18-36 | x 0, z -180 to 180 | Authored surface and markings; gameplay-critical |
| landmark-main-orange-trim-hangar | (-63, 0, -48) | Static procedural multi-mesh |
| landmark-maintenance-hangar | (-66, 0, 4) | Static procedural multi-mesh |
| landmark-east-field-farm-shed | (73, 0, 92) | Static procedural multi-mesh |
| landmark-airport-operations-office | (-44, 0, 29) | Static office/tower with animated beacon appearance |
| landmark-airfield-fuel-depot | (-76, 0, 31) | Static twin tanks and pipe |
| landmark-airfield-windsock | (-35, 0, -76) | Animated visual indicator |
| landmark-hangar-apron | around (-54, -49) | Static visual access surface |
| landmark-papi-south | (-16.1, 0, -106) | Static precision approach indicator |
| landmark-papi-north | (16.1, 0, 106) | Static precision approach indicator |

### Procedural urban landmarks

| Region | Stable landmark ID | Current implementation |
| --- | --- | --- |
| Metropolitan Core | landmark-aerium-spire | Composed procedurally from pooled urban instances |
| Azure Harbor | landmark-azure-beacon | Composed procedurally from pooled urban instances |
| Ironworks District | landmark-grand-foundry | Composed procedurally from pooled urban instances |
| Sunstone Citadel | landmark-sunstone-minaret | Composed procedurally from pooled urban instances |

The urban landmarks are semantic identities, not independent GLB or prefab assets. Their current instance composition and transform remain authoritative.

## Roads, paths, and access

| ID | Type | Status |
| --- | --- | --- |
| route-airport-runway-18-36 | Aircraft runway | Implemented, collidable through runway height override |
| route-airport-taxiway-apron | Curved taxiway and apron | Implemented visually; no taxi objective or pathfinding |
| network-urban-road-grid | Per-urban-chunk visual road grid | Implemented visually; no drivable vehicles, AI, or collision |
| route-autopilot-showcase | Authored aircraft circuit | Implemented and gameplay-critical |

There are no highways, secondary-road graph, off-road driving paths, on-foot paths, rail simulation, boat lanes, or navigable waterways.

## Water access

Water-family instances and urban harbor basins are flat visual geometry. They do not provide depth, buoyancy, shoreline collision, water physics, boat spawns, or navigation. Region specifications must set water access to visual-only.

## Activities and interactive objects

Spatial activities:

- Aircraft spawn and reset at the runway parking position.
- Manual runway takeoff/landing and free flight.
- Authored autopilot circuit and landing.
- Parked aircraft inspection.

The airplane is the only interactive world-facing object. Airport doors, fuel equipment, farm shed, hay bales, fence, roads, urban traffic roles, cranes, tanks, and harbor content are non-interactive visual composition.

## Spawn inventory

| Stable ID | Type | Position | Safe area |
| --- | --- | --- | --- |
| spawn-aircraft-primary | Aircraft and effective player spawn | (0, 0, -112) before model ground offset | zone-airport-runway-18-36 |

No player-character, vehicle garage, boat, farm vehicle, respawn checkpoint, or multiplayer spawn exists.

## Critical route preservation

The following relationships cannot be broken by semantic masks or placement:

1. spawn-aircraft-primary -> northbound runway takeoff.
2. Runway thresholds and approach-light clearances.
3. route-autopilot-showcase from takeoff through its positive-X circuit, negative-Z return, touchdown, and rollout.
4. Runway-to-apron visual continuity.
5. Unobstructed reset and relaunch.
6. Synchronous terrain coverage under every manual-flight coordinate.

See gameplay_routes.json for the numeric route points and gameplay-constraints.md for clearance rules.

## Pilot scope

pilot-chunk-near-airport-arctic-tundra targets existing chunk 0:1, centered at (0, 1280), which the current selector assigns to Arctic Tundra for the default seed. The chunk is part of the initial 3 by 3 stream window, begins 640 m north of the origin, and remains entirely outside the 430 m airport reserve and the 560 m terrain-blend extent.

The decorative airport fields were not selected even though they are farm-themed: they are not an independent farming gameplay region and they sit inside the highest-risk flight area. The selected pilot instead validates terrain serialization, all four seams, natural-prop instancing, off-airport landing, initial-window streaming, disposal, and reset without changing chunk 0:0 or the airport overlay.
