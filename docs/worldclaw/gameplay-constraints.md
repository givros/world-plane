# WorldClaw Gameplay Constraints

Status: preservation contract before world modification

## Authoritative gameplay

The game has one playable vehicle: a procedural taildragger airplane. It supports manual flight, an authored autopilot showcase, parked inspection, reset/replay, camera transitions, paint selection, audio, and VFX.

No ground character, road vehicle, watercraft, farming vehicle, multiplayer session, network authority, quest system, or general-purpose interaction system exists. World specifications must record those systems as absent, not infer them from scenery labels.

## Spawn and safe state

The only gameplay spawn is the aircraft parking state:

- Position: (0, 0, -112) at runway surface level before the aircraft ground offset is applied.
- Heading: aligned with the runway and preferred +Z takeoff direction.
- Parent region: region-airport-origin.
- Safe surface: runway 18/36.
- Reset behavior: manual and autopilot controllers reset, the biome grid recenters at the airport, and airport scenery is made visible.

Source: src/world/RunwayWorld.ts:1394-1411 and src/game/Game.ts:389-413.

There are no player-character spawns or multiplayer spawns.

## Controls to preserve

| Intent | Current inputs |
| --- | --- |
| Throttle up/down | W or Z / S |
| Pitch | Arrow Down to raise nose, Arrow Up to lower nose |
| Roll | Arrow Left/Right; A/Q and D |
| Yaw | J and L |
| Brake | Space |
| Reset | R and HUD reset |
| Start selected flight action | Enter and HUD actions |
| Fullscreen | F and HUD action |
| Parked inspection | Pointer orbit/pan/zoom and view shortcuts |
| Paint | HUD swatches/color input; stored locally |

Source: src/systems/PilotInput.ts:9-23 and src/systems/PilotInput.ts:87-95.

World integration must not capture these keys, change the input ownership, or make the initial parking state unsafe.

## Flight and collision model

Manual flight advances through a fixed 1/120 second accumulator. The flight controller evaluates wheel, tailwheel, and propeller support clearances using a callback supplied by Game. Game returns y = 0 over the paved runway and InfiniteBiomeWorld.getTerrainHeight elsewhere.

Important consequences:

- Terrain height is queried several times per simulation step.
- The query must be synchronous and allocation-free in the normal path.
- It must return a finite number for any world X/Z, loaded or not.
- The height must be deterministic for the same world seed and data revision.
- Rendered terrain and collision terrain must use the same two-triangle interpolation inside every 32 m cell.
- Shared chunk-edge samples must be bit-identical after float conversion.
- A delayed or loaded-chunk-only height source can produce missing ground, stale contact, crashes, or tunneling.
- Since flight simulation runs before streaming in each frame, visual chunk availability cannot be the authority for collision.

Sources: src/systems/ManualFlightController.ts:25, src/systems/ManualFlightController.ts:278-286, src/systems/ManualFlightController.ts:530-565, src/game/Game.ts:246-256, and src/game/Game.ts:416-425.

There is no collision against buildings, fences, trees, rocks, roads, water, or urban props. Hidden aircraft collision proxies exist in the model, but the world controller does not run broadphase or mesh collision against them. New visible obstacles therefore must not be described as physically collidable until an explicit, separately tested collision feature is implemented.

## Runway and airfield invariants

| Invariant | Required value |
| --- | ---: |
| Centerline | x = 0 |
| Paved width | 24 m |
| Paved Z extent | -180 m to 180 m |
| Threshold Z extent | -150 m to 150 m |
| Surface Y | 0 m |
| Safe corridor half-width | 18 m |
| Parking Z | -112 m |
| Takeoff sequence end | z = 105 m |
| Touchdown target | z = -104 m |
| Active controller final stop | z = 124 m |
| Preferred takeoff | +Z |

RunwayWorld separately exposes rolloutStopPosition at z = 104 m, while Game configures both active controllers with finalStopZ = 124 m. The structured route records both facts and treats z = 124 m as active behavior. Do not alter these values through generated terrain, semantic masks, or asset placement. Any future runway migration requires a coordinated update to RunwayWorld, both flight controllers, Game, route data, tests, and existing save/reset assumptions.

The 18 m safe-corridor value is metadata in the current game; no flight-controller branch reads it. WorldClaw adopts it as a conservative placement reservation without claiming that it is already mechanically enforced.

## Critical routes

### Route route-airport-runway-18-36

This is the only dedicated runway height override. It connects the parking position, +Z takeoff roll, approaches, touchdown, and rollout. Off-airport terrain contact remains supported separately.

### Route airport-taxiway-to-apron

The current visual taxiway is a Catmull-Rom ribbon from approximately (-11.9, -24) to (-48, -47), with an apron centered near (-54, -49). It is a visual vehicle-access path but is not used by controller AI or a taxi objective. Its clearance and shape must nevertheless remain unchanged.

