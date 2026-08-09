import * as THREE from 'three';
import type { CinematicShotName, FlightSnapshot } from './FlightSequence';

interface ShotDefinition {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
  fov: number;
  blendSeconds: number;
  positionDamping: number;
}

const SHOTS: Record<CinematicShotName, ShotDefinition> = {
  inspection: { position: [19, 8.5, 23], target: [0, 2.3, 1], fov: 42, blendSeconds: 0.9, positionDamping: 6 },
  'runway-side': { position: [21, 6.2, 13], target: [0, 2.2, 5], fov: 38, blendSeconds: 1, positionDamping: 6 },
  'rotation-track': { position: [-22, 7, -10], target: [0, 2.4, 8], fov: 40, blendSeconds: 1.15, positionDamping: 5.5 },
  'chase-climb': { position: [0, 10, -27], target: [0, 3, 12], fov: 45, blendSeconds: 1.2, positionDamping: 5.5 },
  'wide-scenic': { position: [42, 24, -38], target: [0, 3, 12], fov: 48, blendSeconds: 1.35, positionDamping: 4.5 },
  'wing-side': { position: [-19, 4.8, 2.2], target: [0, 2.35, 0.4], fov: 44, blendSeconds: 1.1, positionDamping: 6.5 },
  'aerial-chase': { position: [4, 20, -34], target: [0, 3, 14], fov: 47, blendSeconds: 1.2, positionDamping: 5 },
  approach: { position: [23, 7.6, 31], target: [0, 2.35, 4], fov: 42, blendSeconds: 1.3, positionDamping: 5.5 },
  touchdown: { position: [-21, 5.1, 18], target: [0, 2.1, 5], fov: 39, blendSeconds: 0.9, positionDamping: 7 },
  rollout: { position: [21, 5.6, -10], target: [0, 2.15, 7], fov: 39, blendSeconds: 1, positionDamping: 6.5 },
  'final-hero': { position: [20.5, 8.8, 24], target: [0, 2.3, 1], fov: 39, blendSeconds: 1.25, positionDamping: 5 },
};

const smoothstep = (value: number): number => value * value * (3 - 2 * value);

export class CinematicCamera {
  private readonly aircraftPosition = new THREE.Vector3();
  private readonly aircraftQuaternion = new THREE.Quaternion();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly forward = new THREE.Vector3();
  private readonly fromPosition = new THREE.Vector3();
  private readonly toPosition = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly currentPosition = new THREE.Vector3();
  private readonly fromTarget = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly currentTarget = new THREE.Vector3();
  private readonly viewDirection = new THREE.Vector3();
  private activeShot: CinematicShotName | null = null;
  private previousShot: CinematicShotName | null = null;
  private blend = 1;
  private initialized = false;
  private currentFov = 45;
  private disposed = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly aircraft: THREE.Object3D,
  ) {}

  update(deltaSeconds: number, snapshot: Readonly<FlightSnapshot>): void {
    if (this.disposed) return;
    const delta = Number.isFinite(deltaSeconds) ? THREE.MathUtils.clamp(deltaSeconds, 0, 0.1) : 0;
    if (this.activeShot !== snapshot.cameraShot) {
      this.previousShot = this.activeShot ?? snapshot.cameraShot;
      this.activeShot = snapshot.cameraShot;
      this.blend = this.initialized ? 0 : 1;
    }

    const activeShot = this.activeShot ?? snapshot.cameraShot;
    const previousShot = this.previousShot ?? activeShot;
    const activeDefinition = SHOTS[activeShot];
    this.updateBasis();
    this.evaluateShot(previousShot, this.fromPosition, this.fromTarget);
    this.evaluateShot(activeShot, this.toPosition, this.toTarget);
    this.blend = Math.min(1, this.blend + delta / Math.max(0.01, activeDefinition.blendSeconds));
    const blend = smoothstep(this.blend);
    this.desiredPosition.lerpVectors(this.fromPosition, this.toPosition, blend);
    this.desiredTarget.lerpVectors(this.fromTarget, this.toTarget, blend);
    const fromFov = SHOTS[previousShot].fov;
    const desiredFov = THREE.MathUtils.lerp(fromFov, activeDefinition.fov, blend);

    if (!this.initialized) {
      this.currentPosition.copy(this.camera.position);
      this.camera.getWorldDirection(this.viewDirection);
      const lookDistance = Math.max(12, this.camera.position.distanceTo(this.aircraftPosition));
      this.currentTarget.copy(this.camera.position).addScaledVector(this.viewDirection, lookDistance);
      this.currentFov = this.camera.fov;
      this.initialized = true;
    }

    const positionAlpha = 1 - Math.exp(-delta * activeDefinition.positionDamping);
    const targetAlpha = 1 - Math.exp(-delta * 7.5);
    const fovAlpha = 1 - Math.exp(-delta * 6);
    this.currentPosition.lerp(this.desiredPosition, positionAlpha);
    this.currentTarget.lerp(this.desiredTarget, targetAlpha);
    this.currentFov = THREE.MathUtils.lerp(this.currentFov, desiredFov, fovAlpha);
    this.camera.position.copy(this.currentPosition);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.currentTarget);
    if (Math.abs(this.camera.fov - this.currentFov) > 0.001) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }
  }

  snap(snapshot: Readonly<FlightSnapshot>): void {
    if (this.disposed) return;
    this.activeShot = snapshot.cameraShot;
    this.previousShot = snapshot.cameraShot;
    this.blend = 1;
    this.updateBasis();
    this.evaluateShot(snapshot.cameraShot, this.currentPosition, this.currentTarget);
    this.currentFov = SHOTS[snapshot.cameraShot].fov;
    this.camera.position.copy(this.currentPosition);
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.currentTarget);
    this.initialized = true;
  }

  reset(): void {
    this.activeShot = null;
    this.previousShot = null;
    this.blend = 1;
    this.initialized = false;
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }

  private updateBasis(): void {
    this.aircraft.getWorldPosition(this.aircraftPosition);
    this.aircraft.getWorldQuaternion(this.aircraftQuaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.aircraftQuaternion).normalize();
    this.forward.set(0, 0, 1).applyQuaternion(this.aircraftQuaternion).normalize();
  }

  private evaluateShot(
    name: CinematicShotName,
    position: THREE.Vector3,
    target: THREE.Vector3,
  ): void {
    const shot = SHOTS[name];
    position.copy(this.aircraftPosition)
      .addScaledVector(this.right, shot.position[0])
      .addScaledVector(this.up, shot.position[1])
      .addScaledVector(this.forward, shot.position[2]);
    target.copy(this.aircraftPosition)
      .addScaledVector(this.right, shot.target[0])
      .addScaledVector(this.up, shot.target[1])
      .addScaledVector(this.forward, shot.target[2]);
  }
}
