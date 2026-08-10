# WorldClaw Asset Inventory

Status: current runtime inventory and classification baseline

## Source summary

The project currently uses procedural TypeScript geometry. No world or vehicle GLB, FBX, OBJ, USD, heightmap, texture atlas, or runtime-downloaded asset is present.

| Source | Role | Runtime status |
| --- | --- | --- |
| src/assets/AirplaneModel.ts | Complete airplane, hierarchy, materials, sockets, collision proxies | Used |
| src/assets/MaterialLibrary.ts | Shared airfield material library | Used |
| src/world/RunwayWorld.ts | Fixed airfield geometry and scenery | Used |
| src/world/BiomeWorldArt.ts | Natural prototype geometry and materials | Used |
| src/world/UrbanBiomeArt.ts | Pooled urban boxes/roofs and semantic styles | Used |
| public/reference/airplane-reference.png | Source/reference image | Not imported by runtime |

Generated or sourced assets added later must record their origin, rights, version, hash, unit scale, coordinate convention, materials, pivots, collision policy, and LOD policy in asset_registry.json.

## Classification rules

Every registry entry uses exactly one WorldClaw class:

1. existing-asset: current reusable static or system-owned content.
2. repeated-environmental-prototype: shared geometry/material intended for instancing.
3. hero-asset: unique landmark requiring individual modeling and visual validation.
4. interactive-asset: vehicle or object whose hierarchy, pivots, collision, animation, or interaction behavior is gameplay-owned.

An entry can have status existing even when its class is hero or interactive. “Existing asset” as a class is reserved for content that does not need the special repeated, hero, or interactive handling contract.

## Existing static/system assets

| Registry ID | Current object | Ownership / notes |
| --- | --- | --- |
| existing-airport-field-layer | Six authored field polygons | RunwayWorld; source points are authoritative |
| existing-runway-18-36 | Paved surface, shoulder, markings, seams, patches, skid marks | RunwayWorld; gameplay-critical |
| existing-airport-taxiway-apron | Curved ribbon, borders, centerline, apron | RunwayWorld; preserve footprint |
| existing-airport-lighting | Edge, threshold, end, approach, and PAPI visuals | RunwayWorld; repeated internally |
| existing-airport-fence | West post-and-rail fence | RunwayWorld |
| existing-airport-sky-clouds | Sky dome and pooled cloud puffs | Travelling scenery |
| existing-airport-light-rig | Hemisphere, ambient, sun, fill, rim | World presentation |
| existing-streamed-terrain | Nine pooled PlaneGeometry slots | InfiniteBiomeWorld; collision-coupled |
| existing-biome-horizon | Travelling silhouette/haze | BiomeWorldArt |
| existing-urban-box-pool | Per-slot instanced box pool | UrbanBiomeArt, 384 capacity |
| existing-urban-roof-pool | Per-slot instanced roof pool | UrbanBiomeArt, 128 capacity |
| existing-airplane-reference-image | PNG source image | Not loaded by runtime |

## Repeated environmental prototypes

### Streamed biome families

All fourteen families below are shared global InstancedMesh resources with a maximum of 2304 active instances per family:

| Registry ID | Runtime family | Typical use |
| --- | --- | --- |
| proto-biome-trunk | trunk | Tree trunks, lights, tanks, stacks |
| proto-biome-canopy | canopy | Broadleaf crowns |
| proto-biome-conifer | conifer | Alpine trees |
| proto-biome-frond | frond | Palm crowns |
| proto-biome-ground-cover | groundCover | Grass/flower cover |
| proto-biome-reed | reed | Marsh vegetation |
| proto-biome-cactus | cactus | Arid vegetation |
| proto-biome-deadwood | deadwood | Dead trees and crane-like silhouettes |
| proto-biome-rock | rock | Faceted rocks |
| proto-biome-mesa | mesa | Mesas, spires, industrial blocks |
| proto-biome-crystal | crystal | Ice/crystal/light/minaret-like accents |
| proto-biome-snow | snow | Snow/salt patches and low desert blocks |
| proto-biome-water | water | Flat visual water/ice patches |
| proto-biome-glow | glow | Volcanic fissures |

Source: src/world/BiomeWorldArt.ts:5-35 and src/world/BiomeWorldArt.ts:444-551.

The urban code intentionally reuses some natural prototype shapes for stylized secondary structures. Registry consumers must not infer physical meaning from a geometry family alone.

### Fixed-airport repeated prototypes

| Registry ID | Current use | Instance policy |
| --- | --- | --- |
| proto-airport-field-furrow | 28 rows across harvest plots | Instanced |
| proto-airport-fence-post | 25 posts | Instanced |
| proto-airport-tree-trunk | 64 tree placements | Instanced |
| proto-airport-tree-lower-canopy | 64 tree placements | Instanced |
| proto-airport-tree-upper-canopy | 64 tree placements | Instanced |
| proto-airport-hay-bale | 18 rolled bales | Instanced |
| proto-airport-cloud-puff | Layered cloud clusters | Instanced |
| proto-airport-runway-light-base | Runway edge lights | Instanced |
| proto-airport-runway-light-lens | Runway edge lights | Instanced |

Future repeated variants must remain limited, coherent, and instanced. They may not allocate one geometry/material per placement.

## Hero assets

