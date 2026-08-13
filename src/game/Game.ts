import * as THREE from 'three';
import {
  createAirplaneModel,
  DEFAULT_AIRCRAFT_PAINT_COLOR,
  type AirplaneModel,
} from '../assets/AirplaneModel';
import { PlayableCharacter, type CharacterId } from '../entities/PlayableCharacter';
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
import { CharacterInput } from '../systems/CharacterInput';
import {
  GroundCharacterController,
  type GroundCharacterSnapshot,
} from '../systems/GroundCharacterController';
import { PilotCamera } from '../systems/PilotCamera';
import { PilotInput, type PilotIntent } from '../systems/PilotInput';
import { GroundCarController, type GroundCarSnapshot } from '../systems/GroundCarController';
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
const CHARACTER_STORAGE_KEY = 'cropper-seven-character';
const CHARACTER_SPAWN = new THREE.Vector3(-6, 0, -112.4);
const CHARACTER_SPAWN_YAW = Math.PI / 2;
// Both authored vehicles face local +Z, so physical right is local -X.
const AIRCRAFT_ENTRY_LEFT_LOCAL = new THREE.Vector3(1.95, 0, -0.5);
const AIRCRAFT_ENTRY_RIGHT_LOCAL = new THREE.Vector3(-1.95, 0, -0.5);
const AIRCRAFT_ENTRY_LOCALS = [AIRCRAFT_ENTRY_LEFT_LOCAL, AIRCRAFT_ENTRY_RIGHT_LOCAL] as const;
const AIRCRAFT_ENTRY_RADIUS = 2.8;
const CAR_ENTRY_RADIUS = 2.5;
const NEUTRAL_PILOT_INTENT: Readonly<PilotIntent> = Object.freeze({
  throttle: 0,
  pitch: 0,
  roll: 0,
  yaw: 0,
  brake: false,
});

type GameplayControlMode = 'inspection' | 'on-foot' | 'piloting' | 'driving' | 'autopilot';
type InteractionTarget = 'aircraft' | 'car';

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

