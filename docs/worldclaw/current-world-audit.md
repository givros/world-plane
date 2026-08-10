# WorldClaw Current World Audit

Status: baseline specification, before world integration  
Repository starting snapshot: 2026-08-10, branch main, commit 917550d  
Scope: desktop Three.js game only

## Executive finding

This is a compact, working flight game with two world layers:

1. A fixed, authored countryside airfield at the world origin.
2. An unbounded deterministic biome streamer beneath and around it.

The safe WorldClaw seam is below the existing InfiniteBiomeWorld API, not above Game and not in the render loop. WorldClaw should compile reviewed source material into versioned local chunk artifacts. InfiniteBiomeWorld must remain the streaming owner and must retain a synchronous, total, deterministic terrain-height query for every world coordinate.

No multiplayer, networking, farming gameplay, ground vehicles, boats, humanoid player, general spawn manager, or world-save system exists in this repository. Rural fields, a farm shed, harbor traffic, and similar labels are scenery rather than implemented gameplay systems.

## Repository and engine

| Item | Current implementation | Source |
| --- | --- | --- |
| Engine | Three.js 0.184.0, WebGL renderer | package-lock.json:956 |
| Build tool | Vite 8.0.13 | package-lock.json:1008 |
| Language | TypeScript 6.0.3 plus HTML/CSS | package-lock.json:987 |
| Test runner | Playwright 1.60.0 and Node regression scripts | package-lock.json:97; package.json |
| Application entry | src/main.ts creates one Game and starts it | src/main.ts:1 |
| Main scene owner | Game | src/game/Game.ts:105 |
| Physics | Custom flight and contact simulation; no external physics engine | src/systems/ManualFlightController.ts:25 |
| Deployment | Static GitHub Pages build on Node 22 | .github/workflows/deploy-pages.yml |

The runtime dependency set is deliberately small: Three.js and lil-gui. There is no runtime model loader, network client, database client, ECS, or physics package.

## Entry and runtime architecture

The application selects #game-canvas, constructs Game, and starts its requestAnimationFrame loop. Game owns the renderer, scene, camera, aircraft, fixed airfield, biome streamer, manual controller, authored flight sequence, cameras, HUD, audio, VFX, and diagnostics.

The current world composition is:

- RunwayWorld: fixed origin airfield, countryside scenery, lighting, fog, sky, and clouds.
- InfiniteBiomeWorld: deterministic terrain, biome selection, repeated natural props, four urban styles, a travelling horizon, and a recycled 3 by 3 chunk pool.
- AirplaneModel: a procedural taildragger with moving control surfaces, propeller and wheel pivots, camera/VFX sockets, and hidden collision proxies.

Game updates the active flight controller first, then updates biome streaming from the resulting aircraft position, then updates world presentation. This order is explicit at src/game/Game.ts:246-256 and is a critical integration constraint.

## Current map and source of truth

The current map is code-authored, not an imported heightmap or scene file. Its source-of-truth files are:

- src/world/RunwayWorld.ts for the fixed airfield and rural plots.
- src/world/InfiniteBiomeWorld.ts for terrain, streaming, placement, and the origin reserve.
- src/world/BiomeCatalog.ts for the 14 biome identities and their palettes.
- src/world/BiomeWorldArt.ts for the 14 shared natural-prop families.
- src/world/UrbanBiomeArt.ts for four urban composition styles.
- src/assets/MaterialLibrary.ts for the airfield material library.
- src/assets/AirplaneModel.ts for the only playable vehicle.

The world uses meter-like units, a right-handed coordinate system, +Y up, and the runway aligned to Z. The source does not formally declare a unit, but aircraft dimensions, gravity, speed, and HUD conversions support adopting one world unit as one meter in the WorldClaw specification. The origin airfield is fixed at (0, 0, 0). The preferred takeoff direction is +Z.

## Fixed airfield

The airfield metadata is an authoritative gameplay contract:

| Property | Value |
| --- | ---: |
| Runway width | 24 m |
| Paved length | 360 m |
| Usable threshold span | 300 m |
| South threshold | z = -150 m |
| North threshold | z = 150 m |
| Surface elevation | y = 0 m |
| Parking / aircraft spawn | (0, 0, -112) |
| Rollout stop metadata | (0, 0, 104) |
| Active controller final stop | z = 124 m |
| Safe corridor half-width metadata | 18 m |
| Preferred takeoff direction | +Z |

Sources: src/world/RunwayWorld.ts:7-16 and src/world/RunwayWorld.ts:1394-1416. Game supplies finalStopZ = 124 to both active controllers; the 18 m safe-corridor value is currently metadata rather than a controller-enforced boundary.

