import * as THREE from 'three';
import type { FlightSnapshot } from './FlightSequence';

export interface PilotCameraDiagnostics {
  enabled: boolean;
  dragging: boolean;
  yawOffset: number;
  pitchOffset: number;
  zoom: number;
  distance: number;
}

export interface PilotCameraOptions {
  minDistance?: number;
  maxDistance?: number;
  focusHeight?: number;
  followDistance?: readonly [number, number];
  followHeight?: readonly [number, number];
  sideOffset?: readonly [number, number];
  lookAhead?: readonly [number, number];
  targetHeight?: number;
  speedForMaximumFraming?: number;
  fov?: readonly [number, number];
  allowAirborneUnderside?: boolean;
}

const DEFAULT_MIN_DISTANCE = 11;
const DEFAULT_MAX_DISTANCE = 55;
const MIN_POLAR_ANGLE = 15 * Math.PI / 180;
const MAX_GROUND_POLAR_ANGLE = 85 * Math.PI / 180;
const MAX_AIRBORNE_POLAR_ANGLE = 115 * Math.PI / 180;
const POINTER_YAW_SENSITIVITY = 0.006;
const POINTER_PITCH_SENSITIVITY = 0.005;
const WHEEL_ZOOM_SENSITIVITY = 0.0012;

const shortestAngle = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