function readStoredCharacter(): CharacterId {
  try {
    const value = window.localStorage.getItem(CHARACTER_STORAGE_KEY);
    return value === 'field' || value === 'racer' ? value : 'pilot';
  } catch {
    return 'pilot';
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
  private readonly characterInput = new CharacterInput();
  private readonly character: PlayableCharacter;
  private readonly characterController: GroundCharacterController;
  private readonly carController: GroundCarController;
  private readonly characterCameraTarget = new THREE.Object3D();
  private readonly inspectionCamera: InspectionCamera;
  private readonly cinematicCamera: CinematicCamera;
  private readonly pilotCamera: PilotCamera;
  private readonly characterCamera: PilotCamera;
  private readonly carCamera: PilotCamera;
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
  private readonly cameraForward = new THREE.Vector3();
  private readonly aircraftEntryWorld = new THREE.Vector3();

  private frame = 0;
  private worldElapsed = 0;
  private timeScale = 1;
  private activeMode: Exclude<FlightMode, 'inspection'> = 'manual';
  private controlMode: GameplayControlMode = 'inspection';
  private characterEntryDistance = Number.POSITIVE_INFINITY;
  private interactionRadius = AIRCRAFT_ENTRY_RADIUS;
  private characterCanEnterVehicle = false;
  private interactionTarget: InteractionTarget | null = null;
  private interactionRight = false;
  private disposed = false;
  private reviewMode = false;
  private normalBackground: THREE.Scene['background'] = null;
  private normalFog: THREE.Fog | THREE.FogExp2 | null = null;

  private get canExit(): boolean {
    const state = this.manualFlight.state;
    return this.controlMode === 'piloting' && state.onGround && state.speed <= 0.05;
  }

  private get canExitCar(): boolean {
    return this.controlMode === 'driving' && Math.abs(this.carController.state.speed) <= 0.1;
  }

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
    const initialCharacter = readStoredCharacter();
    this.character = new PlayableCharacter(initialCharacter);
    this.scene.add(this.character.root);
    void this.character.ready.then(() => this.quality.invalidateSceneMetrics());
    this.characterController = new GroundCharacterController(this.character.root, {
      surfaceHeightAt: (worldX, worldZ) => this.landingSurfaceHeightAt(worldX, worldZ),
      spawnPosition: CHARACTER_SPAWN,
      spawnYaw: CHARACTER_SPAWN_YAW,
      // The airport is the first area of an open world, not a fenced level.
      // Terrain remains the height source, but no artificial slope/step wall
      // may stop the character from walking away from the runway.
      maximumSlopeRadians: Math.PI / 2,
      maximumStepHeight: 1_000,
    });
    this.carController = new GroundCarController(this.world.parkedCar.root, {
      surfaceHeightAt: (worldX, worldZ) => this.landingSurfaceHeightAt(worldX, worldZ),
      wheelPivots: this.world.parkedCar.wheelPivots,
      wheelbase: this.world.parkedCar.diagnostics.dimensions.wheelbase,
      wheelRadius: this.world.parkedCar.diagnostics.dimensions.wheelRadius,
      halfTrack: this.world.parkedCar.diagnostics.dimensions.trackWidth * 0.5,
    });
    void this.world.parkedCar.ready.then((loaded) => {
      if (!loaded || this.disposed) return;
      this.carController.reset();
      this.updateVehicleEntryInteraction(this.characterController.state);
    });
    this.characterCameraTarget.position.copy(this.character.root.position);
    this.characterCameraTarget.rotation.y = CHARACTER_SPAWN_YAW;
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
    this.pilotCamera = new PilotCamera(this.camera, this.airplane.root, canvas);
    this.characterCamera = new PilotCamera(this.camera, this.characterCameraTarget, canvas, {
      minDistance: 3.5,
      maxDistance: 16,
      focusHeight: 1.2,
      followDistance: [5.4, 6.8],
      followHeight: [2.8, 2.8],
      sideOffset: [0, 0],
      lookAhead: [1.5, 2.8],
      targetHeight: 1.05,
      speedForMaximumFraming: 5.25,
      fov: [44, 48],
      allowAirborneUnderside: false,
    });
    this.carCamera = new PilotCamera(this.camera, this.world.parkedCar.root, canvas, {
      minDistance: 4.8,
      maxDistance: 22,
      focusHeight: 0.74,
      followDistance: [6.8, 10.5],
      followHeight: [2.6, 4],
      sideOffset: [0, 0],
      lookAhead: [2.8, 8],
      targetHeight: 0.57,
      speedForMaximumFraming: 38,
      fov: [48, 55],
      allowAirborneUnderside: false,
    });
    this.vfx = new FlightVfx(this.scene);
    this.leftPupilOrigin = this.airplane.face.leftPupil.position.clone();
    this.rightPupilOrigin = this.airplane.face.rightPupil.position.clone();

    this.hud = new FlightHud({
      onStartManual: () => this.startOnFoot(),
      onStartAutopilot: () => this.startAutopilotFlight(),
      onReset: () => this.resetFlight(),
      onMuteChange: (muted) => this.audio.setMuted(muted),
      initialPaintColor,
      onPaintColorChange: (hexColor) => this.setAircraftPaintColor(hexColor),
      onCameraSettingsChange: (sensitivity, invertY) => {
        PilotCamera.setMouseSettings(sensitivity, invertY);
      },
      initialCharacter,
      onCharacterChange: (characterId) => {
        this.character.setCharacter(characterId);
        try {
          window.localStorage.setItem(CHARACTER_STORAGE_KEY, characterId);
        } catch {}
      },
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
    this.characterInput.dispose();
    this.releaseGameplayMouseLook();
    this.inspectionCamera.dispose();
    this.pilotCamera.dispose();
    this.characterCamera.dispose();
    this.carCamera.dispose();
    this.cinematicCamera.dispose();
    this.vfx.dispose();
    this.audio.dispose();
    this.character.dispose();
    this.airplane.dispose();
    this.biomeWorld.dispose();
    this.world.dispose();
    this.reviewStudioFloor.geometry.dispose();
    this.reviewStudioFloor.material.dispose();
    this.renderer.dispose();
    window.__AIRPLANE_EXPERIENCE__ = undefined;
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

    let vehicleSnapshot: Readonly<FlightSnapshot>;
    let snapshot: Readonly<FlightSnapshot>;
    if (this.controlMode === 'autopilot') {
      vehicleSnapshot = this.flight.update(simulationDelta * this.timeScale);
      snapshot = vehicleSnapshot;
    } else if (this.controlMode === 'piloting') {
      vehicleSnapshot = this.manualFlight.update(simulationDelta, this.pilotInput.intent);
      snapshot = vehicleSnapshot;
    } else if (this.controlMode === 'driving') {
      vehicleSnapshot = this.manualFlight.update(simulationDelta, NEUTRAL_PILOT_INTENT);
      snapshot = this.createDrivingSnapshot(
        this.carController.update(simulationDelta, this.pilotInput.intent),
      );
    } else if (this.controlMode === 'on-foot') {
      vehicleSnapshot = this.manualFlight.update(simulationDelta, this.pilotInput.intent);
      this.camera.getWorldDirection(this.cameraForward);
      const characterState = this.characterController.update(
        simulationDelta,
        this.characterInput.intent,
        this.cameraForward,
      );
      this.character.setAnimation(characterState.animation);
      this.characterCameraTarget.position.copy(characterState.position);
      this.updateVehicleEntryInteraction(characterState);
      snapshot = this.createOnFootSnapshot(characterState);
    } else {
      vehicleSnapshot = this.manualFlight.state;
      snapshot = vehicleSnapshot;
    }
    if (this.character.root.visible) this.character.update(delta);
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
    if (
      this.controlMode === 'inspection'
      || (this.controlMode === 'autopilot' && snapshot.inspectionAllowed)
    ) {
      this.characterCamera.setEnabled(false);
      this.pilotCamera.setEnabled(false);
      this.carCamera.setEnabled(false);
      this.inspectionCamera.setEnabled(true);
      this.inspectionCamera.update(delta, snapshot);
    } else if (this.controlMode === 'on-foot') {
      this.inspectionCamera.setEnabled(false);
      this.pilotCamera.setEnabled(false);
      this.carCamera.setEnabled(false);
      this.characterCamera.setEnabled(true);
      this.characterCamera.update(delta, snapshot);
    } else if (this.controlMode === 'piloting') {
      this.characterCamera.setEnabled(false);
      this.inspectionCamera.setEnabled(false);
      this.carCamera.setEnabled(false);
      this.pilotCamera.setEnabled(true);
      this.pilotCamera.update(delta, snapshot);
    } else if (this.controlMode === 'driving') {
      this.characterCamera.setEnabled(false);
      this.inspectionCamera.setEnabled(false);
      this.pilotCamera.setEnabled(false);
      this.carCamera.setEnabled(true);
      this.carCamera.update(delta, snapshot);
    } else {
      this.characterCamera.setEnabled(false);
      this.inspectionCamera.setEnabled(false);
      this.pilotCamera.setEnabled(false);
      this.carCamera.setEnabled(false);
      this.cinematicCamera.update(delta, snapshot);
    }

    this.updatePresentation(delta, vehicleSnapshot);
    this.vfx.update(delta, this.airplane.root, {
      phase: vehicleSnapshot.phase,
      speed: vehicleSnapshot.speed,
      altitude: vehicleSnapshot.altitude,
      propellerRpm: vehicleSnapshot.propellerRpm,
      wheelContact: vehicleSnapshot.wheelContact.main,
    });
    const soundSnapshot = this.controlMode === 'driving' ? snapshot : vehicleSnapshot;
    this.audio.update({
      phase: soundSnapshot.phase,
      speed: soundSnapshot.speed,
      altitude: soundSnapshot.altitude,
      propellerRpm: soundSnapshot.propellerRpm,
      wheelContact: soundSnapshot.wheelContact.all,
    });
    this.hud.update({
      ...snapshot,
      totalDuration: FLIGHT_SEQUENCE_SECONDS,
      controlMode: this.controlMode,
      hubVisible: !this.reviewMode && (
        this.controlMode === 'inspection'
        || (this.controlMode === 'autopilot' && snapshot.inspectionAllowed)
      ),
      interactionPrompt: this.characterCanEnterVehicle
        ? this.interactionTarget === 'car' ? 'Enter car' : 'Enter aircraft'
        : this.canExitCar ? 'Exit car' : this.canExit ? 'Exit aircraft' : undefined,
    });

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
      if (import.meta.env.VITE_E2E !== '1') {
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
      this.characterCamera.reset();
      this.carCamera.reset();
      this.carCamera.setEnabled(false);
      this.carController.setEnabled(false);
      this.carController.reset();
      this.characterCamera.setEnabled(false);
      this.characterController.setEnabled(false);
      this.characterController.reset();
      this.characterInput.setEnabled(false);
      this.character.setVisible(true);
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
    this.releaseGameplayMouseLook();
    this.activeMode = 'autopilot';
    this.controlMode = 'autopilot';
    this.pilotInput.setEnabled(false);
    this.characterInput.setEnabled(false);
    this.characterController.setEnabled(false);
    this.carController.setEnabled(false);
    this.carController.reset();
    this.character.setVisible(false);
    this.characterCanEnterVehicle = false;
    this.interactionTarget = null;
    this.characterEntryDistance = Number.POSITIVE_INFINITY;
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
    this.pilotCamera.setEnabled(false);
    this.characterCamera.setEnabled(false);
    this.carCamera.setEnabled(false);
    this.cinematicCamera.reset();
    this.pilotCamera.reset();
    this.characterCamera.reset();
    this.carCamera.reset();
    this.audio.confirm();
  }

  private startOnFoot(): void {
    if (this.controlMode === 'on-foot') {
      this.canvas.focus({ preventScroll: true });
      return;
    }
    void this.audio.unlock();
    this.activeMode = 'manual';
    this.controlMode = 'on-foot';
    this.flight.reset();
    this.manualFlight.reset();
    this.carController.setEnabled(false);
    this.carController.reset();
    this.recenterWorldAtAirport();
    this.pilotInput.setEnabled(false);
    this.characterInput.setEnabled(true);
    this.characterController.reset();
    this.characterController.setEnabled(true);
    this.characterCameraTarget.position.copy(this.character.root.position);
    this.characterCameraTarget.rotation.set(0, CHARACTER_SPAWN_YAW, 0);
    this.character.setVisible(true);
    this.character.setAnimation('idle', 0);
    this.inspectionCamera.setEnabled(false);
    this.pilotCamera.setEnabled(false);
    this.carCamera.setEnabled(false);
    this.characterCamera.reset();
    this.characterCamera.setEnabled(true);
    this.cinematicCamera.reset();
    this.pilotCamera.reset();
    this.carCamera.reset();
    this.vfx.reset();
    this.updateVehicleEntryInteraction(this.characterController.state);
    this.audio.confirm();
    this.canvas.focus({ preventScroll: true });
    this.characterCamera.toggleMouseLook();
  }

  private startManualFlight(): void {
    if (this.controlMode === 'piloting' && this.manualFlight.state.running) {
      this.canvas.focus({ preventScroll: true });
      return;
    }
    void this.audio.unlock();
    this.activeMode = 'manual';
    this.controlMode = 'piloting';
    this.flight.reset();
    this.manualFlight.reset();
    this.manualFlight.start();
    this.carController.setEnabled(false);
    this.carController.reset();
    this.recenterWorldAtAirport();
    this.characterInput.setEnabled(false);
    this.characterController.setEnabled(false);
    this.character.setVisible(false);
    this.characterCanEnterVehicle = false;
    this.interactionTarget = null;
    this.characterEntryDistance = Number.POSITIVE_INFINITY;
    this.pilotInput.setEnabled(true);
    this.inspectionCamera.setEnabled(false);
    this.characterCamera.setEnabled(false);
    this.carCamera.setEnabled(false);
    this.cinematicCamera.reset();
    this.characterCamera.reset();
    this.carCamera.reset();
    this.pilotCamera.reset();
    this.pilotCamera.setEnabled(true);
    this.vfx.reset();
    this.audio.confirm();
    this.canvas.focus({ preventScroll: true });
    this.pilotCamera.toggleMouseLook();
  }

  private enterAircraft(): void {
    if (
      this.controlMode !== 'on-foot'
      || !this.characterCanEnterVehicle
      || this.interactionTarget !== 'aircraft'
    ) return;
    this.characterInput.setEnabled(false);
    this.characterController.setEnabled(false);
    this.character.setVisible(false);
    this.characterCanEnterVehicle = false;
    this.interactionTarget = null;
    this.characterEntryDistance = Number.POSITIVE_INFINITY;
    this.controlMode = 'piloting';
    this.manualFlight.start();
    this.pilotInput.setEnabled(true);
    this.characterCamera.setEnabled(false);
    this.carCamera.setEnabled(false);
    this.characterCamera.reset();
    this.pilotCamera.reset();
    this.pilotCamera.setEnabled(true);
    this.audio.confirm();
    this.canvas.focus({ preventScroll: true });
  }

  private exitAircraft(): void {
    if (this.controlMode !== 'piloting' || !this.canExit) return;
    const aircraftState = this.manualFlight.state;
    this.pilotInput.setEnabled(false);
    this.aircraftEntryWorld.copy(
      this.interactionRight ? AIRCRAFT_ENTRY_RIGHT_LOCAL : AIRCRAFT_ENTRY_LEFT_LOCAL,
    );
    this.airplane.root.localToWorld(this.aircraftEntryWorld);
    const faceAircraftYaw = Math.atan2(
      this.airplane.root.position.x - this.aircraftEntryWorld.x,
      this.airplane.root.position.z - this.aircraftEntryWorld.z,
    );
    this.characterController.reset(this.aircraftEntryWorld, faceAircraftYaw);
    this.characterController.setEnabled(true);
    this.characterInput.setEnabled(true);
    this.character.setVisible(true);
    this.characterCameraTarget.position.copy(this.character.root.position);
    this.characterCameraTarget.rotation.y = aircraftState.yaw;
    this.controlMode = 'on-foot';
    this.pilotCamera.setEnabled(false);
    this.characterCamera.reset();
    this.characterCamera.setEnabled(true);
    this.updateVehicleEntryInteraction(this.characterController.state);
    this.audio.confirm();
  }

  private enterCar(): void {
    if (
      this.controlMode !== 'on-foot'
      || !this.characterCanEnterVehicle
      || this.interactionTarget !== 'car'
    ) return;
    this.characterInput.setEnabled(false);
    this.characterController.setEnabled(false);
    this.character.setVisible(false);
    this.characterCanEnterVehicle = false;
    this.interactionTarget = null;
    this.characterEntryDistance = Number.POSITIVE_INFINITY;
    this.controlMode = 'driving';
    this.pilotInput.setEnabled(true);
    this.carController.setEnabled(true);
    this.characterCamera.setEnabled(false);
    this.pilotCamera.setEnabled(false);
    this.characterCamera.reset();
    this.carCamera.reset();
    this.carCamera.setEnabled(true);
    this.audio.confirm();
    this.canvas.focus({ preventScroll: true });
  }

  private exitCar(): void {
    if (!this.canExitCar) return;
    this.pilotInput.setEnabled(false);
    this.carController.setEnabled(false);
    // The imported source named its sides in raw authoring coordinates. With
    // runtime +Z forward, physical right is local -X, so the authored names
    // are intentionally crossed here to keep the player-facing side correct.
    const socketName = this.interactionRight
      ? 'socket-driver-entry-left'
      : 'socket-driver-entry-right';
    const socket = this.world.parkedCar.runtime.sockets[socketName];
    this.world.parkedCar.root.updateMatrixWorld(true);
    if (socket) socket.getWorldPosition(this.aircraftEntryWorld);
    else this.aircraftEntryWorld.copy(this.world.parkedCar.root.position);
    const faceCarYaw = Math.atan2(
      this.world.parkedCar.root.position.x - this.aircraftEntryWorld.x,
      this.world.parkedCar.root.position.z - this.aircraftEntryWorld.z,
    );
    this.characterController.reset(this.aircraftEntryWorld, faceCarYaw);
    this.characterController.setEnabled(true);
    this.characterInput.setEnabled(true);
    this.character.setVisible(true);
    this.characterCameraTarget.position.copy(this.character.root.position);
    this.characterCameraTarget.rotation.y = faceCarYaw;
    this.controlMode = 'on-foot';
    this.carCamera.setEnabled(false);
    this.carCamera.reset();
    this.characterCamera.reset();
    this.characterCamera.setEnabled(true);
    this.updateVehicleEntryInteraction(this.characterController.state);
    this.audio.confirm();
  }

  private resetFlight(): void {
    this.activeMode = 'manual';
    this.controlMode = 'inspection';
    this.releaseGameplayMouseLook();
    this.pilotInput.setEnabled(false);
    this.characterInput.setEnabled(false);
    this.characterController.setEnabled(false);
    this.characterController.reset();
    this.carController.setEnabled(false);
    this.carController.reset();
    this.characterCameraTarget.position.copy(this.character.root.position);
    this.characterCameraTarget.rotation.set(0, CHARACTER_SPAWN_YAW, 0);
    this.character.setVisible(!this.reviewMode);
    this.characterCanEnterVehicle = false;
    this.interactionTarget = null;
    this.characterEntryDistance = Number.POSITIVE_INFINITY;
    this.flight.reset();
    this.manualFlight.reset();
    this.recenterWorldAtAirport();
    this.vfx.reset();
    this.cinematicCamera.reset();
    this.pilotCamera.reset();
    this.pilotCamera.setEnabled(false);
    this.carCamera.reset();
    this.carCamera.setEnabled(false);
    this.characterCamera.reset();
    this.characterCamera.setEnabled(false);
    this.inspectionCamera.setEnabled(true);
    this.inspectionCamera.reset('front');
    this.audio.reset();
    this.updatePresentation(0, this.manualFlight.state);
    this.hud.update({
      ...this.manualFlight.state,
      totalDuration: FLIGHT_SEQUENCE_SECONDS,
      controlMode: this.controlMode,
      hubVisible: !this.reviewMode,
    });
  }

  private recenterWorldAtAirport(): void {
    const changed = this.biomeWorld.recenterNow(this.world.environment.parkingPosition);
    this.world.setAirportVisible(true);
    this.world.update(0, this.worldElapsed, this.world.environment.parkingPosition);
    if (changed) this.quality.invalidateSceneMetrics();
  }

  private releaseGameplayMouseLook(): void {
    this.pilotCamera.releaseMouseLook();
    this.characterCamera.releaseMouseLook();
    this.carCamera.releaseMouseLook();
  }

  private landingSurfaceHeightAt(worldX: number, worldZ: number): number {
    return this.world.environment.surfaceHeightAt(worldX, worldZ)
      ?? this.biomeWorld.getTerrainHeight(worldX, worldZ);
  }

  private updateVehicleEntryInteraction(
    characterState: Readonly<GroundCharacterSnapshot>,
  ): void {
    let nearestDistance = Number.POSITIVE_INFINITY;
    let nearestTarget: InteractionTarget | null = null;
    let nearestRight = false;
    let nearestRadius = AIRCRAFT_ENTRY_RADIUS;
    const consider = (
      candidate: Readonly<THREE.Vector3>,
      target: InteractionTarget,
      right: boolean,
      radius: number,
    ): void => {
      const candidateDistance = Math.hypot(
        characterState.position.x - candidate.x,
        characterState.position.z - candidate.z,
      );
      if (candidateDistance >= nearestDistance) return;
      nearestDistance = candidateDistance;
      nearestTarget = target;
      nearestRight = right;
      nearestRadius = radius;
      this.aircraftEntryWorld.copy(candidate);
    };

    const aircraftState = this.manualFlight.state;
    if (aircraftState.onGround && aircraftState.speed <= 0.05) {
      for (let index = 0; index < AIRCRAFT_ENTRY_LOCALS.length; index += 1) {
        this.cameraForward.copy(AIRCRAFT_ENTRY_LOCALS[index]);
        this.airplane.root.localToWorld(this.cameraForward);
        consider(this.cameraForward, 'aircraft', index === 1, AIRCRAFT_ENTRY_RADIUS);
      }
    }

    if (
      this.world.parkedCar.diagnostics.loadState === 'ready'
      && Math.abs(this.carController.state.speed) <= 0.1
    ) {
      this.world.parkedCar.root.updateMatrixWorld(true);
      for (const [socketName, right] of [
        ['socket-driver-entry-right', false],
        ['socket-driver-entry-left', true],
      ] as const) {
        const socket = this.world.parkedCar.runtime.sockets[socketName];
        if (!socket) continue;
        socket.getWorldPosition(this.cameraForward);
        consider(this.cameraForward, 'car', right, CAR_ENTRY_RADIUS);
      }
    }

    this.characterEntryDistance = nearestDistance;
    this.interactionTarget = nearestTarget;
    this.interactionRight = nearestRight;
    this.interactionRadius = nearestRadius;
    this.characterCanEnterVehicle = this.controlMode === 'on-foot'
      && nearestTarget !== null
      && nearestDistance <= nearestRadius;
  }

  private createOnFootSnapshot(
    characterState: Readonly<GroundCharacterSnapshot>,
  ): FlightSnapshot {
    const base = this.manualFlight.state;
    const altitude = Math.max(
      0,
      characterState.position.y - characterState.terrainHeight,
    );
    return {
      ...base,
      mode: 'manual',
      phase: 'manual-ready',
      phaseProgress: 0,
      normalizedProgress: 0,
      elapsed: characterState.elapsed,
      airborneSeconds: characterState.grounded ? 0 : characterState.elapsed,
      airborneProgress: 0,
      speed: characterState.speed,
      altitude,
      verticalSpeed: characterState.verticalSpeed,
      throttle: 0,
      stall: false,
      crashed: false,
      onGround: characterState.grounded,
      propellerRpm: 0,
      propellerAngle: 0,
      wheelRotation: 0,
      wheelContact: {
        main: characterState.grounded,
        auxiliary: characterState.grounded,
        all: characterState.grounded,
      },
      pitch: 0,
      bank: 0,
      yaw: characterState.yaw,
      cameraShot: 'aerial-chase',
      completed: false,
      running: true,
      inspectionAllowed: false,
      position: characterState.position,
    };
  }

  private createDrivingSnapshot(carState: Readonly<GroundCarSnapshot>): FlightSnapshot {
    const base = this.manualFlight.state;
    return {
      ...base,
      mode: 'manual',
      phase: 'manual-ready',
      phaseProgress: 0,
      normalizedProgress: 0,
      elapsed: carState.elapsed,
      airborneSeconds: 0,
      airborneProgress: 0,
      speed: Math.abs(carState.speed),
      altitude: 0,
      verticalSpeed: 0,
      throttle: Math.abs(carState.throttle),
      stall: false,
      crashed: false,
      onGround: true,
      propellerRpm: carState.engineRpm,
      propellerAngle: 0,
      wheelRotation: carState.wheelRotation,
      wheelContact: { main: true, auxiliary: true, all: true },
      pitch: carState.pitch,
      bank: carState.roll,
      yaw: carState.yaw,
      cameraShot: 'aerial-chase',
      completed: false,
      running: true,
      inspectionAllowed: false,
      position: carState.position,
    };
  }

  private updatePresentation(delta: number, snapshot: Readonly<FlightSnapshot>): void {
    const rpm01 = THREE.MathUtils.clamp(snapshot.propellerRpm / 2400, 0, 1);
    const blurMaterial = this.airplane.propellerBlur.material as THREE.MeshBasicMaterial;
    this.airplane.propellerBlur.visible = rpm01 > 0.08;
    blurMaterial.opacity = THREE.MathUtils.smoothstep(rpm01, 0.12, 1) * 0.16;
    this.airplane.propellerBlur.scale.setScalar(0.96 + rpm01 * 0.05);

    const manualControlsActive = this.controlMode === 'piloting' && snapshot.running;
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
      start: () => owner.startOnFoot(),
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
      gameplay: {
        controlMode: this.controlMode,
        hub: this.hud.getDiagnostics(),
        character: {
          ...this.character.diagnostics,
          controller: this.characterController.diagnostics,
        },
        car: {
          loadState: this.world.parkedCar.diagnostics.loadState,
          visible: this.world.parkedCar.root.visible,
          controller: this.carController.diagnostics,
          input: {
            enabled: this.controlMode === 'driving',
            intent: { ...this.pilotInput.intent },
          },
        },
        interaction: {
          kind: this.controlMode === 'on-foot'
            ? this.interactionTarget === 'car'
              ? 'enter-car'
              : this.interactionTarget === 'aircraft' ? 'enter-aircraft' : null
            : this.controlMode === 'piloting'
              ? 'exit-aircraft'
              : this.controlMode === 'driving' ? 'exit-car' : null,
          target: this.controlMode === 'driving'
            ? 'car'
            : this.controlMode === 'piloting' ? 'aircraft' : this.interactionTarget,
          side: this.interactionTarget || this.controlMode === 'driving' || this.controlMode === 'piloting'
            ? this.interactionRight ? 'right' : 'left'
            : null,
          available: this.characterCanEnterVehicle || this.canExit || this.canExitCar,
          distance: this.characterEntryDistance,
          radius: this.interactionRadius,
          promptVisible: this.characterCanEnterVehicle || this.canExit || this.canExitCar,
          worldPosition: {
            x: this.aircraftEntryWorld.x,
            y: this.aircraftEntryWorld.y,
            z: this.aircraftEntryWorld.z,
          },
        },
        input: this.characterInput.diagnostics,
      },
      manual: {
        throttle: this.manualFlight.state.throttle,
        verticalSpeed: this.manualFlight.state.verticalSpeed,
        stall: this.manualFlight.state.stall,
        onGround: this.manualFlight.state.onGround,
        crashed: this.manualFlight.state.crashed,
      },
      camera: {
        controller: this.controlMode === 'autopilot' && snapshot.inspectionAllowed
          ? 'inspection'
          : this.controlMode === 'on-foot'
          ? 'character'
          : this.controlMode === 'piloting'
            ? 'pilot'
            : this.controlMode === 'driving'
              ? 'car'
            : this.controlMode === 'autopilot'
              ? 'cinematic'
              : 'inspection',
        position: {
          x: this.camera.position.x,
          y: this.camera.position.y,
          z: this.camera.position.z,
        },
        fov: this.camera.fov,
        pilot: { ...this.pilotCamera.diagnostics },
        character: { ...this.characterCamera.diagnostics },
        car: { ...this.carCamera.diagnostics },
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

  private currentSnapshot(): Readonly<FlightSnapshot> {
    if (this.controlMode === 'autopilot') return this.flight.state;
    if (this.controlMode === 'on-foot') {
      return this.createOnFootSnapshot(this.characterController.state);
    }
    if (this.controlMode === 'driving') return this.createDrivingSnapshot(this.carController.state);
    return this.manualFlight.state;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.matches('button, input, textarea, select') || target?.isContentEditable) return;
    if (event.code === 'KeyR') {
      event.preventDefault();
      this.resetFlight();
      return;
    }
    if (event.code === 'Tab' && (
      this.controlMode === 'on-foot'
      || this.controlMode === 'piloting'
      || this.controlMode === 'driving'
    )) {
      event.preventDefault();
      const camera = this.controlMode === 'on-foot'
        ? this.characterCamera
        : this.controlMode === 'driving' ? this.carCamera : this.pilotCamera;
      camera.toggleMouseLook();
      return;
    }
    if (event.code === 'Escape' && (
      this.controlMode === 'on-foot'
      || this.controlMode === 'piloting'
      || this.controlMode === 'driving'
    )) {
      const camera = this.controlMode === 'on-foot'
        ? this.characterCamera
        : this.controlMode === 'driving' ? this.carCamera : this.pilotCamera;
      camera.releaseMouseLook();
      return;
    }
    if (event.code === 'KeyE' && !event.repeat) {
      if (this.controlMode === 'on-foot') {
        if (this.interactionTarget === 'car') this.enterCar();
        else this.enterAircraft();
      }
      else if (this.controlMode === 'piloting') this.exitAircraft();
      else if (this.controlMode === 'driving') this.exitCar();
      event.preventDefault();
      return;
    }
    if (event.code === 'KeyC' && this.controlMode === 'on-foot') {
      event.preventDefault();
      this.characterCameraTarget.quaternion.copy(this.character.root.quaternion);
      this.characterCamera.recenter();
      return;
    }
    if (event.code === 'KeyC' && this.controlMode === 'piloting') {
      event.preventDefault();
      this.pilotCamera.recenter();
      return;
    }
    if (event.code === 'KeyC' && this.controlMode === 'driving') {
      event.preventDefault();
      this.carCamera.recenter();
      return;
    }
    if (event.code === 'KeyC' && this.currentSnapshot().inspectionAllowed) {
      event.preventDefault();
      this.inspectionCamera.reset('front');
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
