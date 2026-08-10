import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { BufferAttribute, BufferGeometry, Mesh, Object3D } from 'three';

const isCI = Boolean(process.env.CI);

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

type OrbitCameraSample = {
  enabled: boolean;
  dragging: boolean;
  yawOffset: number;
  pitchOffset: number;
  zoom: number;
  distance: number;
};

type CharacterInputSample = {
  enabled: boolean;
  pressedCodes: string[];
  intent: {
    moveX: number;
    moveZ: number;
    sprint: boolean;
    jump: boolean;
  };
};

type CharacterDiagnosticsSample = {
  loadState: 'loading' | 'ready' | 'fallback' | 'disposed';
  loaded: boolean;
  visible: boolean;
  characterId: 'pilot' | 'field' | 'racer';
  position: Vector3Sample;
  yaw: number;
  requestedAnimation: 'idle' | 'walk' | 'run' | 'jump';
  activeAnimation: 'idle' | 'walk' | 'run' | 'jump' | null;
  availableAnimations: Array<'idle' | 'walk' | 'run' | 'jump'>;
  loadError: string | null;
  controller: {
    fixedStep: number;
    accumulator: number;
    walkSpeed: number;
    runSpeed: number;
    jumpSpeed: number;
    maximumSlopeDegrees: number;
    maximumStepHeight: number;
    state: {
      enabled: boolean;
      grounded: boolean;
      blockedBySlope: boolean;
      animation: 'idle' | 'walk' | 'run' | 'jump';
      speed: number;
      verticalSpeed: number;
      terrainHeight: number;
      position: Vector3Sample;
      yaw: number;
    };
  };
};