The authored scene includes runway 18/36, shoulders and markings, a curved taxiway and apron, runway and approach lights, two hangars, a farm shed, an operations office and beacon, a fuel depot, a windsock, a west-side fence, tree belts, hay bales, six field polygons, sky, clouds, fog, and lighting. Airport scenery is visible only while streamed chunk 0:0 is loaded.

## Terrain and streaming

| Contract | Current value |
| --- | ---: |
| Chunk size | 1280 m centered on integer chunk coordinates |
| Active grid | 3 by 3 chunks |
| Pooled terrain slots | 9 |
| Loaded footprint | 3840 m by 3840 m |
| Terrain segments | 40 by 40 |
| Height samples | 41 by 41 per chunk |
| Terrain cell size | 32 m |
| Biome transition width | 300 m |
| Airport reserve | max(abs(x), abs(z)) less than 430 m |
| Natural prop capacity | 2304 instances per global family |
| Urban capacity | 384 boxes and 128 roofs per chunk slot |
| Fog | 580 m near, 1040 m far |
| Default seed | 0x071c0a57 |

Sources: src/world/InfiniteBiomeWorld.ts:22-34 and src/world/UrbanBiomeArt.ts:10-11.

Biome regions are deterministic jittered Voronoi cells whose sites operate over a span of four chunks. Chunk 0:0 is explicitly forced to Sunlit Meadow. The origin terrain blends to a flat elevation of -0.245 m around the airfield, with the natural surface blended back in from approximately 390 m to 560 m from the origin.

The active terrain geometry and the collision sampler share the same float-rounded vertex heights and the same PlaneGeometry triangle diagonal. This is why wheel contact currently matches the visible surface. The public getTerrainHeight function computes a value for arbitrary coordinates even when their chunks are not loaded.

Natural placement matrices are currently world-absolute inside shared global instanced meshes. Terrain and urban instances are chunk-local with a chunk-positioned parent mesh. Any compiler or loader must normalize this difference explicitly rather than mixing conventions.

## Regional inventory

The streamer contains ten natural biome templates and four urban templates:

- Sunlit Meadow
- Sahara Dunes
- Alpine Peaks
- Arctic Tundra
- Volcanic Wastes
- Emerald Marsh
- Red Rock Canyon
- Autumn Forest
- Tropical Lagoon
- Crystal Salt Flats
- Metropolitan Core
- Azure Harbor
- Ironworks District
- Sunstone Citadel

These are repeatable semantic templates, not fourteen finite hand-placed areas. Runtime region instances are selected from deterministic Voronoi cells and can occur at any positive or negative coordinate. The complete stable-ID and landmark inventory is in world-regions.md and region_graph.json.

## Gameplay and system inventory

| System | Audit result | Preserve |
| --- | --- | --- |
| Manual aircraft | Implemented custom fixed-step flight model | Yes |
| Autopilot showcase | Implemented authored Catmull-Rom flight and landing sequence | Yes |
| Aircraft controls | Keyboard and HUD controls | Yes |
| Terrain contact | Wheel, tailwheel, and propeller envelope sample scalar terrain height | Yes |
| Building/prop collision | Not implemented | Absence is baseline; do not claim support |
| Aircraft spawn | Fixed parking position at (0, 0, -112) | Yes |
| Player character | Not present | Not applicable |
| Cars/trucks/motorcycles | Not present | Not applicable |
| Boats | Not present | Not applicable |
| Tractors/farming machinery | Not present | Not applicable |
| Farming gameplay | Not present; fields are decorative | Not applicable |
| Multiplayer/networking | Not present | Not applicable |
| World persistence | Not present | Not applicable |
| Persistence | Aircraft paint color only, in localStorage | Yes |
| World objectives/quests | Not present | Not applicable |
| Inspection mode | Implemented orbit/pan/zoom while parked | Yes |
| Audio/VFX | Implemented local presentation systems | Yes |

The detailed controls, collision assumptions, route geometry, and compatibility gates are in gameplay-constraints.md.

## Asset sources

All runtime world and aircraft geometry is generated in TypeScript from Three.js primitives and merged or instanced at startup. There are no GLB, FBX, OBJ, texture-atlas, heightmap, or runtime-downloaded world assets.

The only public source image is public/reference/airplane-reference.png. It is not imported by the runtime source. It is copied into production output and therefore contributes package weight without a current runtime role.

See asset-inventory.md and asset_registry.json for classification and ownership.

## Rendering and performance constraints

The renderer uses antialiasing, SRGB output, ACES Filmic tone mapping, a Game-level maximum device-pixel ratio of 1.35, PCF shadows, and a fog horizon. Real-time shadow updates are enabled only below 12 m aircraft altitude.

The current checked-in desktop budgets are:

