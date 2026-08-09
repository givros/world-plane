import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';
import type { BufferAttribute, BufferGeometry, Mesh, Object3D } from 'three';

type Vector3Sample = {
  x: number;
  y: number;
  z: number;
};

type FlightSnapshotSample = {
  mode: string;
  phase: string;
  phaseProgress: number;
  normalizedProgress: number;
  elapsed: number;
  airborneSeconds: number;
  speed: number;
  altitude: number;
  verticalSpeed: number;
  throttle: number;
  stall: boolean;
  crashed: boolean;
  onGround: boolean;
  pitch: number;
  bank: number;
  yaw: number;
  propellerRpm: number;
  wheelContact: {
    main: boolean;
    auxiliary: boolean;
    all: boolean;
  };
  completed: boolean;
  running: boolean;
  inspectionAllowed: boolean;
  position: Vector3Sample;
};

type PilotInputSample = {
  throttle: number;
  pitch: number;
  roll: number;
  yaw: number;
  brake: boolean;
};

type ExperienceDiagnostics = {
  frame: number;
  flight: FlightSnapshotSample;
  input: PilotInputSample;
  camera: {
    position: Vector3Sample;
    fov: number;
  };
  renderer: {
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
  model: {
    dimensions: {
      overallLength: number;
      wingspan: number;
      propellerRadius: number;
      propellerSafetyRadius: number;
      propellerGroundClearance: number;
      mainWheelRadius: number;
      tailWheelRadius: number;
    };
  };
};

type AirplaneExperience = {
  start: () => void;
  startManual: () => void;
  reset: () => void;
  setTimeScale: (value: number) => void;
  readonly state: FlightSnapshotSample;
  readonly diagnostics: ExperienceDiagnostics;
};

type ExperienceReadout = {
  state: FlightSnapshotSample;
  diagnostics: ExperienceDiagnostics;
};

type CanvasSample = {
  ok: boolean;
  reason: string;
  sampledPixels?: number;
  lumaRange?: number;
  colorBuckets?: number;
};

type BrowserErrors = {
  console: string[];
  page: string[];
};

type StreamingDiagnosticsSample = {
  chunkSize: number;
  gridSize: number;
  centerChunk: { x: number; z: number };
  loadedChunkCount: number;
  loadedChunkKeys: string[];
  loadedChunks: Array<{
    key: string;
    x: number;
    z: number;
    biomeId: string;
    biomeLabel: string;
  }>;
  activeBiomeIds: string[];
  catalog: Array<{ id: string; label: string; signature: string }>;
  slotsCreated: number;
  slotsReused: number;
  chunksEvicted: number;
  poolSize: number;
  revision: number;
  activeInstances: number;
  instancedMeshes: number;
  terrainMeshes: number;
  uniqueGeometries: number;
  uniqueMaterials: number;
  fog: { near: number; far: number };
};

function watchBrowserErrors(page: Page): BrowserErrors {
  const errors: BrowserErrors = { console: [], page: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') errors.console.push(message.text());
  });
  page.on('pageerror', (error) => errors.page.push(error.message));
  return errors;
}

function expectNoBrowserErrors(errors: BrowserErrors): void {
  expect(errors.console, 'browser console errors').toEqual([]);
  expect(errors.page, 'uncaught page errors').toEqual([]);
}

async function openExperience(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#game-canvas')).toBeVisible();
  await page.waitForFunction(() => {
    const experience = (
      window as typeof window & { __AIRPLANE_EXPERIENCE__?: AirplaneExperience }
    ).__AIRPLANE_EXPERIENCE__;
    return Boolean(
      experience &&
        typeof experience.start === 'function' &&
        typeof experience.startManual === 'function' &&
        typeof experience.reset === 'function' &&
        typeof experience.setTimeScale === 'function' &&
        experience.state &&
        experience.diagnostics?.frame > 5,
    );
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

async function readExperience(page: Page): Promise<ExperienceReadout> {
  return page.evaluate(() => {
    const experience = (
      window as typeof window & { __AIRPLANE_EXPERIENCE__?: AirplaneExperience }
    ).__AIRPLANE_EXPERIENCE__;
    if (!experience) throw new Error('Missing window.__AIRPLANE_EXPERIENCE__.');

    const copyFlight = (flight: FlightSnapshotSample): FlightSnapshotSample => ({
      mode: flight.mode,
      phase: flight.phase,
      phaseProgress: flight.phaseProgress,
      normalizedProgress: flight.normalizedProgress,
      elapsed: flight.elapsed,
      airborneSeconds: flight.airborneSeconds,
      speed: flight.speed,
      altitude: flight.altitude,
      verticalSpeed: flight.verticalSpeed,
      throttle: flight.throttle,
      stall: flight.stall,
      crashed: flight.crashed,
      onGround: flight.onGround,
      pitch: flight.pitch,
      bank: flight.bank,
      yaw: flight.yaw,
      propellerRpm: flight.propellerRpm,
      wheelContact: { ...flight.wheelContact },
      completed: flight.completed,
      running: flight.running,
      inspectionAllowed: flight.inspectionAllowed,
      position: { ...flight.position },
    });

    const diagnostics = experience.diagnostics;
    return {
      state: copyFlight(experience.state),
      diagnostics: {
        frame: diagnostics.frame,
        flight: copyFlight(diagnostics.flight),
        input: { ...diagnostics.input },
        camera: {
          position: { ...diagnostics.camera.position },
          fov: diagnostics.camera.fov,
        },
        renderer: { ...diagnostics.renderer },
        canvas: { ...diagnostics.canvas },
        model: {
          dimensions: { ...diagnostics.model.dimensions },
        },
      },
    };
  });
}

async function readFlightState(page: Page): Promise<FlightSnapshotSample> {
  return page.evaluate(() => {
    const experience = (
      window as typeof window & { __AIRPLANE_EXPERIENCE__?: AirplaneExperience }
    ).__AIRPLANE_EXPERIENCE__;
    if (!experience) throw new Error('Missing window.__AIRPLANE_EXPERIENCE__.');
    const flight = experience.state;
    return {
      mode: flight.mode,
      phase: flight.phase,
      phaseProgress: flight.phaseProgress,
      normalizedProgress: flight.normalizedProgress,
      elapsed: flight.elapsed,
      airborneSeconds: flight.airborneSeconds,
      speed: flight.speed,
      altitude: flight.altitude,
      verticalSpeed: flight.verticalSpeed,
      throttle: flight.throttle,
      stall: flight.stall,
      crashed: flight.crashed,
      onGround: flight.onGround,
      pitch: flight.pitch,
      bank: flight.bank,
      yaw: flight.yaw,
      propellerRpm: flight.propellerRpm,
      wheelContact: { ...flight.wheelContact },
      completed: flight.completed,
      running: flight.running,
      inspectionAllowed: flight.inspectionAllowed,
      position: { ...flight.position },
    };
  });
}

async function readStreamingDiagnostics(page: Page): Promise<StreamingDiagnosticsSample> {
  return page.evaluate(() => {
    const experience = (
      window as typeof window & { __AIRPLANE_EXPERIENCE__?: AirplaneExperience }
    ).__AIRPLANE_EXPERIENCE__;
    if (!experience) throw new Error('Missing window.__AIRPLANE_EXPERIENCE__.');
    const diagnostics = experience.diagnostics as ExperienceDiagnostics & {
      world?: { streaming?: StreamingDiagnosticsSample };
    };
    if (!diagnostics.world?.streaming) {
      throw new Error('Missing infinite-world streaming diagnostics.');
    }
    return structuredClone(diagnostics.world.streaming);
  });
}

function expectedChunkKeys(centerX: number, centerZ: number): string[] {
  const keys: string[] = [];
  for (let z = centerZ - 1; z <= centerZ + 1; z += 1) {
    for (let x = centerX - 1; x <= centerX + 1; x += 1) {
      keys.push(`${x}:${z}`);
    }
  }
  return keys.sort((first, second) => first.localeCompare(second));
}

async function sampleCanvas(page: Page): Promise<CanvasSample> {
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  if (!box || box.width < 320 || box.height < 180) {
    return { ok: false, reason: 'canvas-too-small' };
  }

  const buffer = await canvas.screenshot();
  const png = PNG.sync.read(buffer);
  let minLuma = 255;
  let maxLuma = 0;
  let sampledPixels = 0;
  const buckets = new Set<string>();
  const pixelCount = png.width * png.height;
  const stride = Math.max(1, Math.floor(pixelCount / 8192));

  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const offset = pixel * 4;
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    const a = png.data[offset + 3];
    if (a < 16) continue;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    minLuma = Math.min(minLuma, luma);
    maxLuma = Math.max(maxLuma, luma);
    sampledPixels += 1;
    buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
  }

  const lumaRange = maxLuma - minLuma;
  return {
    ok: sampledPixels > 512 && lumaRange > 16 && buckets.size > 12,
    reason: 'sampled',
    sampledPixels,
    lumaRange,
    colorBuckets: buckets.size,
  };
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });
}

