import * as THREE from 'three';
import type { FlightSnapshot } from './FlightSequence';

export type InspectionView = 'front' | 'side' | 'rear' | 'above';

export interface InspectionCameraOptions {
  focusOffset?: THREE.Vector3;
  minDistance?: number;
  maxDistance?: number;
  minPolarAngle?: number;
  maxPolarAngle?: number;
  fov?: number;
}

const PRESETS: Record<InspectionView, readonly [number, number, number]> = {
  front: [14.5, 1.32, 1.02],
  side: [16, 1.42, 1.47],
  rear: [16.5, 1.25, 2.35],
  above: [17.8, 0.48, 0.65],
};

const clampDelta = (delta: number): number =>
  Number.isFinite(delta) ? THREE.MathUtils.clamp(delta, 0, 0.1) : 0;

export class InspectionCamera {
  private readonly focusOffset: THREE.Vector3;
  private readonly minDistance: number;
  private readonly maxDistance: number;
  private readonly minPolarAngle: number;
  private readonly maxPolarAngle: number;
  private readonly inspectionFov: number;
  private readonly current = new THREE.Spherical();
  private readonly desired = new THREE.Spherical();
  private readonly currentPan = new THREE.Vector3();
  private readonly desiredPan = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private readonly cameraUp = new THREE.Vector3();
  private requestedEnabled = true;
  private active = false;
  private hasBeenActive = false;
  private pointerId: number | null = null;
  private dragMode: 'orbit' | 'pan' = 'orbit';
  private pointerX = 0;
  private pointerY = 0;
  private disposed = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly aircraft: THREE.Object3D,
    private readonly canvas: HTMLCanvasElement,
    options: InspectionCameraOptions = {},
  ) {
    this.focusOffset = options.focusOffset?.clone() ?? new THREE.Vector3(0, 2.36, 0);
    this.minDistance = options.minDistance ?? 9;
    this.maxDistance = options.maxDistance ?? 42;
    this.minPolarAngle = options.minPolarAngle ?? 0.24;
    this.maxPolarAngle = options.maxPolarAngle ?? 1.48;
    this.inspectionFov = options.fov ?? 30;
    this.addListeners();
    this.reset();
  }

  get enabled(): boolean {
    return this.active;
  }

  setEnabled(enabled: boolean): void {
    this.requestedEnabled = enabled;
    if (!enabled) {
      this.active = false;
      this.finishPointer();
    }
  }

  update(deltaSeconds: number, snapshot: Readonly<FlightSnapshot>): boolean {
    if (this.disposed) return false;
    const allowed = snapshot.inspectionAllowed || snapshot.phase === 'parked' || snapshot.phase === 'complete';
    const nextActive = this.requestedEnabled && allowed;
    if (nextActive && !this.active && this.hasBeenActive) this.adoptCurrentCamera();
    if (!nextActive && this.active) this.finishPointer();
    this.active = nextActive;
    if (!this.active) return false;
    this.hasBeenActive = true;

    const delta = clampDelta(deltaSeconds);
    const orbitAlpha = 1 - Math.exp(-delta * 10);
    const targetAlpha = 1 - Math.exp(-delta * 12);
    this.current.radius = THREE.MathUtils.lerp(this.current.radius, this.desired.radius, orbitAlpha);
    this.current.phi = THREE.MathUtils.lerp(this.current.phi, this.desired.phi, orbitAlpha);
    this.current.theta = THREE.MathUtils.lerp(this.current.theta, this.desired.theta, orbitAlpha);
    this.currentPan.lerp(this.desiredPan, targetAlpha);
    this.updateAnchor();
    this.desiredTarget.copy(this.anchor).add(this.currentPan);
    this.target.lerp(this.desiredTarget, targetAlpha);
    this.offset.setFromSpherical(this.current);
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.lookAt(this.target);
    const nextFov = THREE.MathUtils.lerp(this.camera.fov, this.inspectionFov, targetAlpha);
    if (Math.abs(nextFov - this.camera.fov) > 0.001) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
    return true;
  }

  setView(view: InspectionView, immediate = false): void {
    const [radius, phi, theta] = PRESETS[view];
    this.desired.set(radius, phi, theta);
    this.desiredPan.set(0, 0, 0);
    if (immediate) this.snap();
  }

  reset(view: InspectionView = 'front'): void {
    this.setView(view);
    this.current.copy(this.desired);
    this.currentPan.set(0, 0, 0);
    this.snap();
  }

  snap(view?: InspectionView): void {
    if (view) this.setView(view);
    this.current.copy(this.desired);
    this.currentPan.copy(this.desiredPan);
    this.updateAnchor();
    this.target.copy(this.anchor).add(this.currentPan);
    this.offset.setFromSpherical(this.current);
    this.camera.position.copy(this.target).add(this.offset);
    this.camera.fov = this.inspectionFov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.target);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
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

  private updateAnchor(): void {
    this.anchor.copy(this.focusOffset);
    this.aircraft.localToWorld(this.anchor);
  }

  private adoptCurrentCamera(): void {
    this.updateAnchor();
    this.target.copy(this.anchor);
    this.currentPan.set(0, 0, 0);
    this.desiredPan.set(0, 0, 0);
    this.offset.copy(this.camera.position).sub(this.target);
    if (this.offset.lengthSq() < 0.01) this.offset.set(8, 8, 14);
    this.current.setFromVector3(this.offset);
    this.current.radius = THREE.MathUtils.clamp(this.current.radius, this.minDistance, this.maxDistance);
    this.current.phi = THREE.MathUtils.clamp(this.current.phi, this.minPolarAngle, this.maxPolarAngle);
    this.desired.copy(this.current);
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
    if (!this.active || this.pointerId !== null) return;
    this.pointerId = event.pointerId;
    this.dragMode = event.button === 1 || event.button === 2 || event.shiftKey ? 'pan' : 'orbit';
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.active || event.pointerId !== this.pointerId) return;
    const deltaX = event.clientX - this.pointerX;
    const deltaY = event.clientY - this.pointerY;
    this.pointerX = event.clientX;
    this.pointerY = event.clientY;
    if (this.dragMode === 'orbit') {
      this.desired.theta -= deltaX * 0.006;
      this.desired.phi = THREE.MathUtils.clamp(
        this.desired.phi + deltaY * 0.005,
        this.minPolarAngle,
        this.maxPolarAngle,
      );
    } else {
      const scale = this.desired.radius * 0.0014;
      this.cameraRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
      this.cameraUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
      this.desiredPan.addScaledVector(this.cameraRight, -deltaX * scale);
      this.desiredPan.addScaledVector(this.cameraUp, deltaY * scale);
      this.desiredPan.y = THREE.MathUtils.clamp(this.desiredPan.y, -2.5, 3.5);
      const horizontal = Math.hypot(this.desiredPan.x, this.desiredPan.z);
      if (horizontal > 4.5) {
        const factor = 4.5 / horizontal;
        this.desiredPan.x *= factor;
        this.desiredPan.z *= factor;
      }
    }
    event.preventDefault();
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.finishPointer();
  };

  private readonly onLostPointerCapture = (event: PointerEvent): void => {
    if (event.pointerId === this.pointerId) this.pointerId = null;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.active) return;
    this.desired.radius = THREE.MathUtils.clamp(
      this.desired.radius * Math.exp(event.deltaY * 0.0012),
      this.minDistance,
      this.maxDistance,
    );
    event.preventDefault();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    if (this.active) event.preventDefault();
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