- At most 260 draw calls while parked.
- At most 180,000 triangles while parked.
- At most 240 geometries in the initial parked scenario.
- At most 16 textures in the initial parked scenario.
- Fog far at or below 90 percent of one chunk.
- Fixed resource identity and count across repeated streaming boundaries.

The repaired multi-phase baseline and the distinction between parked gates and active-flight comparison windows are recorded in performance-baseline.md.

## Tool, MCP, and skill availability

This audit used only the local repository, read-only diagnostics already gathered for this task, and installed workflow skills. It did not search for credentials, API keys, or optional services.

Available task tools:

| Capability | Availability / audit use |
| --- | --- |
| Local repository inspection and commands | Available; used for the audit, builds, tests, and packaged preview validation |
| Patch-based file editing | Available; used for the structured specification and approved Stage 0 defect repairs |
| Parallel specialist agents | Available; used for world/assets, gameplay, and performance audits |
| Local image inspection | Available; used to verify the parked and final-approach packaged captures |
| Built-in image generation | Available; deliberately deferred until an approved composition needs an image asset |
| Web lookup | Available; not needed for repository truth and not used |
| Workspace document dependencies | Available; not needed |
| App/thread coordination | Available; not part of the game runtime |

Relevant installed skills:

- threejs-game-director
- threejs-gameplay-systems
- threejs-aaa-graphics-builder
- threejs-game-ui-designer
- threejs-debug-profiler
- threejs-qa-release
- threejs-3d-generator
- threejs-image-generator
- threejs-audio-generator
- img2threejs
- goal-to-game
- playwright
- imagegen
- generate2dmap and generate2dsprite
- Blender low-poly character workflows

The first six skills guided this audit's architecture, gameplay-preservation, asset-classification, profiling, and release gates. The generation skills are installed options, not proof that a particular external asset API is authenticated or reachable.

Connector/MCP finding:

- No repository-local MCP configuration, plugin manifest, or SKILL.md exists.
- The task environment exposes generic web, image-generation, workspace, and app/thread tools.
- Browser/computer-control skills are installed but were not used; no desktop UI control was requested.
- Recommended remote productivity plugins shown by the host are not installed and are unrelated to this world pipeline.
- No direct external asset service was probed. Availability will be verified only if an approved later asset requires it, without credential discovery.

No external asset service was invoked in this audit. External asset generation remains a later-phase option and must be recorded in the asset registry when used.

## Stage 0 baseline disposition

The three baseline defects found by the audit are repaired:

1. The urban MeshBasic shader derives its world normal from the always-declared vertex normal and handles non-uniform instance scale. An active Ironworks chunk compiles without browser errors.
2. Terrain exposes an explicit `worldLayer` identity. The terrain-contact test requires one terrain match and uses exported 1280 m chunk dimensions.
3. The deployment workflow now runs Node regressions, desktop Playwright, the production build, and a packaged `/world-plane/` browser smoke before upload.

The production build passes, all seven standalone Node regressions pass, all seven desktop Playwright scenarios pass, and the packaged deployment-path preview is nonblank with zero console, page, or network errors. `performance-baseline.md` records the repaired multi-phase baseline.

## Non-negotiable integration invariants

1. Keep Game, RunwayWorld, InfiniteBiomeWorld, ManualFlightController, FlightSequence, controls, cameras, HUD, audio, VFX, and persistence ownership intact.
2. Keep InfiniteBiomeWorld as the public streaming owner and API.
3. Keep getTerrainHeight synchronous, finite, deterministic, and defined at every coordinate.
4. Keep rendered terrain interpolation identical to collision interpolation.
5. Keep chunk dimensions, sample layout, origin convention, and shared edges exact unless a separately approved migration updates rendering, physics, tests, and data together.
6. Keep chunk 0:0 and the fixed airfield reserve stable.
7. Preserve runway, spawn, taxiway, autopilot route, approach corridors, and sight lines.
8. Preserve procedural fallback for coordinates not covered by authored WorldClaw data; finite authored coverage must never create a void in the infinite world.
9. Keep repeated assets instanced and resource identities stable during streaming.
10. Do not place AI, web calls, or asset-generation APIs in the browser runtime.
11. Do not invent multiplayer, farming, vehicle, watercraft, or save compatibility requirements that the repository does not implement.
12. Do not modify runtime world composition until the pilot plan and structured specifications have passed validation; baseline defect repairs are kept separate.

## Audit disposition

The repository is suitable for a staged WorldClaw-inspired pipeline, but not for direct generative replacement. The trustworthy green baseline is restored. The next implementation step is Stage 1: formal schemas and an offline validator/compiler. Runtime chunk-source extraction remains Stage 2 and must preserve procedural fallback.