function distance(a: Vector3Sample, b: Vector3Sample): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

test.describe('desktop airplane experience', () => {
  test('starts clean with a nonblank 3D canvas and complete flight UI', async ({ page }, testInfo) => {
    const errors = watchBrowserErrors(page);
    await openExperience(page);

    await expect(page.locator('#brand-lockup')).toBeVisible();
    await expect(page.locator('#brand-lockup h1')).toContainText(/Cropper\s+Seven/i);
    await expect(page.locator('#flight-hud')).toBeVisible();
    await expect(page.locator('#telemetry')).toBeVisible();
    await expect(page.locator('#inspection-hint')).toBeVisible();
    await expect(page.locator('#flight-button')).toBeVisible();
    await expect(page.locator('#flight-button')).toContainText(/Take controls/i);
    await expect(page.locator('#cinematic-button')).toBeVisible();
    await expect(page.locator('#cinematic-button')).toContainText(/Watch cinematic/i);
    await expect(page.locator('#phase-label')).toHaveText(/RUNWAY READY/i);

    const sample = await sampleCanvas(page);
    expect(sample, JSON.stringify(sample)).toMatchObject({ ok: true });

    const readout = await readExperience(page);
    expect(readout.state.phase).toBe('parked');
    expect(readout.state.running).toBe(false);
    expect(readout.state.completed).toBe(false);
    expect(readout.state.propellerRpm).toBeCloseTo(0, 4);
    expect(readout.diagnostics.flight.phase).toBe(readout.state.phase);
    expect(readout.diagnostics.frame).toBeGreaterThan(5);
    expect(readout.diagnostics.renderer.calls).toBeGreaterThan(0);
    expect(readout.diagnostics.renderer.triangles).toBeGreaterThan(0);
    expect(readout.diagnostics.renderer.geometries).toBeGreaterThan(0);
    expect(readout.diagnostics.canvas.clientWidth).toBeGreaterThanOrEqual(320);
    expect(readout.diagnostics.canvas.clientHeight).toBeGreaterThanOrEqual(180);
    expect(readout.diagnostics.canvas.width).toBeGreaterThanOrEqual(
      readout.diagnostics.canvas.clientWidth,
    );
    expect(readout.diagnostics.canvas.height).toBeGreaterThanOrEqual(
      readout.diagnostics.canvas.clientHeight,
    );
    expect(readout.diagnostics.model.dimensions.overallLength).toBeCloseTo(9.8, 2);
    expect(readout.diagnostics.model.dimensions.wingspan).toBeCloseTo(11.76, 2);
    expect(readout.diagnostics.model.dimensions.propellerRadius).toBeCloseTo(1.81, 2);
    expect(readout.diagnostics.model.dimensions.propellerSafetyRadius).toBeCloseTo(1.86, 2);
    expect(readout.diagnostics.model.dimensions.propellerGroundClearance).toBeGreaterThanOrEqual(0.12);
    expect(readout.diagnostics.model.dimensions.mainWheelRadius).toBeCloseTo(0.52, 2);
    expect(readout.diagnostics.model.dimensions.tailWheelRadius).toBeCloseTo(0.2, 2);

    const streaming = await readStreamingDiagnostics(page);
    expect(streaming.gridSize).toBe(3);
    expect(streaming.loadedChunkCount).toBe(9);
    expect(streaming.centerChunk).toEqual({ x: 0, z: 0 });
    expect(streaming.loadedChunkKeys).toEqual(expectedChunkKeys(0, 0));
    expect(new Set(streaming.loadedChunkKeys).size).toBe(9);
    expect(streaming.slotsCreated).toBe(9);
    expect(streaming.poolSize).toBe(0);
    expect(streaming.terrainMeshes).toBe(9);
    expect(streaming.instancedMeshes).toBeGreaterThan(0);
    expect(streaming.catalog.length).toBeGreaterThanOrEqual(10);
    expect(new Set(streaming.catalog.map((biome) => biome.id)).size).toBeGreaterThanOrEqual(10);
    expect(
      new Set(
        streaming.catalog.map((biome) => biome.signature.split('|').slice(1).join('|')),
      ).size,
    ).toBeGreaterThanOrEqual(10);
    expect(streaming.fog.near).toBeGreaterThan(0);
    expect(streaming.fog.far).toBeGreaterThan(streaming.fog.near);
    expect(streaming.fog.far).toBeLessThanOrEqual(streaming.chunkSize * 0.9);
    expect(readout.diagnostics.renderer.calls).toBeLessThanOrEqual(260);
    expect(readout.diagnostics.renderer.triangles).toBeLessThanOrEqual(180_000);
    expect(readout.diagnostics.renderer.geometries).toBeLessThanOrEqual(240);
    expect(readout.diagnostics.renderer.textures).toBeLessThanOrEqual(16);

    await attachScreenshot(page, testInfo, 'desktop-initial');
    expectNoBrowserErrors(errors);
  });

  test('streams a deterministic recycled 3x3 biome grid without resource growth', async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await openExperience(page);

    const probe = await page.evaluate(async () => {
      const moduleUrl = '/src/world/InfiniteBiomeWorld.ts';
      const { createInfiniteBiomeWorld } = await import(/* @vite-ignore */ moduleUrl) as typeof import(
        '../src/world/InfiniteBiomeWorld'
      );
      const world = createInfiniteBiomeWorld({ seed: 0x071c0a57 });
      type FocusPosition = Parameters<typeof world.update>[0];
      const position = (x: number, z: number): FocusPosition =>
        ({ x, y: 0, z }) as FocusPosition;
      const snapshot = (): StreamingDiagnosticsSample =>
        JSON.parse(JSON.stringify(world.diagnostics)) as StreamingDiagnosticsSample;
      const keysFor = (centerX: number, centerZ: number): string[] => {
        const keys: string[] = [];
        for (let z = centerZ - 1; z <= centerZ + 1; z += 1) {
          for (let x = centerX - 1; x <= centerX + 1; x += 1) {
            keys.push(`${x}:${z}`);
          }
        }
        return keys.sort((first, second) => first.localeCompare(second));
      };

      const initialChanged = world.recenterNow(position(0, 0));
      const initial = snapshot();
      const initialChildren = [...world.group.children];
      const initialGeometries = new Set<object>();
      const initialMaterials = new Set<object>();
      const initialTextures = new Set<object>();
      world.group.traverse((object) => {
        const mesh = object as unknown as {
          geometry?: object;
          material?: object | object[];
        };
        if (mesh.geometry) initialGeometries.add(mesh.geometry);
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        materials.forEach((material) => {
          initialMaterials.add(material);
          Object.values(material as Record<string, unknown>).forEach((value) => {
            if (value && typeof value === 'object' && 'isTexture' in value) {
              initialTextures.add(value);
            }
          });
        });
      });

      const beforeBoundaryChanged = world.update(position(initial.chunkSize * 0.5 - 0.1, 0));
      const beforeBoundary = snapshot();
      const crossedBoundary = world.update(position(initial.chunkSize * 0.5 + 0.1, 0));
      const afterBoundary = snapshot();
      const intraChunkChanged = world.update(position(initial.chunkSize * 0.5 + 100, 0));
      const afterIntraChunkMove = snapshot();

      world.recenterNow(position(0, 0));
      const routeBaseline = snapshot();
      let routeChangedCount = 0;
      let routeGridValid = true;
      let routeLoadedMin = Number.POSITIVE_INFINITY;
      let routeLoadedMax = 0;
      let routePoolMax = 0;
      let routeInstancesMax = 0;
      for (let step = 1; step <= 100; step += 1) {
        if (world.update(position(step * initial.chunkSize, 0))) routeChangedCount += 1;
        const diagnostics = world.diagnostics;
        routeLoadedMin = Math.min(routeLoadedMin, diagnostics.loadedChunkCount);
        routeLoadedMax = Math.max(routeLoadedMax, diagnostics.loadedChunkCount);
        routePoolMax = Math.max(routePoolMax, diagnostics.poolSize);
        routeInstancesMax = Math.max(routeInstancesMax, diagnostics.activeInstances);
        if (
          diagnostics.centerChunk.x !== step
          || diagnostics.centerChunk.z !== 0
          || diagnostics.loadedChunkKeys.join('|') !== keysFor(step, 0).join('|')
        ) {
          routeGridValid = false;
        }
      }
      const afterRoute = snapshot();

      const finalGeometries = new Set<object>();
      const finalMaterials = new Set<object>();
      const finalTextures = new Set<object>();
      world.group.traverse((object) => {
        const mesh = object as unknown as {
          geometry?: object;
          material?: object | object[];
        };
        if (mesh.geometry) finalGeometries.add(mesh.geometry);
        const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        materials.forEach((material) => {
          finalMaterials.add(material);
          Object.values(material as Record<string, unknown>).forEach((value) => {
            if (value && typeof value === 'object' && 'isTexture' in value) {
              finalTextures.add(value);
            }
          });
        });
      });
      const sameGeometryIdentities =
        initialGeometries.size === finalGeometries.size
        && [...initialGeometries].every((resource) => finalGeometries.has(resource));
      const sameMaterialIdentities =
        initialMaterials.size === finalMaterials.size
        && [...initialMaterials].every((resource) => finalMaterials.has(resource));
      const sameTextureIdentities =
        initialTextures.size === finalTextures.size
        && [...initialTextures].every((resource) => finalTextures.has(resource));
      const sameChildIdentities =
        initialChildren.length === world.group.children.length
        && initialChildren.every((child) => world.group.children.includes(child));

      const catalogIds = new Set(initial.catalog.map((biome) => biome.id));
      const mappedBiomes = new Map<string, { x: number; z: number }>();
      for (let z = -20; z <= 20 && mappedBiomes.size < catalogIds.size; z += 1) {
        for (let x = -20; x <= 20 && mappedBiomes.size < catalogIds.size; x += 1) {
          const biome = world.getBiomeForChunk(x, z);
          if (!mappedBiomes.has(biome.id)) mappedBiomes.set(biome.id, { x, z });
        }
      }

      const resetChanged = world.recenterNow(position(0, 0));
      const afterReset = snapshot();

      let geometryDisposeEvents = 0;
      let materialDisposeEvents = 0;
      initialGeometries.forEach((resource) => {
        (resource as { addEventListener: (type: string, listener: () => void) => void })
          .addEventListener('dispose', () => { geometryDisposeEvents += 1; });
      });
      initialMaterials.forEach((resource) => {
        (resource as { addEventListener: (type: string, listener: () => void) => void })
          .addEventListener('dispose', () => { materialDisposeEvents += 1; });
      });
      world.dispose();
      const afterDispose = snapshot();
      const firstDisposeEvents = { geometryDisposeEvents, materialDisposeEvents };
      world.dispose();
      const secondDisposeEvents = { geometryDisposeEvents, materialDisposeEvents };

      return {
        initialChanged,
        initial,
        resourceCounts: {
          children: initialChildren.length,
          geometries: initialGeometries.size,
          materials: initialMaterials.size,
          textures: initialTextures.size,
        },
        beforeBoundaryChanged,
        beforeBoundary,
        crossedBoundary,
        afterBoundary,
        intraChunkChanged,
        afterIntraChunkMove,
        routeBaseline,
        routeChangedCount,
        routeGridValid,
        routeLoadedMin,
        routeLoadedMax,
        routePoolMax,
        routeInstancesMax,
        afterRoute,
        sameGeometryIdentities,
        sameMaterialIdentities,
        sameTextureIdentities,
        sameChildIdentities,
        mappedBiomeIds: [...mappedBiomes.keys()].sort(),
        mappedBiomeCoordinates: [...mappedBiomes.entries()],
        resetChanged,
        afterReset,
        firstDisposeEvents,
        secondDisposeEvents,
        afterDispose,
      };
    });

    expect(probe.initialChanged).toBe(true);
    expect(probe.initial.gridSize).toBe(3);
    expect(probe.initial.loadedChunkCount).toBe(9);
    expect(probe.initial.loadedChunkKeys).toEqual(expectedChunkKeys(0, 0));
    expect(probe.initial.slotsCreated).toBe(9);
    expect(probe.initial.poolSize).toBe(0);
    expect(probe.initial.fog.far).toBeLessThanOrEqual(probe.initial.chunkSize * 0.9);

    expect(probe.beforeBoundaryChanged).toBe(false);
    expect(probe.beforeBoundary).toEqual(probe.initial);
    expect(probe.crossedBoundary).toBe(true);
    expect(probe.afterBoundary.centerChunk).toEqual({ x: 1, z: 0 });
    expect(probe.afterBoundary.loadedChunkCount).toBe(9);
    expect(probe.afterBoundary.loadedChunkKeys).toEqual(expectedChunkKeys(1, 0));
    expect(
      probe.initial.loadedChunkKeys.filter((key) => probe.afterBoundary.loadedChunkKeys.includes(key)),
    ).toHaveLength(6);
    expect(probe.afterBoundary.chunksEvicted - probe.beforeBoundary.chunksEvicted).toBe(3);
    expect(probe.afterBoundary.slotsReused - probe.beforeBoundary.slotsReused).toBe(3);
    expect(probe.afterBoundary.revision - probe.beforeBoundary.revision).toBe(1);

    expect(probe.intraChunkChanged).toBe(false);
    expect(probe.afterIntraChunkMove).toEqual(probe.afterBoundary);

    expect(probe.routeChangedCount).toBe(100);
    expect(probe.routeGridValid).toBe(true);
    expect(probe.routeLoadedMin).toBe(9);
    expect(probe.routeLoadedMax).toBe(9);
    expect(probe.routePoolMax).toBe(0);
    expect(probe.routeInstancesMax).toBeGreaterThan(0);
    expect(probe.afterRoute.centerChunk).toEqual({ x: 100, z: 0 });
    expect(probe.afterRoute.loadedChunkKeys).toEqual(expectedChunkKeys(100, 0));
    expect(probe.afterRoute.chunksEvicted - probe.routeBaseline.chunksEvicted).toBe(300);
    expect(probe.afterRoute.slotsReused - probe.routeBaseline.slotsReused).toBe(300);
    expect(probe.afterRoute.revision - probe.routeBaseline.revision).toBe(100);
    expect(probe.afterRoute.slotsCreated).toBe(probe.initial.slotsCreated);
    expect(probe.afterRoute.uniqueGeometries).toBe(probe.initial.uniqueGeometries);
    expect(probe.afterRoute.uniqueMaterials).toBe(probe.initial.uniqueMaterials);
    expect(probe.sameGeometryIdentities).toBe(true);
    expect(probe.sameMaterialIdentities).toBe(true);
    expect(probe.sameTextureIdentities).toBe(true);
    expect(probe.sameChildIdentities).toBe(true);
    expect(probe.resourceCounts.textures).toBe(0);

    const catalogIds = probe.initial.catalog.map((biome) => biome.id).sort();
    expect(catalogIds).toHaveLength(14);
    expect(new Set(catalogIds).size).toBe(14);
    expect(probe.mappedBiomeIds).toEqual(catalogIds);
    expect(probe.mappedBiomeCoordinates).toHaveLength(14);
    expect(new Set(probe.initial.catalog.map((biome) => biome.signature)).size).toBe(14);
    expect(
      new Set(
        probe.initial.catalog.map((biome) => biome.signature.split('|').slice(1).join('|')),
      ).size,
    ).toBe(14);

    expect(probe.resetChanged).toBe(true);
    expect(probe.afterReset.centerChunk).toEqual({ x: 0, z: 0 });
    expect(probe.afterReset.loadedChunkKeys).toEqual(expectedChunkKeys(0, 0));
    expect(probe.afterReset.loadedChunkCount).toBe(9);
    expect(probe.afterReset.slotsCreated).toBe(probe.initial.slotsCreated);
    expect(probe.afterReset.uniqueGeometries).toBe(probe.initial.uniqueGeometries);
    expect(probe.afterReset.uniqueMaterials).toBe(probe.initial.uniqueMaterials);

    expect(probe.firstDisposeEvents.geometryDisposeEvents).toBe(probe.resourceCounts.geometries);
    expect(probe.firstDisposeEvents.materialDisposeEvents).toBe(probe.resourceCounts.materials);
    expect(probe.secondDisposeEvents).toEqual(probe.firstDisposeEvents);
    expect(probe.afterDispose.loadedChunkCount).toBe(0);
    expect(probe.afterDispose.loadedChunkKeys).toEqual([]);
    expect(probe.afterDispose.loadedChunks).toEqual([]);
    expect(probe.afterDispose.activeBiomeIds).toEqual([]);
    expect(probe.afterDispose.poolSize).toBe(0);

    expectNoBrowserErrors(errors);
  });

  test('uses rendered biome terrain for safe and hard manual landing contact', async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await openExperience(page);

    const probe = await page.evaluate(async () => {
      const threeUrl = '/@id/three';
      const controllerUrl = '/src/systems/ManualFlightController.ts';
      const worldUrl = '/src/world/InfiniteBiomeWorld.ts';
      const THREE = await import(/* @vite-ignore */ threeUrl) as typeof import('three');
      const { ManualFlightController } = await import(
        /* @vite-ignore */ controllerUrl
      ) as typeof import('../src/systems/ManualFlightController');
      const { createInfiniteBiomeWorld } = await import(
        /* @vite-ignore */ worldUrl
      ) as typeof import('../src/world/InfiniteBiomeWorld');

      const world = createInfiniteBiomeWorld({ seed: 0x071c0a57 });
      const runway = {
        centerlineX: 0,
        surfaceY: 0,
        parkingZ: -112,
        takeoffEndZ: 105,
        touchdownZ: -104,
        finalStopZ: 124,
        width: 24,
        southThresholdZ: -150,
        northThresholdZ: 150,
      };
      const surfaceHeightAt = (worldX: number, worldZ: number): number => {
        const overRunway = Math.abs(worldX) <= runway.width * 0.5 + 1.5
          && worldZ >= runway.southThresholdZ - 2
          && worldZ <= runway.northThresholdZ + 2;
        return overRunway ? runway.surfaceY : world.getTerrainHeight(worldX, worldZ);
      };
      const slopeAt = (worldX: number, worldZ: number): number => {
        const offset = 2.5;
        const riseX = surfaceHeightAt(worldX + offset, worldZ)
          - surfaceHeightAt(worldX - offset, worldZ);
        const riseZ = surfaceHeightAt(worldX, worldZ + offset)
          - surfaceHeightAt(worldX, worldZ - offset);
        return Math.atan(Math.hypot(riseX, riseZ) / (offset * 2));
      };

      let target = { x: 800, z: 800, slope: Number.POSITIVE_INFINITY };
      for (let z = 640; z <= 960; z += 20) {
        for (let x = 640; x <= 960; x += 20) {
          const slope = slopeAt(x, z);
          if (slope < target.slope) target = { x, z, slope };
        }
      }
      world.recenterNow(new THREE.Vector3(target.x, 0, target.z));

      const chunkCoordinate = (value: number): number => Math.floor((value + 400) / 800);
      const targetChunk = {
        x: chunkCoordinate(target.x),
        z: chunkCoordinate(target.z),
      };
      const targetChunkKey = `${targetChunk.x}:${targetChunk.z}`;
      const terrain = world.group.children.find(
        (child) => child.userData.chunkKey === targetChunkKey,
      ) as Mesh<BufferGeometry> | undefined;
      if (!terrain) throw new Error(`Missing rendered terrain for ${targetChunkKey}.`);
      const terrainPositions = terrain.geometry.getAttribute('position') as BufferAttribute;
      let maximumRenderedHeightError = 0;
      for (let index = 0; index < terrainPositions.count; index += 1) {
        const worldX = terrain.position.x + terrainPositions.getX(index);
        const worldZ = terrain.position.z + terrainPositions.getZ(index);
        maximumRenderedHeightError = Math.max(
          maximumRenderedHeightError,
          Math.abs(terrainPositions.getY(index) - world.getTerrainHeight(worldX, worldZ)),
        );
      }

      const createController = () => {
        const root = new THREE.Object3D();
        const propeller = new THREE.Object3D();
        const leftMainWheel = new THREE.Object3D();
        const rightMainWheel = new THREE.Object3D();
        const tailWheel = new THREE.Object3D();
        propeller.position.set(0, 1.55, 2.6);
        leftMainWheel.position.set(-1, 0.5, 0.45);
        rightMainWheel.position.set(1, 0.5, 0.45);
        tailWheel.position.set(0, 0.2, -2);
        const controller = new ManualFlightController(
          {
            root,
            propeller,
            mainWheels: [leftMainWheel, rightMainWheel],
            auxiliaryWheel: tailWheel,
          },
          {
            runway,
            mainWheelRadius: 0.5,
            auxiliaryWheelRadius: 0.2,
            propellerSafetyRadius: 1.2,
            surfaceHeightAt,
          },
        );
        return { controller, root };
      };
      type ControllerState = ReturnType<typeof createController>['controller']['state'];
      const copyState = (state: ControllerState) => ({
        phase: state.phase,
        running: state.running,
        crashed: state.crashed,
        completed: state.completed,
        onGround: state.onGround,
        speed: state.speed,
        altitude: state.altitude,
        verticalSpeed: state.verticalSpeed,
        throttle: state.throttle,
        pitch: state.pitch,
        bank: state.bank,
        yaw: state.yaw,
        wheelContact: { ...state.wheelContact },
        position: { x: state.position.x, y: state.position.y, z: state.position.z },
      });
      const neutralIntent = () => ({
        throttle: 0,
        pitch: 0,
        roll: 0,
        yaw: 0,
        brake: false,
      });
      const takeOff = (
        controller: ReturnType<typeof createController>['controller'],
      ): void => {
        controller.start();
        const intent = neutralIntent();
        for (let step = 0; step < 4_000 && controller.state.onGround; step += 1) {
          intent.throttle = controller.state.throttle < 0.99 ? 1 : 0;
          intent.pitch = controller.state.speed >= 29 ? 1 : 0;
          controller.update(1 / 120, intent);
        }
        if (controller.state.onGround || controller.state.crashed) {
          throw new Error('The minimal test rig could not take off.');
        }
      };
      const prepareDescent = (
        controller: ReturnType<typeof createController>['controller'],
        hard: boolean,
      ) => {
        const intent = neutralIntent();
        let previousState = copyState(controller.state);
        let hardSinkEstablished = false;
        for (let step = 0; step < 3_000; step += 1) {
          const state = controller.state;
          if (state.crashed && hard) {
            return {
              beforeContact: previousState,
              terminalContact: copyState(state),
            };
          }
          const pitchDegrees = state.pitch * 180 / Math.PI;
          intent.throttle = state.throttle > (hard ? 0.35 : 0.62) ? -1 : 0;
          if (hard) {
            if (!hardSinkEstablished && state.verticalSpeed < -7) hardSinkEstablished = true;
            intent.pitch = hardSinkEstablished
              ? (pitchDegrees < -3.5 ? 1 : 0)
              : -1;
            if (
              state.verticalSpeed < -5.5
              && pitchDegrees >= -4
              && pitchDegrees <= 10
              && state.speed >= 14
              && state.speed <= 56
            ) return { beforeContact: copyState(state) };
          } else {
            if (state.verticalSpeed > -1.5 && pitchDegrees > -3) intent.pitch = -1;
            else if (state.verticalSpeed < -4.5 || pitchDegrees < -3) intent.pitch = 1;
            else intent.pitch = 0;
            if (
              state.verticalSpeed <= -1
              && state.verticalSpeed >= -4.5
              && pitchDegrees >= -3
              && pitchDegrees <= 12
              && state.speed >= 14
              && state.speed <= 56
            ) return { beforeContact: copyState(state) };
          }
          previousState = copyState(state);
          controller.update(1 / 120, intent);
        }
        throw new Error(
          `Could not prepare the ${hard ? 'hard' : 'soft'} descent: ${JSON.stringify(copyState(controller.state))}`,
        );
      };
      const makeContact = (
        controller: ReturnType<typeof createController>['controller'],
        root: Object3D,
      ): ControllerState => {
        root.position.y = surfaceHeightAt(root.position.x, root.position.z) + 0.08;
        const intent = neutralIntent();
        for (let step = 0; step < 60; step += 1) {
          controller.update(1 / 120, intent);
          if (controller.state.onGround || controller.state.crashed) return controller.state;
        }
        throw new Error('The aircraft did not contact the biome terrain.');
      };

      const softRig = createController();
      takeOff(softRig.controller);
      softRig.root.position.set(
        target.x,
        surfaceHeightAt(target.x, target.z) + 3,
        target.z,
      );
      softRig.controller.update(1 / 120, neutralIntent());
      const softDescent = prepareDescent(softRig.controller, false);
      const softBeforeContact = softDescent.beforeContact;
      const softContact = copyState(makeContact(softRig.controller, softRig.root));

      const hardRig = createController();
      takeOff(hardRig.controller);
      hardRig.root.position.set(
        target.x + 40,
        surfaceHeightAt(target.x + 40, target.z + 40) + 50,
        target.z + 40,
      );
      hardRig.controller.update(1 / 120, neutralIntent());
      const hardDescent = prepareDescent(hardRig.controller, true);
      const hardBeforeContact = hardDescent.beforeContact;
      const hardContact = hardDescent.terminalContact
        ?? copyState(makeContact(hardRig.controller, hardRig.root));

      const result = {
        target,
        targetChunk,
        targetChunkKey,
        targetBiomeId: world.getBiomeForChunk(targetChunk.x, targetChunk.z).id,
        sampledTargetHeight: world.getTerrainHeight(target.x, target.z),
        renderedTargetHeight: (() => {
          let nearestIndex = 0;
          let nearestDistance = Number.POSITIVE_INFINITY;
          for (let index = 0; index < terrainPositions.count; index += 1) {
            const worldX = terrain.position.x + terrainPositions.getX(index);
            const worldZ = terrain.position.z + terrainPositions.getZ(index);
            const distance = Math.hypot(worldX - target.x, worldZ - target.z);
            if (distance < nearestDistance) {
              nearestDistance = distance;
              nearestIndex = index;
            }
          }
          return {
            height: terrainPositions.getY(nearestIndex),
            distance: nearestDistance,
          };
        })(),
        maximumRenderedHeightError,
        softBeforeContact,
        softContact,
        softContactSurfaceHeight: surfaceHeightAt(
          softContact.position.x,
          softContact.position.z,
        ),
        hardBeforeContact,
        hardContact,
      };
      world.dispose();
      return result;
    });

    expect(probe.targetChunkKey).not.toBe('0:0');
    expect(probe.targetBiomeId).toBeTruthy();
    expect(probe.target.slope).toBeLessThan(8 * Math.PI / 180);
    expect(probe.maximumRenderedHeightError).toBeLessThan(1e-5);
    expect(probe.renderedTargetHeight.distance).toBeLessThanOrEqual(36);
    expect(Math.abs(probe.sampledTargetHeight - probe.renderedTargetHeight.height)).toBeLessThan(0.06);

    expect(probe.softBeforeContact.verticalSpeed).toBeGreaterThanOrEqual(-4.5);
    expect(probe.softBeforeContact.verticalSpeed).toBeLessThanOrEqual(-1);
    expect(probe.softBeforeContact.speed).toBeGreaterThanOrEqual(14);
    expect(probe.softBeforeContact.speed).toBeLessThanOrEqual(56);
    expect(Math.abs(probe.softBeforeContact.bank)).toBeLessThanOrEqual(18 * Math.PI / 180);
    expect(probe.softContact.position.x).toBeGreaterThan(400);
    expect(probe.softContact.position.z).toBeGreaterThan(400);
    expect(probe.softContact.onGround).toBe(true);
    expect(probe.softContact.crashed).toBe(false);
    expect(probe.softContact.phase).toBe('touchdown');
    expect(probe.softContact.altitude).toBeCloseTo(0, 5);
    expect(probe.softContact.position.y - probe.softContactSurfaceHeight).toBeLessThan(0.2);

    expect(probe.hardBeforeContact.verticalSpeed).toBeLessThan(-5.2);
    expect(probe.hardBeforeContact.speed).toBeGreaterThanOrEqual(14);
    expect(probe.hardBeforeContact.speed).toBeLessThanOrEqual(56);
    expect(Math.abs(probe.hardBeforeContact.bank)).toBeLessThanOrEqual(18 * Math.PI / 180);
    expect(probe.hardContact.onGround).toBe(false);
    expect(probe.hardContact.crashed).toBe(true);
    expect(probe.hardContact.phase).toBe('crashed');
    expectNoBrowserErrors(errors);
  });

  test('supports orbit drag and wheel zoom while parked', async ({ page }, testInfo) => {
    const errors = watchBrowserErrors(page);
    await openExperience(page);

    const canvas = page.locator('#game-canvas');
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    if (!canvasBox) throw new Error('The game canvas has no interactive bounds.');

    const initial = await readExperience(page);
    expect(initial.state.phase).toBe('parked');
    expect(initial.state.inspectionAllowed).toBe(true);

    const startX = canvasBox.x + canvasBox.width * 0.58;
    const startY = canvasBox.y + canvasBox.height * 0.48;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 230, startY + 75, { steps: 14 });
    await page.mouse.up();

    await expect
      .poll(async () => {
        const current = await readExperience(page);
        return distance(current.diagnostics.camera.position, initial.diagnostics.camera.position);
      })
      .toBeGreaterThan(1);

    await page.waitForTimeout(350);
    const afterOrbit = await readExperience(page);
    const radiusAfterOrbit = distance(
      afterOrbit.diagnostics.camera.position,
      afterOrbit.state.position,
    );

    await page.mouse.move(startX, startY);
    await page.mouse.wheel(0, 650);
    await expect
      .poll(async () => {
        const current = await readExperience(page);
        return distance(current.diagnostics.camera.position, current.state.position) - radiusAfterOrbit;
      })
      .toBeGreaterThan(0.4);

    const afterZoom = await readExperience(page);
    expect(afterZoom.state.phase).toBe('parked');
    expect(afterZoom.diagnostics.camera.fov).toBeGreaterThan(20);

    await attachScreenshot(page, testInfo, 'desktop-inspection-orbit-zoom');
    expectNoBrowserErrors(errors);
  });

  test('manual controls throttle, take off, turn, release, and reset', async ({ page }, testInfo) => {
    const errors = watchBrowserErrors(page);
    await openExperience(page);

    const canvas = page.locator('#game-canvas');
    const initial = await readFlightState(page);
    expect(initial.phase).toBe('parked');
    expect(initial.onGround).toBe(true);
    expect(initial.throttle).toBeCloseTo(0, 4);

    const keys = ['z', 's', 'j', 'l', 'Space', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'];
    try {
      await page.locator('#flight-button').click();
      await expect(canvas).toBeFocused();
      await expect.poll(async () => (await readFlightState(page)).mode).toBe('manual');
      await expect.poll(async () => (await readFlightState(page)).running).toBe(true);

      await page.keyboard.down('z');
      await expect
        .poll(async () => (await readFlightState(page)).throttle, { timeout: 5_000 })
        .toBeGreaterThan(0.82);
      await page.keyboard.up('z');

      const throttleReleased = await readExperience(page);
      expect(throttleReleased.diagnostics.input.throttle).toBe(0);
      expect(throttleReleased.state.throttle).toBeGreaterThan(0.8);
      expect(throttleReleased.state.propellerRpm).toBeGreaterThan(2_000);

      await expect
        .poll(async () => (await readFlightState(page)).speed)
        .toBeGreaterThan(12);

      const beforeLeftRudder = await readFlightState(page);
      await page.keyboard.down('j');
      await expect.poll(async () => (await readExperience(page)).diagnostics.input.yaw).toBe(-1);
      await expect
        .poll(async () => (await readFlightState(page)).yaw)
        .toBeGreaterThan(beforeLeftRudder.yaw + 0.012);
      await page.keyboard.up('j');
      await expect.poll(async () => (await readExperience(page)).diagnostics.input.yaw).toBe(0);
      await page.waitForTimeout(300);

      const beforeRightRudder = await readFlightState(page);
      await page.keyboard.down('l');
      await expect.poll(async () => (await readExperience(page)).diagnostics.input.yaw).toBe(1);
      await expect
        .poll(async () => (await readFlightState(page)).yaw)
        .toBeLessThan(beforeRightRudder.yaw - 0.012);
      await page.keyboard.up('l');
      await expect.poll(async () => (await readExperience(page)).diagnostics.input.yaw).toBe(0);
      await page.waitForTimeout(300);

      const beforeBrake = await readFlightState(page);
      await page.keyboard.down('Space');
      await expect.poll(async () => (await readExperience(page)).diagnostics.input.brake).toBe(true);
      await expect
        .poll(async () => (await readFlightState(page)).speed, { timeout: 3_000 })
        .toBeLessThan(beforeBrake.speed - 0.4);
      await page.keyboard.up('Space');
      await expect.poll(async () => (await readExperience(page)).diagnostics.input.brake).toBe(false);

      await expect
        .poll(async () => (await readFlightState(page)).speed, { timeout: 6_000 })
        .toBeGreaterThan(27);
      const rolling = await readFlightState(page);
      expect(rolling.position.z).toBeGreaterThan(initial.position.z + 15);
      expect(rolling.onGround).toBe(true);

      await page.keyboard.down('ArrowDown');
      await expect.poll(async () => (await readExperience(page)).diagnostics.input.pitch).toBe(1);
      await expect
        .poll(async () => (await readFlightState(page)).altitude, { timeout: 6_000 })
        .toBeGreaterThan(5);
      const climbing = await readFlightState(page);
      expect(climbing.onGround).toBe(false);
      expect(climbing.crashed).toBe(false);
      expect(climbing.speed).toBeGreaterThan(25);
      expect(climbing.verticalSpeed).toBeGreaterThan(0);
      expect(climbing.pitch).toBeGreaterThan(5 * Math.PI / 180);
      await page.keyboard.up('ArrowDown');
      await expect.poll(async () => (await readExperience(page)).diagnostics.input.pitch).toBe(0);

      const beforeNoseDown = await readFlightState(page);
      await page.keyboard.down('ArrowUp');
      await expect.poll(async () => (await readExperience(page)).diagnostics.input.pitch).toBe(-1);
      await expect
        .poll(async () => (await readFlightState(page)).pitch)
        .toBeLessThan(beforeNoseDown.pitch - 2 * Math.PI / 180);
      await page.keyboard.up('ArrowUp');
      await expect.poll(async () => (await readExperience(page)).diagnostics.input.pitch).toBe(0);

      const beforeTurn = await readFlightState(page);
      await page.keyboard.down('ArrowLeft');
      await expect
        .poll(async () => (await readFlightState(page)).bank)
        .toBeLessThan(-8 * Math.PI / 180);

      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await expect.poll(async () => (await readExperience(page)).diagnostics.input.roll).toBe(0);
      await page.keyboard.up('ArrowLeft');
      await page.waitForTimeout(450);

      const afterTurn = await readFlightState(page);
      expect(afterTurn.yaw - beforeTurn.yaw).toBeGreaterThan(0.01);
      expect(afterTurn.crashed).toBe(false);

      const beforeRightTurn = await readFlightState(page);
      await page.keyboard.down('ArrowRight');
      await expect
        .poll(async () => (await readFlightState(page)).bank)
        .toBeGreaterThan(8 * Math.PI / 180);
      await page.waitForTimeout(500);
      await page.keyboard.up('ArrowRight');
      await page.waitForTimeout(180);

      const afterRightTurn = await readFlightState(page);
      expect(afterRightTurn.yaw - beforeRightTurn.yaw).toBeLessThan(-0.01);
      expect(afterRightTurn.bank).toBeGreaterThan(0);
      expect(afterRightTurn.crashed).toBe(false);

      const throttleBeforeReduction = (await readFlightState(page)).throttle;
      await page.keyboard.down('s');
      await expect.poll(async () => (await readExperience(page)).diagnostics.input.throttle).toBe(-1);
      await expect
        .poll(async () => (await readFlightState(page)).throttle, { timeout: 3_000 })
        .toBeLessThan(throttleBeforeReduction - 0.1);
      await page.keyboard.up('s');
      await expect.poll(async () => (await readExperience(page)).diagnostics.input.throttle).toBe(0);

      await page.keyboard.press('r');
      await expect.poll(async () => (await readFlightState(page)).phase).toBe('parked');

      const reset = await readExperience(page);
      expect(reset.state.running).toBe(false);
      expect(reset.state.completed).toBe(false);
      expect(reset.state.crashed).toBe(false);
      expect(reset.state.onGround).toBe(true);
      expect(reset.state.speed).toBeCloseTo(0, 4);
      expect(reset.state.throttle).toBeCloseTo(0, 4);
      expect(reset.state.propellerRpm).toBeCloseTo(0, 4);
      expect(reset.state.position.z).toBeGreaterThan(-112.1);
      expect(reset.state.position.z).toBeLessThan(-111.9);
      expect(reset.state.wheelContact).toEqual({ main: true, auxiliary: true, all: true });
      expect(reset.diagnostics.input).toEqual({
        throttle: 0,
        pitch: 0,
        roll: 0,
        yaw: 0,
        brake: false,
      });
      const resetStreaming = await readStreamingDiagnostics(page);
      expect(resetStreaming.centerChunk).toEqual({ x: 0, z: 0 });
      expect(resetStreaming.loadedChunkCount).toBe(9);
      expect(resetStreaming.loadedChunkKeys).toEqual(expectedChunkKeys(0, 0));
      expect(resetStreaming.poolSize).toBe(0);
    } finally {
      for (const key of keys) await page.keyboard.up(key);
    }

    await attachScreenshot(page, testInfo, 'desktop-manual-flight-reset');
    expectNoBrowserErrors(errors);
  });

  test('cinematic button starts propeller spin and takeoff roll', async ({ page }, testInfo) => {
    const errors = watchBrowserErrors(page);
    await openExperience(page);

    const initial = await readFlightState(page);
    await page.evaluate(() => {
      const experience = (
        window as typeof window & { __AIRPLANE_EXPERIENCE__?: AirplaneExperience }
      ).__AIRPLANE_EXPERIENCE__;
      if (!experience) throw new Error('Missing window.__AIRPLANE_EXPERIENCE__.');
      experience.setTimeScale(3);
    });
    await page.locator('#cinematic-button').click();

    await expect(page.locator('#cinematic-button')).toBeDisabled();
    await expect
      .poll(async () => (await readFlightState(page)).propellerRpm)
      .toBeGreaterThan(300);
    await expect
      .poll(async () => {
        const state = await readFlightState(page);
        return state.position.z - initial.position.z;
      })
      .toBeGreaterThan(2);

    const takeoff = await readFlightState(page);
    expect(takeoff.mode).toBe('autopilot');
    expect(takeoff.phase).not.toBe('parked');
    expect(takeoff.running).toBe(true);
    expect(takeoff.speed).toBeGreaterThan(0);
    expect(takeoff.propellerRpm).toBeGreaterThan(300);

    await attachScreenshot(page, testInfo, 'desktop-takeoff-roll');
    expectNoBrowserErrors(errors);
  });

  test('completes the accelerated flight, lands, replays, and resets', async ({ page }, testInfo) => {
    const errors = watchBrowserErrors(page);
    await openExperience(page);

    await page.evaluate(() => {
      const experience = (
        window as typeof window & { __AIRPLANE_EXPERIENCE__?: AirplaneExperience }
      ).__AIRPLANE_EXPERIENCE__;
      if (!experience) throw new Error('Missing window.__AIRPLANE_EXPERIENCE__.');
      experience.setTimeScale(20);
      experience.start();
    });

    await expect
      .poll(async () => (await readFlightState(page)).completed, { timeout: 20_000 })
      .toBe(true);

    const completed = await readExperience(page);
    expect(completed.state.phase).toBe('complete');
    expect(completed.state.running).toBe(false);
    expect(completed.state.airborneSeconds).toBeGreaterThanOrEqual(29.99);
    expect(completed.state.airborneSeconds).toBeLessThanOrEqual(30.001);
    expect(Math.abs(completed.state.altitude)).toBeLessThan(0.15);
    expect(completed.state.position.z).toBeGreaterThan(123.5);
    expect(completed.state.position.z).toBeLessThan(124.5);
    expect(completed.state.wheelContact).toEqual({
      main: true,
      auxiliary: true,
      all: true,
    });
    expect(completed.state.propellerRpm).toBeCloseTo(0, 3);
    expect(completed.diagnostics.renderer.calls).toBeGreaterThan(0);
    expect(completed.diagnostics.renderer.triangles).toBeGreaterThan(0);
    await expect(page.locator('#phase-label')).toHaveText(/SAFELY HOME/i);
    await attachScreenshot(page, testInfo, 'desktop-flight-complete');

    await page.evaluate(() => {
      const experience = (
        window as typeof window & { __AIRPLANE_EXPERIENCE__?: AirplaneExperience }
      ).__AIRPLANE_EXPERIENCE__;
      if (!experience) throw new Error('Missing window.__AIRPLANE_EXPERIENCE__.');
      experience.setTimeScale(1);
    });
    await page.locator('#cinematic-button').click();
    await expect
      .poll(async () => {
        const state = await readFlightState(page);
        return state.running && state.phase !== 'complete';
      })
      .toBe(true);

    await page.evaluate(() => {
      const experience = (
        window as typeof window & { __AIRPLANE_EXPERIENCE__?: AirplaneExperience }
      ).__AIRPLANE_EXPERIENCE__;
      if (!experience) throw new Error('Missing window.__AIRPLANE_EXPERIENCE__.');
      experience.reset();
    });
    await expect.poll(async () => (await readFlightState(page)).phase).toBe('parked');

    const reset = await readFlightState(page);
    expect(reset.running).toBe(false);
    expect(reset.completed).toBe(false);
    expect(reset.elapsed).toBeCloseTo(0, 4);
    expect(reset.airborneSeconds).toBeCloseTo(0, 4);
    expect(Math.abs(reset.altitude)).toBeLessThan(0.01);
    expect(reset.position.z).toBeGreaterThan(-112.1);
    expect(reset.position.z).toBeLessThan(-111.9);
    expect(reset.wheelContact).toEqual({
      main: true,
      auxiliary: true,
      all: true,
    });
    await expect(page.locator('#flight-button')).toContainText(/Take controls/i);
    await expect(page.locator('#cinematic-button')).toContainText(/Watch cinematic/i);
    await attachScreenshot(page, testInfo, 'desktop-flight-reset');

    expectNoBrowserErrors(errors);
  });
});