| Registry ID | Current landmark | Current editability | Required future handling |
| --- | --- | --- | --- |
| hero-main-orange-trim-hangar | Main hangar | Procedural multi-mesh in RunwayWorld | Preserve footprint/silhouette; validate individually if replaced |
| hero-maintenance-hangar | Maintenance hangar | Procedural multi-mesh | Same |
| hero-east-field-farm-shed | Pilot landmark | Procedural multi-mesh | First round-trip unchanged; 9/10 grid if replaced |
| hero-airport-operations-office | Office, tower, beacon | Procedural multi-mesh | Preserve sight-line role and beacon |
| hero-airfield-fuel-depot | Twin tanks and pipe | Procedural multi-mesh | Preserve safe distance and silhouette |
| hero-aerium-spire | Metropolitan landmark | Pooled procedural instances | Not independently loadable today |
| hero-azure-beacon | Harbor landmark | Pooled procedural instances | Not independently loadable today |
| hero-grand-foundry | Ironworks landmark | Pooled procedural instances | Not independently loadable today |
| hero-sunstone-minaret | Citadel landmark | Pooled procedural instances | Not independently loadable today |

The four urban landmarks are stable semantic identities but share generic urban pools. Converting one to an independent asset is a future region-specific migration, not a prerequisite for the data adapter.

## Interactive assets

| Registry ID | Asset | Existing hierarchy contract |
| --- | --- | --- |
| interactive-airplane-taildragger | Cropper Seven, the only playable vehicle | Root, propeller pivot, main-wheel pivots, tail-wheel pivot, ailerons, elevator, rudder, camera focus, exhaust and wingtip sockets, shadow proxy, hidden body/wing collision proxies, paint controller |

The airplane remains owned by Game and AirplaneModel and is not streamed with a world chunk. WorldClaw may reserve routes and clearances for it but must not duplicate, reparent, fuse, or replace it.

Current model dimensions recorded by AirplaneModel are 9.8 units overall length, 11.76 units wingspan, 1.81 visible propeller radius, 1.86 propeller safety radius, 0.52 main-wheel radius, and 0.2 tail-wheel radius.

No interactive doors, gates, cranes, fuel pumps, farm machines, cars, trucks, motorcycles, boats, tractors, or networked props exist. Their visual counterparts or labels are not interaction contracts.

## Materials

The airfield uses a shared material library including asphalt, concrete, grass variants, harvest/earth, foliage, trunk, rock, hangar surfaces, metals, glass, wood, windsock fabric, hay, cloud, runway lights, and warning lights. The streamed world uses one vertex-colored terrain material plus a small shared palette for bark/deadwood, foliage, ground cover, mineral, water/ice, snow/salt, crystal, and emissive glow. Urban slots share box and roof materials per slot.

The current streamed-world tests expect zero streaming textures. New texture use must remain inside the whole-scene texture budget and must define color space, compression, filtering, atlas policy, and fallback.

The airfield material library creates four local procedural DataTextures. Five declared roles—grass, rock, mountainNear, mountainMiddle, and mountainFar—are currently dormant outside the library and must not be counted as visible region assets.

## Collision and interaction metadata

Current asset metadata is uneven:

- Airplane: explicit moving pivots, sockets, dimensions, and hidden proxies.
- Terrain: exact scalar height collision.
- Runway: height override, not mesh collision.
- World structures and props: no collision.
- Water: visual only.
- Doors and gates: visual only or absent.

A future asset registry must not mark a world asset collidable merely because visible mesh bounds exist. Collision sidecars require a named owner, shape, layer/mask policy, local transform, test, and performance budget.

## Coordinate conventions

Current placement conventions differ:

- Fixed airport objects: world-origin local transforms under RunwayWorld.
- Terrain and urban slots: chunk-local vertices/instances, parent positioned at chunk center.
- Natural streamed props: world-absolute instance matrices in global family meshes.
- Airplane parts: local hierarchy under the aircraft root.

Compiled world artifacts standardize on chunk-local transforms. The runtime adapter must convert natural placements when writing the existing global instance pools and must never apply the chunk offset twice.

## Known inventory risks

1. There is no independent asset file to hash for most content; source revision and compiled geometry recipes must initially supply identity.
2. Urban landmark IDs describe compositions, not standalone assets.
3. The unused reference PNG is copied into production output.
4. Replacing procedural content with textured hero assets can exhaust the current geometry ceiling, which already has no measured active-flight headroom.
5. Shared natural-family capacities are global across the 3 by 3 window, not per chunk.
6. Urban capacity is per slot and silently tracks dropped instances; compiled data must reject over-budget chunks.
7. Mixed coordinate conventions are a placement risk.
8. World structures have no gameplay collision; adding collision is a separate feature.

## Pilot asset decision

The pilot uses existing-streamed-terrain plus proto-biome-trunk, proto-biome-canopy, proto-biome-ground-cover, proto-biome-rock, and proto-biome-deadwood without regeneration. The first pilot artifact validates terrain, seams, identity, and transforms only. It requires no hero or resident interactive asset; the existing airplane visits the region for landing tests.

No missing asset is approved yet. After current-region captures, a composition proposal may identify a small missing set. If it does, the proposal must decide explicitly among:

- Reuse an existing prototype.
- Construct procedurally in Three.js.
- Create locally in Blender.
- Generate a source image and convert it through a validated 3D workflow.
- Use a licensed marketplace/local asset already available.

The selected source and resulting evidence must be added to asset_registry.json before integration.