### Route route-autopilot-showcase

The authored airborne curve contains 19 points. It starts at the +Z takeoff end, climbs to roughly 110 m, arcs as far as x = 240 m and z = 385 m, returns through negative Z, and touches down at z = -104 m. It is contained around the origin airfield and relies on unobstructed runway approaches and nearby sight lines.

Source: src/systems/FlightSequence.ts:310-329 and src/systems/FlightSequence.ts:827-850.

The complete numeric route is mirrored in data/world/gameplay_routes.json. The TypeScript implementation remains authoritative until a later migration explicitly makes the structured file runtime-owned.

## Activities and interactions

Implemented activities:

- Free manual ground operation, takeoff, flight, landing, hard-contact recovery, relaunch, and optional reset.
- Authored autopilot/cinematic takeoff, circuit, landing, finale, and replay.
- Parked aircraft inspection.
- Aircraft paint selection.
- Fullscreen and sound controls.

Animated but non-interactive world objects:

- Windsock bearing and sleeve.
- Airport beacon emissive pulse.
- Runway and threshold lights.
- Travelling clouds and sky/horizon presentation.

Decorative-only content:

- Field plots and furrows.
- Farm shed and hay bales.
- Trees and biome vegetation.
- Urban road traffic roles.
- Harbor basins, docks, and service traffic roles.
- Industrial and citadel roles.

There are no doors, gates, machines, crops, harvest loops, fuel interactions, cargo interactions, or networked objects.

## Persistence compatibility

The only persisted value is the aircraft paint color at localStorage key cropper-seven-aircraft-paint. There is no position, world, route, chunk, mission, inventory, or multiplayer save data.

WorldClaw integration must leave this key and its accepted color format unchanged. A future world-save format must be introduced as a new versioned system; it cannot be presented as existing compatibility.

Source: src/game/Game.ts:49-66 and src/game/Game.ts:519-524.

## Streaming constraints

1. The active 3 by 3 chunk window follows the aircraft.
2. Chunk membership changes at centered 1280 m boundaries.
3. The fixed airport appears while chunk 0:0 is loaded.
4. The origin reserve prevents natural and urban props inside max(abs(x), abs(z)) less than 430 m.
5. Terrain outside currently authored WorldClaw coverage must fall back to the current procedural generator.
6. Visual assets may be staged or streamed asynchronously only if collision terrain and the fallback render state remain valid.
7. Chunk reassignment must not change shared geometry/material identity or exceed pool capacities.
8. Natural placements must be converted deliberately between current world-absolute matrices and the proposed chunk-local artifact convention.

## Vehicle and access matrix

| Access type | Current state | WorldClaw rule |
| --- | --- | --- |
| Aircraft runway | Implemented and critical | Preserve exact clearances |
| Aircraft taxiway/apron | Visible, not objective-driven | Preserve geometry and access |
| General off-airport landing | Implemented on sampled terrain and regression-protected | Preserve it; validate slope and clearance |
| Cars and trucks | No vehicle/system | Do not author gameplay routes |
| Motorcycles | No vehicle/system | Do not author gameplay routes |
| Tractors | No vehicle/system | Do not author gameplay routes |
| Boats | No vehicle/system; water is visual | Do not claim navigability |
| Humanoid paths | No character/system | Do not claim walkability |

## Placement exclusion volumes

Before any generated object is accepted, it must remain outside:

- The paved runway footprint.
- The 18 m runway safe corridor plus asset-specific safety margin.
- Threshold and approach-light clearances.
- The taxiway and apron swept envelope.
- The aircraft parking and reset envelope.
- The authored autopilot 3D safety tube, including propeller and wing clearance.
- Existing buildings, fence, windsock, lights, field landmarks, and sight-line reservations.
- Chunk-edge seam guards for assets whose footprint cannot be split safely.

Until object/world collision exists, no newly generated obstacle may rely on a collider to make an otherwise unsafe placement acceptable.

## Acceptance gates

A future world change is gameplay-safe only when all of the following pass:

1. The repaired Stage 0 shader and semantic terrain-identity regressions remain green.
2. Manual controls remain active through ground taxi, takeoff, turn, landing, hard-contact recovery, full stop, and relaunch without requiring reset.
3. The accelerated autopilot completes, lands, replays, and resets.
4. Spawn and parking remain stable with all wheel contacts valid.
5. Runway, taxiway, and approach corridors remain unobstructed.
6. Terrain contact matches rendered triangles at random points, chunk edges, and authored/procedural seams.
7. Arbitrary-coordinate height sampling remains finite and deterministic.
8. Stream boundary crossings do not change resource identity or lose collision coverage.
9. Aircraft paint persistence remains compatible.
10. No absent multiplayer, farming, ground-vehicle, boat, or save system is claimed as validated.