export class PilotCamera {
  private readonly aircraftPosition = new THREE.Vector3();
  private readonly aircraftQuaternion = new THREE.Quaternion();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private readonly anchor = new THREE.Vector3();
  private readonly basePosition = new THREE.Vector3();
  private readonly baseTarget = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly orbit = new THREE.Spherical();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly currentPosition = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly currentTarget = new THREE.Vector3();
  private initialized = false;
  private enabledState = false;
  private disposed = false;
  private pointerId: number | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private desiredYawOffset = 0;
  private currentYawOffset = 0;
  private desiredPitchOffset = 0;
  private currentPitchOffset = 0;
  private desiredZoom = 1;
  private currentZoom = 1;
  private baseDistance = 18;
  private cameraDistance = 18;
  private minimumPitchOffset = -Math.PI / 2;
  private maximumPitchOffset = Math.PI / 2;
  private readonly minDistance: number;
  private readonly maxDistance: number;
  private readonly focusHeight: number;
  private readonly followDistance: readonly [number, number];
  private readonly followHeight: readonly [number, number];
  private readonly sideOffset: readonly [number, number];
  private readonly lookAhead: readonly [number, number];
  private readonly targetHeight: number;
  private readonly speedForMaximumFraming: number;
  private readonly fovRange: readonly [number, number];
  private readonly allowAirborneUnderside: boolean;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly aircraft: THREE.Object3D,
    private readonly canvas: HTMLCanvasElement,
    options: PilotCameraOptions = {},
  ) {
    this.minDistance = options.minDistance ?? DEFAULT_MIN_DISTANCE;
    this.maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE;
    this.focusHeight = options.focusHeight ?? 2.36;
    this.followDistance = options.followDistance ?? [17, 24];
    this.followHeight = options.followHeight ?? [5.6, 8.2];
    this.sideOffset = options.sideOffset ?? [4.2, 2.1];
    this.lookAhead = options.lookAhead ?? [12, 24];
    this.targetHeight = options.targetHeight ?? 2.1;
    this.speedForMaximumFraming = options.speedForMaximumFraming ?? 72;
    this.fovRange = options.fov ?? [43, 52];
    this.allowAirborneUnderside = options.allowAirborneUnderside ?? true;
    this.addListeners();
  }

  get diagnostics(): Readonly<PilotCameraDiagnostics> {
    return {
      enabled: this.enabledState,
      dragging: this.pointerId !== null,
      yawOffset: this.currentYawOffset,
      pitchOffset: this.currentPitchOffset,
      zoom: this.currentZoom,
      distance: this.cameraDistance,
    };
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.enabledState = enabled;
    if (!enabled) this.finishPointer();
  }

  update(deltaSeconds: number, snapshot: Readonly<FlightSnapshot>): void {
    if (this.disposed || !this.enabledState) return;
    const delta = Number.isFinite(deltaSeconds) ? THREE.MathUtils.clamp(deltaSeconds, 0, 0.1) : 0;
    this.aircraft.getWorldPosition(this.aircraftPosition);
    this.aircraft.getWorldQuaternion(this.aircraftQuaternion);
    this.forward.set(0, 0, 1).applyQuaternion(this.aircraftQuaternion).normalize();
    // This model's nose is +Z, making the pilot's right-hand side local -X.
    this.right.set(-1, 0, 0).applyQuaternion(this.aircraftQuaternion).normalize();

    const speed01 = THREE.MathUtils.clamp(
      snapshot.speed / Math.max(0.001, this.speedForMaximumFraming),
      0,
      1,
    );
    const airborne01 = THREE.MathUtils.smoothstep(snapshot.altitude, 0.5, 8);
    const followDistance = THREE.MathUtils.lerp(
      this.followDistance[0],
      this.followDistance[1],
      speed01,
    );
    const followHeight = THREE.MathUtils.lerp(
      this.followHeight[0],
      this.followHeight[1],
      airborne01,
    );
    const sideOffset = THREE.MathUtils.lerp(
      this.sideOffset[0],
      this.sideOffset[1],
      airborne01,
    );

    this.basePosition
      .copy(this.aircraftPosition)
      .addScaledVector(this.forward, -followDistance)
      .addScaledVector(this.worldUp, followHeight)
      .addScaledVector(this.right, sideOffset);
    this.baseTarget
      .copy(this.aircraftPosition)
      .addScaledVector(
        this.forward,
        THREE.MathUtils.lerp(this.lookAhead[0], this.lookAhead[1], speed01),
      )
      .addScaledVector(this.worldUp, this.targetHeight + Math.max(0, snapshot.pitch) * 5);

    this.anchor.copy(this.aircraftPosition).addScaledVector(this.worldUp, this.focusHeight);
    this.offset.copy(this.basePosition).sub(this.anchor);
    this.orbit.setFromVector3(this.offset);
    this.baseDistance = Math.max(0.001, this.orbit.radius);

    const airborneUndersideAccess = this.allowAirborneUnderside
      ? THREE.MathUtils.smoothstep(snapshot.altitude, 4, 18)
      : 0;
    const maximumPolarAngle = THREE.MathUtils.lerp(
      MAX_GROUND_POLAR_ANGLE,
      MAX_AIRBORNE_POLAR_ANGLE,
      airborneUndersideAccess,
    );
    this.minimumPitchOffset = MIN_POLAR_ANGLE - this.orbit.phi;
    this.maximumPitchOffset = maximumPolarAngle - this.orbit.phi;
    this.desiredPitchOffset = THREE.MathUtils.clamp(
      this.desiredPitchOffset,
      this.minimumPitchOffset,
      this.maximumPitchOffset,
    );
    this.desiredZoom = THREE.MathUtils.clamp(
      this.desiredZoom,
      this.minDistance / this.baseDistance,
      this.maxDistance / this.baseDistance,
    );

    const orbitAlpha = 1 - Math.exp(-delta * 12);
    const zoomAlpha = 1 - Math.exp(-delta * 9.5);
    this.currentYawOffset += shortestAngle(this.desiredYawOffset - this.currentYawOffset)
      * orbitAlpha;
    this.currentPitchOffset = THREE.MathUtils.lerp(
      this.currentPitchOffset,
      this.desiredPitchOffset,
      orbitAlpha,
    );
    this.currentZoom = THREE.MathUtils.lerp(this.currentZoom, this.desiredZoom, zoomAlpha);

    this.orbit.theta += this.currentYawOffset;
    this.orbit.phi = THREE.MathUtils.clamp(
      this.orbit.phi + this.currentPitchOffset,
      MIN_POLAR_ANGLE,
      maximumPolarAngle,
    );
    this.orbit.radius = THREE.MathUtils.clamp(
      this.baseDistance * this.currentZoom,
      this.minDistance,
      this.maxDistance,
    );
    this.offset.setFromSpherical(this.orbit);
    this.desiredPosition.copy(this.anchor).add(this.offset);

    // The standard rear chase keeps its forward look-ahead. As the player orbits
    // toward a side or front view, fade that offset so the aircraft stays framed.
    const chaseBlend = Math.max(0, Math.cos(this.currentYawOffset)) ** 2;
    this.desiredTarget.copy(this.anchor).lerp(this.baseTarget, chaseBlend);

    if (!this.initialized) {
      this.currentPosition.copy(this.desiredPosition);
      this.currentTarget.copy(this.desiredTarget);
      this.initialized = true;
    }

    const positionAlpha = 1 - Math.exp(-delta * 5.2);
    const targetAlpha = 1 - Math.exp(-delta * 7.2);
    this.currentPosition.lerp(this.desiredPosition, positionAlpha);
    this.currentTarget.lerp(this.desiredTarget, targetAlpha);
    this.camera.position.copy(this.currentPosition);
    this.camera.up.copy(this.worldUp);
    this.camera.lookAt(this.currentTarget);
    this.cameraDistance = this.camera.position.distanceTo(this.anchor);

    const targetFov = THREE.MathUtils.lerp(this.fovRange[0], this.fovRange[1], speed01);
    const nextFov = THREE.MathUtils.lerp(this.camera.fov, targetFov, 1 - Math.exp(-delta * 4.5));
    if (Math.abs(nextFov - this.camera.fov) > 0.001) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
  }

  recenter(): void {
    this.finishPointer();
    this.desiredYawOffset = 0;
    this.desiredPitchOffset = 0;
    this.desiredZoom = 1;
  }

  reset(): void {
    this.finishPointer();
    this.initialized = false;
    this.desiredYawOffset = 0;
    this.currentYawOffset = 0;
    this.desiredPitchOffset = 0;
    this.currentPitchOffset = 0;
    this.desiredZoom = 1;
    this.currentZoom = 1;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.enabledState = false;
    this.finishPointer();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerEnd);
    this.canvas.removeEventListener('pointercancel', this.onPointerEnd);
    this.canvas.removeEventListener('lostpointercapture', this.onLostPointerCapture);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('blur', this.onBlur);
  }

  private addListeners(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerEnd);
    this.canvas.addEventListener('pointercancel', this.onPointerEnd);
    this.canvas.addEventListener('lostpointercapture', this.onLostPointerCapture);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('blur', this.onBlur);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.enabledState || this.pointerId !== null || event.button !== 0) return;
    this.pointerId = event.pointerId;
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.enabledState || event.pointerId !== this.pointerId) return;
    if (event.buttons === 0) {
      this.finishPointer();
      return;
    }
    const deltaX = event.clientX - this.pointerX;
    const deltaY = event.clientY - this.pointerY;
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.desiredYawOffset = shortestAngle(
      this.desiredYawOffset - deltaX * POINTER_YAW_SENSITIVITY,
    );
    this.desiredPitchOffset = THREE.MathUtils.clamp(
      this.desiredPitchOffset + deltaY * POINTER_PITCH_SENSITIVITY,
      this.minimumPitchOffset,
      this.maximumPitchOffset,
    );
    event.preventDefault();
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.finishPointer();
  };

  private readonly onLostPointerCapture = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.pointerId = null;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.enabledState) return;
    const nextDistance = THREE.MathUtils.clamp(
      this.baseDistance * this.desiredZoom * Math.exp(event.deltaY * WHEEL_ZOOM_SENSITIVITY),
      this.minDistance,
      this.maxDistance,
    );
    this.desiredZoom = nextDistance / this.baseDistance;
    event.preventDefault();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (this.enabledState) event.preventDefault();
  };

  private readonly onBlur = (): void => this.finishPointer();

  private finishPointer(): void {
    const pointerId = this.pointerId;
    this.pointerId = null;
    if (pointerId !== null && this.canvas.hasPointerCapture(pointerId)) {
      this.canvas.releasePointerCapture(pointerId);
    }
  }
}
