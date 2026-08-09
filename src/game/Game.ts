import * as THREE from 'three';
import {
  createAirplaneModel,
  DEFAULT_AIRCRAFT_PAINT_COLOR,
  type AirplaneModel,
} from '../assets/AirplaneModel';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { AudioSystem } from '../systems/AudioSystem';
import { CinematicCamera } from '../systems/CinematicCamera';
import { FlightHud } from '../systems/FlightHud';
import {
  FLIGHT_SEQUENCE_SECONDS,
  FlightSequence,
  type FlightMode,
  type FlightSnapshot,
} from '../systems/FlightSequence';
import { FlightVfx } from '../systems/FlightVfx';
import { InspectionCamera, type InspectionView } from '../systems/InspectionCamera';
import { ManualFlightController } from '../systems/ManualFlightController';
import { PilotCamera } from '../systems/PilotCamera';
import { PilotInput } from '../systems/PilotInput';
import { QualityDiagnostics } from '../systems/QualityDiagnostics';
import {
  createInfiniteBiomeWorld,
  type InfiniteBiomeWorld,
} from '../world/InfiniteBiomeWorld';
import { createRunwayWorld, type RunwayWorld } from '../world/RunwayWorld';

const MAX_DPR = 1.35;
const CAMERA_FAR = 2200;
const CINEMATIC_PREWARM_SECONDS = [
  0.8,
  9.9,
  12.4,
  17.2,
  21.4,
  23.5,
  25.5,
  28.4,
  36.2,
  39.2,
  41.4,
  46.0,
  53.0,
] as const;
const PREWARM_RENDER_WIDTH = 160;
const PREWARM_RENDER_HEIGHT = 100;
const AIRCRAFT_PAINT_STORAGE_KEY = 'cropper-seven-aircraft-paint';

function readStoredAircraftPaintColor(): string {
  try {
    const value = window.localStorage.getItem(AIRCRAFT_PAINT_STORAGE_KEY)?.trim().toLowerCase();
    return value && /^#[0-9a-f]{6}$/.test(value)
      ? value
      : DEFAULT_AIRCRAFT_PAINT_COLOR;
  } catch {
    return DEFAULT_AIRCRAFT_PAINT_COLOR;
  }
}