type ExperienceDiagnostics = {
  frame: number;
  flight: FlightSnapshotSample;
  input: PilotInputSample;
  gameplay: {
    controlMode: 'inspection' | 'on-foot' | 'piloting' | 'autopilot';
    character: CharacterDiagnosticsSample;
    interaction: {
      kind: 'enter-aircraft' | 'exit-aircraft' | null;
      available: boolean;
      distance: number;
      radius: number;
      promptVisible: boolean;
      worldPosition: Vector3Sample;
    };
    hub: {
      visible: boolean;
      settingsOpen: boolean;
      selectedCharacter: 'pilot' | 'field' | 'racer';
      aircraftPaint: string;
    };
    input: CharacterInputSample;
  };
  camera: {
    controller: 'inspection' | 'character' | 'pilot' | 'cinematic';
    position: Vector3Sample;
    fov: number;
    pilot: OrbitCameraSample;
    character: OrbitCameraSample;
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
    paint: {
      selectedColor: string;
      revision: number;
    };
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
  startAutopilot: () => void;
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
    resolution: 'procedural' | 'authored' | 'procedural-fallback';
  }>;
  activeBiomeIds: string[];
  catalog: Array<{ id: string; label: string; signature: string }>;
  slotsCreated: number;
  slotsReused: number;
  chunksEvicted: number;
  poolSize: number;
  revision: number;
  activeInstances: number;
  droppedInstances: number;
  instancedMeshes: number;
  terrainMeshes: number;
  uniqueGeometries: number;
  uniqueMaterials: number;
  fog: { near: number; far: number };
  worldSource: {
    manifestHash: string;
    sourceHash: string;
    compiledDescriptorCount: number;
    activeAuthoredChunkKeys: string[];
    activeFallbackChunkKeys: string[];
  };
  urban: {
    activeChunkCount: number;
  };
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
        typeof experience.startAutopilot === 'function' &&
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
        gameplay: structuredClone(diagnostics.gameplay),
        camera: {
          controller: diagnostics.camera.controller,
          position: { ...diagnostics.camera.position },
          fov: diagnostics.camera.fov,
          pilot: { ...diagnostics.camera.pilot },
          character: { ...diagnostics.camera.character },
        },
        renderer: { ...diagnostics.renderer },
        canvas: { ...diagnostics.canvas },
        model: {
          paint: { ...diagnostics.model.paint },
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
  if (isCI) return;
  await testInfo.attach(name, {
    body: await page.screenshot({ animations: 'disabled' }),
    contentType: 'image/png',
  });
}

function distance(a: Vector3Sample, b: Vector3Sample): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function planarDistance(a: Vector3Sample, b: Vector3Sample): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function planarHeading(from: Vector3Sample, to: Vector3Sample): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

function angleDistance(first: number, second: number): number {
  return Math.abs(Math.atan2(Math.sin(first - second), Math.cos(first - second)));
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
    await expect(page.locator('#flight-button')).toContainText(/Play/i);
    await expect(page.locator('#cinematic-button')).toBeVisible();
    await expect(page.locator('#cinematic-button')).toContainText(/Watch the flight showcase/i);
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
    expect(streaming.urban.activeChunkCount).toBeGreaterThan(0);
    expect(streaming.worldSource.activeAuthoredChunkKeys).toEqual([
      '-1:-1',
      '-1:0',
      '-1:1',
      '0:1',
      '1:-1',
      '1:0',
      '1:1',
    ]);
    expect(streaming.worldSource.activeFallbackChunkKeys).toEqual([]);
    expect(
      streaming.loadedChunks.find((chunk) => chunk.key === '0:0')?.resolution,
    ).toBe('procedural');
    expect(readout.diagnostics.renderer.calls).toBeLessThanOrEqual(260);
    expect(readout.diagnostics.renderer.triangles).toBeLessThanOrEqual(180_000);
    expect(readout.diagnostics.renderer.geometries).toBeLessThanOrEqual(250);
    expect(readout.diagnostics.renderer.textures).toBeLessThanOrEqual(16);

    await attachScreenshot(page, testInfo, 'desktop-initial');
    expect(
      errors.console.filter((message) =>
        message.includes('Material Name: procedural-urban-volume')),
      'procedural urban shader compile errors',
    ).toEqual([]);
    expectNoBrowserErrors(errors);
  });

  test('welcome hub keeps the selected pilot, aircraft colour, and settings through Play and reset', async ({
    page,
  }, testInfo) => {
    const errors = watchBrowserErrors(page);
    await openExperience(page);

    const hub = page.locator('#welcome-hub');
    const settingsPanel = page.locator('#settings-panel');
    const pilotChoice = page.locator('.character-choice[data-character="pilot"]');
    const racerChoice = page.locator('.character-choice[data-character="racer"]');
    const redPaint = page.locator('.paint-swatch[data-color="#c84732"]');

    await expect(hub).toBeVisible();
    await expect(page.locator('#hub-title')).toHaveText(/Choose your setup/i);
    await expect(page.locator('#character-selector')).toBeVisible();
    await expect(page.locator('.aircraft-selector')).toBeVisible();
    await expect(page.locator('#flight-button')).toContainText(/Play/i);
    await expect(page.locator('#settings-button')).toContainText(/Settings/i);
    await expect(pilotChoice).toHaveAttribute('aria-pressed', 'true');
    await expect(racerChoice).toHaveAttribute('aria-pressed', 'false');

    const initial = await readExperience(page);
    expect(initial.diagnostics.gameplay.hub).toEqual({
      visible: true,
      settingsOpen: false,
      selectedCharacter: 'pilot',
      aircraftPaint: '#ed870c',
    });

    await racerChoice.click();
    await expect(racerChoice).toHaveAttribute('aria-pressed', 'true');
    await expect(pilotChoice).toHaveAttribute('aria-pressed', 'false');
    await expect(racerChoice.locator('.pilot-portrait')).toBeVisible();
    expect(
      await racerChoice.evaluate((element) =>
        getComputedStyle(element).getPropertyValue('--suit').trim().toLowerCase()),
    ).toBe('#9a3329');
    await expect
      .poll(async () => (await readExperience(page)).diagnostics.gameplay.hub.selectedCharacter)
      .toBe('racer');
    expect((await readExperience(page)).diagnostics.gameplay.character.characterId).toBe('racer');

    await expect(page.locator('#paint-presets')).toBeVisible();
    await redPaint.click();
    await expect(redPaint).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#paint-color-value')).toHaveText('#C84732');
    await expect
      .poll(async () => (await readExperience(page)).diagnostics.model.paint.selectedColor)
      .toBe('#c84732');
    const configured = await readExperience(page);
    expect(configured.diagnostics.model.paint.revision)
      .toBeGreaterThan(initial.diagnostics.model.paint.revision);
    expect(configured.diagnostics.gameplay.hub).toMatchObject({
      selectedCharacter: 'racer',
      aircraftPaint: '#c84732',
    });

    await page.locator('#settings-button').click();
    await expect(settingsPanel).toBeVisible();
    await expect
      .poll(async () => (await readExperience(page)).diagnostics.gameplay.hub.settingsOpen)
      .toBe(true);
    const soundSetting = page.locator('#settings-sound-input');
    await expect(soundSetting).toBeChecked();
    await page.locator('.settings-toggle').click();
    await expect(soundSetting).not.toBeChecked();
    await expect(page.locator('#sound-button')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#settings-close-button').click();
    await expect(settingsPanel).toBeHidden();
    await expect
      .poll(async () => (await readExperience(page)).diagnostics.gameplay.hub.settingsOpen)
      .toBe(false);

    await page.locator('#settings-button').click();
    await expect(settingsPanel).toBeVisible();
    await expect(soundSetting).not.toBeChecked();
    await page.keyboard.press('Escape');
    await expect(settingsPanel).toBeHidden();

    await page.locator('#flight-button').click();
    await expect
      .poll(async () => (await readExperience(page)).diagnostics.gameplay.controlMode)
      .toBe('on-foot');
    await expect(hub).toBeHidden();
    const playing = await readExperience(page);
    expect(playing.diagnostics.gameplay.character.visible).toBe(true);
    expect(playing.diagnostics.gameplay.character.characterId).toBe('racer');
    expect(playing.diagnostics.gameplay.hub).toMatchObject({
      visible: false,
      selectedCharacter: 'racer',
      aircraftPaint: '#c84732',
    });
    expect(playing.diagnostics.model.paint.selectedColor).toBe('#c84732');

    await page.evaluate(() => {
      const experience = (
        window as typeof window & { __AIRPLANE_EXPERIENCE__?: AirplaneExperience }
      ).__AIRPLANE_EXPERIENCE__;
      if (!experience) throw new Error('Missing window.__AIRPLANE_EXPERIENCE__.');
      experience.reset();
    });
    await expect
      .poll(async () => (await readExperience(page)).diagnostics.gameplay.hub.visible)
      .toBe(true);
    await expect(hub).toBeVisible();
    await expect(racerChoice).toHaveAttribute('aria-pressed', 'true');
    await expect(redPaint).toHaveAttribute('aria-pressed', 'true');
    const reset = await readExperience(page);
    expect(reset.diagnostics.gameplay.controlMode).toBe('inspection');
    expect(reset.diagnostics.gameplay.hub).toMatchObject({
      selectedCharacter: 'racer',
      aircraftPaint: '#c84732',
    });
    expect(reset.diagnostics.model.paint.selectedColor).toBe('#c84732');

    await attachScreenshot(page, testInfo, 'desktop-configured-welcome-hub');
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
      const constructionStarted = performance.now();
      const world = createInfiniteBiomeWorld({ seed: 0x071c0a57 });
      const constructionMs = performance.now() - constructionStarted;
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

      const initialPopulationStarted = performance.now();
      const initialChanged = world.recenterNow(position(0, 0));
      const initialPopulationMs = performance.now() - initialPopulationStarted;
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
      const routeUpdateDurationsMs: number[] = [];
      for (let step = 1; step <= 100; step += 1) {
        const updateStarted = performance.now();
        if (world.update(position(step * initial.chunkSize, 0))) routeChangedCount += 1;
        routeUpdateDurationsMs.push(performance.now() - updateStarted);
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
      const orderedRouteDurationsMs = [...routeUpdateDurationsMs]
        .sort((first, second) => first - second);
      const routeDurationTotalMs = routeUpdateDurationsMs
        .reduce((total, duration) => total + duration, 0);

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
        streamingTiming: {
          constructionMs,
          initialPopulationMs,
          crossings: routeUpdateDurationsMs.length,
          meanCrossingMs: routeDurationTotalMs / routeUpdateDurationsMs.length,
          p95CrossingMs: orderedRouteDurationsMs[
            Math.ceil(orderedRouteDurationsMs.length * 0.95) - 1
          ],
          maximumCrossingMs: orderedRouteDurationsMs.at(-1) ?? 0,
        },
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
    expect(probe.afterDispose.worldSource.activeAuthoredChunkKeys).toEqual([]);
    expect(probe.afterDispose.worldSource.activeFallbackChunkKeys).toEqual([]);

    const timingOutputDirectory = path.resolve('output/worldclaw/performance');
    await mkdir(timingOutputDirectory, { recursive: true });
    await writeFile(
      path.join(timingOutputDirectory, 'streaming.json'),
      `${JSON.stringify({
        ...probe.streamingTiming,
        manifestHash: probe.initial.worldSource.manifestHash,
        compiledDescriptorCount: probe.initial.worldSource.compiledDescriptorCount,
        resourceIdentityStable: probe.sameGeometryIdentities
          && probe.sameMaterialIdentities
          && probe.sameTextureIdentities
          && probe.sameChildIdentities,
        droppedInstances: probe.afterRoute.droppedInstances,
        slotsCreated: probe.afterRoute.slotsCreated,
      }, null, 2)}\n`,
      'utf8',
    );

    expectNoBrowserErrors(errors);
  });

  test('uses rendered biome terrain for safe and recoverable ground contact', async ({ page }) => {
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
      const { BIOME_CHUNK_SIZE, createInfiniteBiomeWorld } = await import(
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

      const targetCenterX = 0;
      const targetCenterZ = 750;
      const searchRadius = 80;
      const searchStep = 20;
      let target = {
        x: targetCenterX,
        z: targetCenterZ,
        slope: Number.POSITIVE_INFINITY,
      };
      for (
        let z = targetCenterZ - searchRadius;
        z <= targetCenterZ + searchRadius;
        z += searchStep
      ) {
        for (
          let x = targetCenterX - searchRadius;
          x <= targetCenterX + searchRadius;
          x += searchStep
        ) {
          const slope = slopeAt(x, z);
          if (slope < target.slope) target = { x, z, slope };
        }
      }
      world.recenterNow(new THREE.Vector3(target.x, 0, target.z));

      const chunkCoordinate = (value: number): number => Math.floor(
        (value + BIOME_CHUNK_SIZE * 0.5) / BIOME_CHUNK_SIZE,
      );
      const targetChunk = {
        x: chunkCoordinate(target.x),
        z: chunkCoordinate(target.z),
      };
      const targetChunkKey = `${targetChunk.x}:${targetChunk.z}`;
      const terrainMatches = world.group.children.filter(
        (child) => child.userData.worldLayer === 'terrain'
          && child.userData.chunkKey === targetChunkKey,
      ) as Mesh<BufferGeometry>[];
      if (terrainMatches.length !== 1) {
        throw new Error(
          `Expected one rendered terrain for ${targetChunkKey}, found ${terrainMatches.length}.`,
        );
      }
      const terrain = terrainMatches[0];
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
        elapsed: state.elapsed,
        airborneSeconds: state.airborneSeconds,
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
        start = true,
      ): void => {
        if (start) controller.start();
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
      const hardContactPosition = hardRig.root.position.clone();
      const taxiIntent = neutralIntent();
      for (let step = 0; step < 1_200; step += 1) {
        taxiIntent.throttle = hardRig.controller.state.throttle < 0.72 ? 1 : 0;
        hardRig.controller.update(1 / 120, taxiIntent);
        if (hardRig.root.position.distanceTo(hardContactPosition) >= 20) break;
      }
      const hardTaxi = copyState(hardRig.controller.state);
      const stopIntent = neutralIntent();
      stopIntent.throttle = -1;
      stopIntent.brake = true;
      for (let step = 0; step < 1_200; step += 1) {
        hardRig.controller.update(1 / 120, stopIntent);
        if (
          hardRig.controller.state.speed === 0
          && hardRig.controller.state.throttle === 0
          && hardRig.controller.state.phase === 'manual-ready'
        ) break;
      }
      const hardStop = copyState(hardRig.controller.state);
      takeOff(hardRig.controller, false);
      const hardRelaunch = copyState(hardRig.controller.state);

      const result = {
        target,
        targetChunk,
        targetChunkKey,
        targetResolution: world.diagnostics.loadedChunks.find(
          (chunk) => chunk.key === targetChunkKey,
        )?.resolution,
        activeFallbackChunkKeys: [
          ...world.diagnostics.worldSource.activeFallbackChunkKeys,
        ],
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
        hardTaxi,
        hardStop,
        hardRelaunch,
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
    expect(probe.targetChunkKey).toBe('0:1');
    expect(probe.targetResolution).toBe('authored');
    expect(probe.activeFallbackChunkKeys).toEqual([]);
    expect(probe.softContact.position.z).toBeGreaterThan(640);
    expect(probe.softContact.onGround).toBe(true);
    expect(probe.softContact.crashed).toBe(false);
    expect(probe.softContact.phase).toBe('touchdown');
    expect(probe.softContact.altitude).toBeCloseTo(0, 5);
    expect(probe.softContact.position.y - probe.softContactSurfaceHeight).toBeLessThan(0.2);

    expect(probe.hardBeforeContact.verticalSpeed).toBeLessThan(-5.2);
    expect(probe.hardBeforeContact.speed).toBeGreaterThanOrEqual(14);
    expect(probe.hardBeforeContact.speed).toBeLessThanOrEqual(56);
    expect(Math.abs(probe.hardBeforeContact.bank)).toBeLessThanOrEqual(18 * Math.PI / 180);
    expect(probe.hardContact.onGround).toBe(true);
    expect(probe.hardContact.running).toBe(true);
    expect(probe.hardContact.crashed).toBe(false);
    expect(probe.hardContact.completed).toBe(false);
    expect(probe.hardContact.phase).toBe('touchdown');
    const expectedHardGroundSpeed = Math.sqrt(Math.max(
      0,
      probe.hardBeforeContact.speed ** 2 - probe.hardBeforeContact.verticalSpeed ** 2,
    ));
    expect(Math.abs(probe.hardContact.speed - expectedHardGroundSpeed)).toBeLessThan(0.75);
    expect(probe.hardContact.speed).toBeGreaterThan(12);
    expect(probe.hardContact.throttle).toBeCloseTo(probe.hardBeforeContact.throttle, 5);
    expect(probe.hardTaxi.onGround).toBe(true);
    expect(probe.hardTaxi.running).toBe(true);
    expect(probe.hardTaxi.crashed).toBe(false);
    expect(probe.hardTaxi.elapsed).toBeGreaterThan(probe.hardContact.elapsed);
    expect(Math.hypot(
      probe.hardTaxi.position.x - probe.hardContact.position.x,
      probe.hardTaxi.position.z - probe.hardContact.position.z,
    )).toBeGreaterThanOrEqual(20);
    expect(probe.hardStop.onGround).toBe(true);
    expect(probe.hardStop.running).toBe(true);
    expect(probe.hardStop.crashed).toBe(false);
    expect(probe.hardStop.speed).toBe(0);
    expect(probe.hardStop.throttle).toBe(0);
    expect(probe.hardStop.phase).toBe('manual-ready');
    expect(probe.hardStop.elapsed).toBeGreaterThan(probe.hardTaxi.elapsed);
    expect(probe.hardTaxi.airborneSeconds).toBeGreaterThanOrEqual(
      probe.hardContact.airborneSeconds,
    );
    expect(probe.hardStop.airborneSeconds).toBeGreaterThanOrEqual(
      probe.hardTaxi.airborneSeconds,
    );
    expect(probe.hardRelaunch.onGround).toBe(false);
    expect(probe.hardRelaunch.running).toBe(true);
    expect(probe.hardRelaunch.crashed).toBe(false);
    expect(probe.hardRelaunch.phase).toBe('liftoff');
    expect(probe.hardRelaunch.elapsed).toBeGreaterThan(probe.hardStop.elapsed);
    expect(probe.hardRelaunch.airborneSeconds).toBeGreaterThanOrEqual(
      probe.hardStop.airborneSeconds,
    );
    for (const state of [
      probe.hardContact,
      probe.hardTaxi,
      probe.hardStop,
      probe.hardRelaunch,
    ]) {
      expect(Math.floor((state.position.x + 640) / 1_280)).toBe(0);
      expect(Math.floor((state.position.z + 640) / 1_280)).toBe(1);
    }
    expectNoBrowserErrors(errors);
  });

  test('validates authored chunks and preserves synchronous procedural fallback', async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await openExperience(page);

    const probe = await page.evaluate(async () => {
      const sourceUrl = '/src/world/WorldChunkSource.ts';
      const {
        WORLD_CHUNK_SAMPLES_PER_SIDE,
        WORLD_CHUNK_SIZE,
        createAuthoredWorldChunkRecord,
        createProceduralWorldChunkSource,
        createValidatedWorldChunkSource,
      } = await import(/* @vite-ignore */ sourceUrl) as typeof import(
        '../src/world/WorldChunkSource'
      );
      const seed = 0x071c0a57;
      const pilot = { x: -12, z: -5 };
      const fallback = createProceduralWorldChunkSource({ seed });
      const proceduralPilot = fallback.resolveChunk(pilot.x, pilot.z);
      const makeRecord = (
        chunkX: number,
        chunkZ: number,
        heightSamples: readonly number[] | Float32Array,
      ) => createAuthoredWorldChunkRecord({
        generatorVersion: 'worldclaw-test-v1',
        dataRevision: 'deterministic-test',
        worldSeed: seed,
        chunkX,
        chunkZ,
        biomeId: fallback.getBiomeForChunk(chunkX, chunkZ).id,
        heightSamples,
      });

      const validRecord = makeRecord(
        pilot.x,
        pilot.z,
        proceduralPilot.heightSamples,
      );
      const validSource = createValidatedWorldChunkSource({
        fallback,
        authoredChunks: [validRecord],
      });
      const validDescriptor = validSource.resolveChunk(pilot.x, pilot.z);
      const pilotCenterX = pilot.x * WORLD_CHUNK_SIZE;
      const pilotCenterZ = pilot.z * WORLD_CHUNK_SIZE;
      const sampleOffsets = [
        [-639.5, -639.5],
        [-320.25, 95.75],
        [0, 0],
        [317.5, -211.25],
        [639.5, 639.5],
      ] as const;
      const validHeightDeltas = sampleOffsets.map(([offsetX, offsetZ]) => Math.abs(
        validSource.sampleHeight(pilotCenterX + offsetX, pilotCenterZ + offsetZ)
          - fallback.sampleHeight(pilotCenterX + offsetX, pilotCenterZ + offsetZ),
      ));

      const interiorSamples = Array.from(proceduralPilot.heightSamples);
      const centerIndex = Math.floor(WORLD_CHUNK_SAMPLES_PER_SIDE / 2)
        * WORLD_CHUNK_SAMPLES_PER_SIDE
        + Math.floor(WORLD_CHUNK_SAMPLES_PER_SIDE / 2);
      interiorSamples[centerIndex] += 2;
      const interiorSource = createValidatedWorldChunkSource({
        fallback,
        authoredChunks: [makeRecord(pilot.x, pilot.z, interiorSamples)],
      });

      const brokenEdgeSamples = Array.from(proceduralPilot.heightSamples);
      const westEdgeIndex = Math.floor(WORLD_CHUNK_SAMPLES_PER_SIDE / 2)
        * WORLD_CHUNK_SAMPLES_PER_SIDE;
      brokenEdgeSamples[westEdgeIndex] += 1;
      const brokenEdgeSource = createValidatedWorldChunkSource({
        fallback,
        authoredChunks: [makeRecord(pilot.x, pilot.z, brokenEdgeSamples)],
      });

      const tamperedHashRecord = {
        ...validRecord,
        heightHash: 'fnv1a32:00000000',
      };
      const tamperedHashSource = createValidatedWorldChunkSource({
        fallback,
        authoredChunks: [tamperedHashRecord],
      });

      const originProcedural = fallback.resolveChunk(0, 0);
      const originSamples = Array.from(originProcedural.heightSamples);
      originSamples[centerIndex] += 1;
      const originSource = createValidatedWorldChunkSource({
        fallback,
        authoredChunks: [makeRecord(0, 0, originSamples)],
      });

      type PrototypeBatch = import('../src/world/WorldChunkSource').WorldChunkPrototypeBatch;
      type PrototypeTransform = import(
        '../src/world/WorldChunkSource'
      ).WorldChunkPrototypeTransform;
      const pilotKey = `${pilot.x}:${pilot.z}`;
      const rockTransform = {
        translation: [-639.5, 12.25, 640],
        rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
        scale: [1, 2, 0.5],
        colorLinearRgb: [0.25, 0.3, 0.2],
      } as const satisfies PrototypeTransform;
      const deadwoodTransform = {
        translation: [125, 1.5, -80],
        rotation: [0, 0, 0, 1],
        scale: [0.8, 0.8, 1.2],
        colorLinearRgb: [0.18, 0.12, 0.08],
      } as const satisfies PrototypeTransform;
      const validBatches = [
        { assetId: 'proto-biome-rock', transforms: [rockTransform] },
        { assetId: 'proto-biome-deadwood', transforms: [deadwoodTransform] },
      ] as const satisfies readonly PrototypeBatch[];
      const compositionSource = createValidatedWorldChunkSource({
        fallback,
        authoredChunks: [validRecord],
        authoredPrototypeBatchesByChunk: { [pilotKey]: validBatches },
      });
      const compositionDescriptor = compositionSource.resolveChunk(pilot.x, pilot.z);
      const reorderedCompositionSource = createValidatedWorldChunkSource({
        fallback: createProceduralWorldChunkSource({ seed }),
        authoredChunks: [validRecord],
        authoredPrototypeBatchesByChunk: { [pilotKey]: [...validBatches].reverse() },
      });
      const reorderedCompositionDescriptor = reorderedCompositionSource.resolveChunk(
        pilot.x,
        pilot.z,
      );
      const compositionResolution = (batches: readonly PrototypeBatch[]) =>
        createValidatedWorldChunkSource({
          fallback,
          authoredChunks: [validRecord],
          authoredPrototypeBatchesByChunk: { [pilotKey]: batches },
        }).resolveChunk(pilot.x, pilot.z);
      const withTransform = (
        assetId: string,
        transform: PrototypeTransform,
      ): readonly PrototypeBatch[] => [{ assetId, transforms: [transform] }];
      const invalidCompositionDescriptors = [
        compositionResolution(withTransform('proto-missing-regression', rockTransform)),
        compositionResolution(withTransform('proto-biome-rock', {
          ...rockTransform,
          translation: [640.01, 0, 0],
        })),
        compositionResolution(withTransform('proto-biome-rock', {
          ...rockTransform,
          rotation: [0, 0, 0, 2],
        })),
        compositionResolution(withTransform('proto-biome-rock', {
          ...rockTransform,
          scale: [1, 0, 1],
        })),
        compositionResolution(withTransform('proto-biome-rock', {
          ...rockTransform,
          colorLinearRgb: [0.2, 1.01, 0.2],
        })),
        compositionResolution(withTransform('proto-biome-rock', {
          ...rockTransform,
          translation: [0, Number.NaN, 0],
        })),
        compositionResolution([{
          assetId: 'proto-biome-rock',
          transforms: Array.from({ length: 2305 }, () => rockTransform),
        }]),
      ];
      const validOriginRecord = makeRecord(0, 0, originProcedural.heightSamples);
      const originCompositionDescriptor = createValidatedWorldChunkSource({
        fallback,
        authoredChunks: [validOriginRecord],
        authoredPrototypeBatchesByChunk: {
          '0:0': withTransform('proto-biome-rock', {
            ...rockTransform,
            translation: [0, 0, 0],
          }),
        },
      }).resolveChunk(0, 0);
      const proceduralDescriptor = fallback.resolveChunk(7, 9);
      const normalizedRockTransform = compositionDescriptor.prototypeBatches
        .find((batch) => batch.assetId === 'proto-biome-rock')?.transforms[0];

      return {
        pilotBiomeId: validDescriptor.biome.id,
        validResolution: validDescriptor.resolution,
        validHeightDeltas,
        deterministicHash: validRecord.contentHash
          === makeRecord(pilot.x, pilot.z, proceduralPilot.heightSamples).contentHash,
        interiorResolution: interiorSource.resolveChunk(pilot.x, pilot.z).resolution,
        interiorDelta: interiorSource.sampleHeight(pilotCenterX, pilotCenterZ)
          - fallback.sampleHeight(pilotCenterX, pilotCenterZ),
        brokenEdgeResolution: brokenEdgeSource.resolveChunk(pilot.x, pilot.z).resolution,
        tamperedHashResolution: tamperedHashSource.resolveChunk(pilot.x, pilot.z).resolution,
        originResolution: originSource.resolveChunk(0, 0).resolution,
        missingResolution: validSource.resolveChunk(91, -73).resolution,
        totalSamples: [
          validSource.sampleHeight(Number.NaN, 0),
          validSource.sampleHeight(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
          validSource.sampleHeight(-1_000_000.25, 2_000_000.75),
        ],
        sourceHashStable: validSource.sourceHash
          === createValidatedWorldChunkSource({
            fallback: createProceduralWorldChunkSource({ seed }),
            authoredChunks: [validRecord],
          }).sourceHash,
        runtimeRecordFields: Object.keys(validRecord).sort(),
        compositionResolution: compositionDescriptor.resolution,
        compositionBatchIds: compositionDescriptor.prototypeBatches.map(
          (batch) => batch.assetId,
        ),
        normalizedRockTransform,
        compositionHashStable: compositionDescriptor.compositionHash
          === reorderedCompositionDescriptor.compositionHash,
        compositionSourceHashStable: compositionSource.sourceHash
          === reorderedCompositionSource.sourceHash,
        compositionChangesSourceHash: compositionSource.sourceHash !== validSource.sourceHash,
        compositionKeepsTerrainContentHash: compositionDescriptor.contentHash
          === validDescriptor.contentHash,
        invalidCompositionResolutions: invalidCompositionDescriptors.map(
          (descriptor) => descriptor.resolution,
        ),
        invalidCompositionBatchCounts: invalidCompositionDescriptors.map(
          (descriptor) => descriptor.prototypeBatches.length,
        ),
        originCompositionResolution: originCompositionDescriptor.resolution,
        proceduralPrototypeBatchCount: proceduralDescriptor.prototypeBatches.length,
        proceduralCompositionHashStable: proceduralDescriptor.compositionHash
          === createProceduralWorldChunkSource({ seed }).resolveChunk(7, 9).compositionHash,
      };
    });

    expect(probe.pilotBiomeId).toBe('sunlit-meadow');
    expect(probe.validResolution).toBe('authored');
    expect(Math.max(...probe.validHeightDeltas)).toBe(0);
    expect(probe.deterministicHash).toBe(true);
    expect(probe.interiorResolution).toBe('authored');
    expect(probe.interiorDelta).toBeCloseTo(2, 6);
    expect(probe.brokenEdgeResolution).toBe('procedural-fallback');
    expect(probe.tamperedHashResolution).toBe('procedural-fallback');
    expect(probe.originResolution).toBe('procedural-fallback');
    expect(probe.missingResolution).toBe('procedural');
    expect(probe.totalSamples.every(Number.isFinite)).toBe(true);
    expect(probe.sourceHashStable).toBe(true);
    expect(probe.runtimeRecordFields).toEqual([
      'biomeId',
      'chunkX',
      'chunkZ',
      'contentHash',
      'dataRevision',
      'generatorVersion',
      'heightHash',
      'heightSamples',
      'schemaVersion',
      'worldSeed',
    ]);
    expect(probe.compositionResolution).toBe('authored');
    expect(probe.compositionBatchIds).toEqual([
      'proto-biome-deadwood',
      'proto-biome-rock',
    ]);
    expect(probe.normalizedRockTransform).toEqual({
      translation: [-639.5, 12.25, 640],
      rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
      scale: [1, 2, 0.5],
      colorLinearRgb: [0.25, 0.3, 0.2],
    });
    expect(probe.compositionHashStable).toBe(true);
    expect(probe.compositionSourceHashStable).toBe(true);
    expect(probe.compositionChangesSourceHash).toBe(true);
    expect(probe.compositionKeepsTerrainContentHash).toBe(true);
    expect(probe.invalidCompositionResolutions).toEqual(
      Array.from({ length: 7 }, () => 'procedural-fallback'),
    );
    expect(probe.invalidCompositionBatchCounts).toEqual(
      Array.from({ length: 7 }, () => 0),
    );
    expect(probe.originCompositionResolution).toBe('procedural-fallback');
    expect(probe.proceduralPrototypeBatchCount).toBe(0);
    expect(probe.proceduralCompositionHashStable).toBe(true);
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

  test('keeps on-foot movement stable after a lateral camera orbit', async ({ page }) => {
    const errors = watchBrowserErrors(page);
    await openExperience(page);

    const canvas = page.locator('#game-canvas');
    await page.locator('#flight-button').click();
    await expect(canvas).toBeFocused();
    await expect
      .poll(async () => (await readExperience(page)).diagnostics.gameplay.controlMode)
      .toBe('on-foot');

    const lateralStart = await readExperience(page);
    const lateralStartZ = lateralStart.diagnostics.gameplay.character.position.z;
    await page.keyboard.down('d');
    await expect
      .poll(async () => (
        await readExperience(page)
      ).diagnostics.gameplay.character.position.z)
      .toBeGreaterThan(lateralStartZ + 0.25);
    await page.keyboard.up('d');
    const afterRight = await readExperience(page);

    await page.keyboard.down('q');
    await expect
      .poll(async () => (
        await readExperience(page)
      ).diagnostics.gameplay.character.position.z)
      .toBeLessThan(afterRight.diagnostics.gameplay.character.position.z - 0.25);
    await page.keyboard.up('q');

    const canvasBox = await canvas.boundingBox();
    expect(canvasBox).not.toBeNull();
    if (!canvasBox) throw new Error('The game canvas has no interactive bounds.');
    const orbitX = canvasBox.x + canvasBox.width * 0.56;
    const orbitY = canvasBox.y + canvasBox.height * 0.48;

    try {
      await page.mouse.move(orbitX, orbitY);
      await page.mouse.down();
      await page.mouse.move(orbitX - 150, orbitY, { steps: 12 });
      await page.mouse.up();
      await expect
        .poll(async () => Math.abs(
          (await readExperience(page)).diagnostics.camera.character.yawOffset,
        ))
        .toBeGreaterThan(0.55);
      await page.waitForTimeout(250);

      const movementStart = await readExperience(page);
      const startPosition = movementStart.diagnostics.gameplay.character.controller.state.position;
      const orbitYaw = movementStart.diagnostics.camera.character.yawOffset;

      await page.keyboard.down('z');
      await expect
        .poll(async () => planarDistance(
          startPosition,
          (await readExperience(page)).diagnostics.gameplay.character.controller.state.position,
        ))
        .toBeGreaterThan(0.8);
      const movementMidpoint = await readExperience(page);
      await expect
        .poll(async () => planarDistance(
          movementMidpoint.diagnostics.gameplay.character.controller.state.position,
          (await readExperience(page)).diagnostics.gameplay.character.controller.state.position,
        ))
        .toBeGreaterThan(1);
      const movementEnd = await readExperience(page);
      await page.keyboard.up('z');

      const midpointState = movementMidpoint.diagnostics.gameplay.character.controller.state;
      const endState = movementEnd.diagnostics.gameplay.character.controller.state;
      const firstHeading = planarHeading(startPosition, midpointState.position);
      const secondHeading = planarHeading(midpointState.position, endState.position);

      expect(movementMidpoint.diagnostics.gameplay.input.intent.moveZ).toBe(1);
      expect(movementEnd.diagnostics.gameplay.input.intent.moveZ).toBe(1);
      expect(planarDistance(startPosition, endState.position)).toBeGreaterThan(1.7);
      expect(planarDistance(startPosition, midpointState.position)).toBeGreaterThan(0.65);
      expect(planarDistance(midpointState.position, endState.position)).toBeGreaterThan(0.9);
      expect(angleDistance(firstHeading, secondHeading)).toBeLessThan(0.12);
      expect(angleDistance(secondHeading, midpointState.yaw)).toBeLessThan(0.1);
      expect(angleDistance(secondHeading, endState.yaw)).toBeLessThan(0.08);
      expect(angleDistance(midpointState.yaw, endState.yaw)).toBeLessThan(0.06);
      expect(Math.abs(
        movementEnd.diagnostics.camera.character.yawOffset - orbitYaw,
      )).toBeLessThan(0.05);

      await page.keyboard.press('c');
      await expect
        .poll(async () => Math.abs(
          (await readExperience(page)).diagnostics.camera.character.yawOffset,
        ))
        .toBeLessThan(0.08);
    } finally {
      await page.keyboard.up('q');
      await page.keyboard.up('d');
      await page.keyboard.up('z');
      await page.mouse.up();
    }

    expectNoBrowserErrors(errors);
  });

  test('only allows leaving a stopped grounded aircraft and supports immediate re-entry', async ({
    page,
  }, testInfo) => {
    test.setTimeout(isCI ? 90_000 : 40_000);
    const errors = watchBrowserErrors(page);
    await openExperience(page);

    const canvas = page.locator('#game-canvas');
    const keys = ['e', 'z', 'ArrowDown'];
    try {
      await page.evaluate(() => {
        const experience = (
          window as typeof window & { __AIRPLANE_EXPERIENCE__?: AirplaneExperience }
        ).__AIRPLANE_EXPERIENCE__;
        if (!experience) throw new Error('Missing window.__AIRPLANE_EXPERIENCE__.');
        experience.startManual();
      });
      await expect(canvas).toBeFocused();
      await expect
        .poll(async () => (await readExperience(page)).diagnostics.gameplay.controlMode)
        .toBe('piloting');

      const stopped = await readExperience(page);
      expect(stopped.state.onGround).toBe(true);
      expect(stopped.state.speed).toBeCloseTo(0, 4);
      expect(stopped.state.throttle).toBeCloseTo(0, 4);
      expect(stopped.diagnostics.gameplay.interaction).toMatchObject({
        kind: 'exit-aircraft',
        available: true,
        promptVisible: true,
      });
      await expect(page.locator('#interaction-prompt')).toBeVisible();
      await expect(page.locator('#interaction-prompt')).toContainText(/E\s*Exit aircraft/i);

      await page.keyboard.press('e');
      await expect
        .poll(async () => (await readExperience(page)).diagnostics.gameplay.controlMode)
        .toBe('on-foot');

      const exited = await readExperience(page);
      expect(exited.state.onGround).toBe(true);
      expect(exited.state.speed).toBeCloseTo(0, 4);
      expect(exited.diagnostics.gameplay.character.visible).toBe(true);
      expect(exited.diagnostics.gameplay.character.controller.state.enabled).toBe(true);
      expect(exited.diagnostics.gameplay.input.enabled).toBe(true);
      expect(exited.diagnostics.gameplay.interaction).toMatchObject({
        kind: 'enter-aircraft',
        available: true,
        promptVisible: true,
      });
      expect(exited.diagnostics.gameplay.interaction.distance).toBeLessThanOrEqual(
        exited.diagnostics.gameplay.interaction.radius,
      );
      expect(exited.diagnostics.camera.controller).toBe('character');
      expect(exited.diagnostics.camera.character.enabled).toBe(true);
      expect(exited.diagnostics.camera.pilot.enabled).toBe(false);
      await expect(page.locator('#interaction-prompt')).toContainText(/E\s*Enter aircraft/i);
      await attachScreenshot(page, testInfo, 'desktop-grounded-aircraft-exit');

      await page.keyboard.press('e');
      await expect
        .poll(async () => (await readExperience(page)).diagnostics.gameplay.controlMode)
        .toBe('piloting');
      expect((await readExperience(page)).diagnostics.gameplay.character.visible).toBe(false);

      await page.keyboard.down('z');
      await expect
        .poll(async () => (await readFlightState(page)).speed, { timeout: 8_000 })
        .toBeGreaterThan(5);
      await page.keyboard.up('z');

      const rolling = await readExperience(page);
      expect(rolling.state.onGround).toBe(true);
      expect(rolling.state.speed).toBeGreaterThan(5);
      expect(rolling.diagnostics.gameplay.interaction).toMatchObject({
        kind: 'exit-aircraft',
        available: false,
        promptVisible: false,
      });
      await expect(page.locator('#interaction-prompt')).toBeHidden();
      await page.keyboard.press('e');
      await page.waitForTimeout(180);
      const refusedWhileRolling = await readExperience(page);
      expect(refusedWhileRolling.diagnostics.gameplay.controlMode).toBe('piloting');
      expect(refusedWhileRolling.diagnostics.gameplay.character.visible).toBe(false);

      await page.keyboard.down('z');
      await expect
        .poll(async () => (await readFlightState(page)).speed, { timeout: 8_000 })
        .toBeGreaterThan(27);
      await page.keyboard.down('ArrowDown');
      await expect
        .poll(async () => (await readFlightState(page)).onGround, { timeout: 8_000 })
        .toBe(false);
      await page.keyboard.up('ArrowDown');
      await page.keyboard.up('z');

      const airborne = await readExperience(page);
      expect(airborne.state.onGround).toBe(false);
      expect(airborne.diagnostics.gameplay.interaction).toMatchObject({
        kind: 'exit-aircraft',
        available: false,
        promptVisible: false,
      });
      await page.keyboard.press('e');
      await page.waitForTimeout(180);
      const refusedWhileAirborne = await readExperience(page);
      expect(refusedWhileAirborne.diagnostics.gameplay.controlMode).toBe('piloting');
      expect(refusedWhileAirborne.diagnostics.gameplay.character.visible).toBe(false);
      expect(refusedWhileAirborne.diagnostics.camera.controller).toBe('pilot');
    } finally {
      for (const key of keys) await page.keyboard.up(key);
    }

    expectNoBrowserErrors(errors);
  });

  test('Play opens a free ground-and-flight sandbox with optional reset', async ({ page }, testInfo) => {
    test.setTimeout(isCI ? 120_000 : 45_000);
    const errors = watchBrowserErrors(page);
    await openExperience(page);

    const canvas = page.locator('#game-canvas');
    const initial = await readFlightState(page);
    expect(initial.phase).toBe('parked');
    expect(initial.onGround).toBe(true);
    expect(initial.throttle).toBeCloseTo(0, 4);
    await expect(page.locator('#flight-button strong')).toHaveText('Play');
    await expect(page.locator('#flight-button .button-kicker')).toHaveText('Open world');

    const keys = [
      'e',
      'z',
      's',
      'j',
      'l',
      'Space',
      'ArrowDown',
      'ArrowUp',
      'ArrowLeft',
      'ArrowRight',
    ];
    try {
      await page.locator('#flight-button').click();
      await expect(canvas).toBeFocused();
      await expect.poll(async () => (await readFlightState(page)).mode).toBe('manual');
      await expect.poll(async () => (await readFlightState(page)).running).toBe(true);
      await expect
        .poll(async () => (await readExperience(page)).diagnostics.gameplay.controlMode)
        .toBe('on-foot');
      await expect
        .poll(async () => (await readExperience(page)).diagnostics.gameplay.character.loaded, {
          timeout: 10_000,
        })
        .toBe(true);
      await expect(page.locator('body')).not.toHaveClass(/flight-ended|flight-crashed/);
      await expect(page.locator('body')).toHaveClass(/on-foot/);
      await expect(page.locator('#phase-label')).toHaveText(/ON FOOT/i);
      await expect(page.locator('#pilot-alert')).toContainText('ON FOOT');
      await expect(page.locator('#inspection-hint')).toHaveClass(/visible/);
      await expect(page.locator('#inspection-hint')).toContainText('Move camera');

      const onFootStart = await readExperience(page);
      const aircraftEntryStart = onFootStart.diagnostics.gameplay.interaction.worldPosition;
      expect(onFootStart.state.speed).toBeCloseTo(0, 4);
      expect(onFootStart.state.throttle).toBeCloseTo(0, 4);
      expect(onFootStart.state.propellerRpm).toBeCloseTo(0, 4);
      expect(onFootStart.diagnostics.gameplay.character).toMatchObject({
        loadState: 'ready',
        loaded: true,
        visible: true,
        requestedAnimation: 'idle',
        loadError: null,
      });
      expect(onFootStart.diagnostics.gameplay.character.availableAnimations).toEqual(
        expect.arrayContaining(['idle', 'walk', 'run', 'jump']),
      );
      expect(onFootStart.diagnostics.gameplay.character.controller.state).toMatchObject({
        enabled: true,
        grounded: true,
      });
      expect(onFootStart.diagnostics.gameplay.input).toMatchObject({
        enabled: true,
        pressedCodes: [],
        intent: { moveX: 0, moveZ: 0, sprint: false, jump: false },
      });
      expect(onFootStart.diagnostics.gameplay.interaction).toMatchObject({
        kind: 'enter-aircraft',
        available: false,
        promptVisible: false,
      });
      expect(onFootStart.diagnostics.gameplay.interaction.distance).toBeGreaterThan(
        onFootStart.diagnostics.gameplay.interaction.radius,
      );
      expect(onFootStart.diagnostics.camera.controller).toBe('character');
      expect(onFootStart.diagnostics.camera.character.enabled).toBe(true);
      expect(onFootStart.diagnostics.camera.pilot.enabled).toBe(false);
      await expect(page.locator('#interaction-prompt')).toBeHidden();

      await page.keyboard.press('e');
      await page.waitForTimeout(120);
      const refusedEntry = await readExperience(page);
      expect(refusedEntry.diagnostics.gameplay.controlMode).toBe('on-foot');
      expect(refusedEntry.diagnostics.gameplay.character.visible).toBe(true);
      expect(refusedEntry.diagnostics.gameplay.interaction.available).toBe(false);
      expect(refusedEntry.state.propellerRpm).toBeCloseTo(0, 4);
      await expect(page.locator('#interaction-prompt')).toBeHidden();

      await page.keyboard.down('z');
      await page.waitForTimeout(650);
      const walkingToAircraft = await readExperience(page);
      expect(walkingToAircraft.diagnostics.gameplay.input.intent.moveZ).toBe(1);
      expect(walkingToAircraft.diagnostics.gameplay.character.controller.state.speed)
        .toBeGreaterThan(0.5);
      expect(walkingToAircraft.diagnostics.gameplay.character.requestedAnimation).toBe('walk');
      await page.keyboard.up('z');

      await expect
        .poll(async () => (await readExperience(page)).diagnostics.gameplay.interaction.available)
        .toBe(true);
      const atAircraft = await readExperience(page);
      expect(atAircraft.diagnostics.gameplay.interaction.promptVisible).toBe(true);
      expect(atAircraft.diagnostics.gameplay.interaction.distance).toBeLessThanOrEqual(
        atAircraft.diagnostics.gameplay.interaction.radius,
      );
      expect(distance(
        atAircraft.diagnostics.gameplay.interaction.worldPosition,
        aircraftEntryStart,
      )).toBeLessThan(0.001);
      expect(atAircraft.state.propellerRpm).toBeCloseTo(0, 4);
      await expect(page.locator('#interaction-prompt')).toBeVisible();
      await expect(page.locator('#interaction-prompt')).toContainText(/E\s*Enter aircraft/i);
      await attachScreenshot(page, testInfo, 'desktop-on-foot-aircraft-entry-prompt');

      await page.keyboard.press('e');
      await expect
        .poll(async () => (await readExperience(page)).diagnostics.gameplay.controlMode)
        .toBe('piloting');
      const enteredAircraft = await readExperience(page);
      expect(enteredAircraft.state.phase).toBe('manual-ready');
      expect(enteredAircraft.state.running).toBe(true);
      expect(enteredAircraft.state.speed).toBeCloseTo(0, 4);
      expect(enteredAircraft.state.throttle).toBeCloseTo(0, 4);
      expect(enteredAircraft.state.propellerRpm).toBeGreaterThan(300);
      expect(enteredAircraft.state.position.x).toBeCloseTo(initial.position.x, 4);
      expect(enteredAircraft.state.position.z).toBeCloseTo(initial.position.z, 4);
      expect(enteredAircraft.diagnostics.gameplay.character.visible).toBe(false);
      expect(enteredAircraft.diagnostics.gameplay.character.controller.state.enabled).toBe(false);
      expect(enteredAircraft.diagnostics.gameplay.input).toMatchObject({
        enabled: false,
        pressedCodes: [],
        intent: { moveX: 0, moveZ: 0, sprint: false, jump: false },
      });
      expect(enteredAircraft.diagnostics.gameplay.interaction).toMatchObject({
        kind: 'exit-aircraft',
        available: true,
        promptVisible: true,
      });
      expect(enteredAircraft.diagnostics.camera.controller).toBe('pilot');
      expect(enteredAircraft.diagnostics.camera.character.enabled).toBe(false);
      expect(enteredAircraft.diagnostics.camera.pilot.enabled).toBe(true);
      expect(enteredAircraft.diagnostics.input.throttle).toBe(0);
      await expect(page.locator('body')).not.toHaveClass(/on-foot/);
      await expect(page.locator('#interaction-prompt')).toContainText(/E\s*Exit aircraft/i);
      await expect(page.locator('#pilot-alert')).toContainText('GROUND MODE');

      const canvasBox = await canvas.boundingBox();
      expect(canvasBox).not.toBeNull();
      if (!canvasBox) throw new Error('The game canvas has no interactive bounds.');
      const cameraX = canvasBox.x + canvasBox.width * 0.58;
      const cameraY = canvasBox.y + canvasBox.height * 0.48;
      const groundCameraStart = await readExperience(page);
      expect(groundCameraStart.diagnostics.camera.controller).toBe('pilot');
      expect(groundCameraStart.diagnostics.camera.pilot.enabled).toBe(true);

      await page.mouse.move(cameraX, cameraY);
      await page.mouse.down();
      await expect
        .poll(async () => (await readExperience(page)).diagnostics.camera.pilot.dragging)
        .toBe(true);
      await page.keyboard.down('z');
      await expect.poll(async () => (await readExperience(page)).diagnostics.input.throttle).toBe(1);
      await page.mouse.move(cameraX - 220, cameraY + 65, { steps: 14 });
      await expect
        .poll(async () => Math.abs(
          (await readExperience(page)).diagnostics.camera.pilot.yawOffset
            - groundCameraStart.diagnostics.camera.pilot.yawOffset,
        ))
        .toBeGreaterThan(0.3);
      await page.mouse.up();
      await expect
        .poll(async () => (await readExperience(page)).diagnostics.camera.pilot.dragging)
        .toBe(false);

      const groundCameraAfterOrbit = await readExperience(page);
      await page.mouse.wheel(0, 520);
      await expect
        .poll(async () => (
          await readExperience(page)
        ).diagnostics.camera.pilot.zoom - groundCameraAfterOrbit.diagnostics.camera.pilot.zoom)
        .toBeGreaterThan(0.12);
      expect((await readExperience(page)).diagnostics.input.throttle).toBe(1);

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

      const airborneCameraStart = await readExperience(page);
      expect(airborneCameraStart.diagnostics.camera.controller).toBe('pilot');
      await page.mouse.move(cameraX, cameraY);
      await page.mouse.down();
      await page.mouse.move(cameraX + 190, cameraY - 45, { steps: 12 });
      await expect
        .poll(async () => Math.abs(
          (await readExperience(page)).diagnostics.camera.pilot.yawOffset
            - airborneCameraStart.diagnostics.camera.pilot.yawOffset,
        ))
        .toBeGreaterThan(0.2);
      await page.mouse.up();
      await expect
        .poll(async () => (await readExperience(page)).diagnostics.camera.pilot.dragging)
        .toBe(false);

      const airborneZoomStart = (await readExperience(page)).diagnostics.camera.pilot.zoom;
      await page.mouse.wheel(0, -420);
      await expect
        .poll(async () => (
          airborneZoomStart - (await readExperience(page)).diagnostics.camera.pilot.zoom
        ))
        .toBeGreaterThan(0.1);
      expect((await readFlightState(page)).onGround).toBe(false);

      const beforeNoseDown = await readFlightState(page);
      await page.keyboard.down('ArrowUp');
      await expect.poll(async () => (await readExperience(page)).diagnostics.input.pitch).toBe(-1);
      await expect
        .poll(async () => (await readFlightState(page)).pitch)
        .toBeLessThan(beforeNoseDown.pitch - 2 * Math.PI / 180);
      await page.keyboard.up('ArrowUp');
      await expect.poll(async () => (await readExperience(page)).diagnostics.input.pitch).toBe(0);

      const beforeTurn = await readFlightState(page);
      await page.mouse.move(cameraX, cameraY);
      await page.mouse.down();
      await expect
        .poll(async () => (await readExperience(page)).diagnostics.camera.pilot.dragging)
        .toBe(true);
      await page.keyboard.down('ArrowLeft');
      await expect
        .poll(async () => (await readFlightState(page)).bank)
        .toBeLessThan(-8 * Math.PI / 180);
      await expect
        .poll(async () => (await readFlightState(page)).yaw - beforeTurn.yaw)
        .toBeGreaterThan(0.01);

      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await expect.poll(async () => (await readExperience(page)).diagnostics.input.roll).toBe(0);
      await expect
        .poll(async () => (await readExperience(page)).diagnostics.camera.pilot.dragging)
        .toBe(false);
      await page.mouse.up();
      await page.keyboard.up('ArrowLeft');

      const afterTurn = await readFlightState(page);
      expect(afterTurn.yaw - beforeTurn.yaw).toBeGreaterThan(0.01);
      expect(afterTurn.crashed).toBe(false);

      const beforeRightTurn = await readFlightState(page);
      await page.keyboard.down('ArrowRight');
      await expect
        .poll(async () => (await readFlightState(page)).bank)
        .toBeGreaterThan(8 * Math.PI / 180);
      await expect
        .poll(async () => (await readFlightState(page)).yaw - beforeRightTurn.yaw)
        .toBeLessThan(-0.01);
      const afterRightTurn = await readFlightState(page);
      await page.keyboard.up('ArrowRight');

      expect(afterRightTurn.yaw - beforeRightTurn.yaw).toBeLessThan(-0.01);
      expect(afterRightTurn.bank).toBeGreaterThan(0);
      expect(afterRightTurn.crashed).toBe(false);

      await page.keyboard.press('c');
      await expect
        .poll(async () => Math.abs(
          (await readExperience(page)).diagnostics.camera.pilot.yawOffset,
        ))
        .toBeLessThan(0.08);
      await expect
        .poll(async () => Math.abs(
          (await readExperience(page)).diagnostics.camera.pilot.zoom - 1,
        ))
        .toBeLessThan(0.08);

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
      expect(reset.diagnostics.gameplay.controlMode).toBe('inspection');
      expect(reset.diagnostics.gameplay.character.visible).toBe(true);
      expect(reset.diagnostics.gameplay.character.controller.state.enabled).toBe(false);
      expect(reset.diagnostics.gameplay.input.enabled).toBe(false);
      expect(reset.diagnostics.gameplay.interaction).toMatchObject({
        kind: null,
        available: false,
        promptVisible: false,
      });
      expect(reset.diagnostics.camera.controller).toBe('inspection');
      expect(reset.diagnostics.camera.character.enabled).toBe(false);
      expect(reset.diagnostics.camera.pilot).toMatchObject({
        enabled: false,
        dragging: false,
        yawOffset: 0,
        pitchOffset: 0,
        zoom: 1,
      });
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

  test('manual flight can taxi into the nearby authored world and take off there without reset', async ({
    page,
  }, testInfo) => {
    test.setTimeout(isCI ? 120_000 : 70_000);
    const errors = watchBrowserErrors(page);
    await openExperience(page);

    const canvas = page.locator('#game-canvas');
    const keys = ['z', 's', 'Space', 'ArrowDown'];
    try {
      await page.evaluate(() => {
        const experience = (
          window as typeof window & { __AIRPLANE_EXPERIENCE__?: AirplaneExperience }
        ).__AIRPLANE_EXPERIENCE__;
        if (!experience) throw new Error('Missing window.__AIRPLANE_EXPERIENCE__.');
        experience.startManual();
      });
      await expect(canvas).toBeFocused();
      await expect.poll(async () => (await readFlightState(page)).running).toBe(true);
      await expect
        .poll(async () => (await readExperience(page)).diagnostics.gameplay.controlMode)
        .toBe('piloting');

      await page.keyboard.down('z');
      await expect
        .poll(async () => (await readFlightState(page)).position.z, {
          timeout: isCI ? 60_000 : 35_000,
        })
        .toBeGreaterThan(650);
      await page.keyboard.up('z');

      const arrived = await readFlightState(page);
      const arrivedStreaming = await readStreamingDiagnostics(page);
      expect(arrived.running).toBe(true);
      expect(arrived.crashed).toBe(false);
      expect(arrived.onGround).toBe(true);
      expect(arrivedStreaming.centerChunk).toEqual({ x: 0, z: 1 });
      expect(
        arrivedStreaming.loadedChunks.find((chunk) => chunk.key === '0:1')?.resolution,
      ).toBe('authored');
      expect(arrivedStreaming.worldSource.activeFallbackChunkKeys).toEqual([]);

      await page.keyboard.down('s');
      await page.keyboard.down('Space');
      await expect
        .poll(async () => {
          const state = await readFlightState(page);
          return state.speed === 0 && state.throttle === 0 && state.phase === 'manual-ready';
        }, { timeout: 10_000 })
        .toBe(true);
      await page.keyboard.up('Space');
      await page.keyboard.up('s');

      const stopped = await readFlightState(page);
      expect(stopped.running).toBe(true);
      expect(stopped.crashed).toBe(false);
      expect(stopped.onGround).toBe(true);
      expect(stopped.position.z).toBeGreaterThan(arrived.position.z);

      await page.keyboard.down('z');
      await expect
        .poll(async () => (await readFlightState(page)).speed, { timeout: 12_000 })
        .toBeGreaterThan(27);
      await page.keyboard.down('ArrowDown');
      await expect
        .poll(async () => (await readFlightState(page)).onGround, { timeout: 10_000 })
        .toBe(false);
      await page.keyboard.up('ArrowDown');
      await page.keyboard.up('z');

      const relaunched = await readFlightState(page);
      expect(relaunched.running).toBe(true);
      expect(relaunched.crashed).toBe(false);
      expect(relaunched.completed).toBe(false);
      expect(relaunched.position.z).toBeGreaterThan(stopped.position.z);
      expect(relaunched.airborneSeconds).toBeGreaterThanOrEqual(stopped.airborneSeconds);
      await expect(page.locator('body')).not.toHaveClass(/flight-ended|flight-crashed/);

      await attachScreenshot(page, testInfo, 'desktop-authored-ground-exploration-relaunch');
    } finally {
      for (const key of keys) await page.keyboard.up(key);
    }

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
      experience.startAutopilot();
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
    await expect(page.locator('#flight-button')).toContainText(/Play/i);
    await expect(page.locator('#cinematic-button')).toContainText(/Watch the flight showcase/i);
    await attachScreenshot(page, testInfo, 'desktop-flight-reset');

    expectNoBrowserErrors(errors);
  });
});