function storeAircraftPaintColor(value: string): void {
  try {
    window.localStorage.setItem(AIRCRAFT_PAINT_STORAGE_KEY, value);
  } catch {
    // The color still applies for this session when storage is unavailable.
  }
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 0.08, CAMERA_FAR);
  private readonly world: RunwayWorld;
  private readonly biomeWorld: InfiniteBiomeWorld;
  private readonly airplane: AirplaneModel;
  private readonly flight: FlightSequence;
  private readonly manualFlight: ManualFlightController;
  private readonly pilotInput = new PilotInput();
  private readonly inspectionCamera: InspectionCamera;
  private readonly cinematicCamera: CinematicCamera;
  private readonly pilotCamera: PilotCamera;
  private readonly audio = new AudioSystem();
  private readonly vfx: FlightVfx;
  private readonly hud: FlightHud;
  private readonly quality = new QualityDiagnostics();
  private readonly loop = new Loop(
    (delta, elapsed, rawDelta) => this.update(delta, elapsed, rawDelta),
    () => this.render(),
  );
  private readonly leftPupilOrigin: THREE.Vector3;
  private readonly rightPupilOrigin: THREE.Vector3;
  private readonly reviewStudioFloor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;

  private frame = 0;
  private worldElapsed = 0;
  private timeScale = 1;
  private previousPhase = 'parked';
  private activeMode: Exclude<FlightMode, 'inspection'> = 'manual';
  private disposed = false;
  private reviewMode = false;
  private normalBackground: THREE.Scene['background'] = null;
  private normalFog: THREE.Fog | THREE.FogExp2 | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.toneMappingExposure = 1.08;
    this.world = createRunwayWorld(this.scene);
    this.biomeWorld = createInfiniteBiomeWorld();
    this.world.group.add(this.biomeWorld.group);
    this.biomeWorld.recenterNow(this.world.environment.parkingPosition);
    this.normalBackground = this.scene.background;
    this.normalFog = this.scene.fog;
    this.airplane = createAirplaneModel();
    this.airplane.paint.setColor(readStoredAircraftPaintColor());
    const initialPaintColor = this.airplane.paint.getColor();
    this.scene.add(this.airplane.root);
    this.reviewStudioFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: '#c7c8c9', roughness: 0.94, metalness: 0 }),
    );
    this.reviewStudioFloor.name = 'neutral-review-studio-floor';
    this.reviewStudioFloor.rotation.x = -Math.PI / 2;
    this.reviewStudioFloor.position.y = -0.012;
    this.reviewStudioFloor.receiveShadow = true;
    this.reviewStudioFloor.visible = false;
    this.scene.add(this.reviewStudioFloor);

    this.flight = new FlightSequence(
      {
        root: this.airplane.root,
        propeller: this.airplane.propellerPivot,
        mainWheels: this.airplane.mainWheelPivots,
        auxiliaryWheel: this.airplane.tailWheelPivot,
      },
      {
        runway: {
          centerlineX: this.world.environment.centerlineX,
          surfaceY: this.world.environment.landingElevation,
          parkingZ: this.world.environment.parkingPosition.z,
          takeoffEndZ: 105,
          touchdownZ: -104,
          finalStopZ: 124,
        },
        aircraftGroundOffset: this.airplane.groundOffset,
        mainWheelRadius: this.airplane.diagnostics.dimensions.mainWheelRadius,
        auxiliaryWheelRadius: this.airplane.diagnostics.dimensions.tailWheelRadius,
        propellerSafetyRadius: this.airplane.diagnostics.dimensions.propellerSafetyRadius,
      },
    );
    this.manualFlight = new ManualFlightController(
      {
        root: this.airplane.root,
        propeller: this.airplane.propellerPivot,
        mainWheels: this.airplane.mainWheelPivots,
        auxiliaryWheel: this.airplane.tailWheelPivot,
      },
      {
        runway: {
          centerlineX: this.world.environment.centerlineX,
          surfaceY: this.world.environment.landingElevation,
          parkingZ: this.world.environment.parkingPosition.z,
          takeoffEndZ: 105,
          touchdownZ: -104,
          finalStopZ: 124,
          width: this.world.environment.runwayWidth,
          southThresholdZ: this.world.environment.southThresholdZ,
          northThresholdZ: this.world.environment.northThresholdZ,
        },
        aircraftGroundOffset: this.airplane.groundOffset,
        mainWheelRadius: this.airplane.diagnostics.dimensions.mainWheelRadius,
        auxiliaryWheelRadius: this.airplane.diagnostics.dimensions.tailWheelRadius,
        propellerSafetyRadius: this.airplane.diagnostics.dimensions.propellerSafetyRadius,
        surfaceHeightAt: (worldX, worldZ) => this.landingSurfaceHeightAt(worldX, worldZ),
      },
    );

    this.inspectionCamera = new InspectionCamera(this.camera, this.airplane.root, canvas, {
      focusOffset: new THREE.Vector3(0, 2.36, 0),
      minDistance: 9.5,
      maxDistance: 42,
      fov: 30,
    });
    this.cinematicCamera = new CinematicCamera(this.camera, this.airplane.root);
    this.pilotCamera = new PilotCamera(this.camera, this.airplane.root);
    this.vfx = new FlightVfx(this.scene);
    this.leftPupilOrigin = this.airplane.face.leftPupil.position.clone();
    this.rightPupilOrigin = this.airplane.face.rightPupil.position.clone();

    this.hud = new FlightHud({
      onStartManual: () => this.startManualFlight(),
      onStartAutopilot: () => this.startAutopilotFlight(),
      onReset: () => this.resetFlight(),
      onMuteChange: (muted) => this.audio.setMuted(muted),
      initialPaintColor,
      onPaintColorChange: (hexColor) => this.setAircraftPaintColor(hexColor),
    });

    this.canvas.tabIndex = 0;

    resizeRenderer(this.renderer, this.camera, MAX_DPR);
    this.prewarmCinematicViews();
    this.inspectionCamera.snap('front');
    this.updatePresentation(0, this.flight.state);
    this.installExperienceApi();
    window.addEventListener('keydown', this.onKeyDown);
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loop.stop();
    window.removeEventListener('keydown', this.onKeyDown);
    this.hud.dispose();
    this.pilotInput.dispose();
    this.inspectionCamera.dispose();
    this.cinematicCamera.dispose();
    this.vfx.dispose();
    this.audio.dispose();
    this.airplane.dispose();
    this.biomeWorld.dispose();
    this.world.dispose();
    this.reviewStudioFloor.geometry.dispose();
    this.reviewStudioFloor.material.dispose();
    this.renderer.dispose();
    window.__AIRPLANE_EXPERIENCE__ = undefined;
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
  }

  private update(
    deltaSeconds: number,
    _elapsedSeconds: number,
    rawDeltaSeconds: number,
  ): void {
    const delta = Math.min(0.05, Math.max(0, deltaSeconds));
    const simulationDelta = Math.min(0.2, Math.max(0, rawDeltaSeconds));
    this.frame += 1;
    this.worldElapsed += delta;
    resizeRenderer(this.renderer, this.camera, MAX_DPR);
    this.quality.tick(Math.min(1, rawDeltaSeconds));

    const snapshot = this.activeMode === 'manual'
      ? this.manualFlight.update(simulationDelta, this.pilotInput.intent)
      : this.flight.update(simulationDelta * this.timeScale);
    const worldChanged = this.biomeWorld.update(snapshot.position);
    if (worldChanged) {
      this.quality.invalidateSceneMetrics();
      this.world.setAirportVisible(
        this.biomeWorld.diagnostics.loadedChunkKeys.includes('0:0'),
      );
    }
    this.world.update(delta, this.worldElapsed, snapshot.position);
    const needsRealtimeShadows = snapshot.altitude < 12;
    if (this.renderer.shadowMap.autoUpdate !== needsRealtimeShadows) {
      this.renderer.shadowMap.autoUpdate = needsRealtimeShadows;
      this.renderer.shadowMap.needsUpdate = true;
    }
    if (snapshot.inspectionAllowed) {
      this.inspectionCamera.setEnabled(true);
      this.inspectionCamera.update(delta, snapshot);
    } else if (this.activeMode === 'manual') {
      this.inspectionCamera.setEnabled(false);
      this.pilotCamera.update(delta, snapshot);
    } else {
      this.inspectionCamera.setEnabled(false);
      this.cinematicCamera.update(delta, snapshot);
    }

    this.updatePresentation(delta, snapshot);
    this.vfx.update(delta, this.airplane.root, {
      phase: snapshot.phase,
      speed: snapshot.speed,
      altitude: snapshot.altitude,
      propellerRpm: snapshot.propellerRpm,
      wheelContact: snapshot.wheelContact.main,
    });
    this.audio.update({
      phase: snapshot.phase,
      speed: snapshot.speed,
      altitude: snapshot.altitude,
      propellerRpm: snapshot.propellerRpm,
      wheelContact: snapshot.wheelContact.all,
    });
    this.hud.update({
      ...snapshot,
      totalDuration: FLIGHT_SEQUENCE_SECONDS,
    });

    if (snapshot.phase !== this.previousPhase) {
      this.previousPhase = snapshot.phase;
    }
    if (this.frame % 8 === 0) this.publishLegacyDiagnostics();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private prewarmCinematicViews(): void {
    const previousVisibility = this.canvas.style.visibility;
    const previousRenderTarget = this.renderer.getRenderTarget();
    const previousShadowAutoUpdate = this.renderer.shadowMap.autoUpdate;
    let elapsed = 0;

    this.canvas.style.visibility = 'hidden';
    this.renderer.setRenderTarget(null);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(PREWARM_RENDER_WIDTH, PREWARM_RENDER_HEIGHT, false);
    this.flight.reset();
    this.flight.start();

    try {
      for (const sampleTime of CINEMATIC_PREWARM_SECONDS) {
        const snapshot = this.flight.update(sampleTime - elapsed);
        elapsed = sampleTime;
        this.biomeWorld.update(snapshot.position);
        this.world.update(0, this.worldElapsed, snapshot.position);
        this.cinematicCamera.snap(snapshot);

        const needsShadowPass = snapshot.altitude < 12;
        this.renderer.shadowMap.autoUpdate = needsShadowPass;
        if (needsShadowPass) this.renderer.shadowMap.needsUpdate = true;
        this.renderer.render(this.scene, this.camera);
      }
    } finally {
      this.flight.reset();
      this.manualFlight.reset();
      this.biomeWorld.recenterNow(this.world.environment.parkingPosition);
      this.world.setAirportVisible(true);
      this.world.update(0, this.worldElapsed, this.world.environment.parkingPosition);
      this.quality.invalidateSceneMetrics();
      this.cinematicCamera.reset();
      this.pilotCamera.reset();
      this.renderer.setRenderTarget(previousRenderTarget);
      this.renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
      this.renderer.shadowMap.needsUpdate = true;
      resizeRenderer(this.renderer, this.camera, MAX_DPR);
      this.inspectionCamera.snap('front');
      this.updatePresentation(0, this.flight.state);
      this.renderer.render(this.scene, this.camera);
      this.canvas.style.visibility = previousVisibility;
    }
  }

  private startAutopilotFlight(): void {
    if (this.activeMode === 'autopilot' && this.flight.state.running) return;
    void this.audio.unlock();
    this.activeMode = 'autopilot';
    this.pilotInput.setEnabled(false);
    this.manualFlight.reset();
    const wasComplete = this.flight.state.completed;
    if (wasComplete) {
      this.vfx.reset();
      this.flight.replay();
    } else {
      this.flight.start();
    }
    this.recenterWorldAtAirport();
    this.inspectionCamera.setEnabled(false);
    this.cinematicCamera.reset();
    this.pilotCamera.reset();
    this.audio.confirm();
  }

  private startManualFlight(): void {
    if (this.activeMode === 'manual' && this.manualFlight.state.running) {
      this.canvas.focus({ preventScroll: true });
      return;
    }
    void this.audio.unlock();
    this.activeMode = 'manual';
    this.flight.reset();
    this.manualFlight.reset();
    this.manualFlight.start();
    this.recenterWorldAtAirport();
    this.pilotInput.setEnabled(true);
    this.inspectionCamera.setEnabled(false);
    this.cinematicCamera.reset();
    this.pilotCamera.reset();
    this.vfx.reset();
    this.audio.confirm();
    this.canvas.focus({ preventScroll: true });
  }

  private resetFlight(): void {
    this.activeMode = 'manual';
    this.pilotInput.setEnabled(false);
    this.flight.reset();
    this.manualFlight.reset();
    this.recenterWorldAtAirport();
    this.vfx.reset();
    this.cinematicCamera.reset();
    this.pilotCamera.reset();
    this.inspectionCamera.setEnabled(true);
    this.inspectionCamera.reset('front');
    this.audio.reset();
    this.previousPhase = 'parked';
    this.updatePresentation(0, this.manualFlight.state);
    this.hud.update({
      ...this.manualFlight.state,
      totalDuration: FLIGHT_SEQUENCE_SECONDS,
    });
  }

  private recenterWorldAtAirport(): void {
    const changed = this.biomeWorld.recenterNow(this.world.environment.parkingPosition);
    this.world.setAirportVisible(true);
    this.world.update(0, this.worldElapsed, this.world.environment.parkingPosition);
    if (changed) this.quality.invalidateSceneMetrics();
  }

  private landingSurfaceHeightAt(worldX: number, worldZ: number): number {
    const environment = this.world.environment;
    const runwayHalfWidth = environment.runwayWidth * 0.5 + 1.5;
    const pavedHalfLength = environment.pavedLength * 0.5;
    const overRunway = Math.abs(worldX - environment.centerlineX) <= runwayHalfWidth
      && worldZ >= -pavedHalfLength
      && worldZ <= pavedHalfLength;
    return overRunway
      ? environment.landingElevation
      : this.biomeWorld.getTerrainHeight(worldX, worldZ);
  }

  private updatePresentation(delta: number, snapshot: Readonly<FlightSnapshot>): void {
    const rpm01 = THREE.MathUtils.clamp(snapshot.propellerRpm / 2400, 0, 1);
    const blurMaterial = this.airplane.propellerBlur.material as THREE.MeshBasicMaterial;
    this.airplane.propellerBlur.visible = rpm01 > 0.08;
    blurMaterial.opacity = THREE.MathUtils.smoothstep(rpm01, 0.12, 1) * 0.16;
    this.airplane.propellerBlur.scale.setScalar(0.96 + rpm01 * 0.05);

    const manualControlsActive = this.activeMode === 'manual' && snapshot.running;
    const aileronTarget = manualControlsActive
      ? this.pilotInput.intent.roll * 0.24
      : THREE.MathUtils.clamp(snapshot.bank * 0.72, -0.24, 0.24);
    const elevatorTarget = manualControlsActive
      ? this.pilotInput.intent.pitch * 0.2
      : THREE.MathUtils.clamp(snapshot.pitch * 0.5, -0.2, 0.2);
    const rudderTarget = manualControlsActive
      ? -this.pilotInput.intent.yaw * 0.14
      : THREE.MathUtils.clamp(-snapshot.bank * 0.18, -0.14, 0.14);
    const damping = delta <= 0 ? 1 : 1 - Math.exp(-delta * 8);
    this.airplane.controlSurfaces.leftAileron.rotation.x = THREE.MathUtils.lerp(
      this.airplane.controlSurfaces.leftAileron.rotation.x,
      aileronTarget,
      damping,
    );
    this.airplane.controlSurfaces.rightAileron.rotation.x = THREE.MathUtils.lerp(
      this.airplane.controlSurfaces.rightAileron.rotation.x,
      -aileronTarget,
      damping,
    );
    this.airplane.controlSurfaces.elevator.rotation.x = THREE.MathUtils.lerp(
      this.airplane.controlSurfaces.elevator.rotation.x,
      elevatorTarget,
      damping,
    );
    this.airplane.controlSurfaces.rudder.rotation.y = THREE.MathUtils.lerp(
      this.airplane.controlSurfaces.rudder.rotation.y,
      rudderTarget,
      damping,
    );

    const gazeX = THREE.MathUtils.clamp(-snapshot.bank * 0.14, -0.055, 0.055);
    const gazeY = THREE.MathUtils.clamp(snapshot.pitch * 0.08, -0.035, 0.035);
    this.airplane.face.leftPupil.position.set(
      this.leftPupilOrigin.x + gazeX,
      this.leftPupilOrigin.y + gazeY,
      this.leftPupilOrigin.z,
    );
    this.airplane.face.rightPupil.position.set(
      this.rightPupilOrigin.x + gazeX,
      this.rightPupilOrigin.y + gazeY,
      this.rightPupilOrigin.z,
    );

    this.airplane.shadowProxy.visible = !this.reviewMode && snapshot.altitude < 1.4;
    const shadowMaterial = this.airplane.shadowProxy.material as THREE.MeshBasicMaterial;
    shadowMaterial.opacity = 0.08 * (1 - THREE.MathUtils.smoothstep(snapshot.altitude, 0.2, 1.4));
  }

  private installExperienceApi(): void {
    const owner = this;
    window.__AIRPLANE_EXPERIENCE__ = {
      start: () => owner.startAutopilotFlight(),
      startAutopilot: () => owner.startAutopilotFlight(),
      startManual: () => owner.startManualFlight(),
      reset: () => owner.resetFlight(),
      setTimeScale: (value: number) => {
        if (!Number.isFinite(value)) return;
        owner.timeScale = THREE.MathUtils.clamp(value, 0.1, 20);
      },
      setReviewMode: (enabled: boolean) => owner.setReviewMode(Boolean(enabled)),
      setPaintColor: (hexColor: string) => owner.setAircraftPaintColor(hexColor),
      get state() {
        return owner.currentSnapshot();
      },
      get diagnostics() {
        return owner.createDiagnostics();
      },
    };
  }

  private setReviewMode(enabled: boolean): void {
    this.reviewMode = enabled;
    this.resetFlight();
    this.world.setSceneryVisible(!enabled);
    this.biomeWorld.setVisible(!enabled);
    this.reviewStudioFloor.visible = enabled;
    this.scene.background = enabled ? new THREE.Color('#d3d4d5') : this.normalBackground;
    this.scene.fog = enabled ? null : this.normalFog;
    this.inspectionCamera.snap('front');
    this.renderer.shadowMap.needsUpdate = true;
  }

  private setAircraftPaintColor(value: string): boolean {
    if (!this.airplane.paint.setColor(value)) return false;
    const color = this.airplane.paint.getColor();
    this.hud.setPaintColor(color);
    storeAircraftPaintColor(color);
    return true;
  }

  private createDiagnostics(): AirplaneExperienceDiagnostics {
    const performance = this.quality.snapshot(this.scene, this.renderer);
    const snapshot = this.currentSnapshot();
    return {
      frame: this.frame,
      mode: this.activeMode,
      flight: snapshot,
      input: { ...this.pilotInput.intent },
      manual: {
        throttle: this.manualFlight.state.throttle,
        verticalSpeed: this.manualFlight.state.verticalSpeed,
        stall: this.manualFlight.state.stall,
        onGround: this.manualFlight.state.onGround,
        crashed: this.manualFlight.state.crashed,
      },
      camera: {
        position: {
          x: this.camera.position.x,
          y: this.camera.position.y,
          z: this.camera.position.z,
        },
        fov: this.camera.fov,
      },
      renderer: {
        calls: performance.drawCalls,
        triangles: performance.triangles,
        geometries: performance.geometries,
        textures: performance.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, MAX_DPR),
      },
      performance,
      model: this.airplane.diagnostics,
      world: {
        ...this.world.diagnostics,
        streaming: this.biomeWorld.diagnostics,
      },
    };
  }

  private publishLegacyDiagnostics(): void {
    window.__THREE_GAME_DIAGNOSTICS__ = this.createDiagnostics();
  }

  private currentSnapshot(): Readonly<FlightSnapshot> {
    return this.activeMode === 'manual' ? this.manualFlight.state : this.flight.state;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target?.matches('button, input, textarea, select')) return;
    if (event.code === 'KeyR') {
      event.preventDefault();
      this.resetFlight();
      return;
    }
    if (event.code === 'Enter') {
      event.preventDefault();
      if (!this.currentSnapshot().running) this.startManualFlight();
      return;
    }
    const views: Partial<Record<string, InspectionView>> = {
      Digit1: 'front',
      Digit2: 'side',
      Digit3: 'rear',
      Digit4: 'above',
    };
    const view = views[event.code];
    if (view && this.currentSnapshot().inspectionAllowed) this.inspectionCamera.setView(view);
  };
}
